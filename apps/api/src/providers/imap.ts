import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type {
  EmailProvider,
  ImapConnectionMeta,
  NormalizedEmail,
  ScanWindow,
} from "./types.js";
import {
  extractLinks,
  htmlToPlainText,
  parseAddressList,
  parseSingleAddress,
  pickBodyText,
} from "./normalize.js";

export type ImapAuth = {
  user: string;
  pass: string;
} & ImapConnectionMeta;

const COMMON_IMAP_HOSTS: Array<{ match: RegExp; host: string; port: number; secure: boolean }> = [
  { match: /@(gmail|googlemail)\.com$/i, host: "imap.gmail.com", port: 993, secure: true },
  { match: /@(outlook|hotmail|live|msn)\.com$/i, host: "outlook.office365.com", port: 993, secure: true },
  { match: /@yahoo\./i, host: "imap.mail.yahoo.com", port: 993, secure: true },
  { match: /@icloud\.com$|@me\.com$|@mac\.com$/i, host: "imap.mail.me.com", port: 993, secure: true },
  { match: /@aol\.com$/i, host: "imap.aol.com", port: 993, secure: true },
  { match: /@zoho\.com$/i, host: "imap.zoho.com", port: 993, secure: true },
  { match: /@proton\.me$|@protonmail\.com$/i, host: "imap.protonmail.ch", port: 993, secure: true },
];

export function inferImapSettings(email: string): ImapConnectionMeta | null {
  const found = COMMON_IMAP_HOSTS.find((c) => c.match.test(email.trim()));
  if (!found) return null;
  return { host: found.host, port: found.port, secure: found.secure };
}

export async function verifyImapLogin(auth: ImapAuth): Promise<void> {
  const client = new ImapFlow({
    host: auth.host,
    port: auth.port,
    secure: auth.secure,
    auth: { user: auth.user, pass: auth.pass },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export class ImapProvider implements EmailProvider {
  readonly name = "imap" as const;

  private async withClient<T>(
    auth: ImapAuth,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow({
      host: auth.host,
      port: auth.port,
      secure: auth.secure,
      auth: { user: auth.user, pass: auth.pass },
      logger: false,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      try {
        await client.logout();
      } catch {
        try {
          client.close();
        } catch {
          // ignore close errors
        }
      }
    }
  }

  private authFrom(accessToken: string, meta?: Record<string, unknown>): ImapAuth {
    const host = String(meta?.host ?? "");
    const port = Number(meta?.port ?? 993);
    const secure = meta?.secure !== false;
    const user = String(meta?.user ?? meta?.email ?? "");
    if (!host || !user) {
      throw new Error("IMAP connection is missing host or username");
    }
    return { host, port, secure, user, pass: accessToken };
  }

  async listMessageIds(
    accessToken: string,
    window: ScanWindow,
    meta?: Record<string, unknown>,
  ): Promise<string[]> {
    const auth = this.authFrom(accessToken, meta);
    return this.withClient(auth, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = await client.search({ since: sinceDate(window.days) }, { uid: true });
        const list = Array.isArray(uids) ? uids : [];
        return list.slice(-100).map(String).reverse();
      } finally {
        lock.release();
      }
    });
  }

  async fetchMessage(
    accessToken: string,
    messageId: string,
    meta?: Record<string, unknown>,
  ): Promise<NormalizedEmail> {
    const auth = this.authFrom(accessToken, meta);
    const uid = Number(messageId);
    if (!Number.isFinite(uid)) {
      throw new Error(`Invalid IMAP message id: ${messageId}`);
    }

    return this.withClient(auth, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const msg = await client.fetchOne(
          uid,
          { source: true, envelope: true, bodyStructure: true },
          { uid: true },
        );
        if (!msg || !msg.source) {
          throw new Error(`IMAP message not found: ${messageId}`);
        }

        const parsed = await simpleParser(msg.source);
        const plain =
          typeof parsed.text === "string"
            ? parsed.text
            : parsed.html
              ? htmlToPlainText(String(parsed.html))
              : "";
        const html = typeof parsed.html === "string" ? parsed.html : undefined;
        const bodyText = pickBodyText({ plain, html });

        const from =
          parseSingleAddress(parsed.from?.text) ||
          parseSingleAddress(msg.envelope?.from?.[0]?.address ?? "");
        const to = parseAddressList(
          (parsed.to && "text" in parsed.to ? parsed.to.text : "") ||
            (msg.envelope?.to ?? []).map((t) => t.address ?? "").join(", "),
        );
        const cc = parseAddressList(
          (parsed.cc && "text" in parsed.cc ? parsed.cc.text : "") ||
            (msg.envelope?.cc ?? []).map((t) => t.address ?? "").join(", "),
        );

        const attachments = (parsed.attachments ?? []).map((a) => ({
          filename: a.filename || "attachment",
          mimeType: a.contentType || "application/octet-stream",
        }));

        const sentAt = (
          parsed.date ||
          msg.envelope?.date ||
          new Date()
        ).toISOString();

        return {
          provider: "imap",
          messageId: String(uid),
          threadId: undefined,
          subject: parsed.subject || msg.envelope?.subject || "(no subject)",
          from,
          to,
          cc,
          sentAt,
          bodyText,
          links: extractLinks(bodyText),
          attachments,
        };
      } finally {
        lock.release();
      }
    });
  }
}

export const imapProvider = new ImapProvider();
