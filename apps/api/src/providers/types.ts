export type EmailAttachmentMeta = {
  filename: string;
  mimeType: string;
};

export type NormalizedEmail = {
  provider: "gmail" | "microsoft" | "fixture" | "imap";
  messageId: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  sentAt: string;
  bodyText: string;
  links: string[];
  attachments: EmailAttachmentMeta[];
};

export type ScanWindow = {
  days: number;
  query?: string;
};

export type ImapConnectionMeta = {
  host: string;
  port: number;
  secure: boolean;
};

export interface EmailProvider {
  readonly name: "gmail" | "microsoft" | "fixture" | "imap";
  listMessageIds(
    accessToken: string,
    window: ScanWindow,
    meta?: Record<string, unknown>,
  ): Promise<string[]>;
  fetchMessage(
    accessToken: string,
    messageId: string,
    meta?: Record<string, unknown>,
  ): Promise<NormalizedEmail>;
}
