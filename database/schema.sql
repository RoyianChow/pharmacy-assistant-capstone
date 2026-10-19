-- Proposed local demo schema. Store synthetic case data only.
-- This file is a starting point; no migration runner is included yet.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  case_type TEXT NOT NULL CHECK (case_type IN ('assessment', 'prescription')),
  dataset_split TEXT CHECK (dataset_split IN ('development', 'final')),
  status TEXT NOT NULL DEFAULT 'draft',
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reference_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  version_label TEXT,
  checked_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL CHECK (agent_role IN ('intake', 'assessment', 'verification')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'incomplete', 'error')),
  model_name TEXT,
  prompt_version TEXT NOT NULL,
  result_json TEXT,
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  follow_up_notes TEXT,
  reviewer_label TEXT NOT NULL DEFAULT 'simulated reviewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cases_type_split ON cases(case_type, dataset_split);
CREATE INDEX IF NOT EXISTS idx_agent_runs_case_created ON agent_runs(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_decisions_case_created ON review_decisions(case_id, created_at);
