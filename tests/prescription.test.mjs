import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
function compile(path, replacements = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries({ "server-only": moduleUrl("export {};"), ...replacements })) {
    code = code.replaceAll(`"${from}"`, `"${to}"`);
  }
  return moduleUrl(code);
}

// Run the actual parser, extraction, upload service and route. No provider,
// auth session, environment file, or database is accessed by this suite.
const questions = compile("../lib/assessment/questions.ts");
const engine = compile("../lib/assessment/engine.ts", { "./questions": questions });
const pharmacyTypes = compile("../lib/pharmacy/types.ts");
const validation = compile("../lib/pharmacy/validation.ts", { "../assessment/engine": engine, "./types": pharmacyTypes });
const http = compile("../lib/pharmacy/http.ts", { "./validation": validation });
const types = compile("../lib/prescription/types.ts");
const ocrResult = compile("../lib/prescription/ocr-result.ts");
const extraction = compile("../lib/prescription/extract.ts");
const service = compile("../lib/prescription/service.ts", { "./types": types, "./ocr-result": ocrResult });
const staff = moduleUrl(`export async function requireStaffApi() {
  return globalThis.__prescriptionTestStaffDenied
    ? Response.json({ error: "Staff sign-in required." }, { status: globalThis.__prescriptionTestStaffDenied,
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
    : null;
}`);
const route = await import(compile("../app/api/prescriptions/verify/route.ts", {
  "@/lib/auth/staff": staff,
  "@/lib/pharmacy/http": http,
  "@/lib/pharmacy/validation": validation,
  "@/lib/prescription/extract": extraction,
  "@/lib/prescription/service": service,
}));
const { parseOcrResult } = await import(ocrResult);
const { extractPrescription } = await import(extraction);
const { prescriptionAvailability } = await import(service);
const { MAX_PRESCRIPTION_BYTES } = await import(types);
const environmentKeys = ["NODE_ENV", "VERCEL", "PADDLEOCR_SERVICE_URL", "PADDLEOCR_SERVICE_TOKEN"];
let originalEnvironment;
let originalFetch;
let fetchCalls;

