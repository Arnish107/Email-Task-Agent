import { Router } from "express";
import { writeAuditLog } from "../audit/log.js";
import { pool } from "../db/pool.js";
import { loadEntities, matchEntity } from "../entity/mapping.js";
import {
  buildExportItem,
  type CandidateExportRow,
} from "../export/task.js";
import { sourceDeepLink } from "./mailbox.js";

export const candidatesRouter = Router();

function mapCandidate(row: Record<string, unknown>) {
  const provider = String(row.provider ?? "");
  return {
    ...row,
    confidence: Number(row.confidence),
    sourceDeepLink: sourceDeepLink(provider, String(row.provider_message_id)),
  };
}

candidatesRouter.get("/", async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const params: unknown[] = [req.user!.id];
  let sql = `
    SELECT c.*, m.provider, m.email_address AS mailbox_email
    FROM email_task_candidates c
    JOIN mailbox_connections m ON m.id = c.mailbox_connection_id
    WHERE m.user_id = $1`;
  if (status) {
    params.push(status);
    sql += ` AND c.status = $2`;
  }
  sql += ` ORDER BY c.created_at DESC LIMIT 200`;

  const result = await pool.query(sql, params);
  res.json({ candidates: result.rows.map(mapCandidate) });
});

candidatesRouter.get("/:id", async (req, res) => {
  const result = await pool.query(
    `SELECT c.*, m.provider, m.email_address AS mailbox_email
     FROM email_task_candidates c
     JOIN mailbox_connections m ON m.id = c.mailbox_connection_id
     WHERE c.id = $1 AND m.user_id = $2`,
    [req.params.id, req.user!.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const candidate = result.rows[0] as Record<string, unknown>;
  const entityHint =
    typeof candidate.entity_hint === "string" ? candidate.entity_hint : "";
  const entitySuggestions = entityHint
    ? [matchEntity(entityHint)].filter(Boolean)
    : [];

  let duplicates: unknown[] = [];
  const dupeIds = Array.isArray(candidate.possible_duplicate_ids)
    ? (candidate.possible_duplicate_ids as string[])
    : [];
  if (dupeIds.length) {
    const dupes = await pool.query(
      `SELECT id, title, status, deadline, submitted_to, entity_hint, confidence
       FROM email_task_candidates WHERE id = ANY($1::text[])`,
      [dupeIds],
    );
    duplicates = dupes.rows;
  }

  res.json({
    candidate: mapCandidate(candidate),
    entitySuggestions,
    entities: loadEntities(),
    possibleDuplicates: duplicates,
  });
});

candidatesRouter.patch("/:id", async (req, res) => {
  const fields = req.body ?? {};
  const allowed = [
    "title",
    "description",
    "deadline",
    "submitted_to",
    "portal_link",
    "priority",
    "entity_hint",
    "county_id",
  ] as const;

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  for (const key of allowed) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (fields[key] !== undefined || fields[camel] !== undefined) {
      sets.push(`${key} = $${i++}`);
      params.push(fields[key] ?? fields[camel]);
    }
  }

  if (fields.assignedRoleHints !== undefined) {
    sets.push(`assigned_role_hints = $${i++}`);
    params.push(JSON.stringify(fields.assignedRoleHints));
  }

  if (!sets.length) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }

  sets.push("updated_at = NOW()");
  params.push(req.params.id, req.user!.id);

  const result = await pool.query(
    `UPDATE email_task_candidates c
     SET ${sets.join(", ")}
     FROM mailbox_connections m
     WHERE c.id = $${i++} AND m.id = c.mailbox_connection_id AND m.user_id = $${i}
     RETURNING c.*`,
    params,
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json({ candidate: result.rows[0] });
});

async function getOwnedCandidate(id: string, userId: string) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT c.*, m.provider, m.user_id
     FROM email_task_candidates c
     JOIN mailbox_connections m ON m.id = c.mailbox_connection_id
     WHERE c.id = $1 AND m.user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

candidatesRouter.post("/:id/approve", async (req, res) => {
  const existing = await getOwnedCandidate(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  // Apply optional edits in the same request
  const edits = req.body ?? {};
  const countyId = edits.countyId ?? edits.county_id ?? existing.county_id;
  const title = edits.title ?? existing.title;
  const description = edits.description ?? existing.description;
  const deadline = edits.deadline ?? existing.deadline;
  const submittedTo =
    edits.submittedTo ?? edits.submitted_to ?? existing.submitted_to;
  const portalLink =
    edits.portalLink ?? edits.portal_link ?? existing.portal_link;
  const priority = edits.priority ?? existing.priority;
  const entityHint =
    edits.entityHint ?? edits.entity_hint ?? existing.entity_hint;

  if (!title?.trim() || !countyId || !deadline || !submittedTo?.trim()) {
    res.status(400).json({
      error:
        "Cannot approve: title, countyId, deadline, and submittedTo are required",
      missing: [
        !title?.trim() && "title",
        !countyId && "countyId",
        !deadline && "deadline",
        !submittedTo?.trim() && "submittedTo",
      ].filter(Boolean),
    });
    return;
  }

  const result = await pool.query(
    `UPDATE email_task_candidates
     SET status = 'approved',
         title = $1, description = $2, deadline = $3, submitted_to = $4,
         portal_link = $5, priority = $6, entity_hint = $7, county_id = $8,
         reviewed_by = $9, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      title,
      description,
      deadline,
      submittedTo,
      portalLink,
      priority,
      entityHint,
      countyId,
      req.user!.email,
      req.params.id,
    ],
  );

  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: String(existing.mailbox_connection_id ?? ""),
    eventType: "candidate_approved",
    details: { candidateId: req.params.id },
  });

  res.json({ candidate: result.rows[0] });
});

candidatesRouter.post("/:id/ignore", async (req, res) => {
  const existing = await getOwnedCandidate(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  const result = await pool.query(
    `UPDATE email_task_candidates
     SET status = 'ignored', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [req.user!.email, req.params.id],
  );
  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: String(existing.mailbox_connection_id ?? ""),
    eventType: "candidate_ignored",
    details: { candidateId: req.params.id },
  });
  res.json({ candidate: result.rows[0] });
});

