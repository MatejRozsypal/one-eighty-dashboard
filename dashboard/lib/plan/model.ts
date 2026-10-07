/**
 * Plan page view model: picks a period out of the pacing rows and shapes the
 * chart series, the breakdown rows and the quarter timeline. Pure, no I/O, so
 * the server page and the client charts share it and the demo goes through
 * exactly the same code as a real client.
 *
 * Nothing here recomputes pace, status or the projection: those come from the
 * warehouse row of the period. The only arithmetic is drawing them:
 *   - cumulative sums of the day rows (the curve target and the actual); for
 *     aMER, a ratio, the cumulative figure is a ratio of the summed parts;
 *   - the projection path from as of to the period end, which spreads the
 *     warehouse's projected end along the remaining curve;
 *   - the target trajectory (see `targetTrajectory`).
 */

import { addDays, daysBetween, fmtDay, fmtMonth, fmtMonthShort, fmtRange, monthStart, monthsBetween } from "./dates";
import {
  PLAN_METRICS,
  isRatioMetric,
  type ActualDay,
  type PacingRow,
  type PeriodType,
  type PlanData,
  type PlanMetric,
  type PlanTask,
  type RowMetric,
  type PlanView,
  type PromoPerf,
} from "./types";

export type MetricRows = Partial<Record<RowMetric, PacingRow>>;

export interface PeriodOption {
  id: string;
  label: string;
  start: string;
  end: string;
}

const VIEW_TYPE: Record<Exclude<PlanView, "target">, PeriodType> = {
  month: "month",
  quarter: "quarter",
  promo: "promo",
};

export const TARGET_STATE_LEVEL = "Target state";

/** The as of date of the data, or null when there are no rows. */
export function asOfOf(data: PlanData): string | null {
  return data.rows.find((r) => r.asOf)?.asOf ?? null;
}

