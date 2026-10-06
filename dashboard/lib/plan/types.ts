/**
 * Plan page data model. Pure types, safe in client components.
 *
 * The warehouse does every pacing calculation (target curve, pace, projection,
 * cone, status). These types carry its rows as they are; the page only picks a
 * period and lays the numbers out, so every view reads the same arithmetic.
 */

export const PLAN_METRICS = ["orders", "revenue", "new_customers", "ad_spend"] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];

export type PeriodType = "day" | "week" | "month" | "quarter" | "promo" | "gate";

export type PacingStatus = "ahead" | "on_track" | "behind" | "off_track" | "not_started" | "closed";

/** One row of the pacing table: client x period x metric. */
export interface PacingRow {
  periodType: PeriodType;
  periodId: string;
  label: string;
  metric: PlanMetric;
  taskId: string | null;
  planStatus: string | null;
  asOf: string;
  start: string;
  end: string;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  isTargetPartial: boolean;
  target: number | null;
  targetToDate: number | null;
  actual: number | null;
  pacePct: number | null;
  gap: number | null;
  projected: number | null;
  projectedLow: number | null;
  projectedHigh: number | null;
  requiredDaily: number | null;
  requiredCurveMult: number | null;
  status: PacingStatus;
  isTooEarly: boolean;
  result: "met" | "missed" | null;
  isPreliminary: boolean;
  merCapPct: number | null;
  merPlanPct: number | null;
  merActualPct: number | null;
}

/** Which promo window set the curve on a day (shortest window wins). */
export interface CurveDay {
  date: string;
  promoTaskId: string | null;
  isPayday: boolean;
}

/** One promo's totals from the attribution layer. */
export interface PromoPerf {
  taskId: string;
  phase: string | null;
  mechanic: string | null;
  windowStart: string;
  windowEnd: string;
  isComplete: boolean;
  attrOrders: number | null;
  attrRevenue: number | null;
  storeOrders: number | null;
  storeRevenue: number | null;
  metaSpend: number | null;
  storeMerPct: number | null;
  merCapPct: number | null;
}

/** A plan task as entered (only what the page needs: Target state and promo targets). */
export interface PlanTask {
  taskId: string;
  level: string;
  name: string;
  start: string | null;
  end: string | null;
  status: string | null;
  targetRevenue: number | null;
  targetOrders: number | null;
  mechanic: string | null;
}

/** Everything the page needs for one client. */
export interface PlanData {
  rows: PacingRow[];
  curve: CurveDay[];
  /** Null when the attribution layer could not be read. */
  promoPerf: PromoPerf[] | null;
  tasks: PlanTask[];
}

export type PlanView = "month" | "quarter" | "promo" | "target";
export const PLAN_VIEWS: readonly PlanView[] = ["month", "quarter", "promo", "target"];
