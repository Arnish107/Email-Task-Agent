import type { NormalizedEmail } from "../providers/types.js";

/** Hard cap on messages listed/processed per scan. */
export const MAX_SCAN_MESSAGES = 10_000;

export type Selectivity = "relaxed" | "balanced" | "strict";

export const SELECTIVITY_LEVELS: Selectivity[] = [
  "relaxed",
  "balanced",
  "strict",
];

export function parseSelectivity(value: unknown): Selectivity {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (v === "relaxed" || v === "balanced" || v === "strict") return v;
  return "balanced";
}

const NOISE =
  /unsubscribe|newsletter|weekly digest|view in browser|you('re| are) receiving this|% off|limited time offer|flash sale/i;

const NOISE_STRICT =
  /unsubscribe|newsletter|weekly digest|view in browser|you('re| are) receiving this|no[- ]reply@|donotreply|do-not-reply|password reset|verify your email|security alert|new login|linkedin|facebook|twitter|instagram|spotify|amazon\.com|package delivered|your order|receipt for|promotional|marketing|sale ends|% off|limited time offer|flash sale|fyi only|for your information only|no action (needed|required)/i;

const HIGH_SIGNAL =
  /\b(action required|immediate action|deadline|due (by|date|on)|no later than|must submit|please submit|please complete|please sign|please return|please upload|required to|compliance|certification|filing|grant|audit|reporting|form [a-z0-9-]+|portal|invoice|payment|meeting|rsvp|confirm|respond|reply by)\b/i;

const DEADLINEish =
  /\b(due|deadline|by|no later than|before)\b.{0,40}\b(\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|[A-Z][a-z]+ \d{1,2}(,?\s*\d{4})?)\b/i;

export type ImportanceResult = {
  important: boolean;
  score: number;
  reasons: string[];
};

/**
 * Prefilter before LLM extraction. Behavior depends on selectivity.
 */
export function scoreEmailImportance(
  email: NormalizedEmail,
  selectivity: Selectivity = "balanced",
): ImportanceResult {
  const subject = email.subject ?? "";
  const blob = `${subject}\n${email.from}\n${email.bodyText.slice(0, 2500)}`;
  const reasons: string[] = [];
  let score = 0;

  const noiseRe = selectivity === "strict" ? NOISE_STRICT : NOISE;
  if (noiseRe.test(blob) && !HIGH_SIGNAL.test(subject) && !DEADLINEish.test(blob)) {
    return { important: false, score: 0, reasons: ["noise_or_marketing"] };
  }

  if (HIGH_SIGNAL.test(subject) || HIGH_SIGNAL.test(blob)) {
    score += 2;
    reasons.push("action_language");
  }
  if (DEADLINEish.test(blob)) {
    score += 1;
    reasons.push("deadline_language");
  }

  if (selectivity === "relaxed") {
    reasons.push("inbox_mail");
    return { important: true, score: Math.max(1, score), reasons };
  }

  if (selectivity === "balanced") {
    // Process unless clear noise; prefer messages with some signal but don't require it.
    reasons.push(score > 0 ? "signal_or_inbox" : "inbox_mail");
    return { important: true, score: Math.max(1, score), reasons };
  }

  // strict: need clear action / deadline language
  const important = score >= 2;
  if (!important) {
    return { important: false, score, reasons: reasons.length ? reasons : ["low_signal"] };
  }
  return { important: true, score, reasons };
}

export function isImportantEmail(
  email: NormalizedEmail,
  selectivity: Selectivity = "balanced",
): boolean {
  return scoreEmailImportance(email, selectivity).important;
}

/**
 * Gmail search shaped by selectivity.
 */
export function buildImportantGmailQuery(
  days: number,
  selectivity: Selectivity = "balanced",
): string {
  const window = `newer_than:${Math.min(90, Math.max(1, days))}d`;
  const exclude = `-category:promotions -category:social -category:forums -in:chats`;

  if (selectivity === "relaxed") {
    return `${window} ${exclude}`;
  }

  if (selectivity === "balanced") {
    return `${window} ${exclude}`;
  }

  const signals = [
    "deadline",
    "due",
    '"action required"',
    '"please submit"',
    '"please complete"',
    "compliance",
    "certification",
    "filing",
    "grant",
    "audit",
    "report due",
    "must submit",
    "portal",
    "invoice",
    "RSVP",
  ].join(" OR ");

  return `${window} (${signals}) ${exclude}`;
}

/** Post-extraction gate for candidates. */
export function isImportantCandidate(
  candidate: {
    confidence: number;
    deadline?: string | null;
    submittedTo?: string | null;
    title: string;
    missingFields?: string[];
  },
  selectivity: Selectivity = "balanced",
): boolean {
  const title = candidate.title?.trim() ?? "";
  if (title.length < 3) return false;
  if (/^(untitled|n\/a|none|test)$/i.test(title)) return false;

  if (selectivity === "relaxed") {
    return candidate.confidence >= 0.3 || title.length >= 8;
  }

  if (selectivity === "balanced") {
    if (candidate.confidence >= 0.45) return true;
    if (candidate.deadline && candidate.confidence >= 0.35) return true;
    if (candidate.submittedTo && candidate.confidence >= 0.4) return true;
    return false;
  }

  // strict
  if (candidate.confidence >= 0.7) return true;
  if (candidate.deadline && candidate.submittedTo && candidate.confidence >= 0.55) {
    return true;
  }
  if (
    candidate.deadline &&
    candidate.confidence >= 0.6 &&
    /\b(submit|file|complete|sign|upload|return|certif|report|pay|respond|confirm)\b/i.test(
      title,
    )
  ) {
    return true;
  }
  return false;
}
