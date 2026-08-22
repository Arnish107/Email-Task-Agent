import { Router } from "express";
import { config } from "../config.js";
import {
  demoSignIn,
  destroySession,
  requireAuth,
} from "../auth/session.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  if (!config.demoAuthEnabled) {
    res.status(403).json({ error: "Demo auth is disabled" });
    return;
  }
  const email = String(req.body?.email ?? "").trim();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }
  const { user, sessionId } = await demoSignIn(email, res);
  res.json({ user, sessionId });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});
