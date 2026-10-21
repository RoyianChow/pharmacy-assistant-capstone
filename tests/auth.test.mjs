import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, test } from "node:test";
import ts from "typescript";

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
function compile(path, replacements = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries({ "server-only": moduleUrl("export {};"), ...replacements })) code = code.replaceAll(`"${from}"`, `"${to}"`);
  return moduleUrl(code);
}
const configUrl = compile("../lib/auth/config.ts");
const { hasAuthConfiguration, isLocalAuthDemo, isAuthorizedStaff } = await import(configUrl);
const serverStub = moduleUrl("export function getAuth() { return { getSession: async () => globalThis.__authTestSession }; }");
const redirectStub = moduleUrl("export function redirect(url) { throw new Error(`redirect:${url}`); }");
const { getStaffAccess, requireStaffApi, requireStaffPage } = await import(compile("../lib/auth/staff.ts", { "./config": configUrl, "./server": serverStub, "next/navigation": redirectStub, "next/server": moduleUrl("export async function connection() {}") }));
const keys = ["NODE_ENV", "VERCEL", "NEON_DB", "DATABASE_URL", "POSTGRES_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "PHARMACY_STAFF_EMAILS", "PHARMACY_STAFF_USER_IDS"];
let original;
beforeEach(() => {
  original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.NODE_ENV = "test";
  globalThis.__authTestSession = { data: null, error: null };
});
afterEach(() => {
  for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
  delete globalThis.__authTestSession;
});
function configure() {
  process.env.NEON_AUTH_BASE_URL = "https://auth.example.test/neondb/auth";
  process.env.NEON_AUTH_COOKIE_SECRET = "synthetic-test-secret-with-more-than-32-characters";
}
const staff = { id: "staff-123", email: "staff@example.com", name: "Test Staff", emailVerified: true };

test("only an unconfigured development SQLite app gets the local demo exception", () => {
  assert.equal(isLocalAuthDemo({ NODE_ENV: "development" }), true);
  for (const field of ["NEON_DB", "DATABASE_URL", "POSTGRES_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "VERCEL"]) assert.equal(isLocalAuthDemo({ NODE_ENV: "development", [field]: "configured" }), false);
  assert.equal(isLocalAuthDemo({ NODE_ENV: "production" }), false);
});
test("auth configuration rejects absent, insecure or invalid URLs and short secrets", () => {
  assert.equal(hasAuthConfiguration({}), false);
  for (const url of ["invalid", "http://auth.example.test", "https://user:secret@auth.example.test"]) assert.equal(hasAuthConfiguration({ NEON_AUTH_BASE_URL: url, NEON_AUTH_COOKIE_SECRET: "x".repeat(40) }), false);
  assert.equal(hasAuthConfiguration({ NEON_AUTH_BASE_URL: "https://auth.example.test", NEON_AUTH_COOKIE_SECRET: "short" }), false);
  assert.equal(hasAuthConfiguration({ NEON_AUTH_BASE_URL: "https://auth.example.test", NEON_AUTH_COOKIE_SECRET: "x".repeat(40) }), true);
});
test("registration never grants staff access and email grants require verification", () => {
  assert.equal(isAuthorizedStaff(staff, {}), false);
  assert.equal(isAuthorizedStaff({ ...staff, emailVerified: false }, { PHARMACY_STAFF_EMAILS: staff.email }), false);
  assert.equal(isAuthorizedStaff(staff, { PHARMACY_STAFF_EMAILS: " STAFF@example.COM , second@example.com " }), true);
  assert.equal(isAuthorizedStaff(staff, { PHARMACY_STAFF_EMAILS: "other@example.com" }), false);
  assert.equal(isAuthorizedStaff(staff, { PHARMACY_STAFF_USER_IDS: "staff-1234" }), false);
  assert.equal(isAuthorizedStaff(staff, { PHARMACY_STAFF_USER_IDS: "staff-123" }), true);
});
test("remote storage without auth fails closed and the local demo remains accessible", async () => {
  assert.deepEqual(await getStaffAccess(), { status: "demo" });
  assert.equal(await requireStaffApi(), null);
  process.env.NEON_DB = "configured";
  const response = await requireStaffApi();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("unauthenticated API requests get 401 and page requests redirect", async () => {
  configure();
  assert.equal((await requireStaffApi()).status, 401);
  await assert.rejects(() => requireStaffPage(), /redirect:\/auth\/sign-in\?reason=signin/);
});
test("signed-in users outside the allowlist cannot access the dashboard API", async () => {
  configure();
  globalThis.__authTestSession = { data: { user: staff }, error: null };
  const response = await requireStaffApi();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, "approval");
});
test("unverified allowlisted accounts are denied; verified staff receive narrow identity", async () => {
  configure();
  process.env.PHARMACY_STAFF_EMAILS = staff.email;
  globalThis.__authTestSession = { data: { user: { ...staff, emailVerified: false } }, error: null };
  assert.equal((await requireStaffApi()).status, 403);
  globalThis.__authTestSession = { data: { user: staff, token: "must-not-be-returned" }, error: null };
  assert.equal(await requireStaffApi(), null);
  assert.deepEqual(await requireStaffPage(), { status: "authorized", user: { id: staff.id, email: staff.email, name: staff.name } });
});
test("provider session errors deny access without exposing provider details", async () => {
  configure();
  globalThis.__authTestSession = { data: null, error: { message: "sensitive-provider-detail" } };
  const response = await requireStaffApi();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /sensitive-provider-detail/);
});
