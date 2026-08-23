import { Router } from "express";
import { nanoid } from "nanoid";
import { writeAuditLog } from "../audit/log.js";
import {
  ensureUserRow,
  requireAuth,
  signOAuthState,
  verifyOAuthState,
} from "../auth/session.js";
import {
  config,
  gmailConfigured,
} from "../config.js";
import { encryptSecret } from "../crypto/tokens.js";
import { pool } from "../db/pool.js";
import {
  exchangeGmailCode,
  getGmailAuthUrl,
  gmailMessageDeepLink,
} from "../providers/gmail.js";
import {
  inferImapSettings,
  verifyImapLogin,
} from "../providers/imap.js";

export const mailboxRouter = Router();

mailboxRouter.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT id, provider, email_address, scope, status, last_scan_at,
            connection_meta, created_at, updated_at
     FROM mailbox_connections
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.user!.id],
  );
  res.json({ mailboxes: result.rows });
});

mailboxRouter.get("/providers", async (_req, res) => {
  res.json({
    providers: [
      {
        id: "gmail",
        label: "Gmail",
        scope: "gmail.readonly",
        configured: gmailConfigured(),
      },
      {
        id: "imap",
        label: "Any email (IMAP)",
        scope: "imap",
        configured: true,
        note: "Works with Yahoo, iCloud, Zoho, custom hosts, and Gmail app passwords.",
      },
      {
        id: "fixture",
        label: "Fixture emails (local demo)",
        scope: "none",
        configured: config.enableFixtureProvider,
      },
    ],
  });
});

mailboxRouter.post("/imap/settings", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }
  const inferred = inferImapSettings(email);
  res.json({
    email,
    inferred,
  });
});

mailboxRouter.post("/imap/connect", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const inferred = inferImapSettings(email);
  const host = String(req.body?.host ?? inferred?.host ?? "").trim();
  const port = Number(req.body?.port ?? inferred?.port ?? 993);
  const secure = req.body?.secure === false ? false : true;

  if (!email.includes("@") || !password || !host) {
    res.status(400).json({
      error: "email, password, and host are required for IMAP",
    });
    return;
  }

  try {
    await verifyImapLogin({
      user: email,
      pass: password,
      host,
      port,
      secure,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "IMAP login failed";
    res.status(400).json({
      error: `Could not connect over IMAP: ${message}. For Gmail/Yahoo/iCloud, use an app password.`,
    });
    return;
  }

  const meta = { host, port, secure, user: email };
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM mailbox_connections
     WHERE user_id = $1 AND provider = 'imap' AND email_address = $2`,
    [req.user!.id, email],
  );

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE mailbox_connections
       SET access_token_ciphertext = $1,
           refresh_token_ciphertext = NULL,
           connection_meta = $2,
           scope = 'imap',
           status = 'active',
           updated_at = NOW()
       WHERE id = $3`,
      [encryptSecret(password), JSON.stringify(meta), existing.rows[0].id],
    );
    await writeAuditLog({
      userId: req.user!.id,
      mailboxConnectionId: existing.rows[0].id,
      eventType: "mailbox_connected",
      details: { provider: "imap", email, host, refreshed: true },
    });
    res.json({ mailboxId: existing.rows[0].id, email, provider: "imap" });
    return;
  }

  const id = nanoid();
  await pool.query(
    `INSERT INTO mailbox_connections (
      id, user_id, provider, email_address, access_token_ciphertext,
      refresh_token_ciphertext, scope, status, connection_meta
    ) VALUES ($1,$2,'imap',$3,$4,NULL,'imap','active',$5)`,
    [id, req.user!.id, email, encryptSecret(password), JSON.stringify(meta)],
  );
  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: id,
    eventType: "mailbox_connected",
    details: { provider: "imap", email, host },
  });
  res.status(201).json({ mailboxId: id, email, provider: "imap" });
});

mailboxRouter.post("/fixture/connect", async (req, res) => {
  if (!config.enableFixtureProvider) {
    res.status(403).json({ error: "Fixture provider disabled" });
    return;
  }

  const email = `fixtures+${req.user!.id.slice(0, 6)}@local.test`;
  const existing = await pool.query(
    `SELECT id FROM mailbox_connections
     WHERE user_id = $1 AND provider = 'fixture' AND status = 'active'`,
    [req.user!.id],
  );
  if (existing.rows[0]) {
    res.json({ mailboxId: existing.rows[0].id, email });
    return;
  }

  const id = nanoid();
  await pool.query(
    `INSERT INTO mailbox_connections (
      id, user_id, provider, email_address, access_token_ciphertext,
      refresh_token_ciphertext, scope, status
    ) VALUES ($1,$2,'fixture',$3,$4,NULL,'fixture:local','active')`,
    [id, req.user!.id, email, encryptSecret("fixture-token")],
  );

  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: id,
    eventType: "mailbox_connected",
    details: { provider: "fixture", email },
  });

  res.status(201).json({ mailboxId: id, email });
});

