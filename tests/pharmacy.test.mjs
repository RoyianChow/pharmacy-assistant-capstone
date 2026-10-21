import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
function compile(path, replacements = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries({ "server-only": moduleUrl("export {};"), ...replacements })) code = code.replaceAll(`"${from}"`, `"${to}"`);
  return moduleUrl(code);
}

// Exercise actual SQLite storage, validation and routes with isolated on-disk files.
// Staff access is stubbed so these tests focus on storage; factory-selection tests
// use a no-network PostgreSQL constructor. No provider or app database is used.
const questions = compile("../lib/assessment/questions.ts");
const engine = compile("../lib/assessment/engine.ts", { "./questions": questions });
const types = compile("../lib/pharmacy/types.ts");
const validation = compile("../lib/pharmacy/validation.ts", { "../assessment/engine": engine, "./types": types });
const postgresStub = moduleUrl(`export class PostgresPharmacyStore {
  constructor(connectionString) { this.connectionString = connectionString; }
  async close() {}
}`);
const staffStub = moduleUrl(`export async function requireStaffApi() {
  return globalThis.__pharmacyTestStaffDenied
    ? Response.json({ error: "Staff sign-in required." }, { status: 401 })
    : null;
}`);
const storeUrl = compile("../lib/pharmacy/store.ts", { "./validation": validation, "./postgres-store": postgresStub });
const http = compile("../lib/pharmacy/http.ts", { "./validation": validation });
const replacements = { "next/server": moduleUrl("export async function connection() {}"), "@/lib/pharmacy/http": http, "@/lib/pharmacy/store": storeUrl, "@/lib/pharmacy/validation": validation, "@/lib/auth/staff": staffStub };
const routes = await import(compile("../app/api/pharmacy/cases/route.ts", replacements));
const detail = await import(compile("../app/api/pharmacy/cases/[id]/route.ts", replacements));
const { PharmacyStore, getPharmacyStore } = await import(storeUrl);
const { PostgresPharmacyStore: FakePostgresStore } = await import(postgresStub);
const { errorResponse } = await import(http);
const { validateSubmission } = await import(validation);
const { assess, nextQuestions } = await import(engine);
const environmentKeys = ["PHARMACY_DATABASE_PATH", "DATABASE_URL", "NEON_DB", "POSTGRES_URL", "VERCEL"];
let originalEnvironment;
let directory;

beforeEach(() => {
  originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  for (const key of environmentKeys) delete process.env[key];
  directory = mkdtempSync(join(tmpdir(), "pharmacy-api-"));
  process.env.PHARMACY_DATABASE_PATH = join(directory, "nested", "cases.sqlite");
});
afterEach(async () => {
  for (const store of globalThis.pharmacyStores?.values() ?? []) store.close();
  globalThis.pharmacyStores?.clear();
  for (const store of globalThis.pharmacyPostgresStores?.values() ?? []) await store.close();
  globalThis.pharmacyPostgresStores?.clear();
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
  delete globalThis.__pharmacyTestStaffDenied;
  rmSync(directory, { recursive: true, force: true });
});

