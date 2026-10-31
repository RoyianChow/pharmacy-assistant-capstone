import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
function compile(path, replacements = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries({ "server-only": moduleUrl("export {};"), ...replacements })) code = code.replaceAll(`"${from}"`, `"${to}"`);
  return moduleUrl(code);
}

// Execute the real route, upload service and response validators. No AWS SDK,
// credential chain, database, provider, or environment file is loaded.
const aws = moduleUrl(`
  export class InvokeCommand { constructor(input) { this.input = input; } }
  export class LambdaClient {
    constructor(options) { globalThis.__rxClassificationTest.clients.push(options); }
    async send(command, options) {
      globalThis.__rxClassificationTest.invocations.push({ input: command.input, options });
      return globalThis.__rxClassificationTest.invoke(command.input, options);
    }
    destroy() { globalThis.__rxClassificationTest.destroyed++; }
  }
`);
const oidc = moduleUrl(`export function awsCredentialsProvider(options) {
  globalThis.__rxClassificationTest.oidc.push(options);
  return { kind: "mock-oidc-provider" };
}`);
const staff = moduleUrl(`export async function requireStaffApi() {
  const status = globalThis.__rxClassificationTest.staffDenied;
  return status ? Response.json({ error: "Staff sign-in required." }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }) : null;
}`);
const questions = compile("../lib/assessment/questions.ts");
const engine = compile("../lib/assessment/engine.ts", { "./questions": questions });
const pharmacyTypes = compile("../lib/pharmacy/types.ts");
const validation = compile("../lib/pharmacy/validation.ts", { "../assessment/engine": engine, "./types": pharmacyTypes });
const http = compile("../lib/pharmacy/http.ts", { "./validation": validation });
const types = compile("../lib/prescription/types.ts");
const classification = compile("../lib/prescription/classification.ts");
const service = compile("../lib/prescription/classifier-service.ts", {
  "@aws-sdk/client-lambda": aws, "@vercel/oidc-aws-credentials-provider": oidc,
  "./classification": classification, "./types": types,
});
const route = await import(compile("../app/api/prescriptions/classify/route.ts", {
  "@/lib/auth/staff": staff, "@/lib/pharmacy/http": http,
  "@/lib/pharmacy/validation": validation, "@/lib/prescription/classifier-service": service,
}));
const { parseClassificationResult, parseClassifierAvailability } = await import(classification);
const { classifierAvailability } = await import(service);
const { MAX_PRESCRIPTION_BYTES } = await import(types);
const LOCAL_URL = "http://127.0.0.1:9000/2015-03-31/functions/function/invocations";
const ROLE = "arn:aws:iam::123456789012:role/pharmacy-test-invoke";
const environmentKeys = ["NODE_ENV", "VERCEL", "PRESCRIPTION_CLASSIFIER_LOCAL_URL", "PRESCRIPTION_CLASSIFIER_AWS_REGION", "PRESCRIPTION_CLASSIFIER_FUNCTION_NAME", "PRESCRIPTION_CLASSIFIER_AWS_ROLE_ARN"];
let originalEnvironment;
let originalFetch;
let fetchCalls;
let state;

