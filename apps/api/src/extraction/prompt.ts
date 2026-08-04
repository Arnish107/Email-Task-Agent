export const EXTRACTION_SYSTEM_PROMPT = `You extract only important, actionable compliance tasks from government-related emails.

Return only JSON that matches the requested schema.

A task is an explicit or strongly implied action the recipient or their organization needs to complete, submit, review, sign, upload, pay, attend, respond to, or approve — usually with a deadline, agency, or portal.

Be selective. Prefer fewer high-confidence candidates over many weak ones.
Set containsTask to false when the email is low importance, vague, or not actionable.

Do not create tasks for:
- newsletters, digests, marketing, or automated notifications
- FYI / informational-only messages
- calendar invites without a required action
- broad announcements with no concrete ask
- completed actions or acknowledgements
- password resets, security alerts, shipping, receipts, social updates

When fields are missing, use null and list the missing field names.

Use short evidence excerpts from the email. Do not quote more than one sentence per evidence item.

Normalize dates to ISO 8601. If a date lacks a year, infer the most plausible future date from the email sent date and explain that in the description.

Only include candidates with confidence >= 0.6. If nothing clear qualifies, return containsTask false and an empty candidates array.`;

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
