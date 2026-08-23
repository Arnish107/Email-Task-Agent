import { config, microsoftConfigured } from "../config.js";
import { MAX_SCAN_MESSAGES } from "../extraction/importance.js";
import type { EmailProvider, NormalizedEmail, ScanWindow } from "./types.js";
import {
  extractLinks,
  htmlToPlainText,
  parseAddressList,
  parseSingleAddress,
  pickBodyText,
} from "./normalize.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Read"];

function authBase(): string {
  return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0`;
}

export function getMicrosoftAuthUrl(state: string): string {
  if (!microsoftConfigured()) {
    throw new Error("Microsoft OAuth is not configured");
  }
  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: config.microsoft.redirectUri,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `${authBase()}/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  email: string;
  scope: string;
}> {
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    code,
    redirect_uri: config.microsoft.redirectUri,
    grant_type: "authorization_code",
    scope: SCOPES.join(" "),
  });

  const tokenRes = await fetch(`${authBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`Microsoft token exchange failed: ${await tokenRes.text()}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
  };
  if (!tokens.access_token) {
    throw new Error("Microsoft OAuth did not return an access token");
  }

  const meRes = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    throw new Error(`Microsoft profile lookup failed: ${await meRes.text()}`);
  }
  const me = (await meRes.json()) as {
    mail?: string;
    userPrincipalName?: string;
  };
  const email = me.mail || me.userPrincipalName;
  if (!email) {
    throw new Error("Could not resolve Microsoft account email");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    email,
    scope: tokens.scope ?? SCOPES.join(" "),
  };
}

export async function refreshMicrosoftAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES.join(" "),
  });
  const tokenRes = await fetch(`${authBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`Microsoft token refresh failed: ${await tokenRes.text()}`);
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.access_token) {
    throw new Error("Microsoft refresh did not return an access token");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  webLink?: string;
};

export class MicrosoftProvider implements EmailProvider {
  readonly name = "microsoft" as const;

  async listMessageIds(accessToken: string, window: ScanWindow): Promise<string[]> {
    const since = new Date(Date.now() - window.days * 24 * 60 * 60 * 1000).toISOString();
    // Broad window: recent non-draft mail (same spirit as Gmail newer_than).
    const filter = `receivedDateTime ge ${since} and isDraft eq false`;
    const params = new URLSearchParams({
      $select: "id",
      $top: "100",
      $orderby: "receivedDateTime desc",
      $filter: filter,
    });

    const ids: string[] = [];
    let url: string | null = `${GRAPH_BASE}/me/messages?${params.toString()}`;

    while (url && ids.length < MAX_SCAN_MESSAGES) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Microsoft message list failed: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        value?: Array<{ id?: string }>;
        "@odata.nextLink"?: string;
      };
      for (const m of data.value ?? []) {
        if (m.id) ids.push(m.id);
        if (ids.length >= MAX_SCAN_MESSAGES) break;
      }
      url = ids.length >= MAX_SCAN_MESSAGES ? null : (data["@odata.nextLink"] ?? null);
    }

    return ids;
  }

  async fetchMessage(accessToken: string, messageId: string): Promise<NormalizedEmail> {
    const select = [
      "id",
      "conversationId",
      "subject",
      "body",
      "from",
      "toRecipients",
      "ccRecipients",
      "receivedDateTime",
      "sentDateTime",
      "hasAttachments",
      "webLink",
    ].join(",");
    const res = await fetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=${select}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`Microsoft message fetch failed: ${await res.text()}`);
    }
    const msg = (await res.json()) as GraphMessage;

    const content = msg.body?.content ?? msg.bodyPreview ?? "";
    const html =
      msg.body?.contentType?.toLowerCase() === "html" ? content : undefined;
    const plain =
      msg.body?.contentType?.toLowerCase() === "text" ? content : undefined;
    const bodyText = pickBodyText({
      plain,
      html: html ?? (plain ? undefined : content ? htmlToPlainText(content) : undefined),
    });

    const from = parseSingleAddress(msg.from?.emailAddress?.address ?? "");
    const to = (msg.toRecipients ?? [])
      .map((r) => parseSingleAddress(r.emailAddress?.address ?? ""))
      .filter(Boolean);
    const cc = (msg.ccRecipients ?? [])
      .map((r) => parseSingleAddress(r.emailAddress?.address ?? ""))
      .filter(Boolean);

    let attachments: Array<{ filename: string; mimeType: string }> = [];
    if (msg.hasAttachments) {
      const attRes = await fetch(
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=name,contentType`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (attRes.ok) {
        const attData = (await attRes.json()) as {
          value?: Array<{ name?: string; contentType?: string }>;
        };
        attachments = (attData.value ?? []).map((a) => ({
          filename: a.name || "attachment",
          mimeType: a.contentType || "application/octet-stream",
        }));
      }
    }

    return {
      provider: "microsoft",
      messageId: msg.id,
      threadId: msg.conversationId,
      subject: msg.subject || "(no subject)",
      from,
      to,
      cc,
      sentAt: msg.sentDateTime || msg.receivedDateTime || new Date().toISOString(),
      bodyText,
      links: extractLinks(bodyText),
      attachments,
    };
  }
}

export const microsoftProvider = new MicrosoftProvider();

export function microsoftMessageDeepLink(
  messageId?: string | null,
  webLink?: string | null,
): string | null {
  if (webLink) return webLink;
  if (!messageId) return null;
  return `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(messageId)}`;
}
