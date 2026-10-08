import "server-only";

/**
 * Dismissed For you cards, per person.
 *
 * Postgres, because the app's BigQuery account is read-only by design. The
 * table is created here behind its own guard, as lib/creative/store.ts does:
 * a mistake in this DDL can only take the dismiss buttons down, never the
 * sign-in path that lib/users/db.ts serves.
 *
 * One row per (user_email, alert_key). Dismissing again replaces the row;
 * Undo deletes it. Every row is read so a card's (i) can say when a teammate
 * dismissed it; only the person's own rows hide anything.
 *   value_at_dismiss, severity_at_dismiss   client alerts: the baseline of
 *                                           "worse since dismissed"
 *   fingerprint                             ClickUp task cards: due date and
 *                                           status when dismissed
 */

import { sql } from "@/lib/users/db";
import { isSeverity, type Dismissal } from "./model";

const DDL = `
CREATE TABLE IF NOT EXISTS home_alert_dismissals (
  user_email          TEXT NOT NULL,
  alert_key           TEXT NOT NULL,
  dismissed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snooze_until        TIMESTAMPTZ NULL,
  value_at_dismiss    NUMERIC NULL,
  severity_at_dismiss TEXT NULL,
  fingerprint         TEXT NULL,
  PRIMARY KEY (user_email, alert_key)
);
`;

const globalForSchema = globalThis as unknown as { oeHomeAlertsSchema?: Promise<boolean> };

function ensure(): Promise<boolean> {
  if (!globalForSchema.oeHomeAlertsSchema) {
    globalForSchema.oeHomeAlertsSchema = sql(DDL)
      .then(() => true)
      .catch((error: unknown) => {
        const code = (error as { code?: string })?.code;
        // Two lambdas racing on CREATE ... IF NOT EXISTS: the loser sees a
        // duplicate-object error, which is the race resolving correctly.
        if (code === "23505" || code === "42P07" || code === "42710") return true;
        console.error("[home] could not create home_alert_dismissals", error);
        globalForSchema.oeHomeAlertsSchema = undefined;
        return false;
      });
  }
  return globalForSchema.oeHomeAlertsSchema;
}

const dec = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null;

const COLUMNS = `user_email, alert_key, dismissed_at, snooze_until, value_at_dismiss, severity_at_dismiss, fingerprint`;

function toDismissal(r: Record<string, unknown>): Dismissal {
  return {
    alertKey: String(r.alert_key),
    userEmail: String(r.user_email),
    dismissedAt: iso(r.dismissed_at) ?? "",
    snoozeUntil: iso(r.snooze_until),
    valueAtDismiss: dec(r.value_at_dismiss),
    severityAtDismiss: isSeverity(r.severity_at_dismiss) ? r.severity_at_dismiss : null,
    fingerprint: r.fingerprint === null || r.fingerprint === undefined ? null : String(r.fingerprint),
  };
}

/** Every dismissal of every person. Throws when Postgres cannot be read; the caller decides. */
export async function listDismissals(): Promise<Dismissal[]> {
  if (!(await ensure())) throw new Error("home_alert_dismissals is unavailable.");
  const rows = await sql(`SELECT ${COLUMNS} FROM home_alert_dismissals`);
  return rows.map(toDismissal);
}

export async function saveDismissal(input: {
  userEmail: string;
  alertKey: string;
  snoozeDays: number | null;
  value: number | null;
  severity: string | null;
  fingerprint: string | null;
}): Promise<Dismissal> {
  if (!(await ensure())) throw new Error("home_alert_dismissals is unavailable.");
  const rows = await sql(
    `INSERT INTO home_alert_dismissals
       (user_email, alert_key, dismissed_at, snooze_until, value_at_dismiss, severity_at_dismiss, fingerprint)
     VALUES ($1, $2, NOW(),
             CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $3::int) END,
             $4, $5, $6)
     ON CONFLICT (user_email, alert_key) DO UPDATE SET
       dismissed_at = EXCLUDED.dismissed_at,
       snooze_until = EXCLUDED.snooze_until,
       value_at_dismiss = EXCLUDED.value_at_dismiss,
       severity_at_dismiss = EXCLUDED.severity_at_dismiss,
       fingerprint = EXCLUDED.fingerprint
     RETURNING ${COLUMNS}`,
    [input.userEmail, input.alertKey, input.snoozeDays, input.value, input.severity, input.fingerprint]
  );
  return toDismissal(rows[0]);
}

export async function deleteDismissal(userEmail: string, alertKey: string): Promise<void> {
  if (!(await ensure())) throw new Error("home_alert_dismissals is unavailable.");
  await sql(`DELETE FROM home_alert_dismissals WHERE user_email = $1 AND alert_key = $2`, [userEmail, alertKey]);
}
