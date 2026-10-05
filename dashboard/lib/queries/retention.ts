/**
 * Repeat rate page queries: two reads, both small.
 *
 *   cohorts   the cohort view: one row per first-order month, entry class and
 *             early flag, with the summable horizon counts. Everything on the
 *             page except the curve is computed from these in `lib/retention`.
 *   curve     one row per group, event, entry class and day: how many
 *             customers had the event that day and how many were last observed
 *             that day. Kaplan-Meier needs the days, so this cannot be a count.
 *
 * `is_early` is a BOOL column, not 0/1: the filters here say NOT is_early.
 * Customers whose first order is after the cut-off (observed days below 0) are
 * left out of the curve; an event after the cut-off counts as "not yet", i.e.
 * the customer is censored on their last observed day.
 *
 * The demo client is served from `lib/demo/retention`, never from the warehouse.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoRetention } from "@/lib/demo/retention";
import { HORIZONS, primaryHorizon, type ByHorizon, type CohortRow, type KmRow, type RetentionData, type RetentionMeta } from "@/lib/retention/model";

export const COHORT_SQL = `SELECT
     cohort_month, entry_class, is_early, classes_configured, n_customer,
     m30, m60, m90, m180, m365,
     r30, r60, r90, r180, r365,
     u30, u60, u90, u180, u365,
     m23_180, r23_180,
     cutoff_date, data_start_date, history_guard_days
   FROM \`${PROJECT_ID}.mart.mart_retention_cohorts\`
   WHERE client_id = @clientId
   ORDER BY cohort_month`;

/** Day 366 stands for "later than the last day shown". */
export const CURVE_SQL = `WITH base AS (
     SELECT entry_class, classes_configured, observed_days, days_to_2nd, days_to_full,
       CASE WHEN first_order_date > DATE_SUB(cutoff_date, INTERVAL 182 DAY) THEN 'recent'
            WHEN first_order_date > DATE_SUB(cutoff_date, INTERVAL 547 DAY) THEN 'older' END AS grp
     FROM \`${PROJECT_ID}.mart.rpt_customer_entry\`
     WHERE client_id = @clientId AND NOT is_early AND observed_days >= 0
   ), per_event AS (
     SELECT entry_class, grp, 'repeat' AS kind, observed_days AS obs, days_to_2nd AS day_of_event
     FROM base WHERE grp IS NOT NULL
     UNION ALL
     SELECT entry_class, grp, 'full', observed_days, days_to_full
     FROM base WHERE grp IS NOT NULL AND classes_configured
   )
   SELECT entry_class, grp, kind,
     LEAST(IF(day_of_event IS NOT NULL AND day_of_event <= obs, day_of_event, obs), 366) AS t,
     COUNTIF(day_of_event IS NOT NULL AND day_of_event <= obs) AS events,
     COUNTIF(NOT (day_of_event IS NOT NULL AND day_of_event <= obs)) AS censored
   FROM per_event
   GROUP BY entry_class, grp, kind, t
   ORDER BY entry_class, grp, kind, t`;

const SETTINGS_SQL = `SELECT primary_horizon_days FROM \`${PROJECT_ID}.ref.retention_settings\` WHERE client_id = @clientId`;

function byHorizon(raw: Record<string, unknown>, prefix: "m" | "r" | "u"): ByHorizon {
  const out = {} as ByHorizon;
  for (const h of HORIZONS) out[h] = num(raw[`${prefix}${h}`]) ?? 0;
  return out;
}

/** Warehouse rows of the cohort view as typed model rows. */
export function parseCohortRows(raw: ReadonlyArray<Record<string, unknown>>): { rows: CohortRow[]; meta: RetentionMeta | null } {
  if (raw.length === 0) return { rows: [], meta: null };
  const rows = raw.map<CohortRow>((r) => ({
    month: isoDate(r.cohort_month as never) ?? "",
    entry: typeof r.entry_class === "string" ? r.entry_class : null,
    early: r.is_early === true,
    n: num(r.n_customer) ?? 0,
    m: byHorizon(r, "m"),
    r: byHorizon(r, "r"),
    u: byHorizon(r, "u"),
    m23: num(r.m23_180) ?? 0,
    r23: num(r.r23_180) ?? 0,
  }));
  const first = raw[0];
  const meta: RetentionMeta = {
    cutoff: isoDate(first.cutoff_date as never) ?? "",
    dataStart: isoDate(first.data_start_date as never),
    guardDays: num(first.history_guard_days) ?? 0,
    classes: raw.some((r) => r.classes_configured === true),
  };
  return { rows, meta };
}

/** Warehouse rows of the curve query as typed model rows. */
export function parseCurveRows(raw: ReadonlyArray<Record<string, unknown>>): KmRow[] {
  return raw.map<KmRow>((r) => ({
    entry: typeof r.entry_class === "string" ? r.entry_class : null,
    group: r.grp === "older" ? "older" : "recent",
    event: r.kind === "full" ? "full" : "repeat",
    t: num(r.t) ?? 0,
    events: num(r.events) ?? 0,
    censored: num(r.censored) ?? 0,
  }));
}

/** Null when the client has no customers in the table yet. */
export async function getRetention(clientId: string): Promise<RetentionData | null> {
  if (isDemo(clientId)) return demoRetention();

  const [cohortRaw, curveRaw, settingsRaw] = await Promise.all([
    query<Record<string, unknown>>(COHORT_SQL, { clientId }),
    query<Record<string, unknown>>(CURVE_SQL, { clientId }),
    // The headline horizon is a stated setting with a default, so a settings
    // table that cannot be read leaves the default (90) rather than the page.
    query<Record<string, unknown>>(SETTINGS_SQL, { clientId }).catch(() => []),
  ]);

  const { rows, meta } = parseCohortRows(cohortRaw);
  if (!meta || rows.length === 0) return null;
  return {
    meta,
    rows,
    km: parseCurveRows(curveRaw),
    primaryHorizon: primaryHorizon(num(settingsRaw[0]?.primary_horizon_days)),
  };
}
