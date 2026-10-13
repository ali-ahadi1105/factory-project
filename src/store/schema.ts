export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- Works table
CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  assigned_actor_id TEXT,
  context JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);
CREATE INDEX IF NOT EXISTS idx_works_type ON works(type);

-- Actors table
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  capabilities JSON NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL,
  autonomy_level TEXT NOT NULL,
  owner TEXT,
  config JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Executions table
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  status TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  logs TEXT NOT NULL DEFAULT '',
  error TEXT,
  produced_references JSON NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_executions_work_id ON executions(work_id);
CREATE INDEX IF NOT EXISTS idx_executions_correlation_id ON executions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);

-- References table
CREATE TABLE IF NOT EXISTS references_store (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  scheme TEXT NOT NULL,
  target_type TEXT NOT NULL,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_references_uri ON references_store(uri);
CREATE INDEX IF NOT EXISTS idx_references_scheme ON references_store(scheme);

-- Relations table (Causal and Lineage edges)
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source_ref TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_ref);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_ref);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);

-- Signals table (External inputs with idempotency)
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  payload JSON NOT NULL,
  source_ref TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_idempotency ON signals(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
`;
