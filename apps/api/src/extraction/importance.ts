import type { NormalizedEmail } from "../providers/types.js";

const NOISE =
  /unsubscribe|newsletter|weekly digest|view in browser|you('re| are) receiving this|no[- ]reply@|donotreply|do-not-reply|password reset|verify your email|security alert|new login|linkedin|facebook|twitter|instagram|spotify|amazon\.com|package delivered|your order|receipt for|promotional|marketing|sale ends|% off/i;

const FYI_ONLY =
  /\bfyi\b|for your information only|no action (needed|required)|informational only|just sharing|fyi only/i;

const HIGH_SIGNAL =
  /\b(action required|immediate action|deadline|due (by|date|on)|no later than|must submit|please submit|please complete|please sign|please return|please upload|required to|compliance|certification|filing|grant award|audit|subrecipient|cdbg|arpa|reporting requirement|form [a-z0-9-]+|portal)\b/i;

const GOV_OR_AGENCY =
  /\.gov\b|dca\.|accg|hud\.gov|fema\.|epa\.gov|usda\.|georgia\.gov|state\.[a-z]{2}\.us|county|city of|authority/i;

const DEADLINEish =
  /\b(due|deadline|by|no later than|before)\b.{0,40}\b(\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|[A-Z][a-z]+ \d{1,2}(,?\s*\d{4})?)\b/i;

export type ImportanceResult = {
  important: boolean;
  score: number;
  reasons: string[];
};

/**
 * Cheap prefilter so we do not run extraction on every inbox message.
 * Tuned for government / compliance action mail, not general inbox triage.
 */
export function scoreEmailImportance(email: NormalizedEmail): ImportanceResult {
  const subject = email.subject ?? "";
  const blob = `${subject}\n${email.from}\n${email.bodyText.slice(0, 2500)}`;
  const reasons: string[] = [];
  let score = 0;

  if (NOISE.test(blob) && !HIGH_SIGNAL.test(subject)) {
    return { important: false, score: 0, reasons: ["noise_or_marketing"] };
  }
  if (FYI_ONLY.test(blob) && !HIGH_SIGNAL.test(blob)) {
    return { important: false, score: 0, reasons: ["fyi_only"] };
  }

  if (HIGH_SIGNAL.test(subject)) {
    score += 3;
    reasons.push("action_subject");
  } else if (HIGH_SIGNAL.test(blob)) {
    score += 2;
    reasons.push("action_body");
  }

  if (DEADLINEish.test(blob)) {
    score += 2;
    reasons.push("deadline_language");
  }

  if (GOV_OR_AGENCY.test(email.from) || GOV_OR_AGENCY.test(blob)) {
    score += 2;
    reasons.push("gov_or_agency");
  }

  if (email.links.some((l) => /portal|submit|forms?|grants?|\.gov\//i.test(l))) {
    score += 1;
    reasons.push("portal_link");
  }

  if (email.attachments.some((a) => /\.(pdf|docx?|xlsx?)$/i.test(a.filename))) {
    score += 1;
    reasons.push("form_attachment");
  }

  // Important if we have clear action signal (score >= 3), or a strong subject alone.
  const important =
    (score >= 3 && reasons.includes("action_subject")) || score >= 3;

  return { important, score, reasons };
}

export function isImportantEmail(email: NormalizedEmail): boolean {
  return scoreEmailImportance(email).important;
}

/**
 * Default Gmail search: recent primary mail in the scan window.
 * Keyword filtering happens in-app (isImportantEmail) so "Seen" counts the
 * real window, not only messages that already match compliance phrases.
 */
export function buildImportantGmailQuery(days: number): string {
  const window = `newer_than:${Math.min(90, Math.max(1, days))}d`;
  return `${window} -category:promotions -category:social -category:forums -in:chats`;
}

/** Drop weak extraction hits so the review queue stays high-signal. */
export function isImportantCandidate(candidate: {
  confidence: number;
  deadline?: string | null;
  submittedTo?: string | null;
  title: string;
  missingFields?: string[];
}): boolean {
  if (candidate.confidence >= 0.55) return true;
  if (candidate.deadline) return true;
  if (candidate.submittedTo && candidate.confidence >= 0.45) return true;
  if (
    /\b(submit|file|complete|sign|upload|return|certif|report|pay|deadline|due)\b/i.test(
      candidate.title,
    )
  ) {
    return true;
  }
  return false;
}
