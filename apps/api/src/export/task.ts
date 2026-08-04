import { z } from "zod";

export const taskPayloadSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  countyId: z.string().min(1),
  deadline: z.string().datetime({ offset: true }),
  submittedTo: z.string().min(1),
  portalLink: z.string().url().optional().or(z.literal("")).or(z.null()).optional(),
  priority: z.enum(["low", "medium", "high"]),
  assignedRoles: z.array(z.string()).default([]),
  assignedContactIds: z.array(z.string()).default([]),
});

export type TaskPayload = z.infer<typeof taskPayloadSchema>;

export type ExportItem = {
  source: {
    type: "email";
    provider: string;
    messageId: string;
    threadId?: string | null;
    subject: string;
    sender: string;
    sentAt?: string | null;
  };
  task: TaskPayload;
  review: {
    approvedBy: string;
    approvedAt: string;
    confidence: number;
    evidence: unknown[];
  };
};

export type CandidateExportRow = {
  id: string;
  title: string;
  description: string;
  county_id: string | null;
  deadline: Date | string | null;
  submitted_to: string | null;
  portal_link: string | null;
  priority: string;
  assigned_role_hints: unknown;
  evidence: unknown;
  confidence: number | string;
  provider_message_id: string;
  source_thread_id: string | null;
  source_subject: string;
  source_sender: string;
  source_sent_at: Date | string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  provider: string;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function buildExportItem(row: CandidateExportRow): ExportItem {
  const deadline = toIso(row.deadline);
  if (!row.county_id) {
    throw new Error(`Candidate ${row.id} is missing countyId`);
  }
  if (!deadline) {
    throw new Error(`Candidate ${row.id} is missing a valid deadline`);
  }
  if (!row.submitted_to?.trim()) {
    throw new Error(`Candidate ${row.id} is missing submittedTo`);
  }

  const task = taskPayloadSchema.parse({
    title: row.title,
    description: row.description,
    countyId: row.county_id,
    deadline,
    submittedTo: row.submitted_to,
    portalLink: row.portal_link || undefined,
    priority: row.priority,
    assignedRoles: Array.isArray(row.assigned_role_hints)
      ? row.assigned_role_hints
      : [],
    assignedContactIds: [],
  });

  return {
    source: {
      type: "email",
      provider: row.provider,
      messageId: row.provider_message_id,
      threadId: row.source_thread_id,
      subject: row.source_subject,
      sender: row.source_sender,
      sentAt: toIso(row.source_sent_at),
    },
    task,
    review: {
      approvedBy: row.reviewed_by ?? "unknown",
      approvedAt: toIso(row.reviewed_at) ?? new Date().toISOString(),
      confidence: Number(row.confidence),
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
    },
  };
}

export function validateExportTask(task: TaskPayload): string[] {
  const errors: string[] = [];
  if (!task.title?.trim()) errors.push("title is required");
  if (!task.countyId?.trim()) errors.push("countyId is required");
  if (!task.deadline || Number.isNaN(new Date(task.deadline).getTime())) {
    errors.push("deadline must be a valid ISO date");
  }
  if (!task.submittedTo?.trim()) errors.push("submittedTo is required");
  if (!["low", "medium", "high"].includes(task.priority)) {
    errors.push("priority must be low, medium, or high");
  }
  return errors;
}
