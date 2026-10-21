import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PharmacyError } from "./validation";
import type { ValidReview, ValidSubmission } from "./validation";
import type { PostgresPharmacyStore } from "./postgres-store";
import type { CaseListItem, CaseStatus, DashboardResponse, PharmacyCase, ReviewEvent, SubmissionReceipt } from "./types";

type Snapshot = Pick<PharmacyCase, "patient" | "answers" | "summary" | "result" | "concern">;
type CaseRow = {
  id: string; reference: string; snapshot_json: string; status: CaseStatus;
  created_at: string; updated_at: string; version: number;
  review_notes: string; reviewer_name: string; fingerprint: string;
};

function listItem(row: CaseRow): CaseListItem {
  const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
  return { id: row.id, reference: row.reference, patient: snapshot.patient, concern: snapshot.concern, outcome: snapshot.result.kind, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version };
}

function receipt(row: CaseRow): SubmissionReceipt {
  return { id: row.id, reference: row.reference, createdAt: row.created_at, status: row.status };
}

/** Local single-server demo persistence. Opening the store is deferred until an API request. */
export class PharmacyStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS pharmacy_cases (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        submission_key TEXT NOT NULL UNIQUE,
        fingerprint TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        display_name TEXT NOT NULL,
        concern TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('new', 'in_review', 'completed')),
        consent_to_share INTEGER NOT NULL CHECK(consent_to_share = 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
        review_notes TEXT NOT NULL DEFAULT '',
        reviewer_name TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS pharmacy_cases_status_created ON pharmacy_cases(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS pharmacy_review_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL REFERENCES pharmacy_cases(id),
        status TEXT NOT NULL CHECK(status IN ('new', 'in_review', 'completed')),
        reviewer_name TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        version INTEGER NOT NULL,
        UNIQUE(case_id, version)
      );
    `);
  }

  close() { this.db.close(); }

  submit(input: ValidSubmission): { receipt: SubmissionReceipt; created: boolean } {
    // Fingerprint accepted patient input, independent of future wording changes in the engine.
    const fingerprint = createHash("sha256").update(JSON.stringify({ patient: input.patient, answers: input.answers, consentToShare: true })).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT * FROM pharmacy_cases WHERE submission_key = ?").get(input.submissionKey) as CaseRow | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new PharmacyError("This submission key was already used for different details. Start a new submission.", 409);
        this.db.exec("COMMIT");
        return { receipt: receipt(existing), created: false };
      }
      let id = randomUUID();
      let reference = `MA-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      // The full UUID addresses the case; the shorter receipt is checked under the write lock.
      while (this.db.prepare("SELECT 1 FROM pharmacy_cases WHERE reference = ?").get(reference)) {
        id = randomUUID();
        reference = `MA-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      }
      const createdAt = new Date().toISOString();
      const snapshot: Snapshot = { patient: input.patient, answers: input.answers, summary: input.summary, result: input.result, concern: input.concern };
      this.db.prepare(`INSERT INTO pharmacy_cases (id, reference, submission_key, fingerprint, snapshot_json, display_name, concern, status, consent_to_share, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 1, ?, ?)`).run(id, reference, input.submissionKey, fingerprint, JSON.stringify(snapshot), input.patient.displayName, input.concern, createdAt, createdAt);
      this.db.exec("COMMIT");
      return { receipt: { id, reference, createdAt, status: "new" }, created: true };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  list(filters: { q: string; status?: CaseStatus }): DashboardResponse {
    const counts = { new: 0, in_review: 0, completed: 0 };
    for (const row of this.db.prepare("SELECT status, COUNT(*) AS count FROM pharmacy_cases GROUP BY status").all() as { status: CaseStatus; count: number }[]) counts[row.status] = row.count;
    const conditions: string[] = [];
    const values: string[] = [];
    if (filters.status) { conditions.push("status = ?"); values.push(filters.status); }
    if (filters.q) {
      const match = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push("(display_name LIKE ? ESCAPE '\\' OR concern LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\')");
      values.push(match, match, match);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM pharmacy_cases ${where} ORDER BY created_at DESC, id DESC LIMIT 200`).all(...values) as CaseRow[];
    return { cases: rows.map(listItem), counts, total: counts.new + counts.in_review + counts.completed };
  }

  get(id: string): PharmacyCase {
    const row = this.db.prepare("SELECT * FROM pharmacy_cases WHERE id = ?").get(id) as CaseRow | undefined;
    if (!row) throw new PharmacyError("Assessment not found.", 404);
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    const reviewHistory = this.db.prepare("SELECT status, reviewer_name AS reviewerName, notes, created_at AS createdAt FROM pharmacy_review_events WHERE case_id = ? ORDER BY id ASC").all(id) as ReviewEvent[];
    return { ...listItem(row), ...snapshot, reviewNotes: row.review_notes, reviewerName: row.reviewer_name, reviewHistory };
  }

  review(id: string, input: ValidReview): PharmacyCase {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT version FROM pharmacy_cases WHERE id = ?").get(id) as { version: number } | undefined;
      if (!row) throw new PharmacyError("Assessment not found.", 404);
      if (row.version !== input.version) throw new PharmacyError("Another reviewer changed this assessment. Refresh it before saving your changes.", 409);
      const updatedAt = new Date().toISOString();
      this.db.prepare("UPDATE pharmacy_cases SET status = ?, review_notes = ?, reviewer_name = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").run(input.status, input.reviewNotes, input.reviewerName, updatedAt, id, input.version);
      this.db.prepare("INSERT INTO pharmacy_review_events (case_id, status, reviewer_name, notes, created_at, version) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.status, input.reviewerName, input.reviewNotes, updatedAt, input.version + 1);
      const updated = this.get(id);
      this.db.exec("COMMIT");
      return updated;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

const globalStore = globalThis as typeof globalThis & {
  pharmacyStores?: Map<string, PharmacyStore>;
  pharmacyPostgresStores?: Map<string, PostgresPharmacyStore>;
};
export async function getPharmacyStore(): Promise<PharmacyStore | PostgresPharmacyStore> {
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.NEON_DB?.trim() || process.env.POSTGRES_URL?.trim();
  if (connectionString) {
    // Validate without ever including the URL, user, or password in an error.
    let valid = false;
    try {
      const url = new URL(connectionString);
      valid = ["postgres:", "postgresql:"].includes(url.protocol) && !!url.hostname;
    } catch { /* The public error below is deliberately credential-free. */ }
    if (!valid) throw new PharmacyError("The pharmacy dashboard connection needs to be configured by the site owner.", 503, "database_configuration_invalid");
    const { PostgresPharmacyStore } = await import("./postgres-store");
    const stores = globalStore.pharmacyPostgresStores ??= new Map();
    let store = stores.get(connectionString);
    if (!store) { store = new PostgresPharmacyStore(connectionString); stores.set(connectionString, store); }
    return store;
  }
  // Vercel instances cannot share a durable local file. Never save a case to /tmp.
  if (process.env.VERCEL) throw new PharmacyError("The pharmacy dashboard is not configured yet. Please contact the site owner.", 503, "database_not_configured");
  // This runtime-created database must not be traced into the application bundle.
  const path = resolve(/* turbopackIgnore: true */ process.env.PHARMACY_DATABASE_PATH?.trim() || "./data/pharmacy-dashboard.sqlite");
  const stores = globalStore.pharmacyStores ??= new Map();
  let store = stores.get(path);
  if (!store) { store = new PharmacyStore(path); stores.set(path, store); }
  return store;
}