/** Periods the picker offers for a view, in calendar order. */
export function periodOptions(data: PlanData, view: PlanView): PeriodOption[] {
  if (view === "target") {
    return data.tasks
      .filter((t) => t.level === TARGET_STATE_LEVEL && t.start && t.end)
      .sort((a, b) => (a.end ?? "").localeCompare(b.end ?? ""))
      .map((t) => ({ id: t.taskId, label: t.name, start: t.start!, end: t.end! }));
  }
  const type = VIEW_TYPE[view];
  const seen = new Map<string, PeriodOption>();
  for (const r of data.rows) {
    if (r.periodType !== type || seen.has(r.periodId)) continue;
    seen.set(r.periodId, { id: r.periodId, label: r.label, start: r.start, end: r.end });
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/**
 * The requested period when it exists, else the one running on `anchor`
 * (the shortest, so a promo inside a longer window wins), else the next one
 * to start, else the latest.
 */
export function selectPeriod(options: PeriodOption[], requested: string | undefined, anchor: string): PeriodOption | null {
  if (options.length === 0) return null;
  const hit = requested ? options.find((o) => o.id === requested) : undefined;
  if (hit) return hit;
  const running = options
    .filter((o) => o.start <= anchor && anchor <= o.end)
    .sort((a, b) => daysBetween(a.start, a.end) - daysBetween(b.start, b.end));
  if (running.length > 0) return running[0];
  const upcoming = options.find((o) => o.start > anchor);
  return upcoming ?? options[options.length - 1];
}

/** The four metric rows of one period. */
export function rowsOf(data: PlanData, type: PeriodType, id: string): MetricRows {
  const out: MetricRows = {};
  for (const r of data.rows) {
    if (r.periodType === type && r.periodId === id) out[r.metric] = r;
  }
  return out;
}

export function hasAnyRow(rows: MetricRows): boolean {
  return PLAN_METRICS.some((m) => rows[m] !== undefined);
}

/** The first metric of the period that has a target (display order), for the charts. */
export function defaultMetric(rows: MetricRows): PlanMetric {
  return PLAN_METRICS.find((m) => rows[m] && rows[m]!.target !== null && rows[m]!.status !== "no_target") ?? PLAN_METRICS[0];
}

// ── Untargeted metrics ───────────────────────────────────────────────────────

/** Store actuals by date. */
function actualIndex(actuals: ActualDay[]): Map<string, ActualDay> {
  return new Map(actuals.map((a) => [a.date, a]));
}

/**
 * Fills in a row for every metric a period has no pacing row for, so a tile
 * still shows what happened: the actual to date summed from the daily store
 * actuals, with target, pace, gap and projection left null and the status
 * `no_target`. A period that has not started keeps a null actual. Periods
 * that already carry a row for a metric (targeted, or an actual-only row from
 * the warehouse) are left as they are.
 */
export function completeRows(data: PlanData): PlanData {
  if (data.actuals.length === 0) return data;
  const asOf = asOfOf(data) ?? data.actuals[data.actuals.length - 1].date;
  const byDate = actualIndex(data.actuals);

  const periods = new Map<string, { template: PacingRow; metrics: Set<RowMetric> }>();
  for (const r of data.rows) {
    const key = `${r.periodType}|${r.periodId}`;
    const p = periods.get(key);
    if (p) p.metrics.add(r.metric);
    else periods.set(key, { template: r, metrics: new Set([r.metric]) });
  }

  const added: PacingRow[] = [];
  for (const { template: t, metrics } of periods.values()) {
    const missing = PLAN_METRICS.filter((m) => !metrics.has(m));
    if (missing.length === 0) continue;

    const started = t.start <= asOf;
    const to = t.end < asOf ? t.end : asOf;
    const sums: Record<PlanMetric, number | null> = {
      revenue: null,
      orders: null,
      new_customers: null,
      ad_spend: null,
      cm3: null,
      amer: null,
    };
    // CM3 is n/a when any day lacks cost data, aMER when any day lacks spend:
    // a partial sum would read as a real figure.
    let cm3Gap = false;
    let spendGap = false;
    let ncr = 0;
    let paid = 0;
    if (started) {
      for (let d = t.start; d <= to; d = addDays(d, 1)) {
        const a = byDate.get(d);
        if (!a) continue;
        for (const m of ["revenue", "orders", "new_customers", "ad_spend"] as const) {
          const v = a[m];
          if (v !== null) sums[m] = (sums[m] ?? 0) + v;
        }
        if (a.cm3 === null) cm3Gap = true;
        else sums.cm3 = (sums.cm3 ?? 0) + a.cm3;
        if (a.paid_spend === null) spendGap = true;
        else paid += a.paid_spend;
        ncr += a.new_customer_revenue ?? 0;
      }
      if (cm3Gap) sums.cm3 = null;
      sums.amer = !spendGap && paid > 0 ? ncr / paid : null;
    }
    const merActual = sums.ad_spend !== null && sums.revenue ? (100 * sums.ad_spend) / sums.revenue : null;
    const preliminary = started && (to >= addDays(asOf, -1));

    for (const metric of missing) {
      added.push({
        ...t,
        metric,
        target: null,
        targetToDate: null,
        actual: started ? sums[metric] : null,
        pacePct: null,
        gap: null,
        projected: null,
        projectedLow: null,
        projectedHigh: null,
        requiredDaily: null,
        requiredCurveMult: null,
        status: started ? "no_target" : "not_started",
        isTooEarly: false,
        result: null,
        isPreliminary: preliminary,
        merCapPct: metric === "ad_spend" ? t.merCapPct : null,
        merPlanPct: null,
        merActualPct: metric === "ad_spend" ? merActual : null,
        ratioNumActual: metric === "amer" && started ? ncr : null,
        ratioDenActual: metric === "amer" && started && !spendGap ? paid : null,
        ratioNumTargetToDate: null,
        ratioDenTargetToDate: null,
        ratioNumTarget: null,
        ratioDenTarget: null,
        trailing7dRatio: null,
        requiredRatio: null,
        measureStart: t.start,
        measureEnd: t.end,
        minSpend: null,
        conditionMet: null,
        isMeasured: metric === "cm3" ? !cm3Gap : metric === "amer" ? !spendGap : true,
      });
    }
  }
  return added.length === 0 ? data : { ...data, rows: [...data.rows, ...added] };
}

// ── Chart series ─────────────────────────────────────────────────────────────

export interface SeriesPoint {
  date: string;
  label: string;
  /** Curve target of the day. */
  target: number | null;
  /** Actual of the day; null for days after as of. */
  actual: number | null;
  cumTarget: number | null;
  cumActual: number | null;
  /** Projection path, from as of to the period end. */
  projection: number | null;
  /** 80% cone around the projection, [low, high]. */
  band: [number, number] | null;
  /** Trailing 7-day mean of actual and of target (ratio of sums). */
  avgActual: number | null;
  avgTarget: number | null;
  preliminary: boolean;
}

/** Day rows of one metric, by date. */
function dayIndex(data: PlanData, metric: PlanMetric): Map<string, PacingRow> {
  const out = new Map<string, PacingRow>();
  for (const r of data.rows) if (r.periodType === "day" && r.metric === metric) out.set(r.periodId, r);
  return out;
}

/** Fewer closed days than this in the trailing window and the 7-day mean stays empty. */
const MIN_DAYS_FOR_AVERAGE = 3;

/** One day's ratio parts: numerator and denominator (aMER: new customer revenue, paid spend). */
interface Parts {
  num: number;
  den: number;
}

const ratio = (p: Parts): number | null => (p.den > 0 ? p.num / p.den : null);

/**
 * Daily and cumulative series of one metric over a period.
 *
 * Additive metrics (orders, revenue, new customers, spend, CM3) sum: the
 * cumulative figure is a running total. aMER is a ratio: the daily point is
 * the day's own ratio, the cumulative and the 7-day figures are ratios of the
 * summed parts, never sums or averages of daily ratios.
 *
 * Projection path: the warehouse projects the period end as
 * P = C + (T - CT) x pf, the remaining curve scaled by one factor. Every day
 * after as of gets the same factor on its share of the remaining curve:
 *   proj_d = C + (cumT_d - CT) x (P - C) / (T - CT).
 * When the remaining curve is not positive (CM3 that the spend still to come
 * pulls down, or a ratio), the path runs straight in calendar days from C to
 * P. The cone widens with the square root of the remaining curve covered,
 * from zero at as of to the warehouse's low / high at the period end.
 */
export function buildSeries(data: PlanData, metric: PlanMetric, start: string, end: string, period?: PacingRow): SeriesPoint[] {
  const days = dayIndex(data, metric);
  const store = actualIndex(data.actuals);
  const asOf = asOfOf(data) ?? "";
  const isRatio = isRatioMetric(metric);
  const out: SeriesPoint[] = [];
  const actualOn = (d: string): number | null => days.get(d)?.actual ?? store.get(d)?.[metric] ?? null;
  /** Actual parts of a ratio metric on a day; null when the day has none or misses spend. */
  const actualParts = (d: string): Parts | null => {
    const row = days.get(d);
    if (row && row.ratioDenActual !== null) return { num: row.ratioNumActual ?? 0, den: row.ratioDenActual };
    const a = store.get(d);
    if (a && a.paid_spend !== null) return { num: a.new_customer_revenue ?? 0, den: a.paid_spend };
    return null;
  };
  const targetParts = (d: string): Parts | null => {
    const row = days.get(d);
    if (!row || row.ratioDenTarget === null || row.target === null) return null;
    return { num: row.ratioNumTarget ?? 0, den: row.ratioDenTarget };
  };

  let cumTarget = 0;
  let cumActual = 0;
  let anyTarget = false;
  const cumT: Parts = { num: 0, den: 0 };
  const cumA: Parts = { num: 0, den: 0 };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const row = days.get(d);
    const target = row?.target ?? null;
    const closed = d <= asOf;
    const actual = closed ? actualOn(d) : null;
    if (target !== null) {
      cumTarget += target;
      anyTarget = true;
    }
    if (actual !== null) cumActual += actual;
    if (isRatio) {
      const tp = targetParts(d);
      if (tp) {
        cumT.num += tp.num;
        cumT.den += tp.den;
      }
      const ap = closed ? actualParts(d) : null;
      if (ap) {
        cumA.num += ap.num;
        cumA.den += ap.den;
      }
    }

    // Trailing 7 closed days, including days before the period when the data has them.
    let sumA = 0;
    let nA = 0;
    let sumT = 0;
    let nT = 0;
    const winA: Parts = { num: 0, den: 0 };
    const winT: Parts = { num: 0, den: 0 };
    for (let k = 0; k < 7; k++) {
      const day = addDays(d, -k);
      if (day > asOf) continue;
      if (isRatio) {
        const ap = actualParts(day);
        if (ap) {
          winA.num += ap.num;
          winA.den += ap.den;
          nA += 1;
        }
        const tp = targetParts(day);
        if (tp) {
          winT.num += tp.num;
          winT.den += tp.den;
          nT += 1;
        }
        continue;
      }
      const a = actualOn(day);
      const t = days.get(day)?.target ?? null;
      if (a !== null) {
        sumA += a;
        nA += 1;
      }
      if (t !== null) {
        sumT += t;
        nT += 1;
      }
    }

    out.push({
      date: d,
      label: fmtDay(d),
      target,
      actual,
      cumTarget: isRatio ? (anyTarget ? ratio(cumT) : null) : anyTarget ? cumTarget : null,
      cumActual: closed && d >= start ? (isRatio ? ratio(cumA) : cumActual) : null,
      projection: null,
      band: null,
      avgActual: closed && nA >= MIN_DAYS_FOR_AVERAGE ? (isRatio ? ratio(winA) : sumA / nA) : null,
      avgTarget: closed && nT >= MIN_DAYS_FOR_AVERAGE ? (isRatio ? ratio(winT) : sumT / nT) : null,
      preliminary: closed && (row?.isPreliminary ?? false),
    });
  }

  // Projection: only for an open period with a warehouse projection.
  if (period && period.projected !== null && period.status !== "closed" && asOf >= start && asOf < end) {
    const idx = out.findIndex((p) => p.date === asOf);
    const at = idx >= 0 ? out[idx] : null;
    const C = at?.cumActual ?? null;
    const CT = at?.cumTarget ?? null;
    const T = out[out.length - 1]?.cumTarget ?? null;
    if (C !== null && CT !== null && T !== null) {
      const remaining = T - CT;
      const byCurve = !isRatio && remaining > 0;
      const scale = byCurve ? (period.projected - C) / remaining : 1;
      const span = Math.max(1, out.length - 1 - Math.max(idx, 0));
      const up = period.projectedHigh !== null ? period.projectedHigh - period.projected : null;
      const down = period.projectedLow !== null ? period.projected - period.projectedLow : null;
      for (let i = Math.max(idx, 0); i < out.length; i++) {
        const p = out[i];
        if (p.cumTarget === null) continue;
        const covered = byCurve
          ? Math.min(1, Math.max(0, (p.cumTarget - CT) / remaining))
          : (i - Math.max(idx, 0)) / span;
        const proj = byCurve ? C + (p.cumTarget - CT) * scale : C + (period.projected - C) * covered;
        p.projection = proj;
        if (up !== null && down !== null) {
          const w = Math.sqrt(covered);
          p.band = [proj - down * w, proj + up * w];
        }
      }
    }
  }
  return out;
}

export interface PromoBand {
  taskId: string;
  code: string;
  start: string;
  end: string;
}

/** "F4" from "F4 · Black Week". */
export function phaseCode(label: string): string {
  const head = label.split(" · ")[0]?.trim();
  return head && head.length <= 6 ? head : label;
}

/** Name after the phase code, "Black Week" from "F4 · Black Week". */
export function phaseName(label: string): string {
  const parts = label.split(" · ");
  return parts.length > 1 ? parts.slice(1).join(" · ") : label;
}

/**
 * Promo windows inside a period as they shape the curve: each day belongs to
 * the window that set its target (the warehouse picks the shortest), so the
 * bands never overlap.
 */
export function promoBands(data: PlanData, start: string, end: string): PromoBand[] {
  const labels = new Map<string, string>();
  for (const r of data.rows) if (r.periodType === "promo" && r.taskId) labels.set(r.taskId, r.label);

  const bands: PromoBand[] = [];
  for (const day of data.curve) {
    if (day.date < start || day.date > end || !day.promoTaskId) continue;
    const last = bands[bands.length - 1];
    if (last && last.taskId === day.promoTaskId && addDays(last.end, 1) === day.date) {
      last.end = day.date;
    } else {
      const label = labels.get(day.promoTaskId) ?? "Promo";
      bands.push({ taskId: day.promoTaskId, code: phaseCode(label), start: day.date, end: day.date });
    }
  }
  return bands;
}

// ── Breakdown ────────────────────────────────────────────────────────────────

export interface BreakdownRow {
  id: string;
  label: string;
  sub: string;
  byMetric: MetricRows;
  /** The row that contains as of. */
  current: boolean;
}

function rowsBy(data: PlanData, type: PeriodType, keep: (r: PacingRow) => boolean): BreakdownRow[] {
  const asOf = asOfOf(data) ?? "";
  const map = new Map<string, BreakdownRow>();
  for (const r of data.rows) {
    if (r.periodType !== type || !keep(r)) continue;
    let row = map.get(r.periodId);
    if (!row) {
      row = { id: r.periodId, label: r.label, sub: fmtRange(r.start, r.end), byMetric: {}, current: r.start <= asOf && asOf <= r.end };
      map.set(r.periodId, row);
    }
    row.byMetric[r.metric] = r;
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Quarter by month, month by ISO week, promo and target by day / month. */
export function breakdown(data: PlanData, view: PlanView, start: string, end: string): BreakdownRow[] {
  const overlaps = (r: PacingRow) => r.start <= end && r.end >= start;
  const inside = (r: PacingRow) => r.start >= start && r.end <= end;
  switch (view) {
    case "quarter":
      return rowsBy(data, "month", inside);
    case "month":
      return rowsBy(data, "week", overlaps).map((r) => ({ ...r, label: r.label.replace(/ \d{4}$/, "") }));
    case "promo":
      return rowsBy(data, "day", inside).map((r) => ({ ...r, label: fmtDay(r.id), sub: "" }));
    case "target":
      return rowsBy(data, "month", overlaps).map((r) => ({ ...r, sub: "" }));
  }
}

// ── Quarter timeline ─────────────────────────────────────────────────────────

export interface TimelineItem {
  kind: "promo" | "gate";
  taskId: string;
  code: string;
  name: string;
  start: string;
  end: string;
  planStatus: string | null;
  byMetric: MetricRows;
  attributedOrders: number | null;
  attributedTarget: number | null;
  /** The promo counts every order in its window, so there is no matched subset. */
  wholeStore: boolean;
  /** Attributed revenue minus COGS of those orders; null without cost data. */
  cm1: number | null;
}

/** Checkpoints and unit-led promos are judged on these, first one with a target wins. */
const HEADLINE_ORDER: readonly RowMetric[] = ["units", "orders", "revenue", "new_customers", "cm3", "amer"];

/**
 * The metric a checkpoint or promo card leads with: the first of units,
 * orders, revenue that has a target in the period, else the first that has a
 * row at all. A calendar checkpoint is judged on calendars sold, not orders.
 */
export function headlineMetric(rows: MetricRows): RowMetric {
  const targeted = HEADLINE_ORDER.find((m) => rows[m] && rows[m]!.target !== null);
  return targeted ?? HEADLINE_ORDER.find((m) => rows[m]) ?? "orders";
}

/**
 * Every condition a checkpoint sets, in display order, except the one the card
 * leads with: the rows that carry a target (a floor or a threshold).
 */
export function gateConditions(rows: MetricRows, lead: RowMetric): PacingRow[] {
  return HEADLINE_ORDER.filter((m) => m !== lead && rows[m] && rows[m]!.target !== null).map((m) => rows[m]!);
}

export function promoPerfOf(data: PlanData, taskId: string): PromoPerf | null {
  return data.promoPerf?.find((p) => p.taskId === taskId) ?? null;
}

export function taskOf(data: PlanData, taskId: string | null): PlanTask | null {
  if (!taskId) return null;
  return data.tasks.find((t) => t.taskId === taskId) ?? null;
}

/**
 * Attributed orders of a promo, or null when there is no such figure:
 *
 *  - no attribution row at all, or
 *  - the promo counts every order in the window (nothing to match on, or a
 *    store wide mechanic), so the figure is the whole store and is read as the
 *    whole store instead, or
 *  - the task names no code, SKU or campaign, so a count would read as
 *    "nobody used it" when nothing was ever matched on.
 */
export function attributedOrders(data: PlanData, taskId: string): number | null {
  const perf = promoPerfOf(data, taskId);
  if (!perf || perf.isStorewide) return null;
  const task = taskOf(data, taskId);
  return task?.hasKeys ? perf.attrOrders : null;
}

/** One entry of the match mix, in rule order, non zero only. */
export interface MatchSlice {
  label: string;
  count: number;
}

/** Everything the Promo view reads about one promo, with the n/a rules applied. */
export interface PromoImpact {
  perf: PromoPerf | null;
  task: PlanTask | null;
  /** The figures cover every order in the window, not a matched subset. */
  wholeStore: boolean;
  attributed: number | null;
  /** Attributed orders over store orders, null unless both sides exist. */
  share: number | null;
  /** Code split; null when the shop platform carries no discount codes. */
  codeOrders: number | null;
  noCodeOrders: number | null;
  matched: MatchSlice[];
}

const MATCH_LABELS: readonly [keyof PromoPerf, string][] = [
  ["matchCoupon", "code"],
  ["matchSku", "SKU"],
  ["matchGiftSku", "gift"],
  ["matchUtm", "campaign"],
  ["matchWindow", "window"],
];

export function promoImpact(data: PlanData, taskId: string): PromoImpact {
  const perf = promoPerfOf(data, taskId);
  const task = taskOf(data, taskId);
  const wholeStore = perf?.isStorewide ?? false;
  const attributed = attributedOrders(data, taskId);
  const matched: MatchSlice[] = perf
    ? MATCH_LABELS.flatMap(([key, label]) => {
        const count = perf[key];
        return typeof count === "number" && count > 0 ? [{ label, count }] : [];
      })
    : [];
  return {
    perf,
    task,
    wholeStore,
    attributed,
    share: attributed !== null && perf?.storeOrders ? attributed / perf.storeOrders : null,
    codeOrders: perf?.hasCouponData ? perf.attrCodeOrders : null,
    noCodeOrders: perf?.hasCouponData ? perf.attrNoCodeOrders : null,
    matched,
  };
}

/** Promos and checkpoints that touch the period, by start date. */
export function timeline(data: PlanData, start: string, end: string): TimelineItem[] {
  const items = new Map<string, TimelineItem>();
  for (const r of data.rows) {
    if ((r.periodType !== "promo" && r.periodType !== "gate") || !(r.start <= end && r.end >= start)) continue;
    let item = items.get(r.periodId);
    if (!item) {
      const id = r.taskId ?? r.periodId;
      const task = taskOf(data, r.taskId);
      const perf = promoPerfOf(data, id);
      item = {
        kind: r.periodType === "gate" ? "gate" : "promo",
        taskId: id,
        code: phaseCode(r.label),
        name: phaseName(r.label),
        start: r.start,
        end: r.end,
        planStatus: r.planStatus,
        byMetric: {},
        attributedOrders: attributedOrders(data, id),
        attributedTarget: task?.targetOrders ?? null,
        wholeStore: perf?.isStorewide ?? false,
        cm1: perf?.attrCm1 ?? null,
      };
      items.set(r.periodId, item);
    }
    item.byMetric[r.metric] = r;
  }
  return [...items.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

// ── Target trajectory ────────────────────────────────────────────────────────

export interface TrajectoryPoint {
  month: string;
  label: string;
  /** Monthly run-rate on the trajectory. */
  trajectory: number | null;
  /** The month's own plan target. */
  plan: number | null;
  /** Closed months: the final figure. */
  actual: number | null;
  /** The month in flight: the warehouse projection. */
  projected: number | null;
}

export interface Trajectory {
  task: PlanTask;
  /** Run-rate at the start: mean revenue of the closed months before it. */
  startValue: number | null;
  startMonths: number;
  goal: number | null;
  /** Constant monthly growth from start value to goal. */
  growth: number | null;
  points: TrajectoryPoint[];
}

/** Closed months that set the starting run-rate. */
const START_WINDOW_MONTHS = 3;

/**
 * Trajectory to a Target state.
 *
 * The Target state task holds a monthly revenue run-rate (`target revenue`) to
 * reach by its due date. The trajectory is a constant monthly growth line from
 * the run-rate at the task's start to that goal:
 *
 *   S = mean revenue of the (up to) 3 closed months before the start month
 *   n = months from the start month to the due month
 *   g = (goal / S)^(1 / n) - 1
 *   level(k) = S x (1 + g)^k, k = 0 (start month) .. n (due month)
 *
 * Revenue is the plan's own definition (month rows of the pacing table), so
 * the line and the actuals are in the same units as every month target. With
 * no closed month before the start there is no starting point and the line is
 * not drawn (S, g null); actuals and month plans still are.
 */
export function targetTrajectory(data: PlanData, task: PlanTask): Trajectory {
  const months = new Map<string, PacingRow>();
  for (const r of data.rows) {
    if (r.periodType === "month" && r.metric === "revenue") months.set(monthStart(r.start), r);
  }

  const startMonth = monthStart(task.start ?? task.end ?? "");
  const endMonth = monthStart(task.end ?? task.start ?? "");
  const before = [...months.entries()]
    .filter(([m, r]) => m < startMonth && r.status === "closed" && r.actual !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-START_WINDOW_MONTHS);
  const startValue = before.length > 0 ? before.reduce((s, [, r]) => s + (r.actual ?? 0), 0) / before.length : null;
  const goal = task.targetRevenue;
  const n = monthsBetween(startMonth, endMonth);
  const growth =
    startValue !== null && startValue > 0 && goal !== null && goal > 0 && n > 0 ? Math.pow(goal / startValue, 1 / n) - 1 : null;

  // From the earliest month that has data or sets the start, to the due month.
  const first = [before[0]?.[0], startMonth, ...months.keys()].filter(Boolean).sort()[0] as string;
  const points: TrajectoryPoint[] = [];
  for (let k = 0, m = first; m <= endMonth && k < 120; k++, m = addMonthsIso(m, 1)) {
    const row = months.get(m);
    const step = monthsBetween(startMonth, m);
    const trajectory =
      startValue !== null && growth !== null && step >= 0 && step <= n ? startValue * Math.pow(1 + growth, step) : null;
    const closed = row?.status === "closed";
    const open = row && row.status !== "closed" && row.status !== "not_started";
    points.push({
      month: m,
      label: fmtMonthShort(m),
      trajectory,
      plan: row?.target ?? null,
      actual: closed ? row!.actual : null,
      projected: open ? row!.projected : null,
    });
  }
  return { task, startValue, startMonths: before.length, goal, growth, points };
}

function addMonthsIso(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + k;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** "October 2026" for a month id. */
export function monthTitle(start: string): string {
  return fmtMonth(start);
}
