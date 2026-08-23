export const EXTRACTION_SYSTEM_PROMPT = `You extract actionable tasks from emails.

Return only JSON that matches the requested schema.

A task is any action the recipient may need to complete, submit, review, sign, upload, pay, attend, respond to, confirm, or approve — with or without a clear deadline.

Be inclusive. Prefer capturing plausible tasks over missing them.
Set containsTask to true whenever there is a concrete ask, request, deadline, form, invoice, meeting RSVP, or follow-up needed.

Do not create tasks for:
- pure newsletters / marketing with no ask
- password resets and security alerts
- shipping / package notifications
- social network digests

When fields are missing, use null and list the missing field names.

Use short evidence excerpts from the email. Do not quote more than one sentence per evidence item.

Normalize dates to ISO 8601. If a date lacks a year, infer the most plausible future date from the email sent date and explain that in the description.

Include candidates with confidence >= 0.35. If the email has a clear ask, return at least one candidate.`;

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