beforeEach(() => {
  originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  originalFetch = globalThis.fetch;
  for (const key of environmentKeys) delete process.env[key];
  process.env.NODE_ENV = "development";
  process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL = LOCAL_URL;
  fetchCalls = [];
  state = globalThis.__rxClassificationTest = {
    clients: [], invocations: [], oidc: [], destroyed: 0, staffDenied: 0,
    invoke: () => { throw new Error("Unexpected mocked Lambda invocation"); },
  };
  mockFetch(() => { throw new Error("Unexpected mocked fetch"); });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__rxClassificationTest;
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

function mockFetch(respond) {
  globalThis.fetch = async (url, options) => { fetchCalls.push({ url: String(url), options }); return respond(url, options); };
}
function awsConfig({ hosted = true, role = true } = {}) {
  delete process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL;
  process.env.PRESCRIPTION_CLASSIFIER_AWS_REGION = "ca-central-1";
  process.env.PRESCRIPTION_CLASSIFIER_FUNCTION_NAME = "pharmacy-rx-classifier:production";
  if (hosted) { process.env.NODE_ENV = "production"; process.env.VERCEL = "1"; }
  if (role) process.env.PRESCRIPTION_CLASSIFIER_AWS_ROLE_ARN = ROLE;
}
function result(overrides = {}) {
  return { schemaVersion: 1, modelVersion: "rx-resnet18-test-v1", predictedLabel: "fake", scores: { real: 0.2, fake: 0.8 }, reviewRequired: true, validationStatus: "research_only", durationMs: 23, ...overrides };
}
const envelope = (body = result(), statusCode = 200) => ({ statusCode, body });
const payload = value => Buffer.from(JSON.stringify(value));
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = Uint8Array.from([255, 216, 255, 224]);
function upload(body = png, headers = {}, extras = {}) {
  return new Request("https://pharmacy.example/api/prescriptions/classify", {
    method: "POST", headers: { Origin: "https://pharmacy.example", "Content-Type": "image/png", "X-Demo-Consent": "true", ...headers },
    ...(body === null ? {} : { body }), ...extras,
  });
}
function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
function assertNoInference() {
  assert.equal(fetchCalls.length, 0);
  assert.equal(state.invocations.length, 0);
  assert.equal(state.oidc.length, 0);
}
async function assertNoPrediction(response, expectedStatus = 503) {
  assert.equal(response.status, expectedStatus);
  assertPrivate(response);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.doesNotMatch(body.error, /private-provider-detail|private-patient|secret-token|arn:aws|localhost|127\.0\.0\.1/);
}

test("classification and availability return only validated public fields", () => {
  const source = result({ patient: "private-patient", providerDiagnostic: "secret-token", scores: { real: 0.2, fake: 0.8, rawImage: "private-patient" } });
  assert.deepEqual(parseClassificationResult(source), result());
  assert.deepEqual(parseClassificationResult(result({ predictedLabel: "real", scores: { real: 0.8, fake: 0.2 } })).predictedLabel, "real");
  assert.deepEqual(parseClassifierAvailability({ configured: true, endpoint: "secret-token" }), { configured: true });
  for (const invalid of [null, [], {}, { configured: "true" }]) assert.throws(() => parseClassifierAvailability(invalid));
});

test("malformed scores, labels, model versions and review status cannot become predictions", () => {
  const invalid = [null, [], {}, result({ schemaVersion: 2 }), result({ predictedLabel: "valid" }), result({ predictedLabel: "real" }),
    result({ reviewRequired: false }), result({ reviewRequired: "true" }), result({ validationStatus: "clinically_validated" }),
    result({ modelVersion: "" }), result({ modelVersion: "x".repeat(101) }), result({ modelVersion: "model version / secret" }),
    result({ durationMs: -1 }), result({ durationMs: Infinity }), result({ durationMs: 120001 }), result({ durationMs: "23" })];
  for (const scores of [null, [], {}, { real: -0.2, fake: 1.2 }, { real: 0.5, fake: 0.6 }, { real: NaN, fake: 0.5 }, { real: "0.2", fake: 0.8 }, { real: 0.2, fake: Infinity }]) invalid.push(result({ scores }));
  for (const value of invalid) assert.throws(() => parseClassificationResult(value));
});

test("local classification accepts only the exact loopback RIE path in development", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL = `http://${host}:9000/2015-03-31/functions/function/invocations`;
    assert.deepEqual(classifierAvailability(), { configured: true });
  }
  for (const url of ["broken", "https://localhost:9000/2015-03-31/functions/function/invocations", "http://example.com:9000/2015-03-31/functions/function/invocations", "http://user:secret@localhost:9000/2015-03-31/functions/function/invocations", `${LOCAL_URL}?token=secret`, `${LOCAL_URL}#fragment`, `${LOCAL_URL}/`, "http://localhost:9000/ocr"]) {
    process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL = url;
    assert.deepEqual(classifierAvailability(), { configured: false }, url);
  }
  process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL = LOCAL_URL;
  process.env.NODE_ENV = "production";
  assert.deepEqual(classifierAvailability(), { configured: false });
  process.env.NODE_ENV = "development";
  process.env.VERCEL = "1";
  assert.deepEqual(classifierAvailability(), { configured: false });
  assertNoInference();
});

