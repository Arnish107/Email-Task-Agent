-- Per-scan selectivity: how picky filtering + extraction should be.
ALTER TABLE email_scan_jobs
  ADD COLUMN IF NOT EXISTS selectivity TEXT NOT NULL DEFAULT 'balanced';

ALTER TABLE email_scan_jobs
  DROP CONSTRAINT IF EXISTS email_scan_jobs_selectivity_check;

ALTER TABLE email_scan_jobs
  ADD CONSTRAINT email_scan_jobs_selectivity_check
  CHECK (selectivity IN ('relaxed', 'balanced', 'strict'));
