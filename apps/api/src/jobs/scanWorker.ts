import { nanoid } from "nanoid";
import { writeAuditLog } from "../audit/log.js";
import { bodyHash, decryptSecret, encryptSecret, sha256 } from "../crypto/tokens.js";
import { findCandidateDuplicates } from "../duplicates/detect.js";
import { strongEntityMatch } from "../entity/mapping.js";
import { extractTasks } from "../extraction/agent.js";
import {
  isImportantCandidate,
  isImportantEmail,
  MAX_SCAN_MESSAGES,
  parseSelectivity,
  type Selectivity,
} from "../extraction/importance.js";
import { pool } from "../db/pool.js";
import { getProvider } from "../providers/index.js";
import { refreshGmailAccessToken } from "../providers/gmail.js";

type MailboxRow = {
  id: string;
  user_id: string;
  provider: string;
  email_address: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  connection_meta: Record<string, unknown> | null;
  status: string;
};

async function resolveAccessToken(mailbox: MailboxRow): Promise<string> {
  let access = decryptSecret(mailbox.access_token_ciphertext);
  if (mailbox.provider === "fixture") {
    return access || "fixture-token";
  }
  if (mailbox.provider === "imap") {
    // Stored app password / mailbox password (encrypted at rest)
    return access;
  }
  if (mailbox.provider === "gmail" && mailbox.refresh_token_ciphertext) {
    try {
      const refresh = decryptSecret(mailbox.refresh_token_ciphertext);
      const fresh = await refreshGmailAccessToken(refresh);
      access = fresh;
      await pool.query(
        `UPDATE mailbox_connections
         SET access_token_ciphertext = $1, updated_at = NOW(), status = 'active'
         WHERE id = $2`,
        [encryptSecret(fresh), mailbox.id],
      );
    } catch (err) {
      console.warn("Gmail token refresh failed; using stored access token", err);
    }
  }
  if (mailbox.provider === "microsoft" && mailbox.refresh_token_ciphertext) {
    try {
      const { refreshMicrosoftAccessToken } = await import(
        "../providers/microsoft.js"
      );
      const refresh = decryptSecret(mailbox.refresh_token_ciphertext);
      const fresh = await refreshMicrosoftAccessToken(refresh);
      access = fresh.accessToken;
      await pool.query(
        `UPDATE mailbox_connections
         SET access_token_ciphertext = $1,
             refresh_token_ciphertext = COALESCE($2, refresh_token_ciphertext),
             updated_at = NOW(), status = 'active'
         WHERE id = $3`,
        [
          encryptSecret(fresh.accessToken),
          fresh.refreshToken ? encryptSecret(fresh.refreshToken) : null,
          mailbox.id,
        ],
      );
    } catch (err) {
      console.warn("Microsoft token refresh failed; using stored access token", err);
    }
  }
  return access;
}

function connectionMeta(mailbox: MailboxRow): Record<string, unknown> {
  const meta =
    mailbox.connection_meta && typeof mailbox.connection_meta === "object"
      ? { ...mailbox.connection_meta }
      : {};
  if (mailbox.provider === "imap") {
    meta.user = meta.user ?? mailbox.email_address;
    meta.email = mailbox.email_address;
  }
  return meta;
}

