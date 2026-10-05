import "server-only";

/**
 * Warehouse read for the Creative hit rate: one row per ad from
 * `mart.rpt_ad_launch` (lifetime to date, with the first delivery date).
 *
 * ── A missing table is "not ready", never zero ─────────────────────────────
 * The table is built by a separate package and may not exist yet, or may not
 * hold this client yet. Both read as `state: "not-ready"`, so the UI renders
 * n/a with one line of explanation. A zero here would claim "no launches", and
 * on a client with 156 of them that is a false statement. Any other failure
 * (permission, timeout, quota) is re-thrown: a calm empty state for "I was not
 * allowed to look" is what `lib/queries/errors.ts` exists to prevent.
 *
 * ── One query, ~450 rows in the whole table ────────────────────────────────
 * The trailing 12 launch months (for the trend) and the page range (for the
 * tile) come back together and are split in TypeScript. The query always
 * returns the client's `through` and row count, even when no ad matches, which
 * is how "not built for this client" is told apart from "no launches".
 *
 * Thresholds are not read here and never reach SQL: the caller evaluates the
 * rows with `lib/creative/hitRate.ts`.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { noEmDash } from "@/lib/creative/display";
import type { LaunchRow } from "@/lib/creative/hitRate";
import type { DateRange } from "@/lib/period";

export type LaunchData =
  | {
      state: "ready";
      rows: LaunchRow[];
      /** Latest day the table has loaded for this client. */
      through: string;
    }
  | { state: "not-ready" };

export const NOT_READY: LaunchData = { state: "not-ready" };

const n0 = (v: unknown): number => num(v) ?? 0;

function str(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : noEmDash(String(v));
}

/** Map one result row to a launch. Exported for the live harness. */
export function launchFrom(r: Record<string, unknown>): LaunchRow {
  return {
    adId: String(r.ad_id),
    adName: noEmDash(String(r.ad_name ?? r.ad_id)),
    firstDate: String(isoDate(r.first_date as never)),
    ageDays: n0(r.age_days),
    spend: n0(r.spend),
    revenue: n0(r.revenue),
    purchases: n0(r.purchases),
    isVideo: r.is_video === true,
    isRelaunch: r.is_relaunch === true,
    isPreexisting: r.is_preexisting === true,
    conceptId: str(r.concept_id),
    conceptName: str(r.concept_name),
    priorRoas: num(r.prior_roas),
  };
}

/**
 * The SQL is exported so the live harness runs exactly what the page runs.
 * Dates are cast explicitly: a string parameter would otherwise be compared to
 * a DATE column by implicit coercion, which LEAST() does not do.
 */
export const LAUNCH_SQL = `
  WITH c AS (
    SELECT * FROM \`${PROJECT_ID}.mart.rpt_ad_launch\` WHERE client_id = @clientId
  ),
  m AS (SELECT MAX(through) AS through, COUNT(*) AS table_rows FROM c)
  SELECT
    m.through, m.table_rows,
    r.ad_id, r.ad_name, r.first_date, r.age_days, r.spend, r.revenue, r.purchases,
    r.is_video, r.is_relaunch, r.is_preexisting,
    r.concept_id, r.concept_name, r.prior_roas
  FROM m
  LEFT JOIN c r
    ON NOT r.is_preexisting
   AND r.first_date >= LEAST(DATE(@from), DATE_SUB(DATE_TRUNC(m.through, MONTH), INTERVAL 11 MONTH))
   AND r.first_date <= GREATEST(DATE(@to), m.through)
  ORDER BY r.first_date, r.ad_id`;

/**
 * Ads first delivered from the earlier of the page range's start and the
 * trend's start, up to the latest loaded day.
 */
export async function getLaunches(clientId: string, range: DateRange): Promise<LaunchData> {
  if (isDemo(clientId)) {
    const { demoLaunches } = await import("@/lib/demo/creative");
    return demoLaunches();
  }

  try {
    const rows = await query<Record<string, unknown>>(LAUNCH_SQL, {
      clientId,
      from: range.from,
      to: range.to,
    });
    const head = rows[0];
    if (!head || n0(head.table_rows) === 0 || !head.through) return NOT_READY;
    return {
      state: "ready",
      rows: rows.filter((r) => r.ad_id !== null && r.ad_id !== undefined).map(launchFrom),
      through: String(isoDate(head.through as never)),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return NOT_READY;
  }
}
