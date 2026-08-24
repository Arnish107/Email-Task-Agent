import { Router } from "express";
import { nanoid } from "nanoid";
import { writeAuditLog } from "../audit/log.js";
import { pool } from "../db/pool.js";
import {
  buildImportantGmailQuery,
  parseSelectivity,
} from "../extraction/importance.js";
import { enqueueScanJob, runScanJob } from "../jobs/scanWorker.js";

export const scansRouter = Router();

async function assertMailboxOwned(mailboxId: string, userId: string) {
  const res = await pool.query(
    `SELECT id, provider, status FROM mailbox_connections
     WHERE id = $1 AND user_id = $2`,
    [mailboxId, userId],
  );
  return res.rows[0] as
    | { id: string; provider: string; status: string }
    | undefined;
}

scansRouter.post("/", async (req, res) => {
  const mailboxId = String(req.body?.mailboxId ?? "");
  const days = Math.min(90, Math.max(1, Number(req.body?.days ?? 7)));
  const selectivity = parseSelectivity(req.body?.selectivity);
  const customQuery = req.body?.query ? String(req.body.query) : null;

  const mailbox = await assertMailboxOwned(mailboxId, req.user!.id);
  if (!mailbox || mailbox.status !== "active") {
    res.status(404).json({
      error:
        "Active mailbox not found. On Vercel the database resets between requests unless you set a real Postgres DATABASE_URL — reconnect Gmail, then scan again. Or use Offline sample inbox for a demo.",
    });
    return;
  }

  const windowEnd = new Date();
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query =
    customQuery?.trim() ||
    (mailbox.provider === "gmail"
      ? buildImportantGmailQuery(days, selectivity)
      : `last_${days}_days`);

  const id = nanoid();
  await pool.query(
    `INSERT INTO email_scan_jobs (
      id, mailbox_connection_id, status, query, selectivity, window_start, window_end
    ) VALUES ($1,$2,'queued',$3,$4,$5,$6)`,
    [id, mailboxId, query, selectivity, windowStart, windowEnd],
  );

  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: mailboxId,
    eventType: "scan_started",
    details: { jobId: id, query, days, selectivity },
  });

  if (process.env.VERCEL) {
    // Must finish inside this invocation — background queues do not survive.
    await runScanJob(id);
  } else {
    enqueueScanJob(id);
  }

  res.status(201).json({
    jobId: id,
    query,
    selectivity,
    windowStart,
    windowEnd,
  });
});

scansRouter.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT j.*
     FROM email_scan_jobs j
     JOIN mailbox_connections m ON m.id = j.mailbox_connection_id
     WHERE m.user_id = $1
     ORDER BY j.created_at DESC
     LIMIT 50`,
    [req.user!.id],
  );
  res.json({ jobs: result.rows });
});

scansRouter.delete("/", async (req, res) => {
  const active = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM email_scan_jobs j
     JOIN mailbox_connections m ON m.id = j.mailbox_connection_id
     WHERE m.user_id = $1 AND j.status IN ('queued', 'running')`,
    [req.user!.id],
  );
  if (Number(active.rows[0]?.count ?? 0) > 0) {
    res.status(409).json({
      error: "A scan is still running. Wait for it to finish, then clear history.",
    });
    return;
  }

  const deleted = await pool.query<{ id: string }>(
    `DELETE FROM email_scan_jobs j
     USING mailbox_connections m
     WHERE j.mailbox_connection_id = m.id AND m.user_id = $1
     RETURNING j.id`,
    [req.user!.id],
  );

  await writeAuditLog({
    userId: req.user!.id,
    eventType: "scan_history_cleared",
    details: { deletedJobs: deleted.rowCount ?? 0 },
  });

  res.json({ ok: true, deletedJobs: deleted.rowCount ?? 0 });
});

scansRouter.get("/:id", async (req, res) => {
  const result = await pool.query(
    `SELECT j.*
     FROM email_scan_jobs j
     JOIN mailbox_connections m ON m.id = j.mailbox_connection_id
     WHERE j.id = $1 AND m.user_id = $2`,
    [req.params.id, req.user!.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Scan job not found" });
    return;
  }
  res.json({ job: result.rows[0] });
});
