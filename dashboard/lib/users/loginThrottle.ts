import "server-only";

/**
 * Brute-force limit for the email + password sign-in.
 *
 * Without it the credentials endpoint answered as many guesses as anyone cared
 * to send. bcrypt slows each guess down, but Vercel runs many instances in
 * parallel, so the cost lands on us rather than on the attacker.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *   EMAIL_MAX failed attempts for one address in WINDOW_MIN minutes, or
 *   IP_MAX failed attempts from one IP address in the same window,
 *   and the next attempt is refused before the password is even compared.
 * A successful sign-in clears that address's failures.
 *
 * ── Why Postgres, not memory ────────────────────────────────────────────────
 * Every lambda instance has its own memory, so an in-memory counter is one
 * counter per instance and an attacker spreads across them. The table is the
 * one counter every instance shares.
 *
 * ── It reveals nothing ──────────────────────────────────────────────────────
 * The limit counts attempts per address whether or not the address has an
 * account, so "too many attempts" is no more an existence oracle than "wrong
 * email or password". Google sign-in never passes through here, so locking an
 * address with junk guesses cannot lock the agency out.
 *
 * Fails closed: if the table cannot be read, the attempt is refused, the same
 * as every other auth lookup in lib/auth.ts.
 */

import { sql } from "@/lib/users/db";

export const WINDOW_MIN = 15;
export const EMAIL_MAX = 10;
export const IP_MAX = 50;

/** Thrown from `authorize`, next-auth hands the message to the sign-in page. */
export const TOO_MANY_ATTEMPTS = "TooManyAttempts";

const DDL = `
CREATE TABLE IF NOT EXISTS login_attempts (
  id     BIGSERIAL PRIMARY KEY,
  at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email  TEXT NOT NULL,
  ip     TEXT,
  ok     BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email, at DESC) WHERE NOT ok;
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts (ip, at DESC) WHERE NOT ok;
`;

const globalForSchema = globalThis as unknown as { oeLoginThrottleSchema?: Promise<void> };

function ensure(): Promise<void> {
  if (!globalForSchema.oeLoginThrottleSchema) {
    globalForSchema.oeLoginThrottleSchema = sql(DDL)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Two lambdas racing on CREATE ... IF NOT EXISTS: the loser sees a
        // duplicate-object error, which is the race resolving correctly.
        const code = (error as { code?: string })?.code;
        if (code === "23505" || code === "42P07" || code === "42710") return;
        globalForSchema.oeLoginThrottleSchema = undefined;
        throw error;
      });
  }
  return globalForSchema.oeLoginThrottleSchema;
}

/**
 * The caller's IP. On Vercel `x-forwarded-for` is set by the platform from the
 * connection, not passed through from the client, so its first entry is the
 * real address. Anywhere else it is a hint only, and the per-address limit
 * still holds.
 */
export function clientIp(headers: Record<string, unknown> | undefined): string | null {
  const raw = headers?.["x-forwarded-for"] ?? headers?.["x-real-ip"];
  const first = String(Array.isArray(raw) ? raw[0] : raw ?? "").split(",")[0].trim();
  return first || null;
}

/** True when this attempt must be refused without checking the password. */
export async function isThrottled(email: string, ip: string | null): Promise<boolean> {
  await ensure();
  const rows = await sql<{ by_email: number; by_ip: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE email = $1)::int                AS by_email,
       COUNT(*) FILTER (WHERE $2::text IS NOT NULL AND ip = $2)::int AS by_ip
     FROM login_attempts
     WHERE NOT ok
       AND at > NOW() - make_interval(mins => $3)
       AND (email = $1 OR ip = $2)`,
    [email, ip, WINDOW_MIN],
  );
  const row = rows[0];
  return (row?.by_email ?? 0) >= EMAIL_MAX || (row?.by_ip ?? 0) >= IP_MAX;
}

/** Record the outcome. A success clears the address's failures and prunes old rows. */
export async function recordAttempt(email: string, ip: string | null, ok: boolean): Promise<void> {
  await ensure();
  await sql(`INSERT INTO login_attempts (email, ip, ok) VALUES ($1, $2, $3)`, [email, ip, ok]);
  if (ok) {
    await sql(
      `DELETE FROM login_attempts
        WHERE (email = $1 AND NOT ok) OR at < NOW() - INTERVAL '1 day'`,
      [email],
    );
  }
}
