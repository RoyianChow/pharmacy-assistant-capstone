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
    assert.deepEqual(body.state.answers, state.answers);
    assert.deepEqual(body.state.latestAnswer, state.answers.at(-1));
    assert.deepEqual(body.state.candidateOrder, ["duration", "history"]);
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

test("a single guided step does not call Jev or claim a model decision", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("No provider call should occur");
  });
  assert.deepEqual(await chooseNextQuestion(state, candidates.slice(0, 1)), {
    questionId: "duration",
    mode: "guided",
  });
  assert.equal(fetch.mock.callCount(), 0);
});

test("uncertainty between approved required questions is not a provider outage", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      payload({
        confidence: 0.2,
        probabilities: { duration: 0.4, history: 0.6 },
      }),
    ),
  );
  const result = await chooseNextQuestion(state, candidates);
  assert.equal(result.mode, "jev");
  assert.equal(result.questionId, "history");
  assert.equal(result.notice, undefined);
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
    { ...payload(), model: "   " },
    { answers: payload().answers },
    null,
  ];
  for (const value of invalid) assert.equal(parseJevChoice(value, ids), null);
  assert.deepEqual(parseJevChoice(payload(), ids), {
    questionId: "history",
    confidence: 0.8,
  });
});

const intents = ["answered", "uncertain", "clarification_request", "treatment_question", "unrelated"];
const textState = {
  answers: [{ questionId: "medicines", value: "What do you mean by supplements?" }],
  latestQuestion: {
    id: "medicines", kind: "text", text: "What medicines or supplements are you taking?",
    hint: "Include health products, or say none or not sure.",
  },
};
function conversationalPayload(intent, confidence = 0.95) {
  return {
    ...payload(),
    answers: {
      ...payload().answers,
      response_intent: {
        type: "choice", choice: intent, confidence,
        probabilities: Object.fromEntries(intents.map(id => [id, id === intent ? 1 : 0])),
      },
    },
  };
}

test("a request to explain the current question gets an authored clarification and retry", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.state.latestQuestion, textState.latestQuestion);
    assert.equal(body.questions.response_intent.type, "choice");
    assert.match(body.questions.response_intent.instructions, /ONLY latestAnswer/);
    assert.match(body.questions.response_intent.instructions, /any usable answer/);
    return Response.json(conversationalPayload("clarification_request"));
  });
  const selected = await chooseNextQuestion(textState, candidates);
  assert.equal(selected.retryAnswer, true);
  assert.match(selected.reply, /vitamins, supplements/);
  assert.match(selected.reply, /not sure/);
});

test("treatment questions receive a pharmacist boundary without invented advice", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(conversationalPayload("treatment_question")));
  const selected = await chooseNextQuestion({ ...textState, answers: [{questionId:"medicines",value:"Which antibiotic do I need?"}] }, candidates);
  assert.equal(selected.retryAnswer, true);
  assert.match(selected.reply, /pharmacist must assess/i);
  assert.equal(selected.reply.includes("antibiotic"), false);
});

test("unknown answers remain accepted and are never treated as a clarification request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(conversationalPayload("uncertain")));
  const selected = await chooseNextQuestion({ ...textState, answers: [{questionId:"medicines",value:"not sure"}] }, candidates);
  assert.equal(selected.retryAnswer, false);
  assert.match(selected.reply, /okay to be unsure/);
});

test("offered short answers cannot be rejected by a mistaken confident model", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(conversationalPayload("unrelated", 1)));
  for (const value of ["not sure", "n/a", "prefer not to answer", "none", "none known", "nothing yet"]) {
    const selected = await chooseNextQuestion({ ...textState, answers: [{questionId:"medicines",value}] }, candidates);
    assert.equal(selected.retryAnswer, false, value);
    assert.equal(selected.reply.includes("Please answer"),false,value);
  }
});

test("relevant replies are accepted and raw model text is never displayed", async (t) => {
  const response = conversationalPayload("answered");
  response.answers.response_intent.text = "Take a synthetic medicine at 50 mg";
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  const selected = await chooseNextQuestion(textState, candidates);
  assert.equal(selected.retryAnswer, false);
  assert.equal(selected.reply.includes("50 mg"), false);
});

test("uncertain intent never traps the person in a repeated question", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(conversationalPayload("unrelated", 0.74)));
  const selected = await chooseNextQuestion(textState, candidates);
  assert.equal(selected.retryAnswer, undefined);
  assert.equal(selected.reply, undefined);
  assert.equal(selected.mode, "jev");
});

test("invalid optional intent does not discard a valid required question selection", async (t) => {
  const response = conversationalPayload("prescribe");
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  const selected = await chooseNextQuestion(textState, candidates);
  assert.equal(selected.questionId, "history");
  assert.equal(selected.retryAnswer, undefined);
});

test("text on a single-candidate step is still interpreted", async (t) => {
  const response = conversationalPayload("clarification_request");
  response.answers.next_question = payload({choice:"duration",confidence:1,probabilities:{duration:1}}).answers.next_question;
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(response));
  const selected = await chooseNextQuestion(textState, candidates.slice(0,1));
  assert.equal(selected.retryAnswer, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test("safety confirmations never wait for an AI request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("No provider call should occur"); });
  for (const id of ["safety_symptoms", "urgent_details"]) {
    assert.deepEqual(await chooseNextQuestion(textState, [{id,text:"Safety confirmation"}]), {questionId:id,mode:"guided"});
  }
  assert.equal(fetch.mock.callCount(),0);
});

test("an older text answer is not interpreted as the newest reply", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url,init) => {
    assert.equal("response_intent" in JSON.parse(init.body).questions,false);
    return Response.json(payload());
  });
  const selected=await chooseNextQuestion({...textState,answers:[...textState.answers,{questionId:"pregnancy",value:"no"}]},candidates);
  assert.equal(selected.retryAnswer,undefined);
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
