import { convert } from "html-to-text";

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}

export function extractLinks(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64").toString("utf8");
}

export function pickBodyText(parts: {
  plain?: string;
  html?: string;
}): string {
  if (parts.plain?.trim()) return parts.plain.trim();
  if (parts.html?.trim()) return htmlToPlainText(parts.html);
  return "";
}

export function parseAddressList(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => {
      const match = s.match(/<([^>]+)>/);
      return (match?.[1] ?? s).trim().toLowerCase();
    })
    .filter(Boolean);
}

export function parseSingleAddress(value?: string | null): string {
  const list = parseAddressList(value);
  return list[0] ?? (value ?? "").trim();
}
