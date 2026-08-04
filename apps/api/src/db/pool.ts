import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type QueryResult<T> = {
  rows: T[];
  rowCount: number | null;
  command?: string;
  fields?: unknown[];
};

type DbLike = {
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
  connect: () => Promise<{
    query: <T = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<QueryResult<T>>;
    release: () => void;
  }>;
  end: () => Promise<void>;
};

function usePglite(): boolean {
  const url = config.databaseUrl;
  return (
    process.env.USE_PGLITE === "true" ||
    url === "pglite" ||
    url.startsWith("pglite:")
  );
}

function createPgPool(): DbLike {
  const pool = new Pool({ connectionString: config.databaseUrl });
  return {
    query: async <T,>(text: string, params?: unknown[]) => {
      const result = await pool.query(text, params);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
        command: result.command,
        fields: result.fields,
      };
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async <T,>(text: string, params?: unknown[]) => {
          const result = await client.query(text, params);
          return {
            rows: result.rows as T[],
            rowCount: result.rowCount,
            command: result.command,
            fields: result.fields,
          };
        },
        release: () => client.release(),
      };
    },
    end: async () => {
      await pool.end();
    },
  };
}

function createPglitePool(): DbLike {
  const dataDir =
    config.databaseUrl.startsWith("pglite:") && config.databaseUrl !== "pglite:"
      ? config.databaseUrl.slice("pglite:".length)
      : path.resolve(__dirname, "../../data/pglite");

  fs.mkdirSync(path.dirname(dataDir), { recursive: true });

  let dbPromise: Promise<PGlite> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const getDb = () => {
    if (!dbPromise) {
      dbPromise = PGlite.create(dataDir);
    }
    return dbPromise;
  };

  const run = async <T,>(fn: (db: PGlite) => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      const db = await getDb();
      return fn(db);
    });
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    query: async <T,>(text: string, params?: unknown[]) => {
      return run(async (db) => {
        const result = await db.query(text, params ?? []);
        return {
          rows: result.rows as T[],
          rowCount: result.rows.length,
        };
      });
    },
    connect: async () => {
      // Serialize transactions through the same queue; hold a logical client.
      let released = false;
      return {
        query: async <T,>(text: string, params?: unknown[]) => {
          return run(async (db) => {
            const result = await db.query(text, params ?? []);
            return {
              rows: result.rows as T[],
              rowCount: result.rows.length,
            };
          });
        },
        release: () => {
          released = true;
          void released;
        },
      };
    },
    end: async () => {
      if (dbPromise) {
        const db = await dbPromise;
        await db.close();
        dbPromise = null;
      }
    },
  };
}

export const pool: DbLike = usePglite() ? createPglitePool() : createPgPool();

export type DbClient = Awaited<ReturnType<DbLike["connect"]>> | DbLike;
