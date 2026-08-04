-- Allow IMAP mailboxes and store provider-specific connection settings.

ALTER TABLE mailbox_connections
  ADD COLUMN IF NOT EXISTS connection_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mailbox_connections
  DROP CONSTRAINT IF EXISTS mailbox_connections_provider_check;

ALTER TABLE mailbox_connections
  ADD CONSTRAINT mailbox_connections_provider_check
  CHECK (provider IN ('gmail', 'microsoft', 'fixture', 'imap'));
