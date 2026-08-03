"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = pool;
exports.userStoreConfigured = userStoreConfigured;
exports.sql = sql;
require("server-only");
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
const pg_1 = require("pg");
const globalForPool = globalThis;
function pool() {
    if (!globalForPool.oeUserPool) {
        const connectionString = process.env.DATABASE_URL ??
            process.env.POSTGRES_URL ??
            process.env.POSTGRES_PRISMA_URL;
        if (!connectionString) {
            throw new Error("No DATABASE_URL / POSTGRES_URL set — the user store is not connected. " +
                "Create a Postgres database in the Vercel project (Storage → Create), " +
                "then run the migration in lib/users/schema.sql.");
        }
        globalForPool.oeUserPool = new pg_1.Pool({
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
function userStoreConfigured() {
    return Boolean(process.env.DATABASE_URL ??
        process.env.POSTGRES_URL ??
        process.env.POSTGRES_PRISMA_URL);
}
/**
 * The schema, applied on demand.
 *
 * There is no migration runner here and adding one for a single table would be
 * ceremony. The DDL is idempotent, so the first query in each process just
 * ensures it — which also means attaching a fresh database needs no manual
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
const globalForSchema = globalThis;
function ensureSchema() {
    if (!globalForSchema.oeSchemaReady) {
        globalForSchema.oeSchemaReady = pool()
            .query(SCHEMA)
            .then(() => undefined)
            .catch((error) => {
            // Two lambdas can reach CREATE TABLE IF NOT EXISTS at the same moment
            // and Postgres raises a duplicate-object error on the loser. That is
            // the race resolving correctly, not a failure.
            const code = error?.code;
            if (code === "23505" || code === "42P07" || code === "42710")
                return;
            // Anything else must not be cached as "ready", or every later request
            // in this process inherits a broken schema.
            globalForSchema.oeSchemaReady = undefined;
            throw error;
        });
    }
    return globalForSchema.oeSchemaReady;
}
async function sql(text, params = []) {
    await ensureSchema();
    const result = await pool().query(text, params);
    return result.rows;
}