beforeEach(() => {
  originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  originalFetch = globalThis.fetch;
  for (const key of environmentKeys) delete process.env[key];
  process.env.NODE_ENV = "development";
  process.env.PADDLEOCR_SERVICE_URL = "http://127.0.0.1:8001";
  fetchCalls = [];
  mockFetch(() => { throw new Error("Unexpected provider request in a rejection test"); });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__prescriptionTestStaffDenied;
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

function mockFetch(respond) {
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    return respond(url, options);
  };
}

const demoFields = [
  ["patient", "Patient", "Alex Example"],
  ["dateOfBirth", "Date of birth", "1990-01-15"],
  ["dateIssued", "Date issued", "2026-10-31"],
  ["prescriber", "Prescriber", "Dr. Taylor Sample"],
  ["licence", "Licence", "DEMO-0000 (invalid)"],
  ["clinicPhone", "Clinic phone", "416-555-0100"],
  ["medication", "Medication", "Example Medication (fictional)"],
  ["strength", "Strength", "10 mg"],
  ["directions", "Directions", "For OCR testing only. Do not administer."],
  ["quantity", "Quantity", "14 tablets (demo)"],
  ["refills", "Refills", "0"],
  ["signature", "Signature", "UNSIGNED DEMO"],
];
function line(text, y = 10, confidence = 0.99, x = 10, width = 900) {
  return { text, confidence, box: [[x, y], [x + width, y], [x + width, y + 20], [x, y + 20]] };
}
function ocr(lines = demoFields.map(([, label, value], index) => line(`${label}: ${value}`, 50 + index * 35))) {
  return { engine: "PaddleOCR", model: "test-PP-OCRv5-mobile", lines, durationMs: 123, image: { width: 1700, height: 2200 } };
}
const pngHeader = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegHeader = Uint8Array.from([255, 216, 255, 224]);
function upload(body = pngHeader, headers = {}, extras = {}) {
  return new Request("https://pharmacy.example/api/prescriptions/verify", {
    method: "POST",
    headers: { Origin: "https://pharmacy.example", "Content-Type": "image/png", "X-Demo-Consent": "true", ...headers },
    ...(body === null ? {} : { body }),
    ...extras,
  });
}
function privateResponse(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
const codes = result => result.checks.map(item => item.code);

test("all twelve demo fields retain exact values and provenance while requiring manual review", () => {
  const source = ocr();
  const parsed = parseOcrResult(source);
  const result = extractPrescription(parsed);
  assert.equal(result.fields.length, 12);
  for (const [key, label, value] of demoFields) {
    const field = result.fields.find(item => item.key === key);
    assert.equal(field.value, value, key);
    assert.equal(field.sourceText, `${label}: ${value}`);
    assert.equal(field.confidence, 0.99);
    assert.equal(field.needsReview, false);
  }
  assert.equal(result.isDemo, true);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(codes(result), ["demo_document", "signature_unverified", "manual_review"]);
  assert.deepEqual(result.ocr, source);
  assert.equal(fetchCalls.length, 0);
});

test("split label and value boxes join in reading order only when they share a row", () => {
  const result = extractPrescription(ocr([
    line("Alex Example", 50, 0.87, 180, 250),
    line("Patient:", 51, 0.99, 10, 130),
    line("Date of birth:", 100, 0.99, 10, 140),
    line("1990-01-15", 135, 0.99, 180, 250),
  ]));
  const patient = result.fields.find(item => item.key === "patient");
  assert.equal(patient.value, "Alex Example");
  assert.equal(patient.sourceText, "Patient: Alex Example");
  assert.equal(patient.confidence, 0.87);
  assert.equal(patient.needsReview, true);
  assert.equal(result.fields.find(item => item.key === "dateOfBirth").value, null);
  assert.ok(codes(result).includes("low_confidence"));
});

test("separate labeled columns on one row keep their own values and confidence", () => {
  const result = extractPrescription(ocr([
    line("1990-01-15", 50, 0.87, 750, 250),
    line("Patient: Alex Example", 50, 0.99, 10, 350),
    line("Date of birth:", 51, 0.98, 500, 200),
  ]));
  const patient = result.fields.find(item => item.key === "patient");
  const birthDate = result.fields.find(item => item.key === "dateOfBirth");
  assert.equal(patient.value, "Alex Example");
  assert.equal(patient.sourceText, "Patient: Alex Example");
  assert.equal(patient.confidence, 0.99);
  assert.equal(patient.needsReview, false);
  assert.equal(birthDate.value, "1990-01-15");
  assert.equal(birthDate.sourceText, "Date of birth: 1990-01-15");
  assert.equal(birthDate.confidence, 0.87);
  assert.equal(birthDate.needsReview, true);
});

test("conflicting repeated values stay unset instead of selecting a prescription value", () => {
  const result = extractPrescription(ocr([
    line("Quantity: 14 tablets", 50), line("Qty: 40 tablets", 85),
    line("Refills: 0", 120), line("Repeats: 0", 155),
  ]));
  const quantity = result.fields.find(item => item.key === "quantity");
  assert.deepEqual({ value: quantity.value, confidence: quantity.confidence, sourceText: quantity.sourceText, needsReview: quantity.needsReview },
    { value: null, confidence: null, sourceText: null, needsReview: true });
  assert.ok(codes(result).includes("ambiguous_quantity"));
  assert.equal(result.fields.find(item => item.key === "refills").value, "0");
  assert.ok(!codes(result).includes("ambiguous_refills"));
  assert.equal(result.reviewRequired, true);
});

test("empty, low-confidence and apparently signed documents never become verified prescriptions", () => {
  const empty = extractPrescription(ocr([]));
  assert.ok(empty.fields.every(field => field.value === null && field.needsReview));
  assert.ok(codes(empty).includes("no_text"));
  assert.ok(codes(empty).includes("missing_fields"));
  assert.ok(codes(empty).includes("signature_unverified"));
  const low = extractPrescription(ocr([line("Patient: Alex Example", 50, 0.2), line("Signature: Text only", 100)]));
  assert.equal(low.fields.find(field => field.key === "patient").needsReview, true);
  assert.equal(low.isDemo, false);
  assert.ok(codes(low).includes("low_confidence"));
  for (const result of [empty, low]) {
    assert.equal(result.reviewRequired, true);
    assert.ok(codes(result).includes("manual_review"));
    assert.ok(!Object.hasOwn(result, "verified"));
    assert.ok(!Object.hasOwn(result, "validPrescription"));
  }
});

test("OCR response validation rejects malformed data and unsafe shape or numeric bounds", () => {
  const mutations = [
    value => { value.engine = "untrusted-engine"; },
    value => { value.model = "x".repeat(201); },
    value => { value.image.width = 0; },
    value => { value.image.height = 2.5; },
    value => { value.image = { width: 4001, height: 4000 }; },
    value => { value.durationMs = -1; },
    value => { value.durationMs = NaN; },
    value => { value.lines = Array.from({ length: 501 }, () => line("text")); },
    value => { value.lines[0].text = "x".repeat(2001); },
    value => { value.lines[0].confidence = 1.01; },
    value => { value.lines[0].confidence = -0.1; },
    value => { value.lines[0].confidence = Infinity; },
    value => { value.lines[0].box = [[0, 0]]; },
    value => { value.lines[0].box[0] = [-1, 0]; },
    value => { value.lines[0].box[0] = [1701, 0]; },
    value => { value.lines[0].box[0] = [0, 2201]; },
    value => { value.lines[0].box[0] = [0, NaN]; },
    value => { value.lines = Array.from({ length: 31 }, () => line("x".repeat(2000))); },
  ];
  for (const value of [null, [], "text", {}, ...mutations.map(mutate => { const value = ocr(); mutate(value); return value; })]) {
    assert.throws(() => parseOcrResult(value));
  }
  const boundary = ocr(Array.from({ length: 30 }, () => line("x".repeat(2000), 0, 0)));
  boundary.image = { width: 4000, height: 4000 };
  boundary.durationMs = 0;
  assert.equal(parseOcrResult(boundary).lines.length, 30);
});

test("raw PNG bytes reach only the configured OCR endpoint and twelve fields return privately", async () => {
  const image = readFileSync(new URL("../public/demo/ontario-demo-prescription.png", import.meta.url));
  mockFetch(() => Response.json(ocr()));
  const response = await route.POST(upload(image));
  assert.equal(response.status, 200);
  privateResponse(response);
  const result = await response.json();
  assert.equal(result.fields.length, 12);
  assert.equal(result.fields.find(field => field.key === "patient").value, "Alex Example");
  assert.equal(result.reviewRequired, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:8001/ocr");
  const options = fetchCalls[0].options;
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal(new Headers(options.headers).get("content-type"), "image/png");
  assert.equal(new Headers(options.headers).get("authorization"), null);
  assert.deepEqual(Buffer.from(options.body), image);
});

test("JPEG uploads preserve their media type and remote tokens are sent only server-to-server", async () => {
  process.env.PADDLEOCR_SERVICE_URL = "https://ocr.example/service/";
  process.env.PADDLEOCR_SERVICE_TOKEN = "synthetic-test-service-token";
  mockFetch(() => Response.json(ocr()));
  const response = await route.POST(upload(jpegHeader, { "Content-Type": "image/jpeg; charset=binary" }));
  assert.equal(response.status, 200);
  assert.equal(fetchCalls[0].url, "https://ocr.example/service/ocr");
  assert.equal(new Headers(fetchCalls[0].options.headers).get("content-type"), "image/jpeg");
  assert.equal(new Headers(fetchCalls[0].options.headers).get("authorization"), "Bearer synthetic-test-service-token");
  assert.ok(!(await response.text()).includes("synthetic-test-service-token"));
});

test("availability and missing service configuration reveal no endpoint or credentials", async () => {
  delete process.env.PADDLEOCR_SERVICE_URL;
  process.env.PADDLEOCR_SERVICE_TOKEN = "synthetic-secret";
  const availability = await route.GET();
  assert.equal(availability.status, 200);
  privateResponse(availability);
  assert.deepEqual(await availability.json(), { configured: false, maxBytes: MAX_PRESCRIPTION_BYTES, acceptedTypes: ["image/png", "image/jpeg"] });
  const response = await route.POST(upload());
  assert.equal(response.status, 503);
  privateResponse(response);
  assert.ok(!(await response.text()).includes("synthetic-secret"));
  assert.equal(fetchCalls.length, 0);
});

test("service configuration rejects embedded secrets, insecure remote URLs and unprotected hosted endpoints", () => {
  for (const url of ["not a URL", "file:///tmp/service", "https://user:password@ocr.example", "https://ocr.example?token=secret", "https://ocr.example#fragment", "http://ocr.example"]) {
    process.env.PADDLEOCR_SERVICE_URL = url;
    process.env.PADDLEOCR_SERVICE_TOKEN = "synthetic-token";
    assert.equal(prescriptionAvailability().configured, false, url);
  }
  process.env.PADDLEOCR_SERVICE_URL = "https://ocr.example";
  delete process.env.PADDLEOCR_SERVICE_TOKEN;
  assert.equal(prescriptionAvailability().configured, false);
  process.env.PADDLEOCR_SERVICE_URL = "http://localhost:8001";
  assert.equal(prescriptionAvailability().configured, true);
  process.env.VERCEL = "1";
  assert.equal(prescriptionAvailability().configured, false);
  delete process.env.VERCEL;
  process.env.NODE_ENV = "production";
  assert.equal(prescriptionAvailability().configured, false);
  process.env.PADDLEOCR_SERVICE_URL = "https://ocr.example";
  process.env.PADDLEOCR_SERVICE_TOKEN = "synthetic-token";
  assert.equal(prescriptionAvailability().configured, true);
});

test("staff authorization protects both availability and uploads before provider access", async () => {
  for (const status of [401, 403]) {
    globalThis.__prescriptionTestStaffDenied = status;
    for (const response of [await route.GET(), await route.POST(upload())]) {
      assert.equal(response.status, status);
      privateResponse(response);
    }
  }
  assert.equal(fetchCalls.length, 0);
});

test("foreign-origin requests and missing fictional-data consent never reach OCR", async () => {
  for (const headers of [{ Origin: "https://foreign.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const response = await route.POST(upload(pngHeader, headers));
    assert.equal(response.status, 403);
    privateResponse(response);
  }
  for (const consent of ["", "false", "TRUE"]) {
    const response = await route.POST(upload(pngHeader, { "X-Demo-Consent": consent }));
    assert.equal(response.status, 400);
  }
  assert.equal(fetchCalls.length, 0);
});

test("missing bodies, PDFs and mismatched image signatures are rejected before OCR", async () => {
  assert.equal((await route.POST(upload(null))).status, 400);
  for (const request of [
    upload(pngHeader, { "Content-Type": "application/pdf" }),
    upload(pngHeader, { "Content-Type": "image/jpeg" }),
    upload(jpegHeader, { "Content-Type": "image/png" }),
    upload("private document contents", { "Content-Type": "image/png" }),
  ]) {
    const response = await route.POST(request);
    assert.equal(response.status, 415);
    privateResponse(response);
    assert.ok(!(await response.text()).includes("private document contents"));
  }
  assert.equal(fetchCalls.length, 0);
});

test("upload byte limits reject declared and streamed excess without trusting Content-Length", async () => {
  assert.equal((await route.POST(upload(pngHeader, { "Content-Length": String(MAX_PRESCRIPTION_BYTES + 1) }))).status, 413);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(pngHeader);
    controller.enqueue(new Uint8Array(MAX_PRESCRIPTION_BYTES));
    controller.close();
  } });
  const response = await route.POST(upload(stream, { "Content-Length": "8" }, { duplex: "half" }));
  assert.equal(response.status, 413);
  privateResponse(response);
  assert.equal(fetchCalls.length, 0);
  const exact = new Uint8Array(MAX_PRESCRIPTION_BYTES);
  exact.set(pngHeader);
  mockFetch(() => Response.json(ocr()));
  assert.equal((await route.POST(upload(exact))).status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].options.body.byteLength, MAX_PRESCRIPTION_BYTES);
});

test("upstream failures and network messages are sanitized while preserving actionable status", async () => {
  for (const [upstream, expected] of [[400, 422], [415, 422], [422, 422], [413, 413], [429, 503], [503, 503], [401, 502], [500, 502]]) {
    mockFetch(() => new Response("private patient text; token=synthetic-secret", { status: upstream }));
    const response = await route.POST(upload());
    assert.equal(response.status, expected);
    privateResponse(response);
    assert.doesNotMatch(await response.text(), /private patient|synthetic-secret/);
  }
  mockFetch(() => { throw new Error("private network URL with token=synthetic-secret"); });
  const response = await route.POST(upload());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private network|synthetic-secret/);
});

test("unreadable, invalid and oversized successful OCR responses are not rendered", async () => {
  for (const body of ["<html>private service error</html>", "null", JSON.stringify({ engine: "PaddleOCR" }), JSON.stringify({ ...ocr(), image: { width: 0, height: 2200 } })]) {
    mockFetch(() => new Response(body));
    const response = await route.POST(upload());
    assert.equal(response.status, 502);
    privateResponse(response);
    assert.doesNotMatch(await response.text(), /private service error|<html>/);
  }
  mockFetch(() => new Response("x".repeat(1_000_001)));
  assert.equal((await route.POST(upload())).status, 413);
});

test("an already cancelled upload never starts an OCR provider request", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await route.POST(upload(pngHeader, {}, { signal: controller.signal }));
  assert.equal(response.status, 499);
  privateResponse(response);
  assert.equal(fetchCalls.length, 0);
});
