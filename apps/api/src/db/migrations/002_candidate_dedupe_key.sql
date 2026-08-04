-- Allow multiple distinct candidates from one email (multi-task messages).
-- Keep source de-dupe via message id + body hash + normalized title key.

ALTER TABLE email_task_candidates
  DROP CONSTRAINT IF EXISTS email_task_candidates_mailbox_connection_id_provider_message_id_body_hash_key;

ALTER TABLE email_task_candidates
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

UPDATE email_task_candidates
SET dedupe_key = md5(
  coalesce(mailbox_connection_id, '') || ':' ||
  coalesce(provider_message_id, '') || ':' ||
  coalesce(body_hash, '') || ':' ||
  lower(coalesce(title, ''))
)
WHERE dedupe_key IS NULL;

ALTER TABLE email_task_candidates
  ALTER COLUMN dedupe_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_task_candidates_dedupe_key_uidx
  ON email_task_candidates (dedupe_key);
