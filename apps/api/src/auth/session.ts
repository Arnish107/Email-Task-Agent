import { createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { writeAuditLog } from "../audit/log.js";

const SESSION_COOKIE = "eta_session";
const SESSION_DAYS = 14;

/** Session cookies for the SPA.
 * Local: Vite proxies /api on the same origin (http://localhost:5173), so use
 * SameSite=Lax and never Secure — Secure cookies are dropped on plain HTTP and
 * bounce the UI back to the login screen after a "successful" sign-in.
 * Production split UI/API: SameSite=None; Secure. */
function sessionCookieOptions(expires?: Date): CookieOptions {
  const appUrl = config.appBaseUrl;
  const webUrl = config.webBaseUrl;
  const https =
    appUrl.startsWith("https://") && webUrl.startsWith("https://");
  let crossSite = false;
  try {
    crossSite = https && new URL(webUrl).origin !== new URL(appUrl).origin;
  } catch {
    crossSite = false;
  }
  return {
    httpOnly: true,
    path: "/",
    sameSite: crossSite ? "none" : "lax",
    secure: crossSite,
    ...(expires ? { expires } : {}),
  };
}

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function signSessionToken(user: AuthUser): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const payload = b64url(
    JSON.stringify({
      uid: user.id,
      email: user.email,
      displayName: user.displayName,
      exp,
    }),
  );
  const sig = b64url(
    createHmac("sha256", config.sessionSecret).update(payload).digest(),
  );
  return `eta1.${payload}.${sig}`;
}

function verifySessionToken(token: string): AuthUser | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "eta1") return null;
  const [, payload, sig] = parts;
  const expected = b64url(
    createHmac("sha256", config.sessionSecret).update(payload).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: string;
      email?: string;
      displayName?: string | null;
      exp?: number;
    };
    if (!data.uid || !data.email || !data.exp) return null;
    if (data.exp * 1000 < Date.now()) return null;
    return {
      id: data.uid,
      email: data.email,
      displayName: data.displayName ?? null,
    };
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Prefer explicit header (survives Vite proxy / localhost cookie quirks),
  // then fall back to the HttpOnly cookie.
  const headerSession = String(req.headers["x-eta-session"] ?? "").trim();
  const sessionId =
    headerSession ||
    (req.cookies?.[SESSION_COOKIE] as string | undefined) ||
    undefined;
  if (!sessionId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Signed tokens stay valid across Vercel serverless instances. PGlite on
  // Vercel is ephemeral, so looking up sessions in the DB after login caused
  // an immediate bounce back to the sign-in screen.
  const fromToken = verifySessionToken(sessionId);
  if (fromToken) {
    req.user = fromToken;
    req.sessionId = sessionId;
    next();
    return;
  }

  const result = await pool.query<{
    session_id: string;
    user_id: string;
    email: string;
    display_name: string | null;
    expires_at: Date;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row || new Date(row.expires_at) < new Date()) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.status(401).json({ error: "Session expired" });
    return;
  }

  req.user = {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
  };
  req.sessionId = row.session_id;
  next();
}

export async function upsertUser(email: string, displayName?: string): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const existing = await pool.query<{ id: string; email: string; display_name: string | null }>(
    "SELECT id, email, display_name FROM users WHERE email = $1",
    [normalized],
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id,
      email: existing.rows[0].email,
      displayName: existing.rows[0].display_name,
    };
  }
  const id = nanoid();
  await pool.query(
    "INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)",
    [id, normalized, displayName ?? null],
  );
  return { id, email: normalized, displayName: displayName ?? null };
}

export async function createSession(user: AuthUser, res: Response): Promise<string> {
  const token = signSessionToken(user);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await pool.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
      [nanoid(), user.id, expires],
    );
  } catch {
    // Ephemeral PGlite on Vercel may not persist this — the signed token is enough.
  }
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expires));
  return token;
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  if (req.sessionId && !req.sessionId.startsWith("eta1.")) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [req.sessionId]);
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

export { SESSION_COOKIE };

/** Short-lived signed OAuth state (survives Vercel cold starts / ephemeral PGlite). */
export function signOAuthState(input: {
  userId: string;
  provider: "gmail";
}): string {
  const exp = Math.floor(Date.now() / 1000) + 10 * 60;
  const payload = b64url(
    JSON.stringify({
      uid: input.userId,
      provider: input.provider,
      exp,
      n: nanoid(8),
    }),
  );
  const sig = b64url(
    createHmac("sha256", config.sessionSecret).update(`oauth.${payload}`).digest(),
  );
  return `o1.${payload}.${sig}`;
}

export function verifyOAuthState(
  state: string,
  provider: "gmail",
): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== "o1") return null;
  const [, payload, sig] = parts;
  const expected = b64url(
    createHmac("sha256", config.sessionSecret)
      .update(`oauth.${payload}`)
      .digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { uid?: string; provider?: string; exp?: number };
    if (!data.uid || data.provider !== provider || !data.exp) return null;
    if (data.exp * 1000 < Date.now()) return null;
    return { userId: data.uid };
  } catch {
    return null;
  }
}

/** Ensure a users row exists for a signed-session user (PGlite may have reset). */
export async function ensureUserRow(user: AuthUser): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [user.id, user.email, user.displayName],
  );
}

export async function demoSignIn(
  email: string,
  res: Response,
): Promise<{ user: AuthUser; sessionId: string }> {
  const user = await upsertUser(email);
  const sessionId = await createSession(user, res);
  try {
    await writeAuditLog({
      userId: user.id,
      eventType: "user_signed_in",
      details: { method: "demo" },
    });
  } catch {
    // Audit must not block sign-in on ephemeral storage.
  }
  return { user, sessionId };
}