const defaults = { emergency: "no", age: "18to64", ontario: "yes", concern: "allergies", symptoms: "Sneezing and an itchy nose", duration: "Three days, staying the same", severity: "mild", warnings: "no", details: "Happens around pollen", pregnancy: "no", medicines: "None", allergies: "None known", conditions: "None", tried: "Nothing yet" };
function answers(overrides = {}) {
  const values = { ...defaults, ...overrides };
  const result = [];
  while (!assess(result)) {
    const question = nextQuestions(result)[0];
    if (!question || result.length >= 32) break;
    result.push({ questionId: question.id, value: values[question.id] ?? "no" });
  }
  return result;
}
function submission(overrides = {}) {
  return { submissionKey: randomUUID(), patient: { displayName: "Fictional Patient A", contactPreference: "in_person", contact: "" }, answers: answers(), consentToShare: true, ...overrides };
}
function request(body, options = {}) {
  const { method = "POST", path = "", headers = {} } = options;
  return new Request(`https://pharmacy.example/api/pharmacy/cases${path}`, { method, headers: { "Content-Type": "application/json", Origin: "https://pharmacy.example", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const context = id => ({ params: Promise.resolve({ id }) });
const getQueue = suffix => routes.GET(request(undefined, { method: "GET", path: suffix ?? "" }));
async function create(body = submission()) {
  const response = await routes.POST(request(body));
  assert.equal(response.status, 201);
  return (await response.json()).receipt;
}
const review = overrides => ({ status: "in_review", reviewerName: "Demo Pharmacist", reviewNotes: "Review started.", version: 1, ...overrides });
function privateResponse(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("store import is lazy and a submitted case survives closing and reopening SQLite", () => {
  const path = process.env.PHARMACY_DATABASE_PATH;
  assert.equal(existsSync(path), false);
  let store = new PharmacyStore(path);
  let id;
  try { id = store.submit(validateSubmission(submission())).receipt.id; }
  finally { store.close(); }
  store = new PharmacyStore(path);
  try {
    const loaded = store.get(id);
    assert.equal(loaded.patient.displayName, "Fictional Patient A");
    assert.equal(loaded.answers.length, 14);
    assert.equal(loaded.result.kind, "pharmacist");
    assert.deepEqual(loaded.reviewHistory, []);
    assert.equal(store.list({ q: "" }).total, 1);
  } finally { store.close(); }
});

test("async storage factory selects and reuses SQLite only outside Vercel without hosted configuration", async () => {
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
  const first = await getPharmacyStore();
  assert.ok(first instanceof PharmacyStore);
  assert.equal(await getPharmacyStore(), first);
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), true);
  assert.equal(globalThis.pharmacyPostgresStores?.size ?? 0, 0);
});

test("hosted storage selection honours URL precedence, whitespace and shared pools without making connections", async () => {
  const primary = "postgresql://demo:synthetic@primary.invalid/pharmacy";
  const neon = "postgres://demo:synthetic@neon.invalid/pharmacy";
  const fallback = "postgresql://demo:synthetic@fallback.invalid/pharmacy";
  process.env.VERCEL = "1";
  process.env.DATABASE_URL = `  ${primary}  `;
  process.env.NEON_DB = neon;
  process.env.POSTGRES_URL = fallback;
  const first = await getPharmacyStore();
  assert.ok(first instanceof FakePostgresStore);
  assert.equal(first.connectionString, primary);
  assert.equal(await getPharmacyStore(), first);
  process.env.DATABASE_URL = "  ";
  assert.equal((await getPharmacyStore()).connectionString, neon);
  delete process.env.NEON_DB;
  assert.equal((await getPharmacyStore()).connectionString, fallback);
  assert.equal(globalThis.pharmacyPostgresStores.size, 3);
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
});

test("Vercel without a database rejects submissions with a safe 503 and never falls back to a file", async t => {
  process.env.VERCEL = "1";
  const logging = t.mock.method(console, "error", () => {});
  const response = await routes.POST(request(submission()));
  assert.equal(response.status, 503);
  privateResponse(response);
  assert.deepEqual(await response.json(), { error: "The pharmacy dashboard is not configured yet. Please contact the site owner." });
  assert.deepEqual(logging.mock.calls.map(call => call.arguments), [["[pharmacy-storage]", "database_not_configured"]]);
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
  assert.equal(globalThis.pharmacyPostgresStores?.size ?? 0, 0);
});

test("invalid database URLs reject before importing a driver and never expose credentials in errors or logs", async t => {
  const logging = t.mock.method(console, "error", () => {});
  for (const key of ["DATABASE_URL", "NEON_DB", "POSTGRES_URL"]) {
    process.env[key] = "https://sensitive-user:synthetic-password@private-host.invalid/db?token=synthetic-token";
    const response = await routes.POST(request(submission()));
    assert.equal(response.status, 503);
    privateResponse(response);
    assert.deepEqual(await response.json(), { error: "The pharmacy dashboard connection needs to be configured by the site owner." });
    delete process.env[key];
  }
  assert.deepEqual(logging.mock.calls.map(call => call.arguments), Array.from({ length: 3 }, () => ["[pharmacy-storage]", "database_configuration_invalid"]));
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
  assert.equal(globalThis.pharmacyPostgresStores?.size ?? 0, 0);
});

test("database failures expose only allowlisted log categories and a generic response", async t => {
  const logging = t.mock.method(console, "error", () => {});
  for (const [code, expected] of [["28P01", "database_authentication_failed"], ["ECONNREFUSED", "database_connection_refused"], ["private-secret-code", "database_operation_failed"], ["__proto__", "database_operation_failed"]]) {
    const failure = Object.assign(new Error("postgresql://private:synthetic-secret@host.invalid; private patient details"), { code });
    const response = errorResponse(failure);
    assert.equal(response.status, 503);
    privateResponse(response);
    assert.deepEqual(await response.json(), { error: "The pharmacy service is unavailable. Please try again." });
    assert.deepEqual(logging.mock.calls.at(-1).arguments, ["[pharmacy-storage]", expected]);
  }
});

test("staff access denial blocks queue reads, detail reads and updates before accessing storage", async () => {
  globalThis.__pharmacyTestStaffDenied = true;
  process.env.DATABASE_URL = "invalid-database-url";
  assert.equal((await getQueue()).status, 401);
  assert.equal((await detail.GET(request(undefined, { method: "GET" }), context(randomUUID()))).status, 401);
  assert.equal((await detail.PATCH(request(review(), { method: "PATCH" }), context(randomUUID()))).status, 401);
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
});

test("patient submission remains available without a staff session", async () => {
  globalThis.__pharmacyTestStaffDenied = true;
  const receipt = await create();
  assert.match(receipt.reference, /^MA-[0-9A-F]{12}$/);
});

test("submission recomputes the result and summary and exposes only a receipt", async () => {
  const input = submission({ result: { kind: "prescribed" }, summary: [{ value: "forged" }], concern: "forged" });
  const response = await routes.POST(request(input));
  assert.equal(response.status, 201);
  privateResponse(response);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["receipt"]);
  assert.deepEqual(Object.keys(body.receipt).sort(), ["createdAt", "id", "reference", "status"]);
  assert.match(body.receipt.reference, /^MA-[0-9A-F]{12}$/);
  const fetched = await detail.GET(request(undefined, { method: "GET" }), context(body.receipt.id));
  privateResponse(fetched);
  const stored = (await fetched.json()).case;
  assert.equal(stored.result.kind, "pharmacist");
  assert.match(stored.concern, /Seasonal allergies/);
  assert.equal(stored.summary.length, 14);
  assert.equal(JSON.stringify(stored).includes("forged"), false);
});

test("retrying the same submission returns the existing receipt without duplicates", async () => {
  const input = submission();
  const first = await create(input);
  const retry = await routes.POST(request(input));
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).receipt, first);
  assert.equal((await (await getQueue()).json()).total, 1);
});

