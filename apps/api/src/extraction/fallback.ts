import type { NormalizedEmail } from "../providers/types.js";
import type { ExtractionResult } from "./schema.js";

const NEWSLETTER_HINTS =
  /unsubscribe|newsletter|weekly digest|you('re| are) receiving this|view in browser/i;
const FYI_HINTS = /\bfyi\b|for your information|no action (needed|required)|informational only/i;

const ACTION_HINTS =
  /\b(must|required|please|submit|upload|complete|respond|attend|pay|sign|approve|file|return)\b/i;

const DEADLINE_PATTERNS: Array<{
  re: RegExp;
  pick: (m: RegExpMatchArray, sentAt: Date) => string | null;
}> = [
  {
    re: /\b(?:due|deadline|by|no later than|before)\s*(?:on\s+)?([A-Z][a-z]+ \d{1,2},? \d{4})\b/i,
    pick: (m) => {
      const d = new Date(m[1]);
      return Number.isNaN(d.getTime()) ? null : endOfDayIso(d);
    },
  },
  {
    re: /\b(?:due|deadline|by)\s*(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
    pick: (m) => {
      const d = new Date(m[1]);
      return Number.isNaN(d.getTime()) ? null : endOfDayIso(d);
    },
  },
  {
    re: /\b(?:due|deadline|by)\s*(?:on\s+)?([A-Z][a-z]+ \d{1,2})\b/i,
    pick: (m, sentAt) => {
      const withYear = `${m[1]}, ${sentAt.getFullYear()}`;
      let d = new Date(withYear);
      if (Number.isNaN(d.getTime())) return null;
      if (d.getTime() < sentAt.getTime()) {
        d = new Date(`${m[1]}, ${sentAt.getFullYear() + 1}`);
      }
      return endOfDayIso(d);
    },
  },
];

function endOfDayIso(d: Date): string {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 0);
  return x.toISOString();
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^[^.!?]+[.!?]?/);
  return (m?.[0] ?? cleaned).slice(0, 220);
}

function extractPortal(links: string[]): string | null {
  const portalish = links.find((l) =>
    /portal|submit|forms?|grants?|dca\.|georgia\.gov|login/i.test(l),
  );
  return portalish ?? links[0] ?? null;
}

function extractSubmittedTo(text: string, from: string): string | null {
  const agency =
    text.match(
      /\b(Georgia DCA|DCA|ACCG|EPA|FEMA|HUD|USDA|Department of [A-Za-z ]+)\b/,
    )?.[1] ?? null;
  if (agency) return agency;
  if (/gov|state\.|dca|accg/i.test(from)) return from;
  return null;
}

function extractEntityHint(text: string): string | null {
  const m = text.match(
    /\b([A-Z][a-z]+(?: [A-Z][a-z]+)? (?:County|City|Authority))\b/,
  );
  return m?.[1] ?? null;
}

/**
 * Deterministic fallback extractor for demos/tests when no LLM key is configured,
 * and as a safety net if the model call fails.
 */
export function fallbackExtract(email: NormalizedEmail): ExtractionResult {
  const blob = `${email.subject}\n${email.bodyText}`;

  if (NEWSLETTER_HINTS.test(blob) && !/\b(must submit|please submit|action required:)\b/i.test(email.subject)) {
    return { containsTask: false, candidates: [] };
  }
  if (
    FYI_HINTS.test(blob) ||
    /\bno action (needed|required)\b/i.test(blob)
  ) {
    if (!/\b(please submit|must submit|complete and return|upload|sign and return)\b/i.test(blob)) {
      return { containsTask: false, candidates: [] };
    }
  }

  const actionish =
    ACTION_HINTS.test(blob) ||
    /compliance|report|filing|certification|grant|audit/i.test(blob);

  if (!actionish) {
    return { containsTask: false, candidates: [] };
  }

  const sentAt = new Date(email.sentAt);
  let deadline: string | null = null;
  for (const p of DEADLINE_PATTERNS) {
    const m = blob.match(p.re);
    if (m) {
      deadline = p.pick(m, sentAt);
      if (deadline) break;
    }
  }

  const submittedTo = extractSubmittedTo(blob, email.from);
  const portalLink = extractPortal(email.links);
  const entityHint = extractEntityHint(blob);
  const missingFields: string[] = [];
  if (!deadline) missingFields.push("deadline");
  if (!submittedTo) missingFields.push("submittedTo");

  // Split on numbered/bullet tasks for multi-task emails
  const taskChunks = splitMultipleTasks(email);
  const candidates = taskChunks.map((chunk, idx) => {
    const title =
      chunk.title ||
      email.subject.replace(/^(re:|fw:|fwd:)\s*/i, "").trim() ||
      "Compliance action required";
    return {
      title: idx === 0 ? title : chunk.title || `${title} (${idx + 1})`,
      description: chunk.body.slice(0, 800),
      deadline,
      submittedTo,
      portalLink,
      priority: /urgent|asap|immediately/i.test(blob) ? ("high" as const) : ("medium" as const),
      entityHint,
      assignedRoleHints: inferRoles(blob),
      confidence: deadline && submittedTo ? 0.72 : 0.55,
      evidence: [
        {
          quote: firstSentence(chunk.body || email.bodyText),
          reason: "Shows the requested action",
        },
      ],
      missingFields: [...missingFields],
    };
  });

  return { containsTask: true, candidates };
}

function inferRoles(text: string): string[] {
  const roles: string[] = [];
  if (/finance|budget|fiscal|audit/i.test(text)) roles.push("finance");
  if (/planning|zoning/i.test(text)) roles.push("planning");
  if (/public works|infrastructure/i.test(text)) roles.push("public_works");
  if (/clerk|election/i.test(text)) roles.push("clerk");
  return roles;
}

function splitMultipleTasks(email: NormalizedEmail): Array<{ title: string; body: string }> {
  const lines = email.bodyText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^\d+[\).]\s+/.test(l));
  if (numbered.length >= 2) {
    return numbered.map((l) => ({
      title: l.replace(/^\d+[\).]\s+/, "").slice(0, 120),
      body: l,
    }));
  }
  return [{ title: "", body: email.bodyText }];
}
