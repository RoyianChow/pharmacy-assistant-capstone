// Opt-in live integration check. Uses only a unique fictional case and removes it afterwards.
// Run against a started app: node --env-file=.env.local scripts/verify-neon-storage.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const base = process.env.QA_BASE_URL || "http://localhost:3000";
const connectionString = process.env.DATABASE_URL || process.env.NEON_DB || process.env.POSTGRES_URL;
if (!connectionString) throw new Error("A PostgreSQL connection is required for this opt-in check.");
const db = new Client({ connectionString, connectionTimeoutMillis: 10000 });
const submissionKey = randomUUID();
const values = {
  emergency: "no", age: "18to64", ontario: "yes", concern: "cold_sores",
  symptoms: "Fictional small sore on the lip", duration: "Yesterday, staying the same",
  severity: "mild", warnings: "no", details: "A similar lip sore in the past",
  pregnancy: "no", medicines: "None", allergies: "None known", conditions: "None", tried: "Nothing yet",
};
const payload = {
  submissionKey,
  patient: { displayName: `Storage check ${submissionKey.slice(0, 8)}`, contactPreference: "in_person", contact: "" },
  answers: Object.entries(values).map(([questionId, value]) => ({ questionId, value })),
  consentToShare: true,
};
let caseId;
let connected = false;
let passed = false;
async function submit(body) {
  return fetch(`${base}/api/pharmacy/cases`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(base).origin },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
}
try {
  await db.connect(); connected = true;
  const initial = await submit(payload);
  assert.equal(initial.status, 201, "Initial submission must return 201");
  caseId = (await initial.json()).receipt.id;
  console.log("PASS POST /api/pharmacy/cases -> 201 (live PostgreSQL)");
  const again = await submit(payload);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).receipt.id, caseId);
  const collision = await submit({ ...payload, patient: { ...payload.patient, displayName: "Different fictional patient" } });
  assert.equal(collision.status, 409);
  console.log("PASS identical retry -> 200, changed retry -> 409");
  const stored = await db.query("SELECT id, snapshot_json, version FROM pharmacy_cases WHERE submission_key = $1", [submissionKey]);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].id, caseId);
  assert.deepEqual(JSON.parse(stored.rows[0].snapshot_json).answers, payload.answers);
  assert.equal(stored.rows[0].version, 1);
  console.log("PASS one durable row with all 14 original answers");
  const list = await fetch(`${base}/api/pharmacy/cases`, { signal: AbortSignal.timeout(30000) });
  assert.equal(list.status, 401, "Unsigned visitor must not read the queue");
  const detail = await fetch(`${base}/api/pharmacy/cases/${caseId}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(detail.status, 401);
  console.log("PASS unauthenticated queue and detail access -> 401");
  passed = true;
} catch (error) {
  console.error("FAIL Neon storage integration", error instanceof assert.AssertionError ? error.message : "connection or request failed (credentials withheld)");
  process.exitCode = 1;
} finally {
  if (connected) {
    try {
      // Delete only the fixture created by this exact run, never any other submissions.
      const table = await db.query("SELECT to_regclass('pharmacy_cases') AS name");
      if (table.rows[0].name) {
        await db.query("BEGIN");
        await db.query("DELETE FROM pharmacy_review_events WHERE case_id IN (SELECT id FROM pharmacy_cases WHERE submission_key = $1)", [submissionKey]);
        await db.query("DELETE FROM pharmacy_cases WHERE submission_key = $1", [submissionKey]);
        await db.query("COMMIT");
      }
      console.log("PASS synthetic database fixture removed");
    } catch { process.exitCode = 1; console.error("Fixture cleanup could not be confirmed."); }
    await db.end();
  }
}
if (passed && !process.exitCode) console.log("Neon storage end-to-end check passed.");
