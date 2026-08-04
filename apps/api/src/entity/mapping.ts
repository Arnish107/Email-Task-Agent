import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type EntityRecord = {
  id: string;
  name: string;
  type: string;
  code: string;
};

export type EntityMatch = {
  entity: EntityRecord;
  score: number;
  method: "exact" | "suffix" | "fuzzy";
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSuffix(name: string): string {
  return normalizeName(name).replace(
    /\b(county|city|authority|town|village|borough)\b/g,
    "",
  ).replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

let cached: EntityRecord[] | null = null;

export function invalidateEntityCache(): void {
  cached = null;
}

export function loadEntities(): EntityRecord[] {
  if (cached) return cached;

  const tryPaths = [config.entitySyncedPath, config.entityCatalogPath];
  for (const filePath of tryPaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as EntityRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        cached = parsed;
        return cached;
      }
    } catch {
      // try next
    }
  }
  cached = [];
  return cached;
}

export function saveSyncedEntities(entities: EntityRecord[]): void {
  fs.mkdirSync(path.dirname(config.entitySyncedPath), { recursive: true });
  fs.writeFileSync(
    config.entitySyncedPath,
    JSON.stringify(entities, null, 2),
    "utf8",
  );
  cached = entities;
}

export function matchEntity(
  hint: string | null | undefined,
  threshold = 0.78,
): EntityMatch | null {
  if (!hint?.trim()) return null;
  const entities = loadEntities();
  const norm = normalizeName(hint);
  const stripped = stripSuffix(hint);

  for (const entity of entities) {
    if (normalizeName(entity.name) === norm) {
      return { entity, score: 1, method: "exact" };
    }
  }

  for (const entity of entities) {
    if (stripSuffix(entity.name) === stripped && stripped.length > 0) {
      return { entity, score: 0.92, method: "suffix" };
    }
  }

  let best: EntityMatch | null = null;
  for (const entity of entities) {
    const score = Math.max(
      similarity(norm, normalizeName(entity.name)),
      similarity(stripped, stripSuffix(entity.name)),
    );
    if (!best || score > best.score) {
      best = { entity, score, method: "fuzzy" };
    }
  }

  if (best && best.score >= threshold) return best;
  return null;
}

/** Strong matches only — never auto-fill countyId from a weak fuzzy hit. */
export function strongEntityMatch(hint: string | null | undefined): EntityMatch | null {
  const match = matchEntity(hint, 0.9);
  if (!match) return null;
  if (match.method === "fuzzy" && match.score < 0.92) return null;
  return match;
}
