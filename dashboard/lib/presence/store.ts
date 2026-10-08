import "server-only";

/**
 * Presence: which internal people were on the dashboard on which Prague day,
 * when they started, and for how many active minutes.
 *
 *   presence_days   one row per (email, Prague day)
 *
 * Internal roles only. Client accounts are never written here: the heartbeat
 * is not mounted for them and the route refuses them as well.
 *
 * ── Counting a minute ──────────────────────────────────────────────────────
 * A heartbeat adds one active minute only when it lands in a later clock
 * minute than the previous heartbeat of that day (`last_seen`). So:
 *   - two tabs open both ping, and still add one minute per minute;
 *   - a burst of requests, a reload loop or a scripted client adds at most one
 *     minute per clock minute;
 *   - a tab pinging every 60 s adds one minute per ping, and timer jitter of a
 *     few hundred ms cannot make it lose minutes the way a strict "60 s since
 *     the last count" rule would.
 * Idle and hidden tabs are filtered in the browser (components/presence/
 * Heartbeat.tsx): they send nothing, so they add nothing.
 *
 * ── Why the DDL is here and not in lib/users/db.ts ─────────────────────────
 * Same reason as `lib/creative/store.ts`: that schema runs before the sign-in
 * query, so a mistake there locks everybody out. Here the worst case is that
 * presence is unavailable while the dashboard carries on.
 */

import { sql } from "@/lib/users/db";
import { PRESENCE_TIME_ZONE } from "@/lib/presence/streak";

const DDL = `
CREATE TABLE IF NOT EXISTS presence_days (
  email          TEXT NOT NULL,
  -- The calendar day in Europe/Prague, not UTC.
  day            DATE NOT NULL,
  first_seen     TIMESTAMPTZ NOT NULL,
  last_seen      TIMESTAMPTZ NOT NULL,
  active_minutes INT NOT NULL DEFAULT 1,
  PRIMARY KEY (email, day)
);
CREATE INDEX IF NOT EXISTS presence_days_day_idx ON presence_days (day);
`;

const globalForSchema = globalThis as unknown as { oePresenceSchema?: Promise<boolean> };

function ensure(): Promise<boolean> {
  if (!globalForSchema.oePresenceSchema) {
    globalForSchema.oePresenceSchema = sql(DDL)
      .then(() => true)
      .catch((error: unknown) => {
        const code = (error as { code?: string })?.code;
        // Two lambdas racing on CREATE ... IF NOT EXISTS: the loser sees a
        // duplicate-object error, which is the race resolving correctly.
        if (code === "23505" || code === "42P07" || code === "42710") return true;
        console.error("[presence] could not create presence_days", error);
        globalForSchema.oePresenceSchema = undefined;
        return false;
      });
  }
  return globalForSchema.oePresenceSchema;
}

/**
 * One heartbeat. Creates today's row (1 minute) or extends it.
 * `email` must come from the server session, never from a request body.
 */
export async function recordHeartbeat(email: string): Promise<void> {
  if (!(await ensure())) return;
  await sql(
    `
    INSERT INTO presence_days AS p (email, day, first_seen, last_seen, active_minutes)
    VALUES (LOWER($1), (NOW() AT TIME ZONE $2)::date, NOW(), NOW(), 1)
    ON CONFLICT (email, day) DO UPDATE SET
      active_minutes = p.active_minutes
        + CASE WHEN date_trunc('minute', NOW()) > date_trunc('minute', p.last_seen) THEN 1 ELSE 0 END,
      first_seen = LEAST(p.first_seen, EXCLUDED.first_seen),
      last_seen  = GREATEST(p.last_seen, EXCLUDED.last_seen)
    `,
    [email, PRESENCE_TIME_ZONE],
  );
}

export interface PresenceDay {
  email: string;
  /** "YYYY-MM-DD", Prague. */
  day: string;
  firstSeen: string;
  lastSeen: string;
  activeMinutes: number;
}

/**
 * Every presence row for these people. Small by construction: a handful of
 * internal accounts times the days since the feature shipped; best streak
 * needs the whole history.
 */
export async function presenceDays(emails: string[]): Promise<PresenceDay[]> {
  if (emails.length === 0 || !(await ensure())) return [];
  const rows = await sql<{
    email: string;
    day: string;
    first_seen: Date;
    last_seen: Date;
    active_minutes: number;
  }>(
    `SELECT email, day::text AS day, first_seen, last_seen, active_minutes
       FROM presence_days
      WHERE email = ANY($1::text[])
      ORDER BY email, day`,
    [emails.map((e) => e.toLowerCase())],
  );
  return rows.map((r) => ({
    email: r.email,
    day: r.day,
    firstSeen: new Date(r.first_seen).toISOString(),
    lastSeen: new Date(r.last_seen).toISOString(),
    activeMinutes: Number(r.active_minutes) || 0,
  }));
}

export interface InternalPerson {
  email: string;
  name: string | null;
}

/** Active agency and admin accounts: everyone the leaderboard lists. */
export async function internalPeople(): Promise<InternalPerson[]> {
  const rows = await sql<{ email: string; name: string | null }>(
    `SELECT LOWER(email) AS email, name
       FROM app_users
      WHERE is_active AND role IN ('agency', 'admin')
      ORDER BY LOWER(email)`,
  );
  return rows.map((r) => ({ email: r.email, name: r.name }));
}