test("AWS configuration is fail-closed for partial or malformed hosted settings", async () => {
  delete process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL;
  assert.deepEqual(classifierAvailability(), { configured: false });
  process.env.PRESCRIPTION_CLASSIFIER_AWS_REGION = "ca-central-1";
  assert.deepEqual(classifierAvailability(), { configured: false });
  awsConfig({ role: false });
  assert.deepEqual(classifierAvailability(), { configured: false });
  process.env.PRESCRIPTION_CLASSIFIER_AWS_ROLE_ARN = ROLE;
  assert.deepEqual(classifierAvailability(), { configured: true });
  for (const [key, value] of [
    ["PRESCRIPTION_CLASSIFIER_AWS_REGION", "not-a-region"], ["PRESCRIPTION_CLASSIFIER_FUNCTION_NAME", "name/with/path"],
    ["PRESCRIPTION_CLASSIFIER_FUNCTION_NAME", "x".repeat(65)], ["PRESCRIPTION_CLASSIFIER_AWS_ROLE_ARN", "arn:aws:iam::123:role/test"],
  ]) {
    const prior = process.env[key]; process.env[key] = value;
    assert.deepEqual(classifierAvailability(), { configured: false });
    process.env[key] = prior;
  }
  process.env.PRESCRIPTION_CLASSIFIER_LOCAL_URL = LOCAL_URL;
  const availability = await route.GET();
  assertPrivate(availability);
  assert.deepEqual(await availability.json(), { configured: false });
  await assertNoPrediction(await route.POST(upload()));
  assertNoInference();
});

test("local RIE success forwards bounded image bytes and strips provider extras", async () => {
  const image = readFileSync(new URL("../public/demo/ontario-demo-prescription.png", import.meta.url));
  mockFetch(() => Response.json(envelope(result({ privateDiagnostic: "private-provider-detail" }))));
  const response = await route.POST(upload(image));
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.deepEqual(await response.json(), result());
  assert.equal(fetchCalls.length, 1);
  const call = fetchCalls[0];
  assert.equal(call.url, LOCAL_URL);
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.redirect, "error");
  assert.deepEqual(call.options.headers, { "Content-Type": "application/json" });
  const event = JSON.parse(call.options.body);
  assert.deepEqual(Object.keys(event).sort(), ["contentType", "imageBase64", "schemaVersion"]);
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.contentType, "image/png");
  assert.deepEqual(Buffer.from(event.imageBase64, "base64"), image);
  assert.equal(state.clients.length, 0);
});

test("AWS invocation uses short-lived credential provider, one attempt, private payload and cleanup", async () => {
  awsConfig();
  state.invoke = () => ({ StatusCode: 200, Payload: payload(envelope()) });
  const response = await route.POST(upload(jpeg, { "Content-Type": "image/jpeg" }));
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.deepEqual(await response.json(), result());
  assert.deepEqual(state.clients, [{ region: "ca-central-1", maxAttempts: 1, credentials: { kind: "mock-oidc-provider" } }]);
  assert.deepEqual(state.oidc, [{ roleArn: ROLE }]);
  assert.equal(state.invocations.length, 1);
  const invocation = state.invocations[0];
  assert.equal(invocation.input.FunctionName, "pharmacy-rx-classifier:production");
  assert.equal(invocation.input.InvocationType, "RequestResponse");
  assert.equal(invocation.input.LogType, undefined);
  assert.ok(invocation.options.abortSignal instanceof AbortSignal);
  const event = JSON.parse(Buffer.from(invocation.input.Payload).toString("utf8"));
  assert.deepEqual(event, { schemaVersion: 1, contentType: "image/jpeg", imageBase64: Buffer.from(jpeg).toString("base64") });
  assert.equal(state.destroyed, 1);
  assert.equal(fetchCalls.length, 0);
});

test("local AWS development can use the default credential chain without creating an OIDC provider", async () => {
  awsConfig({ hosted: false, role: false });
  state.invoke = () => ({ StatusCode: 200, Payload: payload(envelope()) });
  assert.equal((await route.POST(upload())).status, 200);
  assert.deepEqual(state.clients, [{ region: "ca-central-1", maxAttempts: 1 }]);
  assert.equal(state.oidc.length, 0);
});

test("staff, origin and fictional-data consent guards run before inference", async () => {
  for (const denied of [401, 403]) {
    state.staffDenied = denied;
    await assertNoPrediction(await route.GET(), denied);
    await assertNoPrediction(await route.POST(upload()), denied);
  }
  state.staffDenied = 0;
  for (const headers of [
    { Origin: "https://elsewhere.example" }, { "Sec-Fetch-Site": "cross-site" },
    { "X-Demo-Consent": "" }, { "X-Demo-Consent": "false" }, { "X-Demo-Consent": "TRUE" },
  ]) await assertNoPrediction(await route.POST(upload(png, headers)), 403);
  assertNoInference();
});

