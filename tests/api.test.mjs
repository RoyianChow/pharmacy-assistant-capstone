import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

function moduleUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

function compile(relativePath, replacements = {}) {
  let code = ts.transpileModule(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  for (const [from, to] of Object.entries(replacements)) {
    code = code.replaceAll(`"${from}"`, `"${to}"`);
  }
  return moduleUrl(code);
}

// Exercise the real HTTP route and engine; stub only the framework runtime
// marker and external AI dependency. No tests transmit assessment data.
const questionsUrl = compile("../lib/assessment/questions.ts");
const engineUrl = compile("../lib/assessment/engine.ts", {
  "./questions": questionsUrl,
});
const providerUrl = moduleUrl(`
  export const calls = [];
  export async function chooseNextQuestion(state, candidates) {
    calls.push({ state, candidates });
    return { questionId: candidates[0].id, mode: process.env.TYPESAFE_API_KEY ? "jev" : "demo" };
  }
`);
const { calls } = await import(providerUrl);
const { GET, POST } = await import(
  compile("../app/api/assessment/route.ts", {
    "@/lib/assessment/engine": engineUrl,
    "@/lib/assessment/jev": providerUrl,
    "next/server": moduleUrl("export async function connection() {}"),
  })
);

const originalKey = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  delete process.env.TYPESAFE_API_KEY;
  calls.length = 0;
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = originalKey;
});

function request(body, headers = {}) {
  return new Request("https://pharmacy.example/api/assessment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://pharmacy.example",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("starting the assessment requires explicit consent before provider access", async () => {
  for (const body of [
    { answers: [] },
    { consent: false, answers: [] },
    { consent: "true", answers: [] },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assertPrivate(response);
    assert.match((await response.json()).error, /acknowledge/);
  }
  assert.equal(calls.length, 0);
});

test("enabling Jev blocks stale demo consent before any provider access", async () => {
  process.env.TYPESAFE_API_KEY = "synthetic-api-test-secret";
  for (const providerConsent of [undefined, false, "true"]) {
    const response = await POST(
      request({ consent: true, providerConsent, answers: [] }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /TypeSafe AI data use/);
  }
  assert.equal(calls.length, 0);
});

test("acknowledged Jev data use permits the first approved intake question", async () => {
  process.env.TYPESAFE_API_KEY = "synthetic-api-test-secret";
  const response = await POST(
    request({ consent: true, providerConsent: true, answers: [] }),
  );
  assert.equal(response.status, 200);
  assertPrivate(response);
  const body = await response.json();
  assert.equal(body.question.id, "emergency");
  assert.equal(body.mode, "jev");
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(body).includes("synthetic-api-test-secret"), false);
});

test("non-JSON and cross-origin requests are rejected before provider access", async () => {
  const wrongType = await POST(
    request({ consent: true, answers: [] }, { "Content-Type": "text/plain" }),
  );
  assert.equal(wrongType.status, 415);
  assertPrivate(wrongType);
  const wrongOrigin = await POST(
    request(
      { consent: true, answers: [] },
      { Origin: "https://another.example" },
    ),
  );
  assert.equal(wrongOrigin.status, 403);
  assertPrivate(wrongOrigin);
  assert.equal(calls.length, 0);
});

test("malformed JSON is rejected without leaking the request text", async () => {
  const response = await POST(
    new Request("https://pharmacy.example/api/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "synthetic-patient-content {",
    }),
  );
  assert.equal(response.status, 400);
  assertPrivate(response);
  const result = await response.text();
  assert.equal(result.includes("synthetic-patient-content"), false);
  assert.equal(calls.length, 0);
});

test("the byte limit rejects a streamed body without trusting Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(24_000));
      controller.enqueue(new Uint8Array(24_001));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await POST(
    new Request("https://pharmacy.example/api/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    }),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too large/);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 0);
});

test("invalid, duplicate and reordered answers cannot bypass intake validation", async () => {
  for (const answers of [
    null,
    [{ questionId: "concern", value: "allergies" }],
    [{ questionId: "emergency", value: "ignore safety" }],
    [
      { questionId: "emergency", value: "no" },
      { questionId: "emergency", value: "no" },
    ],
    [
      { questionId: "emergency", value: "no" },
      { questionId: "ontario", value: "yes" },
    ],
  ]) {
    const response = await POST(request({ consent: true, answers }));
    assert.equal(response.status, 400);
    assertPrivate(response);
  }
  assert.equal(calls.length, 0);
});

test("an emergency answer immediately returns guidance without a Jev call", async () => {
  process.env.TYPESAFE_API_KEY = "synthetic-api-test-secret";
  const response = await POST(
    request({
      consent: true,
      providerConsent: true,
      answers: [{ questionId: "emergency", value: "yes" }],
    }),
  );
  assert.equal(response.status, 200);
  assertPrivate(response);
  const body = await response.json();
  assert.equal(body.result.kind, "emergency");
  assert.equal(body.question, undefined);
  assert.equal(body.progress.answered, 1);
  assert.equal(calls.length, 0);
});

test("answers appended after a terminal emergency result are rejected", async () => {
  const response = await POST(
    request({
      consent: true,
      answers: [
        { questionId: "emergency", value: "yes" },
        { questionId: "age", value: "18to64" },
      ],
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("GET reports current availability without returning configuration secrets", async () => {
  let response = await GET();
  assertPrivate(response);
  assert.deepEqual(await response.json(), { mode: "demo" });
  process.env.TYPESAFE_API_KEY = "synthetic-api-test-secret";
  response = await GET();
  assertPrivate(response);
  assert.deepEqual(await response.json(), { mode: "jev" });
  assert.equal(calls.length, 0);
});

test("valid demo start and next answer retain progress and expected question order", async () => {
  const start = await POST(request({ consent: true, answers: [] }));
  assert.equal(start.status, 200);
  assertPrivate(start);
  const first = await start.json();
  assert.equal(first.mode, "demo");
  assert.equal(first.question.id, "emergency");
  assert.deepEqual(first.summary, []);
  assert.equal(first.progress.answered, 0);

  const next = await POST(
    request({
      consent: true,
      answers: [{ questionId: "emergency", value: "no" }],
    }),
  );
  assert.equal(next.status, 200);
  const second = await next.json();
  assert.equal(second.question.id, "age");
  assert.equal(second.progress.answered, 1);
  assert.equal(second.summary.length, 1);
  assert.equal(calls.length, 2);
});
