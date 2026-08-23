import { google } from "googleapis";
import { config } from "../config.js";
import { MAX_SCAN_MESSAGES } from "../extraction/importance.js";
import type { EmailProvider, NormalizedEmail, ScanWindow } from "./types.js";
import {
  decodeBase64Url,
  extractLinks,
  parseAddressList,
  parseSingleAddress,
  pickBodyText,
} from "./normalize.js";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function getGmailOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function getGmailAuthUrl(state: string): string {
  const client = getGmailOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE, "openid", "email"],
    state,
  });
}

export async function exchangeGmailCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  email: string;
  scope: string;
}> {
  const client = getGmailOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Gmail OAuth did not return an access token");
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email;
  if (!email) {
    throw new Error("Could not resolve Gmail account email");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? undefined,
    email,
    scope: tokens.scope ?? GMAIL_READONLY_SCOPE,
  };
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<string> {
  const client = getGmailOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Failed to refresh Gmail access token");
  }
  return credentials.access_token;
}

type GmailPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null } | null;
  parts?: GmailPart[] | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
};

function collectBodies(part: GmailPart, acc: { plain?: string; html?: string }) {
  if (part.mimeType === "text/plain" && part.body?.data) {
    acc.plain = (acc.plain ?? "") + decodeBase64Url(part.body.data);
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    acc.html = (acc.html ?? "") + decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    collectBodies(child, acc);
  }
}

function collectAttachments(
  part: GmailPart,
  acc: Array<{ filename: string; mimeType: string }>,
) {
  if (part.filename && part.body?.attachmentId) {
    acc.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
    });
  }
  for (const child of part.parts ?? []) {
    collectAttachments(child, acc);
  }
}

function headerValue(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

export class GmailProvider implements EmailProvider {
  readonly name = "gmail" as const;

  private gmail(accessToken: string) {
    const auth = getGmailOAuthClient();
    auth.setCredentials({ access_token: accessToken });
    return google.gmail({ version: "v1", auth });
  }

  async listMessageIds(accessToken: string, window: ScanWindow): Promise<string[]> {
    const gmail = this.gmail(accessToken);
    const q = window.query?.trim() || `newer_than:${window.days}d`;
    const ids: string[] = [];
    let pageToken: string | undefined;

    do {
      const res = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: 50,
        pageToken,
      });
      for (const m of res.data.messages ?? []) {
        if (m.id) ids.push(m.id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
      if (ids.length >= MAX_SCAN_MESSAGES) break;
    } while (pageToken);

    return ids;
  }

  async fetchMessage(accessToken: string, messageId: string): Promise<NormalizedEmail> {
    const gmail = this.gmail(accessToken);
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const payload = res.data.payload as GmailPart | undefined;
    const headers = payload?.headers ?? [];
    const bodies: { plain?: string; html?: string } = {};
    if (payload) collectBodies(payload, bodies);
    if (!bodies.plain && !bodies.html && payload?.body?.data) {
      const decoded = decodeBase64Url(payload.body.data);
      if (payload.mimeType === "text/html") bodies.html = decoded;
      else bodies.plain = decoded;
    }

    const bodyText = pickBodyText(bodies);
    const attachments: Array<{ filename: string; mimeType: string }> = [];
    if (payload) collectAttachments(payload, attachments);

    const subject = headerValue(headers, "Subject") ?? "(no subject)";
    const from = parseSingleAddress(headerValue(headers, "From"));
    const to = parseAddressList(headerValue(headers, "To"));
    const cc = parseAddressList(headerValue(headers, "Cc"));
    const dateHeader = headerValue(headers, "Date");
    const internalDate = res.data.internalDate
      ? new Date(Number(res.data.internalDate)).toISOString()
      : undefined;
    const sentAt = dateHeader
      ? new Date(dateHeader).toISOString()
      : (internalDate ?? new Date().toISOString());

    return {
      provider: "gmail",
      messageId,
      threadId: res.data.threadId ?? undefined,
      subject,
      from,
      to,
      cc,
      sentAt,
      bodyText,
      links: extractLinks(bodyText),
      attachments,
    };
  }
}

export const gmailProvider = new GmailProvider();

export function gmailMessageDeepLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}
