import type { CookieOptions, Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { writeAuditLog } from "../audit/log.js";

const SESSION_COOKIE = "eta_session";
const SESSION_DAYS = 14;

/** Cross-origin SPA (e.g. Vercel UI + Render API) needs SameSite=None; Secure.
 * Local Vite proxies /api to the API, so the browser only talks to WEB_BASE_URL —
 * do not treat localhost:5173 vs :4000 as cross-site (Secure cookies break on
 * http://127.0.0.1 and can strand the login UI). */
function sessionCookieOptions(expires?: Date): CookieOptions {
  const isProd = config.nodeEnv === "production";
  let crossSite = false;
  try {
    const web = new URL(config.webBaseUrl);
    const app = new URL(config.appBaseUrl);
    crossSite = isProd && web.origin !== app.origin;
  } catch {
    crossSite = false;
  }
  return {
    httpOnly: true,
    sameSite: crossSite ? "none" : "lax",
    secure: crossSite || isProd,
    ...(expires ? { expires } : {}),
  };
}

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

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
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!sessionId) {
    res.status(401).json({ error: "Authentication required" });
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

export async function createSession(userId: string, res: Response): Promise<void> {
  const id = nanoid();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
    [id, userId, expires],
  );
  res.cookie(SESSION_COOKIE, id, sessionCookieOptions(expires));
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  if (req.sessionId) {
    await pool.query("DELETE FROM sessions WHERE id = $1", [req.sessionId]);
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

export { SESSION_COOKIE };

export async function demoSignIn(email: string, res: Response): Promise<AuthUser> {
  const user = await upsertUser(email);
  await createSession(user.id, res);
  await writeAuditLog({
    userId: user.id,
    eventType: "user_signed_in",
    details: { method: "demo" },
  });
  return user;
}
