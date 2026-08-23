import type { Selectivity } from "./importance.js";

const BASE = `Return only JSON that matches the requested schema.

When fields are missing, use null and list the missing field names.

Use short evidence excerpts from the email. Do not quote more than one sentence per evidence item.

Normalize dates to ISO 8601. If a date lacks a year, infer the most plausible future date from the email sent date and explain that in the description.`;

const BY_SELECTIVITY: Record<Selectivity, string> = {
  relaxed: `You extract actionable tasks from emails.

${BASE}

A task is any action the recipient may need to complete, submit, review, sign, upload, pay, attend, respond to, confirm, or approve — with or without a clear deadline.

Be inclusive. Prefer capturing plausible tasks over missing them.
Set containsTask to true whenever there is a concrete ask, request, deadline, form, invoice, meeting RSVP, or follow-up needed.

Do not create tasks for:
- pure newsletters / marketing with no ask
- password resets and security alerts
- shipping / package notifications
- social network digests

Include candidates with confidence >= 0.3. If the email has a clear ask, return at least one candidate.`,

  balanced: `You extract actionable tasks from emails.

${BASE}

A task is an explicit or strongly implied action the recipient needs to complete, submit, review, sign, upload, pay, attend, respond to, or approve — often with a deadline, agency, form, or portal.

Prefer clear asks over weak implications. Set containsTask to false when the email is vague informational noise.

Do not create tasks for:
- newsletters, digests, marketing
- FYI / informational-only messages with no ask
- password resets, security alerts, shipping, receipts, social updates

Include candidates with confidence >= 0.45. Prefer fewer solid candidates over many weak ones.`,

  strict: `You extract only important, high-signal actionable tasks from emails.

${BASE}

A task must be an explicit action the recipient or their organization needs to complete — usually with a deadline, agency, portal, form, or clear "action required" language.

Be selective. Prefer fewer high-confidence candidates over many weak ones.
Set containsTask to false when the email is low importance, vague, or not clearly actionable.

Do not create tasks for:
- newsletters, digests, marketing, or automated notifications
- FYI / informational-only messages
- calendar invites without a required action
- broad announcements with no concrete ask
- completed actions or acknowledgements
- password resets, security alerts, shipping, receipts, social updates
- meeting notes or soft "please review when you can" without a deadline

Only include candidates with confidence >= 0.65. If nothing clear qualifies, return containsTask false and an empty candidates array.`,
};

export function buildExtractionSystemPrompt(
  selectivity: Selectivity = "balanced",
): string {
  return BY_SELECTIVITY[selectivity] ?? BY_SELECTIVITY.balanced;
}

/** @deprecated Prefer buildExtractionSystemPrompt(selectivity) */
export const EXTRACTION_SYSTEM_PROMPT = buildExtractionSystemPrompt("balanced");

export function buildExtractionUserPrompt(normalizedEmailJson: string): string {
  return `Email:
${normalizedEmailJson}

Return:
{
  "containsTask": boolean,
  "candidates": [
    {
      "title": string,
      "description": string,
      "deadline": string | null,
      "submittedTo": string | null,
      "portalLink": string | null,
      "priority": "low" | "medium" | "high",
      "entityHint": string | null,
      "assignedRoleHints": string[],
      "confidence": number,
      "evidence": [{ "quote": string, "reason": string }],
      "missingFields": string[]
    }
  ]
}`;
}
