import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { PharmacyError } from "./validation";
import type { ValidReview, ValidSubmission } from "./validation";
import type { CaseFilters, CaseListItem, CaseStatus, DashboardResponse, PharmacyCase, ReviewEvent, SubmissionReceipt } from "./types";

type Snapshot = Pick<PharmacyCase, "patient" | "answers" | "summary" | "result" | "concern">;
type CaseRow = {
  id: string;
  reference: string;
  snapshot_json: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  version: number;
  review_notes: string;
  reviewer_name: string;
  fingerprint: string;
};

function listItem(row: CaseRow): CaseListItem {
  const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
  return {
    id: row.id, reference: row.reference, patient: snapshot.patient,
    concern: snapshot.concern, outcome: snapshot.result.kind, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
  };
}

function receipt(row: CaseRow): SubmissionReceipt {
  return { id: row.id, reference: row.reference, createdAt: row.created_at, status: row.status };
}

/** Shared persistence for hosted instances. Connections and schema creation are lazy. */
export class PostgresPharmacyStore {
  private readonly pool: Pool;
  private schemaReady?: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      min: 0,
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });
    // pg requires an idle-client error listener. Do not log credentials or patient data.
    this.pool.on("error", () => console.error("Pharmacy database idle connection error."));
    if (process.env.VERCEL) attachDatabasePool(this.pool);
  }

  async close(): Promise<void> { await this.pool.end(); }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const client = await this.pool.connect();
    let discardClient = false;
    try {
      await client.query(readOnly
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN ISOLATION LEVEL READ COMMITTED");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      // Keep the original failure, and discard a connection if rollback also fails.
      try { await client.query("ROLLBACK"); }
      catch { discardClient = true; }
      throw error;
    } finally {
      client.release(discardClient);
    }
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.initializeSchema().catch((error: unknown) => {
        this.schemaReady = undefined;
        throw error;
      });
    }
    return this.schemaReady;
  }

  private async initializeSchema(): Promise<void> {
    await this.transaction(async (client) => {
      // Transaction-scoped locking also works through transaction-mode poolers.
      // Serialize DDL from simultaneous cold starts in this application's database.
      await client.query("SELECT pg_advisory_xact_lock(385, 1)");
      await client.query(`
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
        CREATE INDEX IF NOT EXISTS pharmacy_cases_status_created
          ON pharmacy_cases(status, created_at DESC);
        CREATE TABLE IF NOT EXISTS pharmacy_review_events (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES pharmacy_cases(id),
          status TEXT NOT NULL CHECK(status IN ('new', 'in_review', 'completed')),
          reviewer_name TEXT NOT NULL,
          notes TEXT NOT NULL,
          created_at TEXT NOT NULL,
          version INTEGER NOT NULL,
          UNIQUE(case_id, version)
        );
      `);
    });
  }

  async submit(input: ValidSubmission): Promise<{ receipt: SubmissionReceipt; created: boolean }> {
    await this.ensureSchema();
    // Match local-store idempotency without including recomputed engine wording.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ patient: input.patient, answers: input.answers, consentToShare: true }))
      .digest("hex");
    const snapshot: Snapshot = {
      patient: input.patient, answers: input.answers, summary: input.summary,
      result: input.result, concern: input.concern,
    };
    return this.transaction(async (client) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const id = randomUUID();
        const reference = `MA-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
        const createdAt = new Date().toISOString();
        const inserted = await client.query<CaseRow>(`
          INSERT INTO pharmacy_cases (
            id, reference, submission_key, fingerprint, snapshot_json,
            display_name, concern, status, consent_to_share, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', 1, $8, $8)
          ON CONFLICT DO NOTHING
          RETURNING *
        `, [id, reference, input.submissionKey, fingerprint, JSON.stringify(snapshot), input.patient.displayName, input.concern, createdAt]);
        if (inserted.rows[0]) return { receipt: receipt(inserted.rows[0]), created: true };

        // The INSERT waits on conflicting writers. This new READ COMMITTED statement
        // can see the committed winner, even when it was absent before the INSERT.
        const existing = await client.query<CaseRow>(
          "SELECT * FROM pharmacy_cases WHERE submission_key = $1", [input.submissionKey],
        );
        const row = existing.rows[0];
        if (row) {
          if (row.fingerprint !== fingerprint) {
            throw new PharmacyError("This submission key was already used for different details. Start a new submission.", 409);
          }
          return { receipt: receipt(row), created: false };
        }
        // Only the random id/reference collided; retry using a fresh pair.
      }
      throw new Error("Unable to allocate a pharmacy case reference.");
    });
  }

  async list(filters: CaseFilters): Promise<DashboardResponse> {
    await this.ensureSchema();
    return this.transaction(async (client) => {
      const counts = { new: 0, in_review: 0, completed: 0 };
      const totals = await client.query<{ status: CaseStatus; count: string }>(
        "SELECT status, COUNT(*) AS count FROM pharmacy_cases GROUP BY status",
      );
      for (const row of totals.rows) counts[row.status] = Number(row.count);
      const conditions: string[] = [];
      const values: string[] = [];
      if (filters.status) {
        values.push(filters.status);
        conditions.push(`status = $${values.length}`);
      }
      if (filters.outcome) {
        values.push(filters.outcome);
        conditions.push(`snapshot_json::jsonb -> 'result' ->> 'kind' = $${values.length}`);
      }
      if (filters.q) {
        values.push(`%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
        const parameter = `$${values.length}`;
        conditions.push(`(display_name ILIKE ${parameter} ESCAPE E'\\\\' OR concern ILIKE ${parameter} ESCAPE E'\\\\' OR reference ILIKE ${parameter} ESCAPE E'\\\\')`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const matching = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM pharmacy_cases ${where}`, values);
      const matchedTotal = Number(matching.rows[0].count);
      const pageSize = 20;
      const page = Math.min(filters.page ?? 1, Math.max(1, Math.ceil(matchedTotal / pageSize)));
      // SQL identifiers and direction are chosen only from these authored fragments.
      const order = filters.sort === "oldest" ? "created_at ASC, id ASC" : filters.sort === "updated" ? "updated_at DESC, id DESC" : "created_at DESC, id DESC";
      const rows = await client.query<CaseRow>(
        `SELECT * FROM pharmacy_cases ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      );
      return { cases: rows.rows.map(listItem), counts, total: counts.new + counts.in_review + counts.completed, matchedTotal, page, pageSize };
    }, true);
  }

  private async readCase(client: PoolClient, id: string): Promise<PharmacyCase> {
    const { rows } = await client.query<CaseRow>("SELECT * FROM pharmacy_cases WHERE id = $1", [id]);
    const row = rows[0];
    if (!row) throw new PharmacyError("Assessment not found.", 404);
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    const history = await client.query<ReviewEvent>(`
      SELECT status, reviewer_name AS "reviewerName", notes, created_at AS "createdAt"
      FROM pharmacy_review_events WHERE case_id = $1 ORDER BY id ASC
    `, [id]);
    return {
      ...listItem(row), ...snapshot, reviewNotes: row.review_notes,
      reviewerName: row.reviewer_name, reviewHistory: history.rows,
    };
  }

  async get(id: string): Promise<PharmacyCase> {
    await this.ensureSchema();
    return this.transaction(client => this.readCase(client, id), true);
  }

  async review(id: string, input: ValidReview): Promise<PharmacyCase> {
    await this.ensureSchema();
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ version: number }>(
        "SELECT version FROM pharmacy_cases WHERE id = $1 FOR UPDATE", [id],
      );
      const row = rows[0];
      if (!row) throw new PharmacyError("Assessment not found.", 404);
      if (row.version !== input.version) {
        throw new PharmacyError("Another reviewer changed this assessment. Refresh it before saving your changes.", 409);
      }
      const updatedAt = new Date().toISOString();
      await client.query(`
        UPDATE pharmacy_cases
        SET status = $1, review_notes = $2, reviewer_name = $3, updated_at = $4, version = version + 1
        WHERE id = $5 AND version = $6
      `, [input.status, input.reviewNotes, input.reviewerName, updatedAt, id, input.version]);
      await client.query(`
        INSERT INTO pharmacy_review_events (case_id, status, reviewer_name, notes, created_at, version)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [id, input.status, input.reviewerName, input.reviewNotes, updatedAt, input.version + 1]);
      return this.readCase(client, id);
    });
  }
}
