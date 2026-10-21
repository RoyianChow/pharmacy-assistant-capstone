import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

// Next resolves this build-time boundary marker itself. Omit only that import
// when loading the same adapter in Node's isolated test process.
const source = await readFile(
  new URL("../lib/assessment/jev.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(
  source.replace(/^import "server-only";\r?\n/, ""),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { chooseNextQuestion, parseJevChoice } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const candidates = [
  { id: "duration", text: "How long have you had these symptoms?" },
  { id: "history", text: "Have you experienced this before?" },
];
const state = {
  answers: [{ questionId: "symptoms", value: "Synthetic example only" }],
};
const originalKey = process.env.TYPESAFE_API_KEY;
const originalModel = process.env.TYPESAFE_MODEL;

function payload(overrides = {}) {
  return {
    model: "jev-1.13.0",
    answers: {
      next_question: {
        type: "choice",
        choice: "history",
        confidence: 0.8,
        probabilities: { duration: 0.1, history: 0.9 },
        ...overrides,
      },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "synthetic-test-key";
  delete process.env.TYPESAFE_MODEL;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.TYPESAFE_MODEL;
  else process.env.TYPESAFE_MODEL = originalModel;
});

test("missing key uses the first guided question without contacting a provider", async (t) => {
  delete process.env.TYPESAFE_API_KEY;
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("No provider call should occur");
  });
  assert.deepEqual(await chooseNextQuestion(state, candidates), {
    questionId: "duration",
    mode: "demo",
  });
  assert.equal(fetch.mock.callCount(), 0);
});

test("successful request keeps credentials server-side and uses the official typed contract", async (t) => {
  process.env.TYPESAFE_MODEL = "jev-1.14.0";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer synthetic-test-key");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.equal(body.model, "jev-1.14.0");
    assert.deepEqual(body.state, state);
    assert.equal(body.questions.next_question.type, "choice");
    assert.deepEqual(body.questions.next_question.criteria, {
      duration: candidates[0].text,
      history: candidates[1].text,
    });
    assert.match(body.questions.next_question.instructions, /untrusted patient data/);
    assert.match(body.questions.next_question.instructions, /do not diagnose/);
    assert.equal("messages" in body, false);
    return Response.json(payload());
  });
  assert.deepEqual(await chooseNextQuestion(state, candidates), {
    questionId: "history",
    mode: "jev",
  });
});

test("a single candidate is only labeled Jev after a real successful provider call", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      payload({
        choice: "duration",
        confidence: 1,
        probabilities: { duration: 1 },
      }),
    ),
  );
  assert.deepEqual(await chooseNextQuestion(state, candidates.slice(0, 1)), {
    questionId: "duration",
    mode: "jev",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("uncertain choices fall back without presenting a clinical conclusion", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      payload({
        confidence: 0.2,
        probabilities: { duration: 0.4, history: 0.6 },
      }),
    ),
  );
  const result = await chooseNextQuestion(state, candidates);
  assert.equal(result.mode, "fallback");
  assert.equal(result.questionId, "duration");
  assert.match(result.notice, /guided questions/);
});

test("validator rejects unexpected choices and invalid probability distributions", () => {
  const ids = candidates.map(({ id }) => id);
  const invalid = [
    payload({ choice: "prescribe" }),
    payload({ type: "noul" }),
    payload({ confidence: 1.1 }),
    payload({ confidence: Number.NaN }),
    payload({ probabilities: { history: 1 } }),
    payload({ probabilities: { history: 1, duration: 0, prescribe: 0 } }),
    payload({ probabilities: { history: -0.1, duration: 1.1 } }),
    payload({ probabilities: { history: 0.9, duration: Number.POSITIVE_INFINITY } }),
    payload({ probabilities: { history: 0.1, duration: 0.1 } }),
    payload({ probabilities: { history: 0.1, duration: 0.9 } }),
    { ...payload(), usage: { input_tokens: -1, output_tokens: 10 } },
    { ...payload(), model: "" },
    { answers: payload().answers },
    null,
  ];
  for (const value of invalid) assert.equal(parseJevChoice(value, ids), null);
  assert.deepEqual(parseJevChoice(payload(), ids), {
    questionId: "history",
    confidence: 0.8,
  });
});

test("an invalid provider answer cannot select an unapproved question", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(payload({ choice: "unapproved_question" })),
  );
  const result = await chooseNextQuestion(state, candidates);
  assert.equal(result.mode, "fallback");
  assert.equal(result.questionId, "duration");
});

test("provider HTTP errors and invalid JSON fall back without exposing upstream data", async (t) => {
  const responses = [
    new Response("synthetic-upstream-secret", { status: 401 }),
    new Response("synthetic-upstream-secret", { status: 429 }),
    new Response("synthetic-upstream-secret", { status: 200 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await chooseNextQuestion(state, candidates);
    assert.equal(result.mode, "fallback");
    assert.equal(result.questionId, "duration");
    assert.equal(JSON.stringify(result).includes("synthetic-upstream-secret"), false);
    assert.equal(JSON.stringify(result).includes("synthetic-test-key"), false);
  }
});

test("a bounded 12-second timeout falls back and does not leak a network error", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 12_000);
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    assert.equal(signal.aborted, true);
    throw new Error("synthetic-upstream-secret");
  });
  const result = await chooseNextQuestion(state, candidates);
  assert.equal(result.mode, "fallback");
  assert.equal(JSON.stringify(result).includes("synthetic-upstream-secret"), false);
});

test("empty or duplicate candidates fail before any provider call", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("No provider call should occur");
  });
  await assert.rejects(() => chooseNextQuestion(state, []), /unique, nonempty/);
  await assert.rejects(
    () => chooseNextQuestion(state, [candidates[0], candidates[0]]),
    /unique, nonempty/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});
