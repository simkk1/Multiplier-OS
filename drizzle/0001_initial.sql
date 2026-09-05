CREATE TABLE cycles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  quarter_label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'applications_open',
  application_open INTEGER NOT NULL DEFAULT 1,
  edit_open INTEGER NOT NULL DEFAULT 0,
  close_at TEXT,
  upcoming_text TEXT NOT NULL DEFAULT 'Next multiplier cycle opens next quarter.',
  manager_due_hours INTEGER NOT NULL DEFAULT 72,
  manager_reminder_hours INTEGER NOT NULL DEFAULT 24,
  function_due_hours INTEGER NOT NULL DEFAULT 48,
  function_reminder_hours INTEGER NOT NULL DEFAULT 24,
  daily_digest_time TEXT NOT NULL DEFAULT '08:00',
  admin_email TEXT NOT NULL DEFAULT 'admin@example.com',
  aop_required INTEGER NOT NULL DEFAULT 1,
  allow_public_test_mode INTEGER NOT NULL DEFAULT 0,
  manager_rework_send_mode TEXT NOT NULL DEFAULT 'draft',
  function_rework_send_mode TEXT NOT NULL DEFAULT 'draft',
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  applicant_email_norm TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  login_user_id TEXT,
  manager_name TEXT NOT NULL,
  manager_email TEXT NOT NULL,
  manager_email_norm TEXT NOT NULL,
  department TEXT NOT NULL,
  sub_department TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  manager_status TEXT NOT NULL DEFAULT 'pending',
  function_status TEXT NOT NULL DEFAULT 'not_ready',
  final_status TEXT NOT NULL DEFAULT 'not_final',
  latest_version_id INTEGER,
  manager_recheck_needed INTEGER NOT NULL DEFAULT 0,
  objective_flags_json TEXT NOT NULL DEFAULT '[]',
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (cycle_id, applicant_email_norm)
);

CREATE TABLE submission_versions (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  version_no INTEGER NOT NULL,
  source TEXT NOT NULL,
  editor_email TEXT NOT NULL,
  data_json TEXT NOT NULL,
  change_summary TEXT,
  material_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (submission_id, version_no)
);

CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  stage TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  reviewer_email_norm TEXT NOT NULL,
  group_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  review_token TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  gmail_thread_id TEXT,
  gmail_message_id TEXT,
  due_at TEXT,
  reminded_at TEXT,
  escalated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (cycle_id, stage, group_key)
);

CREATE TABLE approval_items (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES approval_requests(id),
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  version_id_at_send INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  requested_change TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (request_id, submission_id)
);

CREATE TABLE email_events (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  request_id INTEGER REFERENCES approval_requests(id),
  submission_id INTEGER REFERENCES submissions(id),
  direction TEXT NOT NULL,
  gmail_thread_id TEXT,
  gmail_message_id TEXT,
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  classification TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  request_id INTEGER REFERENCES approval_requests(id),
  submission_id INTEGER REFERENCES submissions(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  actor_email TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  undo_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE dataset_snapshots (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  label TEXT NOT NULL,
  data_json TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE final_participants (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  version_id INTEGER NOT NULL REFERENCES submission_versions(id),
  data_json TEXT NOT NULL,
  finalized_by_email TEXT NOT NULL,
  finalized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (cycle_id, submission_id)
);

CREATE TABLE routing_rules (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  department TEXT NOT NULL,
  sub_department TEXT,
  owner_name TEXT NOT NULL,
  owner_email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE team1_managers (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  manager_name TEXT NOT NULL,
  manager_name_norm TEXT NOT NULL,
  manager_email TEXT,
  manager_email_norm TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (cycle_id, manager_name_norm)
);

CREATE TABLE cycle_memory (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id),
  kind TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_submissions_cycle_status ON submissions(cycle_id, status);
CREATE INDEX idx_submissions_cycle_manager ON submissions(cycle_id, manager_email_norm);
CREATE INDEX idx_submissions_cycle_dept ON submissions(cycle_id, department, sub_department);
CREATE INDEX idx_versions_submission ON submission_versions(submission_id, version_no);
CREATE INDEX idx_approval_requests_cycle_stage ON approval_requests(cycle_id, stage, status);
CREATE INDEX idx_approval_items_submission ON approval_items(submission_id, status);
CREATE INDEX idx_email_events_request ON email_events(request_id, created_at);
CREATE INDEX idx_tasks_cycle_status_due ON tasks(cycle_id, status, due_at);
CREATE INDEX idx_audit_cycle_entity ON audit_events(cycle_id, entity_type, entity_id);
CREATE INDEX idx_final_cycle ON final_participants(cycle_id);
CREATE INDEX idx_routes_cycle_dept ON routing_rules(cycle_id, department, sub_department);
CREATE INDEX idx_team1_cycle_name ON team1_managers(cycle_id, manager_name_norm);

PRAGMA optimize;
