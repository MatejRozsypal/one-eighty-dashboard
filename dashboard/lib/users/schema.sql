-- App user store.
--
-- You do not normally need to run this: the same DDL is applied on demand by
-- `ensureSchema()` in lib/users/db.ts, so attaching a fresh database is enough.
-- This file is the readable copy — keep the two in step.
--
-- This holds ONLY who may open the dashboard and what they may see. It is
-- deliberately separate from BigQuery: `ref.clients` is business configuration
-- that analysts read, this is credentials.

CREATE TABLE IF NOT EXISTS app_users (
  id              BIGSERIAL PRIMARY KEY,

  -- Stored lower-cased; the unique index is what actually prevents two rows
  -- differing only in case from both being able to sign in.
  email           TEXT NOT NULL,

  name            TEXT,

  -- 'admin'  — everything, plus user management
  -- 'agency' — every client, no user management
  -- 'client' — exactly one client, the one in client_id
  role            TEXT NOT NULL CHECK (role IN ('admin', 'agency', 'client')),

  -- Required for 'client', meaningless otherwise. Enforced below rather than
  -- left to the application, so a bug in the admin form cannot create a client
  -- user with access to everything.
  client_id       TEXT,

  -- NULL for accounts that sign in with Google instead of a password.
  password_hash   TEXT,

  -- Set when the password was issued by an admin, cleared once the user picks
  -- their own. The sign-in flow refuses to go anywhere else while it is true.
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT client_role_needs_a_client
    CHECK (role <> 'client' OR client_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key
  ON app_users (LOWER(email));


-- Who saw whose data, and who tried to.
--
-- resolveClient() writes one row per data-page render: it is the single point
-- every page funnels through to turn ?client= into the client it renders, so it
-- is the only place that sees the identity, the role, what the URL asked for
-- and what was actually served.
--
-- Read this as evidence, not as enforcement. A write failure is swallowed so
-- that an unreachable database cannot take the dashboard down, which means a
-- gap here says "we could not record", never "nobody accessed".
CREATE TABLE IF NOT EXISTS access_log (
  id                  BIGSERIAL PRIMARY KEY,
  at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email               TEXT NOT NULL,
  role                TEXT NOT NULL,

  -- 'view'    -- data for client_id was served to this account
  -- 'refused' -- the account asked for requested_client_id and was denied
  event               TEXT NOT NULL CHECK (event IN ('view', 'refused')),

  client_id           TEXT,
  requested_client_id TEXT,
  detail              TEXT
);

CREATE INDEX IF NOT EXISTS access_log_at_idx ON access_log (at DESC);
CREATE INDEX IF NOT EXISTS access_log_client_idx ON access_log (client_id, at DESC);
CREATE INDEX IF NOT EXISTS access_log_email_idx ON access_log (LOWER(email), at DESC);
CREATE INDEX IF NOT EXISTS access_log_refused_idx ON access_log (at DESC) WHERE event = 'refused';
