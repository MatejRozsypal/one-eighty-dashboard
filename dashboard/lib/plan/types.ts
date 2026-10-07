/**
 * Plan page data model. Pure types, safe in client components.
 *
 * The warehouse does every pacing calculation (target curve, pace, projection,
 * cone, status). These types carry its rows as they are; the page only picks a
 * period and lays the numbers out, so every view reads the same arithmetic.
 */

/** Display order, and the order the charts pick their default metric in. */
export const PLAN_METRICS = ["revenue", "orders", "new_customers", "ad_spend", "cm3", "amer"] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];

/**
 * aMER is a ratio (new customer revenue / paid spend): never summed, never
 * averaged per day. Every period carries its numerator and denominator, and
 * any cumulative or trailing figure is a ratio of sums.
 */
export const RATIO_METRICS: ReadonlySet<PlanMetric> = new Set(["amer"]);

export function isRatioMetric(metric: string): boolean {
  return RATIO_METRICS.has(metric as PlanMetric);
}

/**
 * Every metric a pacing row can carry. `units` is set only where a task has a
 * Target units (checkpoints such as calendars sold, unit-led promos); it is
 * not one of the store metrics the tiles and charts cycle through.
 */
export type RowMetric = PlanMetric | "units";

export type PeriodType = "day" | "week" | "month" | "quarter" | "promo" | "gate";

export type PacingStatus = "ahead" | "on_track" | "behind" | "off_track" | "not_started" | "closed";

/**
 * Status of a row the page itself filled in for a metric the period has no
 * target for, or of a targeted row the data cannot measure (CM3 without cost
 * data, aMER with missing spend days).
 */
export type RowStatus = PacingStatus | "no_target" | "not_measured";

/** One row of the pacing table: client x period x metric. */
export interface PacingRow {
  periodType: PeriodType;
  periodId: string;
  label: string;
  metric: RowMetric;
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
  status: RowStatus;
  isTooEarly: boolean;
  result: "met" | "missed" | null;
  isPreliminary: boolean;
  merCapPct: number | null;
  merPlanPct: number | null;
  merActualPct: number | null;
  /**
   * aMER parts (null on every other metric): actual and plan numerator (new
   * customer revenue) and denominator (paid spend), to date and in total.
   */
  ratioNumActual: number | null;
  ratioDenActual: number | null;
  ratioNumTargetToDate: number | null;
  ratioDenTargetToDate: number | null;
  ratioNumTarget: number | null;
  ratioDenTarget: number | null;
  /** aMER over the 7 days ending as of, while the period runs. */
  trailing7dRatio: number | null;
  /** aMER needed on the spend still to come to end on target. */
  requiredRatio: number | null;
  /** The window the row is measured over (a checkpoint's aMER can look back N days from its check day). */
  measureStart: string;
  measureEnd: string;
  /** Checkpoint aMER: paid spend the window must reach for the floor to count. */
  minSpend: number | null;
  /** Checkpoint rows: this row's own condition holds on the data so far. */
  conditionMet: boolean | null;
  /** False when the data cannot measure the row (no cost data for CM3, missing spend for aMER). */
  isMeasured: boolean;
}

/** Which promo window set the curve on a day (shortest window wins). */
export interface CurveDay {
  date: string;
  promoTaskId: string | null;
  isPayday: boolean;
}

/**
 * One promo's totals from the attribution layer, over the window days up to
 * the client's as of (the same days the store figures beside them cover).
 *
 * `isStorewide` is the one flag that changes how the rest reads: the promo had
 * nothing to match on beyond the window, or ran store wide, so its attributed
 * orders ARE every order in the window.
 */
export interface PromoPerf {
  taskId: string;
  phase: string | null;
  mechanic: string | null;
  windowStart: string;
  windowEnd: string;
  isComplete: boolean;
  /** Every order in the window counts, so "attributed" means the whole store. */
  isStorewide: boolean;
  /** The platform exposes discount codes at all (WooCommerce yes, Shoptet no). */
  hasCouponData: boolean;
  daysElapsed: number | null;
  windowDays: number | null;
  attrOrders: number | null;
  attrRevenue: number | null;
  attrUnits: number | null;
  attrGiftUnits: number | null;
  attrNewCustomers: number | null;
  attrReturningCustomers: number | null;
  attrCodeOrders: number | null;
  attrNoCodeOrders: number | null;
  attrDiscountedOrders: number | null;
  attrDiscountGiven: number | null;
  /** COGS of the attributed orders, and how many of them carry a cost at all. */
  attrCogs: number | null;
  attrOrdersCosted: number | null;
  /** Attributed revenue minus COGS; null unless every attributed order is costed. */
  attrCm1: number | null;
  attrCm1Pct: number | null;
  /** Spend of the Meta campaigns the task names; null when none are named. */
  attrMetaSpend: number | null;
  attrCm3: number | null;
  /** How the attributed orders matched. */
  matchCoupon: number | null;
  matchSku: number | null;
  matchGiftSku: number | null;
  matchUtm: number | null;
  matchWindow: number | null;
  storeOrders: number | null;
  storeRevenue: number | null;
  storeNewCustomers: number | null;
  storeUnits: number | null;
  /** The mart CM3 of the whole store over the window; null without cost data. */
  storeCm3: number | null;
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
  targetUnits: number | null;
  mechanic: string | null;
  /** True when the task names at least one matching key (coupon code, SKU or UTM campaign). */
  hasKeys: boolean;
}

/**
 * Store actuals of one day, the plan revenue definition. CM3, new customer
 * revenue and paid spend are the mart definitions (same as Snapshot); `cm3`
 * is null on a day without cost data, `paid_spend` null when spend is missing.
 * `amer` is that day's own ratio, for display only: never sum it.
 */
export interface ActualDay {
  date: string;
  orders: number | null;
  revenue: number | null;
  new_customers: number | null;
  ad_spend: number | null;
  cm3: number | null;
  amer: number | null;
  new_customer_revenue: number | null;
  paid_spend: number | null;
}

/** Everything the page needs for one client. */
export interface PlanData {
  rows: PacingRow[];
  curve: CurveDay[];
  /** Null when the attribution layer could not be read. */
  promoPerf: PromoPerf[] | null;
  tasks: PlanTask[];
  /** Daily store actuals, the fallback for metrics a period has no target for. */
  actuals: ActualDay[];
}

export type PlanView = "month" | "quarter" | "promo" | "target";
export const PLAN_VIEWS: readonly PlanView[] = ["month", "quarter", "promo", "target"];