candidatesRouter.post("/:id/duplicate", async (req, res) => {
  const existing = await getOwnedCandidate(req.params.id, req.user!.id);
  if (!existing) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  const result = await pool.query(
    `UPDATE email_task_candidates
     SET status = 'duplicate', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [req.user!.email, req.params.id],
  );
  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: String(existing.mailbox_connection_id ?? ""),
    eventType: "candidate_marked_duplicate",
    details: { candidateId: req.params.id },
  });
  res.json({ candidate: result.rows[0] });
});

candidatesRouter.post("/export", async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const statusFilter = ids.length ? null : "approved";

  let result;
  if (ids.length) {
    result = await pool.query(
      `SELECT c.*, m.provider
       FROM email_task_candidates c
       JOIN mailbox_connections m ON m.id = c.mailbox_connection_id
       WHERE m.user_id = $1 AND c.id = ANY($2::text[])
         AND c.status IN ('approved', 'exported', 'posted')`,
      [req.user!.id, ids],
    );
  } else {
    result = await pool.query(
      `SELECT c.*, m.provider
       FROM email_task_candidates c
       JOIN mailbox_connections m ON m.id = c.mailbox_connection_id
       WHERE m.user_id = $1 AND c.status = $2`,
      [req.user!.id, statusFilter],
    );
  }

  const exported: unknown[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of result.rows) {
    try {
      const item = buildExportItem(row as CandidateExportRow);
      exported.push(item);
      await pool.query(
        `UPDATE email_task_candidates
         SET status = CASE WHEN status = 'posted' THEN status ELSE 'exported' END,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
      await writeAuditLog({
        userId: req.user!.id,
        mailboxConnectionId: String(row.mailbox_connection_id ?? ""),
        eventType: "task_exported",
        details: { candidateId: row.id },
      });
    } catch (err) {
      errors.push({
        id: String(row.id),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({ exported, errors });
});

export const entitiesRouter = Router();
entitiesRouter.get("/", (_req, res) => {
  res.json({ entities: loadEntities() });
});

export const auditRouter = Router();
auditRouter.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.user!.id],
  );
  res.json({ events: result.rows });
});
