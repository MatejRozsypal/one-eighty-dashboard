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
 */

import { query } from "@/lib/bigquery";
import { isoDate, num } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoPlanData } from "@/lib/demo/plan";
import { isMissingObject, optional } from "@/lib/queries/errors";
import { PLAN_TABLES } from "@/lib/plan/tables";
import type {
  CurveDay,
  PacingRow,
  PacingStatus,
  PeriodType,
  PlanData,
  PlanMetric,
  PlanTask,
  PromoPerf,
} from "@/lib/plan/types";

type Raw = Record<string, unknown>;

const STATUSES: readonly PacingStatus[] = ["ahead", "on_track", "behind", "off_track", "not_started", "closed"];

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

function toPacingRow(r: Raw): PacingRow {
  const status = String(r.status) as PacingStatus;
  const result = str(r.result);
  return {
    periodType: String(r.period_type) as PeriodType,
    periodId: String(r.period_id),
    label: String(r.period_label ?? r.period_id),
    metric: String(r.metric) as PlanMetric,
    taskId: str(r.task_id),
    planStatus: str(r.plan_status),
    asOf: date(r.as_of),
    start: date(r.period_start),
    end: date(r.period_end),
    daysTotal: int(r.days_total),
    daysElapsed: int(r.days_elapsed),
    daysRemaining: int(r.days_remaining),
    isTargetPartial: r.is_target_partial === true,
    target: num(r.target_total),
    targetToDate: num(r.target_to_date),
    actual: num(r.actual_to_date),
    pacePct: num(r.pace_pct),
    gap: num(r.gap_abs),
    projected: num(r.projected_end),
    projectedLow: num(r.projected_low),
    projectedHigh: num(r.projected_high),
    requiredDaily: num(r.required_daily_rate),
    requiredCurveMult: num(r.required_curve_mult),
    status: STATUSES.includes(status) ? status : "on_track",
    isTooEarly: r.is_too_early === true,
    result: result === "met" || result === "missed" ? result : null,
    isPreliminary: r.is_preliminary === true,
    merCapPct: num(r.mer_cap_pct),
    merPlanPct: num(r.mer_plan_pct),
    merActualPct: num(r.mer_actual_pct),
  };
}

async function fetchPacing(clientId: string): Promise<PacingRow[]> {
  const rows = await query<Raw>(
    `SELECT period_type, period_id, period_label, metric, task_id, plan_status, as_of,
            period_start, period_end, days_total, days_elapsed, days_remaining,
            is_target_partial, target_total, target_to_date, actual_to_date, pace_pct,
            gap_abs, projected_end, projected_low, projected_high, required_daily_rate,
            required_curve_mult, status, is_too_early, result, is_preliminary,
            mer_cap_pct, mer_plan_pct, mer_actual_pct
     FROM ${PLAN_TABLES.pacing}
     WHERE client_id = @clientId`,
    { clientId }
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
            target_revenue, target_orders, mechanic
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
    mechanic: str(r.mechanic),
  }));
}

async function fetchPromoPerf(clientId: string): Promise<PromoPerf[]> {
  const rows = await query<Raw>(
    `SELECT task_id, phase, mechanic, window_start, window_end, is_complete,
            attr_orders, attr_revenue, store_orders, store_revenue, meta_spend,
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
    return withPromoPerf ? demo : { ...demo, promoPerf: null };
  }

  const [rows, curve, tasks, promoPerf] = await Promise.all([
    optional(() => fetchPacing(clientId), [] as PacingRow[]),
    optional(() => fetchCurve(clientId), [] as CurveDay[]),
    optional(() => fetchTasks(clientId), [] as PlanTask[]),
    withPromoPerf ? promoPerfOrNull(clientId) : Promise.resolve(null),
  ]);

  return { rows, curve, tasks, promoPerf };
}
