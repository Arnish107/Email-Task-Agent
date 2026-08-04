import { z } from "zod";

export const evidenceSchema = z.object({
  quote: z.string().max(500),
  reason: z.string().max(500),
});

export const candidateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  deadline: z.string().nullable(),
  submittedTo: z.string().nullable(),
  portalLink: z.string().nullable(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  entityHint: z.string().nullable(),
  assignedRoleHints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceSchema).default([]),
  missingFields: z.array(z.string()).default([]),
});

export const extractionResultSchema = z.object({
  containsTask: z.boolean(),
  candidates: z.array(candidateSchema).default([]),
});

export type ExtractionCandidate = z.infer<typeof candidateSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export function validateExtractionResult(raw: unknown): ExtractionResult {
  const parsed = extractionResultSchema.parse(raw);
  if (!parsed.containsTask) {
    return { containsTask: false, candidates: [] };
  }
  return parsed;
}
