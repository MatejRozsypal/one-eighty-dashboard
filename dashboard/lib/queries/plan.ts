/**
 * Plan page queries.
 *
 * ── Read, never recompute ───────────────────────────────────────────────────
 * The warehouse materialises the plan: the daily target curve, and one pacing
 * row per client x period x metric (day, ISO week, month, quarter, promo
 * window, checkpoint) with target, target to date, actual, pace, gap,
 * projection with its 80% cone, required daily rate and status. The page
 * filters those rows; it does not redo the arithmetic, so a month here and the
 * same month in a weekly review are the same number.
 *
 * Revenue on this page is the plan's own definition (goods ex VAT, after
 * discounts and refunds, without shipping), because targets are set in it.
 * It is therefore slightly below Snapshot revenue, which includes shipping.
 *
 * Every read is one small table scan per client (a few hundred rows). The
 * promo attribution totals are a heavier view and are only read by the
 * Quarter and Promo views.
 *
 * Missing is not zero: an absent actual stays null and renders "n/a".
 *
 * A metric a period has no target for still shows its actual: the daily store
 * actuals are read too, and `completeRows` fills in a target-less row for it.
 *
 * CM3 and aMER are the mart definitions (the Snapshot numbers): CM3 = revenue
 * - COGS - fulfilment - paid spend, aMER = new customer revenue / paid spend.
 * Their columns arrive with the CM3 and aMER warehouse release; until it is
 * deployed the reads fall back to the earlier column set and both metrics
 * read n/a, so this page can ship before or after it.
 */

import { query } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoPlanData } from "@/lib/demo/plan";
import { isMissingObject, optional } from "@/lib/queries/errors";
import { PLAN_TABLES } from "@/lib/plan/tables";
import { completeRows } from "@/lib/plan/model";
import type {
  ActualDay,
  CurveDay,
  PacingRow,
  RowStatus,
  PeriodType,
  PlanData,
  RowMetric,
  PlanTask,
  PromoPerf,
} from "@/lib/plan/types";

type Raw = Record<string, unknown>;

const STATUSES: readonly RowStatus[] = ["ahead", "on_track", "behind", "off_track", "not_started", "closed", "no_target", "not_measured"];

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function date(v: unknown): string {
  return isoDate(v as Parameters<typeof isoDate>[0]) ?? "";
}

function dateOrNull(v: unknown): string | null {
  return isoDate(v as Parameters<typeof isoDate>[0]);
}

function int(v: unknown): number {
  return num(v) ?? 0;
}

/** BigQuery's answer to a column the deployed table does not have yet. */
function isMissingColumn(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "");
  return /unrecognized name/i.test(message);
}

/** Runs the read with the CM3 / aMER columns, else without them (older warehouse). */
async function withFallback<T>(full: () => Promise<T>, base: () => Promise<T>): Promise<T> {
  try {
    return await full();
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    console.warn(`[plan] CM3 / aMER columns not deployed yet: ${(error as Error)?.message ?? error}`);
    return base();
  }
}

