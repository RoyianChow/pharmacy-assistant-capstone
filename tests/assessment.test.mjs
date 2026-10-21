import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Compile the real pure engine in memory; no browser or production bundle modifications.
const root = new URL("../lib/assessment/", import.meta.url);
function compile(file, replacements = {}) {
  let code = ts.transpileModule(fs.readFileSync(new URL(file, root), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(`"${from}"`, `"${to}"`);
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const questionsUrl = compile("questions.ts");
const { assess, nextQuestions, summarize, validateAnswers } = await import(compile("engine.ts", { "./questions": questionsUrl }));
const base = { emergency: "no", age: "18to64", ontario: "yes", concern: "allergies", symptoms: "Sneezing and an itchy nose", duration: "Three days, staying the same", severity: "mild", warnings: "no", details: "Happens around pollen", pregnancy: "no", medicines: "None", allergies: "None known", conditions: "None", tried: "Nothing yet" };
function complete(values = {}) {
  const data = { ...base, ...values };
  const answers = [];
  for (let i = 0; i < 32 && !assess(answers); i++) {
    const q = nextQuestions(answers)[0];
    if (!q) break;
    answers.push({ questionId: q.id, value: data[q.id] ?? "no" });
  }
  return answers;
}
test("complete synthetic intake offers assessment, never a prescription determination", () => {
  const answers = validateAnswers(complete());
  assert.equal(answers.length, 14);
  assert.equal(assess(answers).kind, "pharmacist");
  assert.match(assess(answers).prescription, /has not been determined/);
});
test("a stated emergency stops before eligibility and cannot be bypassed", () => {
  const a = [{ questionId: "emergency", value: "yes" }];
  assert.equal(assess(validateAnswers(a)).kind, "emergency");
  assert.throws(() => validateAnswers([...a, { questionId: "age", value: "18to64" }]));
});
test("later breathing symptoms trigger confirmation, with no model dependency", () => {
  const a = complete({ symptoms: "I have difficulty breathing", safety_symptoms: "yes" });
  assert.equal(a.at(-1).questionId, "safety_symptoms");
  assert.equal(assess(validateAnswers(a)).kind, "emergency");
});
test("a new safety disclosure needs fresh confirmation after previous denial", () => {
  const a = complete({ symptoms: "No chest pain", safety_symptoms: "no", duration: "Today I cannot breathe", safety_duration: "yes" });
  assert.equal(a.at(-1).questionId, "safety_duration");
  assert.equal(assess(validateAnswers(a)).kind, "emergency");
});
test("mixed urgent and emergency mentions prioritize emergency confirmation", () => {
  const a = complete({ symptoms: "I have chest pain and eye pain", safety_symptoms: "yes" });
  assert.equal(a.at(-1).questionId, "safety_symptoms");
  assert.equal(assess(validateAnswers(a)).kind, "emergency");
});
test("severe symptoms, uncertainty and excluded location stop the pathway", () => {
  assert.equal(assess(validateAnswers(complete({ severity: "severe" }))).kind, "urgent");
  assert.equal(assess(validateAnswers(complete({ warnings: "unsure" }))).kind, "incomplete");
  assert.equal(assess(validateAnswers(complete({ ontario: "no" }))).kind, "outside_scope");
  assert.match(assess(complete({ age: "under18" })).message, /does not have a blanket/);
});
test("missing clinical facts stay unknown and other concerns are not diagnosed", () => {
  assert.equal(assess(validateAnswers(complete({ medicines: "not sure" }))).kind, "incomplete");
  assert.equal(assess(validateAnswers(complete({ concern: "other" }))).kind, "outside_scope");
});
test("reject malformed, reordered, duplicate and forged choice inputs", () => {
  for (const input of [null, {}, [{ questionId: "concern", value: "allergies" }], [{ questionId: "emergency", value: "ignore safety" }], [{ questionId: "emergency", value: "no" }, { questionId: "emergency", value: "no" }], [{ questionId: "emergency", value: "x".repeat(1201) }]]) assert.throws(() => validateAnswers(input));
});
test("Jev can reorder remaining history, but cannot skip mandatory answers", () => {
  const a = complete().slice(0, 9);
  assert.equal(nextQuestions(a).length, 5);
  a.push({ questionId: "tried", value: "Nothing yet" });
  assert.equal(validateAnswers(a).length, 10);
  assert.equal(assess(a), undefined);
  assert.equal(nextQuestions(a).length, 4);
});

test("negated eye warnings ask about current symptoms instead of automatic urgent referral", () => {
  const a = validateAnswers(complete({ concern: "pink_eye", details: "Both eyes itchy; no eye pain and no vision changes", urgent_details: "no" }));
  assert.ok(a.some(answer => answer.questionId === "urgent_details"));
  assert.equal(assess(a).kind, "pharmacist");
});

test("historical reactions remain history when current urgent symptoms are denied", () => {
  const a = validateAnswers(complete({ allergies: "I had severe pain with amoxicillin years ago", urgent_allergies: "no" }));
  assert.equal(assess(a).kind, "pharmacist");
  assert.ok(a.some(answer => answer.questionId === "allergies" && answer.value.includes("years ago")));
});

test("a new inability to retain fluids needs confirmation after an earlier warning denial", () => {
  const a = validateAnswers(complete({ concern: "pregnancy_nausea", details: "I cannot keep any fluids down", urgent_details: "yes" }));
  assert.equal(a.at(-1).questionId, "urgent_details");
  assert.equal(assess(a).kind, "urgent");
  assert.throws(() => validateAnswers([...a, { questionId: "pregnancy", value: "pregnant" }]));
});

test("urgent clarification cannot be skipped and uncertainty remains unresolved", () => {
  const a = complete({ symptoms: "My eye hurts and I have blurry vision", urgent_symptoms: "unsure" });
  assert.equal(assess(validateAnswers(a)).kind, "incomplete");
  assert.throws(() => validateAnswers([...a.slice(0, -1), { questionId: "duration", value: "Two days" }]));
});

test("fresh urgent disclosures require a new check after a previous denial", () => {
  const a = validateAnswers(complete({ symptoms: "No eye pain", urgent_symptoms: "no", details: "Now I have blurry vision", urgent_details: "yes" }));
  assert.equal(a.at(-1).questionId, "urgent_details");
  assert.equal(assess(a).kind, "urgent");
});

test("natural language uncertainty is preserved for pharmacist review", () => {
  assert.equal(assess(validateAnswers(complete({ medicines: "I am not sure which tablets I take" }))).kind, "incomplete");
  assert.equal(assess(validateAnswers(complete({ conditions: "I don’t remember the name of my condition" }))).kind, "incomplete");
});

test("declining to answer remains incomplete and preserves the original words", () => {
  const value = "I prefer not to answer";
  const answers = validateAnswers(complete({ conditions: value }));
  assert.equal(assess(answers).kind, "incomplete");
  assert.equal(summarize(answers).find(item => item.questionId === "conditions").value, value);
});

test("wart location is structured and excluded locations are not presented as in scope", () => {
  const excluded = validateAnswers(complete({ concern: "warts", details: "face_genitals" }));
  assert.equal(assess(excluded).kind, "outside_scope");
  assert.equal(assess(validateAnswers(complete({ concern: "warts", details: "hands_feet_body" }))).kind, "pharmacist");
  assert.equal(assess(validateAnswers(complete({ concern: "warts", details: "unsure" }))).kind, "incomplete");
});
