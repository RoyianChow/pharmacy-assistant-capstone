import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/pharmacy/submission-response.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readSubmissionResponse } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const receipt = { id: "fictional-case", reference: "MA-DEMO", createdAt: "2026-10-25T12:00:00Z", status: "new" };

test("new and repeated successful submissions preserve a valid receipt", async () => {
  for (const status of [200, 201]) {
    assert.deepEqual(await readSubmissionResponse(Response.json({ receipt }, { status })), { ok: true, receipt });
  }
});

test("empty, HTML and malformed validation responses still permit correcting the form", async () => {
  for (const status of [400, 422]) {
    for (const body of ["", "<html>upstream internal information</html>", "{", "null", "[]"]) {
      const result = await readSubmissionResponse(new Response(body, { status }));
      assert.equal(result.ok, false);
      assert.equal(result.canCorrect, true);
      assert.match(result.message, /check your fictional details/i);
      assert.doesNotMatch(result.message, /upstream|JSON|SyntaxError|Unexpected/);
    }
  }
});

test("structured validation errors retain useful field correction guidance", async () => {
  const message = "Enter a valid fictional phone number.";
  assert.deepEqual(await readSubmissionResponse(Response.json({ error: message }, { status: 400 })), {
    ok: false, canCorrect: true, message,
  });
  for (const error of [null, {}, "", "<html>bad gateway</html>", "raw\nstack", "X".repeat(241)]) {
    const result = await readSubmissionResponse(Response.json({ error }, { status: 422 }));
    assert.equal(result.canCorrect, true);
    assert.match(result.message, /check your fictional details/i);
  }
});

test("uncertain HTTP failures keep the exact submission frozen and hide upstream details", async () => {
  for (const status of [403, 409, 429, 500, 502, 503, 504]) {
    for (const body of ["", "<html>secret upstream body</html>", JSON.stringify({ error: "secret upstream body" })]) {
      const result = await readSubmissionResponse(new Response(body, { status }));
      assert.equal(result.ok, false);
      assert.equal(result.canCorrect, false);
      assert.doesNotMatch(result.message, /secret|upstream|JSON|SyntaxError|Unexpected/);
    }
  }
});

test("a successful response without a valid receipt remains an uncertain submission", async () => {
  for (const body of ["", "<html>gateway</html>", "null", "{}", JSON.stringify({ receipt: { ...receipt, createdAt: "invalid" } }), JSON.stringify({ receipt: { ...receipt, status: "unknown" } })]) {
    const result = await readSubmissionResponse(new Response(body));
    assert.equal(result.ok, false);
    assert.equal(result.canCorrect, false);
    assert.match(result.message, /retry to retrieve/i);
  }
});

test("a body read failure uses the received status without exposing the read error", async () => {
  for (const status of [400, 422, 200, 503]) {
    const body = new ReadableStream({ start(controller) { controller.error(new Error("private read details")); } });
    const result = await readSubmissionResponse(new Response(body, { status }));
    assert.equal(result.ok, false);
    assert.equal(result.canCorrect, status === 400 || status === 422);
    assert.doesNotMatch(result.message, /private|read details/);
  }
});
