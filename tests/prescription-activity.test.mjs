import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/prescription/activity.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { PRESCRIPTION_ACTIVITY_EVENT, readPrescriptionActivity, recordPrescriptionActivity } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const STORAGE_KEY = "pharmacy:prescription-activity:v1";
const globalKeys = ["window", "sessionStorage", "CustomEvent"];
let originalGlobals;
let stored;
let events;
let storage;

beforeEach(() => {
  originalGlobals = Object.fromEntries(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  stored = new Map();
  events = [];
  storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, String(value)); },
    removeItem: key => { stored.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage, dispatchEvent: event => { events.push(event); return true; } } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => globalThis.window.sessionStorage });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: class extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  } });
});

afterEach(() => {
  for (const key of globalKeys) {
    if (originalGlobals[key]) Object.defineProperty(globalThis, key, originalGlobals[key]);
    else delete globalThis[key];
  }
});

const privateText = "PRIVATE-PATIENT-AND-PRESCRIPTION-DETAIL";
function result() {
  const fields = [
    ["patient", privateText, false], ["dateOfBirth", "1990-01-15", false],
    ["dateIssued", "", false], ["prescriber", null, true],
    ["licence", "   ", false], ["clinicPhone", "416-555-0100", true],
    ["medication", "Fictional medication", false], ["strength", "10 mg", true],
    ["directions", privateText, false], ["quantity", "14 tablets", false],
    ["refills", "0", false], ["signature", "UNSIGNED DEMO", false],
  ].map(([key, value, needsReview]) => ({ key, label: key, value, needsReview, confidence: 0.99, sourceText: privateText }));
  return {
    ocr: { engine: "PaddleOCR", model: "test", lines: [{ text: privateText, confidence: 0.99, box: [[0, 0], [1, 0], [1, 1], [0, 1]] }], durationMs: 16001, image: { width: 1700, height: 2200 } },
    fields, checks: [{ code: "manual_review", severity: "info", message: privateText }], isDemo: true, reviewRequired: true,
    // Sensitive additions must not be copied if callers ever attach metadata.
    filename: "private-patient-prescription.png", image: "data:image/png;base64,PRIVATE",
  };
}

function validActivity() {
  return { version: 1, scanCount: 3, lastScan: { at: "2026-10-31T15:00:00.000Z", fieldCount: 12, extractedCount: 9, flaggedCount: 5, durationMs: 16001 } };
}

test("a successful scan persists only aggregate counts and time, with one private-data-free event", () => {
  assert.equal(readPrescriptionActivity(), null);
  const before = Date.now();
  recordPrescriptionActivity(result());
  const after = Date.now();
  const serialized = stored.get(STORAGE_KEY);
  assert.equal(stored.size, 1);
  const activity = JSON.parse(serialized);
  assert.deepEqual(Object.keys(activity).sort(), ["lastScan", "scanCount", "version"]);
  assert.deepEqual(Object.keys(activity.lastScan).sort(), ["at", "durationMs", "extractedCount", "fieldCount", "flaggedCount"]);
  assert.equal(activity.version, 1);
  assert.equal(activity.scanCount, 1);
  assert.deepEqual({ ...activity.lastScan, at: undefined }, { at: undefined, fieldCount: 12, extractedCount: 9, flaggedCount: 5, durationMs: 16001 });
  assert.ok(Date.parse(activity.lastScan.at) >= before && Date.parse(activity.lastScan.at) <= after);
  assert.deepEqual(readPrescriptionActivity(), activity);
  assert.equal(PRESCRIPTION_ACTIVITY_EVENT, "pharmacy:prescription-activity");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, PRESCRIPTION_ACTIVITY_EVENT);
  assert.doesNotMatch(serialized + JSON.stringify(events.map(event => event.detail)), /PRIVATE|private-patient|1990-01-15|416-555|Fictional medication|data:image|sourceText|filename|confidence|ocr/);
});

