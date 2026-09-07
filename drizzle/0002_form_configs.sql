CREATE TABLE IF NOT EXISTS form_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL UNIQUE,
  definition_json TEXT NOT NULL,
  updated_by_email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (cycle_id) REFERENCES cycles(id)
);

CREATE INDEX IF NOT EXISTS idx_form_configs_cycle ON form_configs(cycle_id);
