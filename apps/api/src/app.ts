import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { requireAuth } from "./auth/session.js";
import { authRouter } from "./routes/auth.js";
import { mailboxRouter, oauthRouter } from "./routes/mailbox.js";
import { scansRouter } from "./routes/scans.js";
import {
  auditRouter,
  candidatesRouter,
  entitiesRouter,
} from "./routes/candidates.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.webBaseUrl,
      credentials: true,
    }),
  );
  // Skip stream parsing when the platform already attached a body (Vercel).
  app.use((req, res, next) => {
    if (req.body !== undefined && req.body !== null && req.body !== "") {
      next();
      return;
    }
    express.json({ limit: "1mb" })(req, res, next);
  });
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "email-task-agent",
    });
  });

  // Root is not the SPA — send people to the Vite app in local/dev.
  app.get("/", (_req, res) => {
    res.redirect(302, config.webBaseUrl);
  });

  app.use("/api/auth", authRouter);
  app.use("/api/mailboxes", requireAuth, mailboxRouter);
  app.use("/api/oauth", oauthRouter);
  app.use("/api/scans", requireAuth, scansRouter);
  app.use("/api/candidates", requireAuth, candidatesRouter);
  app.use("/api/entities", requireAuth, entitiesRouter);
  app.use("/api/audit", requireAuth, auditRouter);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(err);
      res.status(500).json({ error: err.message || "Internal server error" });
    },
  );

  return app;
}
