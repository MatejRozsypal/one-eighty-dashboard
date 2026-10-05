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

/** Connections per instance. Overridable for a database with a tighter limit. */
const PG_POOL_MAX = Math.max(1, Number(process.env.PG_POOL_MAX ?? "") || 5);

export function pool(): Pool {
  if (!globalForPool.oeUserPool) {
    const connectionString =
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL;

    if (!connectionString) {
      throw new Error(
        "No DATABASE_URL / POSTGRES_URL set, the user store is not connected. " +
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
      // Sizing for Vercel Fluid compute, where ONE instance serves many
      // requests at once and they all share this pool. Each page render needs
      // a session lookup, an access-log insert and often a settings read, and
      // a Reports open adds one gate check per widget request; at 3 those
      // queued behind each other under a burst (QA N-06). Check the database's
      // connection limit against 5 x the instance count; PG_POOL_MAX lowers it.
      max: PG_POOL_MAX,
      idleTimeoutMillis: 10_000,
      // Fail instead of hanging. Without these a request waited for a free or
      // dead connection with no limit, until the platform killed the function
      // at 300 s. Every caller already handles a thrown query (auth refuses,
      // the access log skips, pages show their error state).
      connectionTimeoutMillis: 10_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
      // Detects a connection the pooler or a NAT silently dropped, so it is
      // replaced rather than handed to the next request.
      keepAlive: true,
    });

    // An idle connection the server or pooler closes emits "error" on the
    // pool. With no listener Node treats that as an unhandled error event and
    // the whole instance goes down, with every request it was serving. The
    // pool already discards the broken client; log it and carry on.
    globalForPool.oeUserPool.on("error", (error) => {
      console.error("[db] idle Postgres connection failed", error.message);
    });
  }

  return globalForPool.oeUserPool;
}

/** True when a user store is configured at all, lets the UI explain itself. */
export function userStoreConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL
  );
}

/**
 * The schema, applied on demand.
 *
 * There is no migration runner here and adding one for a single table would be
 * ceremony. The DDL is idempotent, so the first query in each process just
 * ensures it: which also means attaching a fresh database needs no manual
 * step and no throwaway migration endpoint in production.
 *
 * Kept in step with `schema.sql`, which stays as the readable version.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL,
  name            TEXT,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'agency', 'client')),
  client_id       TEXT,
  password_hash   TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_role_needs_a_client
    CHECK (role <> 'client' OR client_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (LOWER(email));

-- Cost assumptions the warehouse cannot measure.
--
-- OpEx, fulfilment and the other CM1 costs are salaries, rent, platform fees,
-- pick-and-pack -- none of which any connected source reports, so they cannot
-- be derived. They used to be hardcoded in the app (30% OpEx, zero fulfilment),
-- which is worse than storing them: a guess buried in code looks like a
-- measurement and nobody knows to revisit it. Here they are somebody's stated
-- input, visible and editable, and a metric that depends on one is hidden
-- entirely until it is filled in.
CREATE TABLE IF NOT EXISTS client_settings (
  client_id             TEXT PRIMARY KEY,
  -- Share of revenue, 0..1. NULL means "not stated" -- never assume a default.
  opex_rate             NUMERIC,
  -- Per-order costs in the client's own trading currency.
  fulfilment_per_order  NUMERIC,
  other_cm1_per_order   NUMERIC,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            TEXT
);


`;

const globalForSchema = globalThis as unknown as { oeSchemaReady?: Promise<void> };

function ensureSchema(): Promise<void> {
  if (!globalForSchema.oeSchemaReady) {
    globalForSchema.oeSchemaReady = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Two lambdas can reach CREATE TABLE IF NOT EXISTS at the same moment
        // and Postgres raises a duplicate-object error on the loser. That is
        // the race resolving correctly, not a failure.
        const code = (error as { code?: string })?.code;
        if (code === "23505" || code === "42P07" || code === "42710") return;

        // Anything else must not be cached as "ready", or every later request
        // in this process inherits a broken schema.
        globalForSchema.oeSchemaReady = undefined;
        throw error;
      });
  }
  return globalForSchema.oeSchemaReady;
}

export async function sql<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensureSchema();
  const result = await pool().query(text, params);
  return result.rows as T[];
}
