import { nanoid } from "nanoid";
import { pool } from "../db/pool.js";

export type AuditEventType =
  | "mailbox_connected"
  | "mailbox_revoked"
  | "scan_started"
  | "scan_completed"
  | "scan_failed"
  | "scan_history_cleared"
  | "candidate_created"
  | "candidate_approved"
  | "candidate_ignored"
  | "candidate_marked_duplicate"
  | "task_exported"
  | "user_signed_in";

export async function writeAuditLog(input: {
  userId?: string | null;
  mailboxConnectionId?: string | null;
  eventType: AuditEventType;
  details?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (id, user_id, mailbox_connection_id, event_type, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      nanoid(),
      input.userId ?? null,
      input.mailboxConnectionId ?? null,
      input.eventType,
      JSON.stringify(input.details ?? {}),
    ],
  );
}
