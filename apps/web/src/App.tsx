import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  client,
  type Candidate,
  type Entity,
  type Mailbox,
  type ScanJob,
  type User,
} from "./api";

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

const STATUS_LABELS: Record<string, string> = {
  needs_review: "Needs review",
  approved: "Approved",
  ignored: "Ignored",
  duplicate: "Duplicate",
  exported: "Exported",
  "": "All statuses",
};

function AmbientBackground() {
  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="gradient-blob blob-a" />
        <div className="gradient-blob blob-b" />
        <div className="gradient-blob blob-c" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />
    </>
  );
}

function LandingScreen({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="app-root">
      <AmbientBackground />
      <div className="landing-wrap">
        <div className="landing-hero">
          <div className="logo-mark landing-brand">
            <span className="logo-dot" />
            Email Task Agent
          </div>
          <h1>
            Mail in. Tasks out.{" "}
            <span className="text-gradient">Nothing silent.</span>
          </h1>
          <p>
            Connect a mailbox, scan for compliance actions, and export only what
            you approve.
          </p>
          <div className="landing-actions">
            <button className="btn btn-lg" type="button" onClick={onEnter}>
              Enter the app
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await client.login(email);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-root">
      <AmbientBackground />
      <div className="login-wrap">
        <div className="login-stage glass">
          <div className="login-visual glass-strong" aria-hidden="true">
            <div className="login-visual-glow" />
            <div className="login-visual-grid" />
            <div className="login-visual-copy">
              <p className="brand-kicker">Human review first</p>
              <h2>
                Mail in. Tasks out.{" "}
                <span className="text-gradient">Nothing silent.</span>
              </h2>
              <p>
                Connect a mailbox, scan for compliance actions, and export only
                what you approve.
              </p>
            </div>
          </div>
          <form className="panel login-card stack" onSubmit={submit}>
            <div className="brand brand-hero">
              <div className="logo-mark">
                <span className="logo-dot" />
                Email Task Agent
              </div>
              <h1>
                Sign in to{" "}
                <span className="text-gradient">review your queue</span>
              </h1>
              <p>
                Read-only mailbox access. Every candidate needs your sign-off
                before it becomes an exported task.
              </p>
            </div>
            {error && <div className="banner error">{error}</div>}
            <label>
              Work email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@yourcounty.gov"
                required
                autoFocus
              />
            </label>
            <button className="btn btn-lg" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Continue"}
            </button>
            <p className="meta login-footnote">
              Demo auth for this prototype — use any work email to continue.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function CandidateDetail({
  candidateId,
  entities,
  onChanged,
}: {
  candidateId: string;
  entities: Entity[];
  onChanged: () => void;
}) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [duplicates, setDuplicates] = useState<
    Array<{ id: string; title: string; status: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    deadline: "",
    submittedTo: "",
    portalLink: "",
    priority: "medium",
    entityHint: "",
    countyId: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await client.candidate(candidateId);
        if (cancelled) return;
        setCandidate(res.candidate);
        setDuplicates(res.possibleDuplicates);
        setForm({
          title: res.candidate.title,
          description: res.candidate.description,
          deadline: res.candidate.deadline
            ? new Date(res.candidate.deadline).toISOString().slice(0, 16)
            : "",
          submittedTo: res.candidate.submitted_to ?? "",
          portalLink: res.candidate.portal_link ?? "",
          priority: res.candidate.priority,
          entityHint: res.candidate.entity_hint ?? "",
          countyId: res.candidate.county_id ?? "",
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  async function approve() {
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      await client.approve(candidate.id, {
        title: form.title,
        description: form.description,
        deadline: form.deadline
          ? new Date(form.deadline).toISOString()
          : null,
        submittedTo: form.submittedTo,
        portalLink: form.portalLink || null,
        priority: form.priority,
        entityHint: form.entityHint,
        countyId: form.countyId,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  if (!candidate) {
    return <div className="panel glass">{error ?? "Loading candidate…"}</div>;
  }

  return (
    <div className="panel drawer glass-strong">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Review candidate</h2>
        <span className="pill">{candidate.status}</span>
      </div>
      {error && <div className="banner error">{error}</div>}

      <div className="meta">
        Source: {candidate.source_subject} · {candidate.source_sender} ·{" "}
        {fmtDate(candidate.source_sent_at)} · confidence{" "}
        {(candidate.confidence * 100).toFixed(0)}%
      </div>

      {(candidate.missing_fields?.length ?? 0) > 0 && (
        <div className="banner error">
          Missing fields: {candidate.missing_fields.join(", ")}
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="banner">
          Possible duplicates:{" "}
          {duplicates.map((d) => `${d.title} (${d.status})`).join("; ")}
        </div>
      )}

      <div className="evidence">
        {(candidate.evidence ?? []).map((e, idx) => (
          <blockquote key={idx}>
            “{e.quote}”
            <div className="meta">{e.reason}</div>
          </blockquote>
        ))}
      </div>

      <label>
        Title
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Deadline
          <input
            type="datetime-local"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
          />
        </label>
        <label style={{ flex: 1 }}>
          Priority
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </div>
      <label>
        Submitted to
        <input
          value={form.submittedTo}
          onChange={(e) => setForm({ ...form, submittedTo: e.target.value })}
        />
      </label>
      <label>
        Portal link
        <input
          value={form.portalLink}
          onChange={(e) => setForm({ ...form, portalLink: e.target.value })}
        />
      </label>
      <label>
        Entity hint
        <input
          value={form.entityHint}
          onChange={(e) => setForm({ ...form, entityHint: e.target.value })}
        />
      </label>
      <label>
        County / entity
        <select
          value={form.countyId}
          onChange={(e) => setForm({ ...form, countyId: e.target.value })}
        >
          <option value="">Select entity…</option>
          {entities.map((ent) => (
            <option key={ent.id} value={ent.id}>
              {ent.name} ({ent.type})
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <button className="btn" disabled={busy} onClick={approve} type="button">
          Edit & approve
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          type="button"
          onClick={async () => {
            await client.ignore(candidate.id);
            onChanged();
          }}
        >
          Ignore
        </button>
        <button
          className="btn warn"
          disabled={busy}
          type="button"
          onClick={async () => {
            await client.markDuplicate(candidate.id);
            onChanged();
          }}
        >
          Mark duplicate
        </button>
        {candidate.sourceDeepLink && (
          <a
            className="btn secondary"
            href={candidate.sourceDeepLink}
            target="_blank"
            rel="noreferrer"
          >
            Open source email
          </a>
        )}
      </div>
    </div>
  );
}

function Dashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [gmailReady, setGmailReady] = useState(false);
  const [microsoftReady, setMicrosoftReady] = useState(false);
  const [selectedMailbox, setSelectedMailbox] = useState("");
  const [days, setDays] = useState(7);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("needs_review");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOfflineSample, setShowOfflineSample] = useState(false);
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapForm, setImapForm] = useState({
    email: "",
    password: "",
    host: "",
    port: "993",
  });

  const activeMailbox = useMemo(
    () => mailboxes.find((m) => m.id === selectedMailbox),
    [mailboxes, selectedMailbox],
  );
  const realMailboxes = useMemo(
    () =>
      mailboxes.filter(
        (m) =>
          m.status === "active" &&
          (m.provider === "gmail" ||
            m.provider === "microsoft" ||
            m.provider === "imap"),
      ),
    [mailboxes],
  );
  const gmailMailboxes = useMemo(
    () => mailboxes.filter((m) => m.provider === "gmail" && m.status === "active"),
    [mailboxes],
  );
  const scanMailboxes = useMemo(() => {
    const active = mailboxes.filter((m) => m.status === "active");
    const real = active.filter((m) =>
      ["gmail", "microsoft", "imap"].includes(m.provider),
    );
    if (real.length > 0) return real;
    if (showOfflineSample) {
      return active.filter((m) => m.provider === "fixture");
    }
    return [];
  }, [mailboxes, showOfflineSample]);

  function pickPreferredMailbox(
    list: Mailbox[],
    currentId: string,
  ): string {
    const real = list.find(
      (m) =>
        m.status === "active" &&
        ["gmail", "microsoft", "imap"].includes(m.provider),
    );
    if (real) {
      if (
        currentId &&
        list.some(
          (m) =>
            m.id === currentId &&
            m.status === "active" &&
            ["gmail", "microsoft", "imap"].includes(m.provider),
        )
      ) {
        return currentId;
      }
      return real.id;
    }
    if (
      currentId &&
      list.some(
        (m) =>
          m.id === currentId &&
          m.status === "active" &&
          m.provider === "fixture" &&
          showOfflineSample,
      )
    ) {
      return currentId;
    }
    return "";
  }

  function mailboxLabel(m: Mailbox): string {
    if (m.provider === "gmail") return `Gmail · ${m.email_address}`;
    if (m.provider === "microsoft") return `Outlook · ${m.email_address}`;
    if (m.provider === "imap") return `IMAP · ${m.email_address}`;
    if (m.provider === "fixture") return `Sample inbox (offline) · ${m.email_address}`;
    return `${m.provider} · ${m.email_address}`;
  }

  async function refresh() {
    const [mb, sc, cand, ents, providers] = await Promise.all([
      client.mailboxes(),
      client.scans(),
      client.candidates(filter || undefined),
      client.entities(),
      client.providers(),
    ]);
    setMailboxes(mb.mailboxes);
    setJobs(sc.jobs);
    setCandidates(cand.candidates);
    setEntities(ents.entities);
    setGmailReady(
      Boolean(providers.providers.find((p) => p.id === "gmail")?.configured),
    );
    setMicrosoftReady(
      Boolean(providers.providers.find((p) => p.id === "microsoft")?.configured),
    );
    setSelectedMailbox((current) => pickPreferredMailbox(mb.mailboxes, current));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") === "success") {
      setMessage("Gmail connected with read-only access.");
      window.history.replaceState({}, "", "/");
      refresh().catch(() => undefined);
    } else if (params.get("oauth") === "error") {
      setError(params.get("message") || "Gmail connection failed");
      window.history.replaceState({}, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /authentication required|session expired/i.test(msg);
  }

  useEffect(() => {
    refresh().catch((err) => {
      if (isAuthError(err)) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (jobs.some((j) => j.status === "queued" || j.status === "running")) {
        refresh().catch((err) => {
          if (isAuthError(err)) onLogout();
        });
      }
    }, 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  return (
    <div className="app-root">
      <AmbientBackground />
      <div className="app-shell">
      <nav className="top-nav glass" aria-label="Account">
        <div className="logo-mark">
          <span className="logo-dot" />
          Email Task Agent
        </div>
        <div className="row topbar-actions">
          <span className="pill muted">{user.email}</span>
          <button
            className="btn secondary"
            type="button"
            onClick={async () => {
              try {
                await client.logout();
              } catch {
                // Session may already be gone.
              }
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <header className="topbar">
        <div className="brand">
          <p className="brand-kicker">Mailbox → review → export</p>
          <h1>
            Review before anything{" "}
            <span className="text-gradient">becomes a task</span>
          </h1>
          <p>
            Connect Gmail, Outlook, or IMAP. We scan for high-signal compliance
            mail, you approve with evidence, then export JSON.
          </p>
        </div>
      </header>

      <ol className="workflow-rail" aria-label="Workflow steps">
        <li>Connect</li>
        <li>Scan</li>
        <li>Review</li>
        <li>Export</li>
      </ol>

      {message && <div className="banner">{message}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="grid grid-2">
        <section className="panel stack panel-enter hover-glow">
          <div className="section-head">
            <span className="step-index">01</span>
            <h2>Connect mailbox</h2>
          </div>

          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={busy || !gmailReady}
              title={
                gmailReady
                  ? "Gmail read-only OAuth"
                  : "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart"
              }
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const { url } = await client.startGmailOAuth();
                  window.location.href = url;
                } catch (err) {
                  if (isAuthError(err)) {
                    onLogout();
                    return;
                  }
                  setError(err instanceof Error ? err.message : "OAuth failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Connect Gmail
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy || !microsoftReady}
              title={
                microsoftReady
                  ? "Microsoft Graph Mail.Read"
                  : "Add MICROSOFT_CLIENT_ID/SECRET to .env, or use Any email (IMAP)"
              }
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const { url } = await client.startMicrosoftOAuth();
                  window.location.href = url;
                } catch (err) {
                  if (isAuthError(err)) {
                    onLogout();
                    return;
                  }
                  setError(err instanceof Error ? err.message : "OAuth failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Connect Outlook
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => setShowImapForm((v) => !v)}
            >
              {showImapForm ? "Hide IMAP form" : "Any email (IMAP)"}
            </button>
          </div>

          {(!gmailReady || !microsoftReady) && (
            <p className="meta" style={{ margin: 0 }}>
              {!gmailReady && !microsoftReady
                ? "Gmail and Outlook OAuth are not configured yet — use Any email (IMAP) with an app password, or Offline sample inbox."
                : !gmailReady
                  ? "Gmail OAuth is not configured (missing Google client ID/secret in .env)."
                  : "Outlook OAuth is not configured (missing Microsoft client ID/secret in .env)."}
            </p>
          )}

          {showImapForm && (
            <div className="stack panel" style={{ boxShadow: "none" }}>
              <p className="meta" style={{ margin: 0 }}>
                Works with Outlook, Yahoo, iCloud, Zoho, custom domains, and
                Gmail via an app password. Password is encrypted at rest.
              </p>
              <label>
                Email address
                <input
                  type="email"
                  value={imapForm.email}
                  onChange={async (e) => {
                    const email = e.target.value;
                    setImapForm((f) => ({ ...f, email }));
                    if (email.includes("@")) {
                      try {
                        const res = await client.inferImapSettings(email);
                        if (res.inferred) {
                          setImapForm((f) => ({
                            ...f,
                            email,
                            host: res.inferred!.host,
                            port: String(res.inferred!.port),
                          }));
                        }
                      } catch {
                        // ignore inference errors while typing
                      }
                    }
                  }}
                  placeholder="you@company.com"
                  required
                />
              </label>
              <label>
                Password / app password
                <input
                  type="password"
                  value={imapForm.password}
                  onChange={(e) =>
                    setImapForm((f) => ({ ...f, password: e.target.value }))
                  }
                  required
                />
              </label>
              <div className="row">
                <label style={{ flex: 2 }}>
                  IMAP host
                  <input
                    value={imapForm.host}
                    onChange={(e) =>
                      setImapForm((f) => ({ ...f, host: e.target.value }))
                    }
                    placeholder="imap.example.com"
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Port
                  <input
                    value={imapForm.port}
                    onChange={(e) =>
                      setImapForm((f) => ({ ...f, port: e.target.value }))
                    }
                  />
                </label>
              </div>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await client.connectImap({
                      email: imapForm.email,
                      password: imapForm.password,
                      host: imapForm.host || undefined,
                      port: Number(imapForm.port) || undefined,
                    });
                    setMessage(`Connected ${res.email} over IMAP.`);
                    setShowImapForm(false);
                    setImapForm({ email: "", password: "", host: "", port: "993" });
                    await refresh();
                  } catch (err) {
                    if (isAuthError(err)) {
                      onLogout();
                      return;
                    }
                    setError(err instanceof Error ? err.message : "IMAP failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Connect IMAP mailbox
              </button>
            </div>
          )}

          {realMailboxes.length > 0 ? (
            <div className="banner">
              Connected:{" "}
              {realMailboxes.map((m) => mailboxLabel(m)).join(" · ")}
            </div>
          ) : (
            <div className="banner">
              Connect Gmail, Outlook, or any IMAP mailbox to scan real email.
            </div>
          )}

          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowOfflineSample((v) => !v)}
          >
            {showOfflineSample ? "Hide offline sample" : "Offline sample inbox…"}
          </button>

          {showOfflineSample && (
            <div className="stack">
              <p className="meta" style={{ margin: 0 }}>
                Bundled sample emails for offline testing only. This is not your
                real mailbox.
              </p>
              <div className="row">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await client.connectFixture();
                      setMessage("Offline sample inbox connected.");
                      await refresh();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Connect sample inbox
                </button>
                {mailboxes.some(
                  (m) => m.provider === "fixture" && m.status === "active",
                ) && (
                  <button
                    className="btn danger"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const fixture = mailboxes.find(
                          (m) => m.provider === "fixture" && m.status === "active",
                        );
                        if (fixture) {
                          await client.disconnectMailbox(fixture.id);
                          setMessage("Sample inbox disconnected.");
                          await refresh();
                        }
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Disconnect sample
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="section-head">
            <span className="step-index">02</span>
            <h2>Scan mailbox</h2>
          </div>

          {gmailMailboxes.length === 0 && scanMailboxes.length === 0 ? (
            <div className="empty">
              Connect a mailbox above first. The scan target will appear here
              automatically.
            </div>
          ) : (
            <label>
              Mailbox to scan
              <select
                value={selectedMailbox}
                onChange={(e) => setSelectedMailbox(e.target.value)}
              >
                <option value="" disabled>
                  Select a mailbox…
                </option>
                {scanMailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {mailboxLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {activeMailbox?.provider === "fixture" && (
            <div className="banner error">
              You are scanning the offline sample inbox, not real Gmail. Connect
              Gmail above, or disconnect the sample inbox.
            </div>
          )}

          <div className="row">
            <label style={{ flex: 1, maxWidth: 220 }}>
              Scan window (days)
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="meta" style={{ margin: 0 }}>
            Automatically focuses on high-signal compliance mail (deadlines,
            required actions) and skips promotions, social, and FYI noise.
          </p>

          <button
            className="btn"
            type="button"
            disabled={
              !selectedMailbox ||
              busy ||
              !["gmail", "microsoft", "imap", "fixture"].includes(
                activeMailbox?.provider ?? "",
              )
            }
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await client.startScan(selectedMailbox, days);
                setMessage(
                  `Scan started for the last ${days} day(s). Important messages only.`,
                );
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Scan failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Start scan
          </button>

          <h3>Scan history</h3>
          {jobs.length === 0 ? (
            <div className="empty">No scans yet. Connect a mailbox, then start a scan.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Seen</th>
                  <th>Candidates</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <span className="pill muted">{j.status}</span>
                      {j.error_message && (
                        <div className="meta">{j.error_message}</div>
                      )}
                    </td>
                    <td>{j.messages_seen}</td>
                    <td>{j.candidates_created}</td>
                    <td>{fmtDate(j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel stack panel-enter panel-enter-delay hover-glow">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="section-head">
              <span className="step-index">03</span>
              <h2>Review queue</h2>
            </div>
            <select
              className="filter-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter candidates by status"
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="row">
            <button
              className="btn secondary"
              type="button"
              onClick={async () => {
                try {
                  const res = await client.exportApproved();
                  setExportJson(JSON.stringify(res.exported, null, 2));
                  setMessage(
                    `Exported ${res.exported.length} payload(s)${
                      res.errors.length ? `, ${res.errors.length} error(s)` : ""
                    }.`,
                  );
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Export failed");
                }
              }}
            >
              Export approved JSON
            </button>
          </div>

          {exportJson && <pre className="export-box">{exportJson}</pre>}

          <div className="candidate-list">
            {candidates.length === 0 ? (
              <div className="empty">
                No candidates yet. After a mailbox scan finishes, actionable emails
                appear here for review.
              </div>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`candidate-card ${selectedId === c.id ? "active" : ""}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <h3>{c.title}</h3>
                  <div className="meta">
                    {c.submitted_to || "submittedTo missing"} · deadline{" "}
                    {fmtDate(c.deadline)} · {c.priority}
                  </div>
                  <div className="meta">
                    {c.entity_hint || "no entity hint"} ·{" "}
                    {(c.confidence * 100).toFixed(0)}% · {c.source_subject}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="pill">{c.status}</span>
                    {(c.missing_fields?.length ?? 0) > 0 && (
                      <span className="pill warn">missing fields</span>
                    )}
                    {(c.possible_duplicate_ids?.length ?? 0) > 0 && (
                      <span className="pill warn">possible duplicate</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="detail-dock">
        {selectedId ? (
          <CandidateDetail
            candidateId={selectedId}
            entities={entities}
            onChanged={async () => {
              setSelectedId(null);
              await refresh();
            }}
          />
        ) : (
          <div className="panel empty detail-placeholder glass">
            Select a candidate to review evidence, edit fields, and approve.
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

const ENTERED_KEY = "eta_entered_app";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [entered, setEntered] = useState(
    () => sessionStorage.getItem(ENTERED_KEY) === "1",
  );

  useEffect(() => {
    client
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="app-root">
        <AmbientBackground />
        <div className="login-wrap">
          <div className="loading-mark" aria-live="polite">
            <span className="loading-dot" />
            Loading Email Task Agent…
          </div>
        </div>
      </div>
    );
  }

  if (!entered) {
    return (
      <LandingScreen
        onEnter={() => {
          sessionStorage.setItem(ENTERED_KEY, "1");
          setEntered(true);
        }}
      />
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  return (
    <Dashboard
      user={user}
      onLogout={() => {
        setUser(null);
      }}
    />
  );
}
