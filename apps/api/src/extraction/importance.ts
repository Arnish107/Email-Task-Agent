import type { NormalizedEmail } from "../providers/types.js";

/** Hard cap on messages listed/processed per scan. */
export const MAX_SCAN_MESSAGES = 10_000;

const NOISE =
  /unsubscribe|newsletter|weekly digest|view in browser|you('re| are) receiving this|% off|limited time offer|flash sale/i;

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
 * Light prefilter — only drops obvious marketing noise.
 * Extraction decides what becomes a candidate.
 */
export function scoreEmailImportance(email: NormalizedEmail): ImportanceResult {
  const subject = email.subject ?? "";
  const blob = `${subject}\n${email.from}\n${email.bodyText.slice(0, 2500)}`;
  const reasons: string[] = [];
  let score = 1; // default: process the message

  if (NOISE.test(blob) && !HIGH_SIGNAL.test(subject) && !DEADLINEish.test(blob)) {
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

  reasons.push("inbox_mail");
  return { important: true, score, reasons };
}

export function isImportantEmail(email: NormalizedEmail): boolean {
  return scoreEmailImportance(email).important;
}

/**
 * Recent mail in the scan window (skips promotions/social/chats).
 */
export function buildImportantGmailQuery(days: number): string {
  const window = `newer_than:${Math.min(90, Math.max(1, days))}d`;
  return `${window} -category:promotions -category:social -category:forums -in:chats`;
}

/** Keep almost all extracted tasks; only drop empty/junk titles. */
export function isImportantCandidate(candidate: {
  confidence: number;
  deadline?: string | null;
  submittedTo?: string | null;
  title: string;
  missingFields?: string[];
}): boolean {
  const title = candidate.title?.trim() ?? "";
  if (title.length < 3) return false;
  if (/^(untitled|n\/a|none|test)$/i.test(title)) return false;
  return true;
}