mailboxRouter.get("/oauth/gmail/start", async (req, res) => {
  if (!gmailConfigured()) {
    res.status(400).json({
      error:
        "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    });
    return;
  }

  // Signed state — no DB write required (Vercel PGlite is ephemeral / slow to boot).
  const state = signOAuthState({
    userId: req.user!.id,
    provider: "gmail",
  });
  const url = getGmailAuthUrl(state);
  res.json({ url });
});

mailboxRouter.delete("/:id", async (req, res) => {
  const result = await pool.query(
    `UPDATE mailbox_connections
     SET status = 'revoked', updated_at = NOW(),
         access_token_ciphertext = $1, refresh_token_ciphertext = NULL
     WHERE id = $2 AND user_id = $3
     RETURNING id`,
    [encryptSecret("revoked"), req.params.id, req.user!.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Mailbox not found" });
    return;
  }
  await writeAuditLog({
    userId: req.user!.id,
    mailboxConnectionId: req.params.id,
    eventType: "mailbox_revoked",
    details: {},
  });
  res.json({ ok: true });
});

export const oauthRouter = Router();

async function finishOAuthCallback(
  req: { query: Record<string, unknown> },
  res: {
    redirect: (url: string) => void;
    status: (code: number) => { send: (body: string) => void };
  },
  provider: "gmail",
) {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const error = req.query.error;

  if (error) {
    res.redirect(
      `${config.webBaseUrl}/?oauth=error&message=${encodeURIComponent(String(error))}`,
    );
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }

  let userId: string | null = null;
  const signed = verifyOAuthState(state, provider);
  if (signed) {
    userId = signed.userId;
  } else {
    // Legacy DB-backed state (local / older deploys)
    const stateRes = await pool.query<{
      user_id: string;
      expires_at: Date;
    }>(
      `SELECT user_id, expires_at FROM oauth_states WHERE state = $1 AND provider = $2`,
      [state, provider],
    );
    const row = stateRes.rows[0];
    await pool.query("DELETE FROM oauth_states WHERE state = $1", [state]);
    if (row && new Date(row.expires_at) >= new Date()) {
      userId = row.user_id;
    }
  }

  if (!userId) {
    res.status(400).send("Invalid or expired OAuth state");
    return;
  }

  try {
    const tokens = await exchangeGmailCode(code);

    // Re-create the user row if this serverless instance has a fresh PGlite DB.
    await ensureUserRow({
      id: userId,
      email: tokens.email,
      displayName: null,
    });

    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM mailbox_connections
       WHERE user_id = $1 AND provider = $2 AND email_address = $3`,
      [userId, provider, tokens.email],
    );

    if (existing.rows[0]) {
      await pool.query(
        `UPDATE mailbox_connections
         SET access_token_ciphertext = $1,
             refresh_token_ciphertext = COALESCE($2, refresh_token_ciphertext),
             scope = $3, status = 'active', updated_at = NOW()
         WHERE id = $4`,
        [
          encryptSecret(tokens.accessToken),
          tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          tokens.scope,
          existing.rows[0].id,
        ],
      );
      try {
        await writeAuditLog({
          userId,
          mailboxConnectionId: existing.rows[0].id,
          eventType: "mailbox_connected",
          details: { provider, email: tokens.email, refreshed: true },
        });
      } catch {
        // ignore audit failures
      }
    } else {
      const id = nanoid();
      await pool.query(
        `INSERT INTO mailbox_connections (
          id, user_id, provider, email_address, access_token_ciphertext,
          refresh_token_ciphertext, scope, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
        [
          id,
          userId,
          provider,
          tokens.email,
          encryptSecret(tokens.accessToken),
          tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          tokens.scope,
        ],
      );
      try {
        await writeAuditLog({
          userId,
          mailboxConnectionId: id,
          eventType: "mailbox_connected",
          details: { provider, email: tokens.email },
        });
      } catch {
        // ignore audit failures
      }
    }

    res.redirect(`${config.webBaseUrl}/?oauth=success&provider=${provider}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth failed";
    res.redirect(
      `${config.webBaseUrl}/?oauth=error&message=${encodeURIComponent(message)}`,
    );
  }
}

oauthRouter.get("/gmail/callback", async (req, res) => {
  await finishOAuthCallback(req, res, "gmail");
});

export function sourceDeepLink(provider: string, messageId: string): string | null {
  if (provider === "gmail") return gmailMessageDeepLink(messageId);
  return null;
}
