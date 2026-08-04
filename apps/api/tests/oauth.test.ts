import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/db/pool.js", () => {
  const query = vi.fn();
  return {
    pool: { query },
  };
});

vi.mock("../src/providers/gmail.js", () => ({
  exchangeGmailCode: vi.fn(),
  getGmailAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/auth"),
  gmailMessageDeepLink: (id: string) => `https://mail.google.com/mail/u/0/#inbox/${id}`,
}));

import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

describe("OAuth callback state validation", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("rejects invalid OAuth state", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // state lookup
    query.mockResolvedValueOnce({ rows: [] }); // delete

    const app = createApp();
    const res = await request(app).get(
      "/api/oauth/gmail/callback?code=abc&state=not-a-real-state",
    );

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or expired oauth state/i);
  });

  it("rejects expired OAuth state", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          user_id: "user-1",
          expires_at: new Date(Date.now() - 60_000),
        },
      ],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get(
      "/api/oauth/gmail/callback?code=abc&state=expired-state",
    );

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or expired oauth state/i);
  });
});