test("unsupported and spoofed file types are rejected before provider calls", async () => {
  for (const [body, mime] of [[png, "application/pdf"], [png, "image/jpeg"], [jpeg, "image/png"], [Buffer.from("private-patient"), "image/png"], [new Uint8Array(), "image/png"]]) {
    await assertNoPrediction(await route.POST(upload(body, { "Content-Type": mime })), 415);
  }
  const missing = await route.POST(upload(null));
  assert.ok(missing.status >= 400 && missing.status < 500);
  assertNoInference();
});

test("declared and streamed upload excess are rejected; exact maximum fits the Lambda payload", async () => {
  await assertNoPrediction(await route.POST(upload(png, { "Content-Length": String(MAX_PRESCRIPTION_BYTES + 1) })), 413);
  const excessive = new ReadableStream({ start(controller) { controller.enqueue(png); controller.enqueue(new Uint8Array(MAX_PRESCRIPTION_BYTES)); controller.close(); } });
  await assertNoPrediction(await route.POST(upload(excessive, { "Content-Length": "8" }, { duplex: "half" })), 413);
  assertNoInference();
  awsConfig();
  state.invoke = () => ({ StatusCode: 200, Payload: payload(envelope()) });
  const maximum = new Uint8Array(MAX_PRESCRIPTION_BYTES); maximum.set(png);
  assert.equal((await route.POST(upload(maximum))).status, 200);
  const eventBytes = state.invocations[0].input.Payload;
  assert.ok(eventBytes.byteLength < 6_000_000);
  assert.equal(Buffer.from(JSON.parse(Buffer.from(eventBytes).toString()).imageBase64, "base64").byteLength, MAX_PRESCRIPTION_BYTES);
});

test("Lambda FunctionError with HTTP 200, missing model and SDK exceptions never become predictions", async () => {
  awsConfig();
  for (const upstream of [
    { StatusCode: 200, FunctionError: "Unhandled", Payload: payload({ errorMessage: "private-provider-detail" }) },
    { StatusCode: 200, Payload: payload(envelope({ error: "private-provider-detail: model missing" }, 503)) },
    { StatusCode: 202, Payload: payload(envelope()) },
    { StatusCode: 200 },
    { StatusCode: 200, Payload: new Uint8Array(16_385) },
  ]) {
    state.invoke = () => upstream;
    await assertNoPrediction(await route.POST(upload()));
  }
  state.invoke = () => { throw new Error("AccessDenied secret-token private-provider-detail"); };
  await assertNoPrediction(await route.POST(upload()));
  assert.equal(state.invocations.length, 6);
  assert.equal(state.destroyed, 6);
  assert.ok(state.clients.every(options => options.maxAttempts === 1));
});

test("model-side image rejections retain a bounded status without returning diagnostic details", async () => {
  awsConfig();
  for (const status of [400, 413, 415, 422]) {
    state.invoke = () => ({ StatusCode: 200, Payload: payload(envelope({ error: "private-patient private-provider-detail" }, status)) });
    await assertNoPrediction(await route.POST(upload()), status);
  }
});

test("malformed and inconsistent provider results fail closed in both local and AWS modes", async () => {
  for (const bad of [null, [], {}, envelope({}), envelope(result({ predictedLabel: "real" })), envelope(JSON.stringify(result())), { statusCode: "200", body: result() }]) {
    mockFetch(() => Response.json(bad));
    await assertNoPrediction(await route.POST(upload()));
  }
  mockFetch(() => new Response("<html>private-provider-detail</html>"));
  await assertNoPrediction(await route.POST(upload()));
  mockFetch(() => new Response(new Uint8Array(16_385)));
  await assertNoPrediction(await route.POST(upload()), 502);
  awsConfig();
  for (const badPayload of [Buffer.from("not-json"), Uint8Array.from([255]), payload(envelope(result({ validationStatus: "approved" })))]) {
    state.invoke = () => ({ StatusCode: 200, Payload: badPayload });
    await assertNoPrediction(await route.POST(upload()));
  }
});

test("local upstream failures are sanitized and do not retry", async () => {
  for (const status of [401, 429, 500, 503]) {
    mockFetch(() => new Response("private-provider-detail secret-token", { status }));
    await assertNoPrediction(await route.POST(upload()));
  }
  mockFetch(() => { throw new Error("private-provider-detail secret-token"); });
  await assertNoPrediction(await route.POST(upload()));
  assert.equal(fetchCalls.length, 5);
});

test("a previously cancelled request makes no provider or credential call", async () => {
  const controller = new AbortController(); controller.abort();
  await assertNoPrediction(await route.POST(upload(png, {}, { signal: controller.signal })), 499);
  assertNoInference();
});