test("reusing a submission key with different accepted details returns a conflict", async () => {
  const input = submission();
  await create(input);
  input.patient.displayName = "Different fictional patient";
  const conflict = await routes.POST(request(input));
  assert.equal(conflict.status, 409);
  privateResponse(conflict);
  assert.equal((await (await getQueue()).json()).total, 1);
});

test("incomplete intake and emergency, urgent, child and outside-Ontario pathways cannot be submitted", async () => {
  const disallowed = [[], answers().slice(0, -1), answers({ emergency: "yes" }), answers({ severity: "severe" }), answers({ symptoms: "I have eye pain" }), answers({ age: "under18" }), answers({ ontario: "no" }), answers({ ontario: "unsure" })];
  for (const value of disallowed) {
    const response = await routes.POST(request(submission({ answers: value })));
    assert.equal(response.status, 400);
    privateResponse(response);
  }
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
});

test("terminal uncertainty and unmatched concerns remain available for professional review", async () => {
  for (const value of [answers({ warnings: "unsure" }), answers({ concern: "other" })]) await create(submission({ answers: value }));
  const body = await (await getQueue()).json();
  assert.equal(body.total, 2);
  assert.deepEqual(new Set(body.cases.map(item => item.outcome)), new Set(["incomplete", "outside_scope"]));
});

test("consent, patient details, answer ordering and submission keys are validated", async () => {
  const invalid = [null, { consentToShare: false }, { consentToShare: "true" }, { submissionKey: "bad-key" }, { answers: [{ questionId: "concern", value: "allergies" }] }, { patient: { displayName: " ", contactPreference: "in_person" } }, { patient: { displayName: "A".repeat(81), contactPreference: "in_person" } }, { patient: { displayName: "Demo", contactPreference: "sms", contact: "5555555555" } }, { patient: { displayName: "Demo", contactPreference: "email", contact: "invalid" } }, { patient: { displayName: "Demo", contactPreference: "phone", contact: "12" } }];
  for (const changes of invalid) {
    const response = await routes.POST(request(changes === null ? null : submission(changes)));
    assert.equal(response.status, 400);
  }
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
});

test("in-person preference discards stale contact details while selected email and phone persist", async () => {
  for (const [contactPreference, contact] of [["in_person", "discard@example.test"], ["email", "fictional@example.test"], ["phone", "(416) 555-0100"]]) {
    const item = await create(submission({ patient: { displayName: "Fictional contact", contactPreference, contact } }));
    const stored = (await (await detail.GET(request(undefined, { method: "GET" }), context(item.id))).json()).case;
    assert.equal(stored.patient.contact, contactPreference === "in_person" ? "" : contact);
  }
});

