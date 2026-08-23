export type User = {
  id: string;
  email: string;
  displayName: string | null;
};

export type Mailbox = {
  id: string;
  provider: string;
  email_address: string;
  scope: string;
  status: string;
  last_scan_at: string | null;
};

export type ScanJob = {
  id: string;
  mailbox_connection_id: string;
  status: string;
  query: string;
  window_start: string | null;
  window_end: string | null;
  messages_seen: number;
  candidates_created: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type Candidate = {
  id: string;
  title: string;
  description: string;
  deadline: string | null;
  submitted_to: string | null;
  portal_link: string | null;
  priority: string;
  entity_hint: string | null;
  county_id: string | null;
  confidence: number;
  status: string;
  source_subject: string;
  source_sender: string;
  source_sent_at: string | null;
  provider_message_id: string;
  source_thread_id: string | null;
  evidence: Array<{ quote: string; reason: string }>;
  missing_fields: string[];
  possible_duplicate_ids: string[];
  provider?: string;
  sourceDeepLink?: string | null;
  assigned_role_hints?: string[];
};

export type Entity = {
  id: string;
  name: string;
  type: string;
  code: string;
};

/** Production API origin (no trailing slash). Empty in local Vite proxy mode. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "eta_session_id";

export function getStoredSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionId(sessionId: string | null): void {
  try {
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore private-mode / blocked storage
  }
}

function apiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function api<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else {
      init.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }
  const sessionId = getStoredSessionId();
  try {
    const res = await fetch(apiUrl(path), {
      credentials: "include",
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "X-Eta-Session": sessionId } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        setStoredSessionId(null);
      }
      throw new Error(
        (data as { error?: string }).error || `Request failed (${res.status})`,
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const local =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");
      if (local) {
        throw new Error(
          "Request timed out. Make sure the API is running (npm run dev) on port 4000.",
        );
      }
      if (path.includes("oauth")) {
        throw new Error(
          "Gmail connect timed out (server waking up). Wait a few seconds and click Connect Gmail again.",
        );
      }
      if (path.includes("imap")) {
        throw new Error(
          "IMAP timed out. For Gmail prefer Connect Gmail (OAuth), or use an App Password with imap.gmail.com:993.",
        );
      }
      throw new Error(
        "Request timed out. Wait a moment and try again (first load can be slow).",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type ProviderInfo = {
  id: string;
  label: string;
  scope?: string;
  configured: boolean;
  note?: string;
};

export const client = {
  me: () => api<{ user: User }>("/api/auth/me"),
  login: async (email: string) => {
    const res = await api<{ user: User; sessionId: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (res.sessionId) setStoredSessionId(res.sessionId);
    return res;
  },
  logout: async () => {
    try {
      await api<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    } finally {
      setStoredSessionId(null);
    }
  },
  mailboxes: () => api<{ mailboxes: Mailbox[] }>("/api/mailboxes"),
  providers: () =>
    api<{ providers: ProviderInfo[] }>("/api/mailboxes/providers"),
  connectFixture: () =>
    api<{ mailboxId: string; email: string }>("/api/mailboxes/fixture/connect", {
      method: "POST",
    }),
  disconnectMailbox: (id: string) =>
    api<{ ok: boolean }>(`/api/mailboxes/${id}`, { method: "DELETE" }),
  inferImapSettings: (email: string) =>
    api<{
      email: string;
      inferred: { host: string; port: number; secure: boolean } | null;
    }>("/api/mailboxes/imap/settings", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  connectImap: (body: {
    email: string;
    password: string;
    host?: string;
    port?: number;
    secure?: boolean;
  }) =>
    api<{ mailboxId: string; email: string; provider: string }>(
      "/api/mailboxes/imap/connect",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      45_000,
    ),
  startGmailOAuth: () =>
    api<{ url: string }>("/api/mailboxes/oauth/gmail/start", undefined, 60_000),
  startScan: (mailboxId: string, days: number) =>
    api<{ jobId: string; query: string }>("/api/scans", {
      method: "POST",
      body: JSON.stringify({ mailboxId, days }),
    }),
  scans: () => api<{ jobs: ScanJob[] }>("/api/scans"),
  candidates: (status?: string) =>
    api<{ candidates: Candidate[] }>(
      status ? `/api/candidates?status=${encodeURIComponent(status)}` : "/api/candidates",
    ),
  candidate: (id: string) =>
    api<{
      candidate: Candidate;
      entities: Entity[];
      possibleDuplicates: Array<{ id: string; title: string; status: string }>;
    }>(`/api/candidates/${id}`),
  approve: (id: string, body: Record<string, unknown>) =>
    api<{ candidate: Candidate }>(`/api/candidates/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ignore: (id: string) =>
    api<{ candidate: Candidate }>(`/api/candidates/${id}/ignore`, {
      method: "POST",
    }),
  markDuplicate: (id: string) =>
    api<{ candidate: Candidate }>(`/api/candidates/${id}/duplicate`, {
      method: "POST",
    }),
  exportApproved: (ids?: string[]) =>
    api<{ exported: unknown[]; errors: Array<{ id: string; error: string }> }>(
      "/api/candidates/export",
      {
        method: "POST",
        body: JSON.stringify(ids ? { ids } : {}),
      },
    ),
  entities: () => api<{ entities: Entity[] }>("/api/entities"),
};