function toPacingRow(r: Raw): PacingRow {
  const raw = String(r.status) as RowStatus;
  const result = str(r.result);
  const target = num(r.target_total);
  // An actual-only row (a metric the period has no target for) has no status to show;
  // a targeted row the data cannot measure (CM3 without cost data) has none either.
  const status: RowStatus =
    target === null && raw !== "not_started"
      ? "no_target"
      : r.is_measured === false && raw !== "not_started" && raw !== "closed"
        ? "not_measured"
        : STATUSES.includes(raw)
          ? raw
          : "on_track";
  return {
    periodType: String(r.period_type) as PeriodType,
    periodId: String(r.period_id),
    label: String(r.period_label ?? r.period_id),
    metric: String(r.metric) as RowMetric,
    taskId: str(r.task_id),
    planStatus: str(r.plan_status),
    asOf: date(r.as_of),
    start: date(r.period_start),
    end: date(r.period_end),
    daysTotal: int(r.days_total),
    daysElapsed: int(r.days_elapsed),
    daysRemaining: int(r.days_remaining),
    isTargetPartial: r.is_target_partial === true,
    target,
    targetToDate: num(r.target_to_date),
    actual: num(r.actual_to_date),
    pacePct: num(r.pace_pct),
    gap: num(r.gap_abs),
    projected: num(r.projected_end),
    projectedLow: num(r.projected_low),
    projectedHigh: num(r.projected_high),
    requiredDaily: num(r.required_daily_rate),
    requiredCurveMult: num(r.required_curve_mult),
    status,
    isTooEarly: r.is_too_early === true,
    result: result === "met" || result === "missed" ? result : null,
    isPreliminary: r.is_preliminary === true,
    merCapPct: num(r.mer_cap_pct),
    merPlanPct: num(r.mer_plan_pct),
    merActualPct: num(r.mer_actual_pct),
    baselineTotal: num(r.baseline_total),
    baselineToDate: num(r.baseline_to_date),
    liftPct: num(r.lift_vs_baseline_pct),
    ratioNumActual: num(r.ratio_num_actual),
    ratioDenActual: num(r.ratio_den_actual),
    ratioNumTargetToDate: num(r.ratio_num_target_to_date),
    ratioDenTargetToDate: num(r.ratio_den_target_to_date),
    ratioNumTarget: num(r.ratio_num_target),
    ratioDenTarget: num(r.ratio_den_target),
    trailing7dRatio: num(r.trailing_7d_ratio),
    requiredRatio: num(r.required_ratio),
    measureStart: dateOrNull(r.measure_start) ?? date(r.period_start),
    measureEnd: dateOrNull(r.measure_end) ?? date(r.period_end),
    minSpend: num(r.min_spend),
    conditionMet: typeof r.condition_met === "boolean" ? r.condition_met : null,
    isMeasured: r.is_measured !== false,
  };
}

const PACING_COLUMNS = `period_type, period_id, period_label, metric, task_id, plan_status, as_of,
            period_start, period_end, days_total, days_elapsed, days_remaining,
            is_target_partial, target_total, target_to_date, actual_to_date, pace_pct,
            gap_abs, projected_end, projected_low, projected_high, required_daily_rate,
            required_curve_mult, status, is_too_early, result, is_preliminary,
            mer_cap_pct, mer_plan_pct, mer_actual_pct,
            baseline_total, baseline_to_date, lift_vs_baseline_pct`;

const RATIO_COLUMNS = `ratio_num_actual, ratio_den_actual, ratio_num_target_to_date,
            ratio_den_target_to_date, ratio_num_target, ratio_den_target, trailing_7d_ratio,
            required_ratio, measure_start, measure_end, min_spend, condition_met, is_measured`;

async function fetchPacing(clientId: string): Promise<PacingRow[]> {
  const read = (columns: string) =>
    query<Raw>(
      `SELECT ${columns}
       FROM ${PLAN_TABLES.pacing}
       WHERE client_id = @clientId`,
      { clientId }
    );
  const rows = await withFallback(
    () => read(`${PACING_COLUMNS}, ${RATIO_COLUMNS}`),
    () => read(PACING_COLUMNS)
  );
  return rows.map(toPacingRow);
}

async function fetchCurve(clientId: string): Promise<CurveDay[]> {
  const rows = await query<Raw>(
    `SELECT date, promo_task_id, is_payday
     FROM ${PLAN_TABLES.targetsDaily}
     WHERE client_id = @clientId AND metric = 'orders'
     ORDER BY date`,
    { clientId }
  );
  return rows.map((r) => ({
    date: date(r.date),
    promoTaskId: str(r.promo_task_id),
    isPayday: r.is_payday === true,
  }));
}

async function fetchTasks(clientId: string): Promise<PlanTask[]> {
  const rows = await query<Raw>(
    `SELECT task_id, level, name, start_date, end_date, status,
            target_revenue, target_orders, target_units, mechanic,
            COALESCE(TRIM(coupon_codes), '') != '' OR COALESCE(TRIM(skus), '') != ''
              OR COALESCE(TRIM(utm_campaign), '') != '' AS has_keys
     FROM ${PLAN_TABLES.planInput}
     WHERE client_id = @clientId AND (is_valid OR status = 'planning')`,
    { clientId }
  );
  return rows.map((r) => ({
    taskId: String(r.task_id),
    level: String(r.level),
    name: String(r.name ?? ""),
    start: dateOrNull(r.start_date),
    end: dateOrNull(r.end_date),
    status: str(r.status),
    targetRevenue: num(r.target_revenue),
    targetOrders: num(r.target_orders),
    targetUnits: num(r.target_units),
    mechanic: str(r.mechanic),
    hasKeys: r.has_keys === true,
  }));
}

