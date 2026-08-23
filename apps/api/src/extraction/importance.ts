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
  return "relaxed";
}

/** Subject/from look like marketing — ignore common footer “unsubscribe” alone. */
const MARKETING_SUBJECT =
  /\b(newsletter|digest|% off|sale|promo|deal of the day|weekly roundup|flash sale)\b/i;

const NOISE_BODY_STRONG =
  /you('re| are) receiving this (email )?because|view (this|in) browser|manage preferences|weekly digest/i;

const HIGH_SIGNAL =
  /\b(action required|immediate action|deadline|due (by|date|on)|no later than|must submit|please submit|please complete|please sign|please return|please upload|required to|compliance|certification|filing|grant|audit|reporting|form [a-z0-9-]+|portal|invoice|payment|meeting|rsvp|confirm|respond|reply by|please review|follow up|can you|could you|need you to)\b/i;

const DEADLINEish =
  /\b(due|deadline|by|no later than|before)\b.{0,40}\b(\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|[A-Z][a-z]+ \d{1,2}(,?\s*\d{4})?)\b/i;

export type ImportanceResult = {
  important: boolean;
  score: number;
  reasons: string[];
};

function looksLikeMarketing(email: NormalizedEmail): boolean {
  const subject = email.subject ?? "";
  const from = email.from ?? "";
  const head = email.bodyText.slice(0, 400);
  if (MARKETING_SUBJECT.test(subject)) return true;
  if (NOISE_BODY_STRONG.test(head) && !HIGH_SIGNAL.test(subject)) return true;
  if (
    /noreply|no-reply|donotreply|marketing@|news@|promo@/i.test(from) &&
    !HIGH_SIGNAL.test(subject) &&
    !DEADLINEish.test(`${subject}\n${head}`)
  ) {
    return true;
  }
  return false;
}

/**
 * Prefilter before LLM extraction. Behavior depends on selectivity.
 */
export function scoreEmailImportance(
  email: NormalizedEmail,
  selectivity: Selectivity = "relaxed",
): ImportanceResult {
  const subject = email.subject ?? "";
  const blob = `${subject}\n${email.from}\n${email.bodyText.slice(0, 2500)}`;
  const reasons: string[] = [];
  let score = 0;

  // Catch more: never drop on prefilter — LLM / candidate gate decide.
  if (selectivity === "relaxed") {
    return { important: true, score: 1, reasons: ["catch_more"] };
  }

  if (looksLikeMarketing(email) && !HIGH_SIGNAL.test(subject) && !DEADLINEish.test(blob)) {
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

  if (selectivity === "balanced") {
    reasons.push(score > 0 ? "signal_or_inbox" : "inbox_mail");
    return { important: true, score: Math.max(1, score), reasons };
  }

  // strict
  const important = score >= 2;
  if (!important) {
    return {
      important: false,
      score,
      reasons: reasons.length ? reasons : ["low_signal"],
    };
  }
  return { important: true, score, reasons };
}

export function isImportantEmail(
  email: NormalizedEmail,
  selectivity: Selectivity = "relaxed",
): boolean {
  return scoreEmailImportance(email, selectivity).important;
}

/**
 * Gmail search shaped by selectivity.
 */
export function buildImportantGmailQuery(
  days: number,
  selectivity: Selectivity = "relaxed",
): string {
  const window = `newer_than:${Math.min(90, Math.max(1, days))}d`;

  if (selectivity === "relaxed") {
    // Broadest: all recent mail (including promotions).
    return window;
  }

  const exclude = `-category:promotions -category:social -category:forums -in:chats`;
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
    "please",
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
  selectivity: Selectivity = "relaxed",
): boolean {
  const title = candidate.title?.trim() ?? "";
  if (title.length < 3) return false;
  if (/^(untitled|n\/a|none|test)$/i.test(title)) return false;

  if (selectivity === "relaxed") {
    return true;
  }

  if (selectivity === "balanced") {
    if (candidate.confidence >= 0.4) return true;
    if (candidate.deadline) return true;
    if (candidate.submittedTo && candidate.confidence >= 0.35) return true;
    return title.length >= 12;
  }

  // strict
  if (candidate.confidence >= 0.65) return true;
  if (candidate.deadline && candidate.submittedTo && candidate.confidence >= 0.5) {
    return true;
  }
  if (
    candidate.deadline &&
    candidate.confidence >= 0.55 &&
    /\b(submit|file|complete|sign|upload|return|certif|report|pay|respond|confirm)\b/i.test(
      title,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * When the model finds nothing, invent a reviewable guess from the subject
 * so Catch more scans are not empty.
 */
export function synthesizeRelaxedCandidate(email: NormalizedEmail): {
  title: string;
  description: string;
  deadline: string | null;
  submittedTo: string | null;
  portalLink: string | null;
  priority: "low" | "medium" | "high";
  entityHint: string | null;
  assignedRoleHints: string[];
  confidence: number;
  evidence: Array<{ quote: string; reason: string }>;
  missingFields: string[];
} | null {
  const title =
    (email.subject ?? "").replace(/^(re:|fw:|fwd:)\s*/i, "").trim() ||
    "Review this email";
  if (title.length < 3) return null;
  if (looksLikeMarketing(email) && !HIGH_SIGNAL.test(title)) return null;

  const blob = `${email.subject}\n${email.bodyText.slice(0, 500)}`;
  const softAsk =
    HIGH_SIGNAL.test(blob) ||
    DEADLINEish.test(blob) ||
    /\b(please|can you|could you|need|request|meeting|call|asap|urgent|follow[- ]?up)\b/i.test(
      blob,
    );

  // Prefer soft asks; still keep a thin subject-based candidate for Catch more.
  const confidence = softAsk ? 0.42 : 0.32;

  return {
    title: title.slice(0, 160),
    description: (email.bodyText || title).slice(0, 600),
    deadline: null,
    submittedTo: email.from || null,
    portalLink: email.links[0] ?? null,
    priority: /urgent|asap|immediate/i.test(blob) ? "high" : "medium",
    entityHint: null,
    assignedRoleHints: [],
    confidence,
    evidence: [
      {
        quote: (email.bodyText || title).replace(/\s+/g, " ").trim().slice(0, 180),
        reason: softAsk
          ? "Possible ask detected — review and approve or ignore"
          : "Catch-more scan: subject kept for human review",
      },
    ],
    missingFields: ["deadline"],
  };
}
