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

## Deploy (Vercel frontend)

Host the **API separately**. This Express + PGlite/Postgres API is not meant to run as a Vercel serverless function.

1. Deploy this repo on Vercel (`vercel.json` builds `apps/web`)
2. Set `VITE_API_BASE_URL` to your public API origin
3. On the API host, set `WEB_BASE_URL` to the Vercel URL and `APP_BASE_URL` to the API origin (HTTPS required for cross-site cookies)

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