test("review saves append audit history without altering the submitted snapshot", async () => {
  const receipt = await create();
  const fetchCase = async () => (await (await detail.GET(request(undefined, { method: "GET" }), context(receipt.id))).json()).case;
  const original = await fetchCase();
  const first = await detail.PATCH(request(review(), { method: "PATCH" }), context(receipt.id));
  assert.equal(first.status, 200);
  privateResponse(first);
  const reviewed = (await first.json()).case;
  assert.equal(reviewed.status, "in_review");
  assert.equal(reviewed.version, 2);
  const complete = await detail.PATCH(request(review({ status: "completed", reviewNotes: "Demo review completed; follow-up discussed.", version: 2 }), { method: "PATCH" }), context(receipt.id));
  assert.equal(complete.status, 200);
  const reopened = await detail.PATCH(request(review({ status: "new", reviewNotes: "Reopened for additional review.", version: 3 }), { method: "PATCH" }), context(receipt.id));
  assert.equal(reopened.status, 200);
  const final = await fetchCase();
  for (const field of ["patient", "answers", "summary", "result", "concern", "createdAt"]) assert.deepEqual(final[field], original[field]);
  assert.equal(final.version, 4);
  assert.deepEqual(final.reviewHistory.map(item => item.status), ["in_review", "completed", "new"]);
  assert.equal(final.reviewHistory[1].notes, "Demo review completed; follow-up discussed.");
});

test("stale review versions cannot overwrite saved notes or append an audit event", async () => {
  const receipt = await create();
  await detail.PATCH(request(review(), { method: "PATCH" }), context(receipt.id));
  const response = await detail.PATCH(request(review({ reviewNotes: "Stale overwrite" }), { method: "PATCH" }), context(receipt.id));
  assert.equal(response.status, 409);
  const saved = (await (await detail.GET(request(undefined, { method: "GET" }), context(receipt.id))).json()).case;
  assert.equal(saved.reviewNotes, "Review started.");
  assert.equal(saved.reviewHistory.length, 1);
});

test("invalid statuses, unnamed reviewers, unversioned updates and empty completion notes are rejected", async () => {
  const receipt = await create();
  for (const changes of [{ status: "prescribed" }, { reviewerName: "  " }, { reviewerName: "A".repeat(81) }, { reviewNotes: "A".repeat(4001) }, { status: "completed", reviewNotes: " " }, { version: 0 }, { version: "1" }]) {
    const response = await detail.PATCH(request(review(changes), { method: "PATCH" }), context(receipt.id));
    assert.equal(response.status, 400);
  }
  const item = (await (await detail.GET(request(undefined, { method: "GET" }), context(receipt.id))).json()).case;
  assert.equal(item.version, 1);
  assert.equal(item.reviewHistory.length, 0);
});

test("search and status filters use literal parameters and counts reflect the whole queue", async () => {
  const first = await create(submission({ patient: { displayName: "Demo_100%", contactPreference: "in_person", contact: "" } }));
  await create(submission({ patient: { displayName: "Other patient", contactPreference: "in_person", contact: "" } }));
  await detail.PATCH(request(review(), { method: "PATCH" }), context(first.id));
  let queue = await (await getQueue("?status=new")).json();
  assert.equal(queue.cases.length, 1);
  assert.equal(queue.total, 2);
  assert.deepEqual(queue.counts, { new: 1, in_review: 1, completed: 0 });
  queue = await (await getQueue("?q=" + encodeURIComponent("_100%"))).json();
  assert.equal(queue.cases[0].id, first.id);
  assert.equal(queue.cases.length, 1);
  assert.equal((await (await getQueue("?q=" + encodeURIComponent("' OR 1=1 --"))).json()).cases.length, 0);
  assert.equal((await getQueue("?status=bad")).status, 400);
  assert.equal((await getQueue("?q=" + "a".repeat(121))).status, 400);
});

test("missing and malformed identifiers return 404 for reads and updates", async () => {
  for (const id of [randomUUID(), "../secret"]) {
    assert.equal((await detail.GET(request(undefined, { method: "GET" }), context(id))).status, 404);
    assert.equal((await detail.PATCH(request(review(), { method: "PATCH" }), context(id))).status, 404);
  }
});

test("cross-origin and non-JSON mutations are rejected before creating storage", async () => {
  assert.equal((await routes.POST(request(submission(), { headers: { Origin: "https://elsewhere.example" } }))).status, 403);
  assert.equal((await routes.POST(request(submission(), { headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  assert.equal((await routes.POST(request(submission(), { headers: { "Content-Type": "text/plain" } }))).status, 415);
  assert.equal((await routes.GET(request(undefined, { method: "GET", headers: { Origin: "https://elsewhere.example" } }))).status, 403);
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
});

test("malformed and oversized streamed bodies are bounded without exposing health details", async () => {
  const malformed = await routes.POST(new Request("https://pharmacy.example/api/pharmacy/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: "private health text {" }));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.text()).includes("private health text"), false);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(24_000)); controller.enqueue(new Uint8Array(24_001)); }, cancel() { cancelled = true; } });
  const oversized = await routes.POST(new Request("https://pharmacy.example/api/pharmacy/cases", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body, duplex: "half" }));
  assert.equal(oversized.status, 413);
  privateResponse(oversized);
  assert.equal(cancelled, true);
  assert.equal(existsSync(process.env.PHARMACY_DATABASE_PATH), false);
});
