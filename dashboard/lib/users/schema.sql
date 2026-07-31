-- App user store. Run once against the Postgres database attached to the
-- Vercel project (Storage → your database → Query), or via psql.
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