export async function processScanJob(jobId: string): Promise<void> {
  const jobRes = await pool.query<{
    id: string;
    mailbox_connection_id: string;
    query: string;
    selectivity: string | null;
    window_start: Date | null;
    window_end: Date | null;
  }>("SELECT * FROM email_scan_jobs WHERE id = $1", [jobId]);
  const job = jobRes.rows[0];
  if (!job) return;

  const selectivity: Selectivity = parseSelectivity(job.selectivity);

  const mailboxRes = await pool.query<MailboxRow>(
    "SELECT * FROM mailbox_connections WHERE id = $1",
    [job.mailbox_connection_id],
  );
  const mailbox = mailboxRes.rows[0];
  if (!mailbox) {
    await failJob(jobId, "Mailbox connection not found");
    return;
  }

  await pool.query(
    `UPDATE email_scan_jobs SET status = 'running' WHERE id = $1`,
    [jobId],
  );

  try {
    const provider = getProvider(mailbox.provider);
    const accessToken = await resolveAccessToken(mailbox);
    const meta = connectionMeta(mailbox);

    const days = job.window_start
      ? Math.max(
          1,
          Math.ceil(
            (Date.now() - new Date(job.window_start).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 7;

    const messageIds = await provider.listMessageIds(
      accessToken,
      {
        days,
        query: job.query,
      },
      meta,
    );

    let candidatesCreated = 0;
    let messagesProcessed = 0;
    const startedAt = Date.now();
    // Leave headroom before Vercel maxDuration so we can still write completion.
    const deadlineMs = process.env.VERCEL ? 240_000 : 10 * 60_000;

    const existingRes = await pool.query<{
      id: string;
      title: string;
      entity_hint: string | null;
      deadline: Date | null;
      submitted_to: string | null;
      status: string;
    }>(
      `SELECT id, title, entity_hint, deadline, submitted_to, status
       FROM email_task_candidates
       WHERE mailbox_connection_id = $1`,
      [mailbox.id],
    );

    for (const messageId of messageIds) {
      if (Date.now() - startedAt > deadlineMs) {
        break;
      }
      messagesProcessed += 1;
      const email = await provider.fetchMessage(accessToken, messageId, meta);
      if (!isImportantEmail(email, selectivity)) {
        continue;
      }

      const hash = bodyHash(email.bodyText);
      const extraction = await extractTasks(email, selectivity);

      if (!extraction.containsTask || extraction.candidates.length === 0) {
        continue;
      }

      for (const candidate of extraction.candidates) {
        if (!isImportantCandidate(candidate, selectivity)) {
          continue;
        }

        const dupes = findCandidateDuplicates(
          {
            title: candidate.title,
            entityHint: candidate.entityHint,
            deadline: candidate.deadline,
            submittedTo: candidate.submittedTo,
          },
          existingRes.rows.map((r) => ({
            id: r.id,
            title: r.title,
            entityHint: r.entity_hint,
            deadline: r.deadline,
            submittedTo: r.submitted_to,
            status: r.status,
          })),
        );

        const entityMatch = strongEntityMatch(candidate.entityHint);
        const id = nanoid();
        const dedupeKey = sha256(
          [
            mailbox.id,
            email.messageId,
            hash,
            candidate.title.toLowerCase().trim(),
          ].join(":"),
        );

        try {
          await pool.query(
            `INSERT INTO email_task_candidates (
              id, scan_job_id, mailbox_connection_id, provider_message_id,
              source_thread_id, source_subject, source_sender, source_sent_at,
              body_hash, dedupe_key, status, confidence, title, description, deadline,
              submitted_to, portal_link, priority, entity_hint, county_id,
              assigned_role_hints, evidence, missing_fields, raw_extraction,
              possible_duplicate_ids
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_review',$11,$12,$13,$14,
              $15,$16,$17,$18,$19,$20,$21,$22,$23,$24
            )`,
            [
              id,
              jobId,
              mailbox.id,
              email.messageId,
              email.threadId ?? null,
              email.subject,
              email.from,
              email.sentAt,
              hash,
              dedupeKey,
              candidate.confidence,
              candidate.title,
              candidate.description,
              candidate.deadline,
              candidate.submittedTo,
              candidate.portalLink,
              candidate.priority,
              candidate.entityHint,
              entityMatch?.entity.id ?? null,
              JSON.stringify(candidate.assignedRoleHints ?? []),
              JSON.stringify(candidate.evidence ?? []),
              JSON.stringify(candidate.missingFields ?? []),
              JSON.stringify(candidate),
              JSON.stringify(dupes.map((d) => d.id)),
            ],
          );

          candidatesCreated += 1;
          existingRes.rows.push({
            id,
            title: candidate.title,
            entity_hint: candidate.entityHint,
            deadline: candidate.deadline ? new Date(candidate.deadline) : null,
            submitted_to: candidate.submittedTo,
            status: "needs_review",
          });

          await writeAuditLog({
            userId: mailbox.user_id,
            mailboxConnectionId: mailbox.id,
            eventType: "candidate_created",
            details: { candidateId: id, messageId: email.messageId, title: candidate.title },
          });
        } catch (err: unknown) {
          // Unique constraint = source duplicate; skip silently for MVP
          const message = err instanceof Error ? err.message : String(err);
          if (!/unique|duplicate/i.test(message)) {
            throw err;
          }
        }
      }
    }

    await pool.query(
      `UPDATE email_scan_jobs
       SET status = 'completed', messages_seen = $1, candidates_created = $2,
           completed_at = NOW()
       WHERE id = $3`,
      [messagesProcessed, candidatesCreated, jobId],
    );
    await pool.query(
      `UPDATE mailbox_connections SET last_scan_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [mailbox.id],
    );
    await writeAuditLog({
      userId: mailbox.user_id,
      mailboxConnectionId: mailbox.id,
      eventType: "scan_completed",
      details: {
        jobId,
        messagesListed: messageIds.length,
        messagesSeen: messagesProcessed,
        candidatesCreated,
        selectivity,
        cappedAt: MAX_SCAN_MESSAGES,
        timedOutEarly: messagesProcessed < messageIds.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(jobId, message, mailbox.user_id, mailbox.id);
  }
}

async function failJob(
  jobId: string,
  errorMessage: string,
  userId?: string,
  mailboxId?: string,
) {
  await pool.query(
    `UPDATE email_scan_jobs
     SET status = 'failed', error_message = $1, completed_at = NOW()
     WHERE id = $2`,
    [errorMessage, jobId],
  );
  await writeAuditLog({
    userId,
    mailboxConnectionId: mailboxId,
    eventType: "scan_failed",
    details: { jobId, errorMessage },
  });
}

export function enqueueScanJob(jobId: string): void {
  // Fire-and-forget only works on a long-lived Node process (local / Render).
  // On Vercel, setImmediate is frozen when the response ends — caller must await
  // runScanJob() instead.
  if (process.env.VERCEL) {
    return;
  }
  setImmediate(() => {
    processScanJob(jobId).catch((err) => {
      console.error("Scan job crashed", jobId, err);
    });
  });
}

/** Run a scan to completion (required on Vercel serverless). */
export async function runScanJob(jobId: string): Promise<void> {
  await processScanJob(jobId);
}
