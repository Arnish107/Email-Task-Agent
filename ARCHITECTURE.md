# Architecture notes

## Why this shape

The product is split into clear seams:

1. **Mailbox connection** (OAuth / IMAP, encrypted tokens, least-privilege scopes)
2. **Scan job** (bounded query window, async processing, audit events)
3. **Candidate** (reviewable extraction result — never an auto-created task)
4. **Export** (validated JSON payload after human approval)

Keeping those as separate tables and API resources keeps review rules enforceable and the UI simple.

## Tradeoffs

| Choice | Why | Cost |
| --- | --- | --- |
| Database-backed scan jobs + `setImmediate` worker | Fastest local MVP; no Redis required | Not multi-instance safe; swap for BullMQ later |
| Demo email login | Unblocks local UI without SSO | Replace with real auth for production |
| Deterministic fallback extractor when no LLM key | Tests and demos work offline | Weaker recall/precision than a structured LLM call |
| Store evidence snippets + body hash, not full bodies | Privacy / retention posture | Re-open source email via provider deep link when needed |
| Fixture provider | Demo without Google Cloud setup | Not a substitute for real Gmail acceptance testing |
| AES-256-GCM token encryption at rest | Meets encrypted-token requirement with one env key | Key rotation / KMS still needed for production |
| Fuzzy entity matching with human confirmation | Avoid inventing `countyId` | Reviewer must always pick or confirm entity |

## Safety invariants

- Candidates start as `needs_review`.
- Approve requires `title`, `countyId`, `deadline`, and `submittedTo`.
- Gmail auth requests `gmail.readonly` only.
- Audit log records connect / scan / candidate / export events.

## Related package

CiviSight plug-and-play live mount lives in a separate repo: **Email-Task-Agent-CiviSight**.
