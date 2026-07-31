import "server-only";

/**
 * Postgres pool for the app's own user store.
 *
 * ── Why this is not in BigQuery ─────────────────────────────────────────────
 * Everything else this app reads lives in BigQuery, so putting users there
 * would have been the path of least resistance. It is the wrong place for
 * credentials: BigQuery is an analytics warehouse that several service accounts
 * and, in time, several humans can read, and a password hash sitting next to
 * `mart_orders` is exactly the kind of thing that ends up in an export a year
 * from now. Auth data gets its own store with its own credentials, and the
 * BigQuery service account never sees it.
 *
 * The pool is cached on `globalThis` because Next.js re-evaluates modules on
 * every hot reload in dev and across lambda invocations in production; without
 * this each one opens a fresh pool and Postgres runs out of connections.
 */

import { Pool } from "pg";

const globalForPool = globalThis as unknown as { oeUserPool?: Pool };

export function pool(): Pool {
  if (!globalForPool.oeUserPool) {
    const connectionString =
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL;

    if (!connectionString) {
      throw new Error(
        "No DATABASE_URL / POSTGRES_URL set — the user store is not connected. " +
          "Create a Postgres database in the Vercel project (Storage → Create), " +
          "then run the migration in lib/users/schema.sql."
      );
    }

    globalForPool.oeUserPool = new Pool({
      connectionString,
      // Neon and Vercel Postgres both terminate TLS at the pooler with a cert
      // chain Node doesn't ship; the connection is still encrypted.
      ssl: connectionString.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }

  return globalForPool.oeUserPool;
}

/** True when a user store is configured at all — lets the UI explain itself. */
export function userStoreConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL
  );
}

export async function sql<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool().query(text, params);
  return result.rows as T[];
}
