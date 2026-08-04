-- Email Task Agent initial schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS mailbox_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'fixture')),
  email_address TEXT NOT NULL,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'error')) DEFAULT 'active',
  last_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, email_address)
);

CREATE INDEX IF NOT EXISTS mailbox_connections_user_id_idx ON mailbox_connections(user_id);

CREATE TABLE IF NOT EXISTS email_scan_jobs (
  id TEXT PRIMARY KEY,
  mailbox_connection_id TEXT NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')) DEFAULT 'queued',
  query TEXT NOT NULL,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  messages_seen INT NOT NULL DEFAULT 0,
  candidates_created INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_scan_jobs_mailbox_idx ON email_scan_jobs(mailbox_connection_id);

CREATE TABLE IF NOT EXISTS email_task_candidates (
  id TEXT PRIMARY KEY,
  scan_job_id TEXT NOT NULL REFERENCES email_scan_jobs(id) ON DELETE CASCADE,
  mailbox_connection_id TEXT NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  source_thread_id TEXT,
  source_subject TEXT NOT NULL,
  source_sender TEXT NOT NULL,
  source_sent_at TIMESTAMPTZ,
  body_hash TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('needs_review', 'approved', 'ignored', 'duplicate', 'exported', 'posted')
  ) DEFAULT 'needs_review',
  confidence NUMERIC NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  deadline TIMESTAMPTZ,
  submitted_to TEXT,
  portal_link TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  entity_hint TEXT,
  county_id TEXT,
  assigned_role_hints JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
  possible_duplicate_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_task_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mailbox_connection_id, provider_message_id, body_hash)
);

CREATE INDEX IF NOT EXISTS email_task_candidates_status_idx ON email_task_candidates(status);
CREATE INDEX IF NOT EXISTS email_task_candidates_mailbox_idx ON email_task_candidates(mailbox_connection_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  mailbox_connection_id TEXT,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_event_type_idx ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