test("successive scans increment the count while replacing, not accumulating, last-scan metrics", () => {
  recordPrescriptionActivity(result());
  const next = result();
  next.fields = next.fields.map(field => ({ ...field, value: "present", needsReview: false }));
  next.ocr.durationMs = 17;
  recordPrescriptionActivity(next);
  const activity = readPrescriptionActivity();
  assert.equal(activity.scanCount, 2);
  assert.equal(activity.lastScan.fieldCount, 12);
  assert.equal(activity.lastScan.extractedCount, 12);
  assert.equal(activity.lastScan.flaggedCount, 0);
  assert.equal(activity.lastScan.durationMs, 17);
  assert.equal(events.length, 2);
});

test("valid persisted aggregates restore without scanning or changing storage", () => {
  const activity = validActivity();
  const serialized = JSON.stringify(activity);
  stored.set(STORAGE_KEY, serialized);
  assert.deepEqual(readPrescriptionActivity(), activity);
  assert.equal(stored.get(STORAGE_KEY), serialized);
  assert.equal(events.length, 0);
});

test("malformed or inconsistent persisted counts fail closed and the next success starts cleanly", () => {
  const invalid = [
    "not-json", "null", "[]", "{}", JSON.stringify({ ...validActivity(), version: 2 }),
    JSON.stringify({ ...validActivity(), scanCount: -1 }), JSON.stringify({ ...validActivity(), scanCount: 0 }), JSON.stringify({ ...validActivity(), scanCount: 1.5 }),
    JSON.stringify({ ...validActivity(), scanCount: "3" }), JSON.stringify({ ...validActivity(), lastScan: null }),
  ];
  for (const [key, value] of [
    ["at", "not-a-date"], ["at", "2026-02-30T15:00:00.000Z"], ["at", 1793458800000], ["fieldCount", -1], ["fieldCount", 1.5],
    ["extractedCount", -1], ["extractedCount", 13], ["extractedCount", "9"],
    ["flaggedCount", -1], ["flaggedCount", 13], ["flaggedCount", 0.5], ["flaggedCount", 2],
    ["durationMs", -1], ["durationMs", null],
  ]) invalid.push(JSON.stringify({ ...validActivity(), lastScan: { ...validActivity().lastScan, [key]: value } }));
  for (const value of invalid) {
    stored.set(STORAGE_KEY, value);
    assert.equal(readPrescriptionActivity(), null, value);
  }
  recordPrescriptionActivity(result());
  assert.equal(readPrescriptionActivity().scanCount, 1);
});

test("unexpected persisted details are never returned as dashboard activity", () => {
  stored.set(STORAGE_KEY, JSON.stringify({ ...validActivity(), patient: privateText, lastScan: { ...validActivity().lastScan, rawOcr: privateText } }));
  const activity = readPrescriptionActivity();
  assert.doesNotMatch(JSON.stringify(activity), /PRIVATE|patient|rawOcr/);
  if (activity !== null) assert.deepEqual(activity, validActivity());
});

test("unavailable or full session storage never breaks a successful scan", () => {
  storage.getItem = () => { throw new DOMException("Storage denied", "SecurityError"); };
  assert.equal(readPrescriptionActivity(), null);
  assert.doesNotThrow(() => recordPrescriptionActivity(result()));
  storage.getItem = key => stored.get(key) ?? null;
  storage.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  const priorEvents = events.length;
  assert.doesNotThrow(() => recordPrescriptionActivity(result()));
  assert.equal(events.length, priorEvents, "a failed write must not announce new persisted activity");
  Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Storage denied", "SecurityError"); } });
  assert.equal(readPrescriptionActivity(), null);
  assert.doesNotThrow(() => recordPrescriptionActivity(result()));
});

test("server rendering has no browser state and never attempts browser storage", () => {
  delete globalThis.window;
  storage.getItem = () => { throw new Error("SSR must not access storage"); };
  storage.setItem = () => { throw new Error("SSR must not access storage"); };
  assert.equal(readPrescriptionActivity(), null);
  assert.doesNotThrow(() => recordPrescriptionActivity(result()));
  assert.equal(events.length, 0);
});