async function fetchActuals(clientId: string): Promise<ActualDay[]> {
  const read = (columns: string) =>
    query<Raw>(
      `SELECT ${columns}
       FROM ${PLAN_TABLES.actualsDaily}
       WHERE client_id = @clientId AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 800 DAY)
       ORDER BY date`,
      { clientId }
    );
  const base = "date, orders, revenue, new_customers, meta_spend";
  const rows = await withFallback(
    () => read(`${base}, cm3, new_customer_revenue, paid_spend`),
    () => read(base)
  );
  return rows.map((r) => {
    const paid = num(r.paid_spend);
    const ncr = num(r.new_customer_revenue);
    return {
      date: date(r.date),
      orders: num(r.orders),
      revenue: num(r.revenue),
      new_customers: num(r.new_customers),
      ad_spend: num(r.meta_spend),
      // Absent before the CM3 / aMER release: null, so both read n/a.
      cm3: num(r.cm3),
      amer: paid !== null && paid > 0 ? (ncr ?? 0) / paid : null,
      new_customer_revenue: ncr,
      paid_spend: paid,
    };
  });
}

async function fetchPromoPerf(clientId: string): Promise<PromoPerf[]> {
  const rows = await query<Raw>(
    `SELECT task_id, phase, mechanic, window_start, window_end, is_complete,
            attr_orders, attr_revenue, attr_units, store_orders, store_revenue, meta_spend,
            store_mer_pct, mer_cap_pct
     FROM ${PLAN_TABLES.promoPerf}
     WHERE client_id = @clientId AND grain = 'total' AND source = 'clickup'`,
    { clientId }
  );
  return rows.map((r) => ({
    taskId: String(r.task_id),
    phase: str(r.phase),
    mechanic: str(r.mechanic),
    windowStart: date(r.window_start),
    windowEnd: date(r.window_end),
    isComplete: r.is_complete === true,
    attrOrders: num(r.attr_orders),
    attrRevenue: num(r.attr_revenue),
    attrUnits: num(r.attr_units),
    storeOrders: num(r.store_orders),
    storeRevenue: num(r.store_revenue),
    metaSpend: num(r.meta_spend),
    storeMerPct: num(r.store_mer_pct),
    merCapPct: num(r.mer_cap_pct),
  }));
}

/**
 * Attribution is a supporting panel: when it cannot be read the page shows
 * n/a for the attributed figures rather than failing. A missing object is
 * always tolerated; a permission error only when the page is pointed at the
 * QA copies by override, never against the deployed objects, where it is a
 * misconfiguration and must surface.
 */
async function promoPerfOrNull(clientId: string): Promise<PromoPerf[] | null> {
  try {
    return await fetchPromoPerf(clientId);
  } catch (error) {
    if (isMissingObject(error) || PLAN_TABLES.source === "mart_qa") {
      console.warn(`[plan] promo attribution unavailable: ${(error as Error)?.message ?? error}`);
      return null;
    }
    throw error;
  }
}

/**
 * All plan data for one client. `withPromoPerf` adds the attribution totals
 * (Quarter and Promo views only).
 */
export async function getPlanData(
  clientId: string,
  { withPromoPerf = false }: { withPromoPerf?: boolean } = {}
): Promise<PlanData> {
  if (isDemo(clientId)) {
    const demo = demoPlanData();
    return completeRows(withPromoPerf ? demo : { ...demo, promoPerf: null });
  }

  const [rows, curve, tasks, promoPerf, actuals] = await Promise.all([
    optional(() => fetchPacing(clientId), [] as PacingRow[]),
    optional(() => fetchCurve(clientId), [] as CurveDay[]),
    optional(() => fetchTasks(clientId), [] as PlanTask[]),
    withPromoPerf ? promoPerfOrNull(clientId) : Promise.resolve(null),
    optional(() => fetchActuals(clientId), [] as ActualDay[]),
  ]);

  return completeRows({ rows, curve, tasks, promoPerf, actuals });
}
