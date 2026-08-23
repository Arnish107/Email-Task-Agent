import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function vercelHttpsOrigin(): string | undefined {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod.replace(/^https?:\/\//, "")}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return undefined;
}

const vercelOrigin = vercelHttpsOrigin();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  appBaseUrl:
    process.env.APP_BASE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    vercelOrigin ??
    "http://localhost:4000",
  webBaseUrl:
    process.env.WEB_BASE_URL ??
    vercelOrigin ??
    "http://localhost:5173",
  sessionSecret: required("SESSION_SECRET", "dev-session-secret-change-me"),
  tokenEncryptionKey: required(
    "TOKEN_ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ),
  databaseUrl: required(
    "DATABASE_URL",
    process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL ??
      "pglite",
  ),
  usePglite: (() => {
    const url =
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL ??
      "pglite";
    if ((process.env.USE_PGLITE ?? "") === "true") return true;
    if ((process.env.USE_PGLITE ?? "") === "false") return false;
    return url === "pglite" || url.startsWith("pglite:");
  })(),
  demoAuthEnabled: (process.env.DEMO_AUTH_ENABLED ?? "true") === "true",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      `${vercelOrigin ?? "http://localhost:4000"}/api/oauth/gmail/callback`,
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
    redirectUri:
      process.env.MICROSOFT_REDIRECT_URI ??
      "http://localhost:4000/api/oauth/microsoft/callback",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    baseUrl:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta",
  },
  enableFixtureProvider: (process.env.ENABLE_FIXTURE_PROVIDER ?? "true") === "true",
  // From dist/config.js → apps/api/data/entities.json (included via vercel.json)
  entityCatalogPath:
    process.env.ENTITY_CATALOG_PATH ??
    path.resolve(__dirname, "../data/entities.json"),
  // Writable path must be under /tmp on Vercel (read-only bundle otherwise)
  entitySyncedPath:
    process.env.ENTITY_SYNCED_PATH ??
    (process.env.VERCEL
      ? "/tmp/email-task-agent-entities.synced.json"
      : path.resolve(__dirname, "../data/entities.synced.json")),
};

export function gmailConfigured(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function microsoftConfigured(): boolean {
  return Boolean(config.microsoft.clientId && config.microsoft.clientSecret);
}
