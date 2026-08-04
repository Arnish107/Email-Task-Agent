# Email Task Agent

Standalone app that connects a mailbox, extracts actionable compliance tasks, requires human review, and exports approved tasks as JSON.

No CiviSight dependencies. For the plug-and-play CiviSight package, see **[Email-Task-Agent-CiviSight](https://github.com/Arnish107/Email-Task-Agent-CiviSight)**.

## What it does

1. Sign in (demo email session for the prototype)
2. Connect a mailbox with **read-only** OAuth (`gmail.readonly`), Microsoft Graph, or IMAP
3. Start a bounded scan (for example last 7 / 30 days)
4. Extract candidate tasks (LLM if configured, otherwise deterministic fallback)
5. Review candidates with source evidence, confidence, and missing fields
6. Approve / edit / ignore / mark duplicate
7. Export approved items as JSON

## Non-negotiable safety rules

- **No silent task creation.** Every candidate must be reviewed before export.
- **Least-privilege scopes:** Gmail `gmail.readonly`; Microsoft `Mail.Read` when enabled.
- **Tokens encrypted at rest** with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
- **No full email body retention** in durable candidate records.
- **We do not train or fine-tune models on user emails.**

## Stack

- API: Node.js, Express, TypeScript, Postgres (PGlite locally by default; Docker Postgres optional)
- Web: React + Vite (Vercel-ready frontend)
- Providers: Gmail OAuth, Microsoft/Outlook OAuth, generic IMAP, fixture mailbox for local demo

## Quick start

```bash
cp .env.example .env
npm install
npm run migrate
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:4000/api/health

Default DB is embedded **PGlite** (`DATABASE_URL=pglite`) — no Docker required.

### Local demo (no Google Cloud)

1. Sign in with any email
2. Click **Use fixture mailbox**
3. Start a scan, review candidates, **Edit & approve**, then **Export approved JSON**

### Gmail OAuth

1. Create a Google Cloud OAuth client (Web application)
2. Redirect URI: `http://localhost:4000/api/oauth/gmail/callback`
3. Enable Gmail API; set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
4. Click **Connect Gmail (readonly)**

## Deploy (Vercel frontend + Render API)

The Vite app on Vercel is static only. Login (`POST /api/auth/login`) must hit a separate Node API — otherwise the browser shows **405**.

### 1. API on Render

1. Open [Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint) and connect `Arnish107/Email-Task-Agent`.
2. Render reads `render.yaml` and creates **email-task-agent-api**.
3. After deploy, copy the service URL (e.g. `https://email-task-agent-api.onrender.com`).
4. Optional: set `GEMINI_API_KEY` / Gmail OAuth vars in the Render dashboard.
5. Free tier sleeps when idle — first request after sleep can take 30–60s.

### 2. Point Vercel at the API

In the **email-task-agent** Vercel project → **Settings → Environment Variables**:

| Name | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://YOUR-API.onrender.com` (no trailing slash) |

Redeploy the frontend after saving (Vite reads this at **build** time).

Confirm Render `WEB_BASE_URL` is `https://email-task-agent-xi.vercel.app` (CORS + cookies).

### Local

Leave `VITE_API_BASE_URL` unset so the Vite `/api` proxy uses `localhost:4000`.

## Tests

```bash
npm test
```

## Export shape

Approved candidates export as:

```json
[
  {
    "source": {
      "type": "email",
      "provider": "gmail",
      "messageId": "...",
      "subject": "...",
      "sender": "...",
      "sentAt": "..."
    },
    "task": {
      "title": "...",
      "description": "...",
      "countyId": "...",
      "deadline": "...",
      "submittedTo": "...",
      "portalLink": "...",
      "priority": "medium",
      "assignedRoles": [],
      "assignedContactIds": []
    },
    "review": {
      "approvedBy": "...",
      "approvedAt": "...",
      "confidence": 0.86,
      "evidence": []
    }
  }
]
```

## Repo layout

```
apps/api   Express API, migrations, providers, extraction, tests
apps/web   React review UI
ARCHITECTURE.md
```
