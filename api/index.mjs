/**
 * Vercel serverless entry — serves the Express API under /api/*.
 * Use api/index + rewrites (not [[...path]]): non-Next catch-alls only
 * match a single path segment, which caused /api/auth/login → 405/404.
 */
import { createApp } from "../apps/api/dist/app.js";
import { migrate } from "../apps/api/dist/db/migrate.js";

const app = createApp();

let migratePromise = null;

function ensureReady() {
  if (!migratePromise) {
    migratePromise = migrate().catch((err) => {
      migratePromise = null;
      throw err;
    });
  }
  return migratePromise;
}

/**
 * Vercel may pre-parse JSON into req.body while leaving the stream empty,
 * so Express's json() middleware would see nothing. Normalize before Express.
 */
function restoreBody(req) {
  if (req.body == null) return;
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString("utf8");
    if (!raw) {
      req.body = undefined;
      return;
    }
    try {
      req.body = JSON.parse(raw);
    } catch {
      req.body = raw;
    }
    return;
  }
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // leave string body as-is
    }
  }
}

/** Keep Express routes (/api/...) matched after rewrite to /api. */
function restoreUrl(req) {
  const candidates = [
    req.headers["x-forwarded-uri"],
    req.headers["x-invoke-path"],
    req.originalUrl,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.startsWith("/api")) continue;
    // x-invoke-path can be the function path (/api) — skip that
    if (candidate === "/api" || candidate === "/api/") continue;
    req.url = candidate;
    return;
  }
}

export default async function handler(req, res) {
  await ensureReady();
  restoreBody(req);
  restoreUrl(req);

  // Async handlers must wait for Express to finish writing the response;
  // otherwise Vercel freezes the isolate when this Promise resolves early.
  await new Promise((resolve, reject) => {
    const done = () => resolve(undefined);
    res.on("finish", done);
    res.on("close", done);
    try {
      app(req, res);
    } catch (err) {
      reject(err);
    }
  });
}
