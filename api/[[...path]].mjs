/**
 * Vercel serverless entry — serves the Express API under /api/*.
 * Keeps the Vite SPA static while fixing POST /api/auth/login 405s.
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

export default async function handler(req, res) {
  await ensureReady();
  restoreBody(req);

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
