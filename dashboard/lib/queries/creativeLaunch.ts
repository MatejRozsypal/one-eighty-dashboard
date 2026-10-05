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
 * The trailing 12 launch months (for the trend), the trailing 365 days (for
 * the reference rate) and the page range (for the tile) come back together and
 * are split in TypeScript. `r.*` is deliberate: the ad set columns arrive with
 * a later release of the table, and a missing one must read as "not ready" for
 * the launch context, not fail the whole hit rate. The query always
 * returns the client's `through` and row count, even when no ad matches, which
 * is how "not built for this client" is told apart from "no launches".
 *
 * Purchases, revenue and the prior are the 7-day click + 1-day view columns of
 * the table (ME5); `launchFrom` maps them onto the row the winner test reads.
 *
 * Thresholds are not read here and never reach SQL: the caller evaluates the
 * rows with `lib/creative/hitRate.ts`.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { noEmDash } from "@/lib/creative/display";
import { HIT_RATE_REFERENCE_DAYS, type LaunchRow } from "@/lib/creative/hitRate";
import type { DateRange } from "@/lib/period";

export type LaunchData =
  | {
      state: "ready";
      rows: LaunchRow[];
      /** Latest day the table has loaded for this client. */
      through: string;
      /** When the table was last built (`YYYY-MM-DDTHH:MM:SSZ`), or null when it carries no timestamp. */
      refreshedAt?: string | null;
    }
  | { state: "not-ready" };

export const NOT_READY: LaunchData = { state: "not-ready" };

const n0 = (v: unknown): number => num(v) ?? 0;

function str(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : noEmDash(String(v));
}

/**
 * Map one result row to a launch. Exported for the live harness.
 *
 * The ad set columns (`adset_id`, `adset_first_date`, `is_new_adset`) belong to
 * a later release of the table. A result row without the key maps to
 * `undefined`, which the launch context reads as "not ready"; a key holding
 * NULL maps to `null`, "unknown for this ad".
 */
export function launchFrom(r: Record<string, unknown>): LaunchRow {
  return {
    adId: String(r.ad_id),
    adName: noEmDash(String(r.ad_name ?? r.ad_id)),
    firstDate: String(isoDate(r.first_date as never)),
    ageDays: n0(r.age_days),
    spend: n0(r.spend),
    // 7-day click + 1-day view (ME5), the winner test's basis. A table without
    // the columns (older release, test stubs) reads its stored columns. A table
    // WITH them and a NULL (split incomplete for the ad) reads 0 and no prior,
    // so the ad is never a winner: the same rule the Reports compiler applies.
    revenue: n0("revenue_7dc_1dv" in r ? r.revenue_7dc_1dv : r.revenue),
    purchases: n0("purchases_7dc_1dv" in r ? r.purchases_7dc_1dv : r.purchases),
    isVideo: r.is_video === true,
    isRelaunch: r.is_relaunch === true,
    isPreexisting: r.is_preexisting === true,
    conceptId: str(r.concept_id),
    conceptName: str(r.concept_name),
    priorRoas: num("prior_roas_7dc_1dv" in r ? r.prior_roas_7dc_1dv : r.prior_roas),
    adsetId: "adset_id" in r ? str(r.adset_id) : undefined,
    adsetFirstDate:
      "adset_first_date" in r
        ? r.adset_first_date === null || r.adset_first_date === undefined
          ? null
          : String(isoDate(r.adset_first_date as never))
        : undefined,
    isNewAdset:
      "is_new_adset" in r ? (r.is_new_adset === true ? true : r.is_new_adset === false ? false : null) : undefined,
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
  m AS (
    SELECT MAX(through) AS through,
           FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(refreshed_at)) AS refreshed_at,
           COUNT(*) AS table_rows
    FROM c
  )
  SELECT
    m.through AS table_through, m.refreshed_at AS table_refreshed_at, m.table_rows,
    r.*
  FROM m
  LEFT JOIN c r
    ON NOT r.is_preexisting
   AND r.first_date >= LEAST(
         DATE(@from),
         DATE_SUB(DATE_TRUNC(m.through, MONTH), INTERVAL 11 MONTH),
         DATE_SUB(m.through, INTERVAL ${HIT_RATE_REFERENCE_DAYS - 1} DAY))
   AND r.first_date <= GREATEST(DATE(@to), m.through)
  ORDER BY r.first_date, r.ad_id`;

/**
 * Ads first delivered from the earliest of the page range's start, the
 * trend's start and the reference window's start (365 days to `through`), up
 * to the latest loaded day.
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
    if (!head || n0(head.table_rows) === 0 || !head.table_through) return NOT_READY;
    return {
      state: "ready",
      rows: rows.filter((r) => r.ad_id !== null && r.ad_id !== undefined).map(launchFrom),
      through: String(isoDate(head.table_through as never)),
      refreshedAt: head.table_refreshed_at ? String(head.table_refreshed_at) : null,
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return NOT_READY;
  }
}

// ---------------------------------------------------------------------------
// The anchor and the ages: what every other Creative screen judges against
// ---------------------------------------------------------------------------

/**
 * What the grid, scorecard, Concepts, Breakdown and Production need from the
 * launch table so they judge a winner exactly as the hit rate does: the
 * client's trailing 365-day ROAS (the shrinkage anchor) and each ad's age in
 * days since first delivery (the 14-day winner rule). Includes pre-existing
 * ads and relaunches: they are on the wall too.
 */
export interface LaunchAnchor {
  /** Null when the table holds no spend to compute it from. */
  priorRoas: number | null;
  through: string;
  refreshedAt: string | null;
  /** Days since first delivery, by ad id, as of `through`. */
  ageByAd: Map<string, number>;
}

export const ANCHOR_SQL = `
  SELECT ad_id, age_days, prior_roas_7dc_1dv AS prior_roas, through,
         FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', refreshed_at) AS refreshed_at
  FROM \`${PROJECT_ID}.mart.rpt_ad_launch\`
  WHERE client_id = @clientId`;

/** Null when the table is not ready for this client: callers then keep the window mean and apply no age rule. */
export async function getLaunchAnchor(clientId: string): Promise<LaunchAnchor | null> {
  if (isDemo(clientId)) {
    const { demoLaunches } = await import("@/lib/demo/creative");
    const demo = demoLaunches();
    if (demo.state !== "ready") return null;
    return {
      priorRoas: demo.rows.find((r) => r.priorRoas !== null)?.priorRoas ?? null,
      through: demo.through,
      refreshedAt: null,
      ageByAd: new Map(demo.rows.map((r) => [r.adId, r.ageDays])),
    };
  }
  try {
    const rows = await query<Record<string, unknown>>(ANCHOR_SQL, { clientId });
    if (rows.length === 0) return null;
    const head = rows[0];
    return {
      priorRoas: num(head.prior_roas),
      through: String(isoDate(head.through as never)),
      refreshedAt: head.refreshed_at ? String(head.refreshed_at) : null,
      ageByAd: new Map(rows.map((r) => [String(r.ad_id), n0(r.age_days)])),
    };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}
