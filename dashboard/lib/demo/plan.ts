/**
 * Demo plan: targets, promo windows, checkpoints and pacing rows for the
 * fictional brand, so the Plan page renders in the demo and in local dev.
 *
 * The rows have the same shape the warehouse produces and are built with the
 * same rules (curve target, pace, shrunk projection with an 80% cone, the
 * noise-aware status), simplified where only the warehouse has the inputs:
 * the payday factor is fixed, there is no last-year share, and the quarter is
 * projected directly rather than as the sum of its months. Deterministic: a
 * date always produces the same figures.
 *
 * Actuals ride the same daily spine as every other demo page, lifted on promo
 * days, with revenue as net sales (goods ex shipping) to match the plan's own
 * revenue definition. Targets sit a little above what happens, so some
 * periods are behind and the page has something to say.
 *
 * CM3 follows the warehouse's component curve (gross margin on the revenue
 * curve minus the flat spend plan). aMER is carried as numerator and
 * denominator (new customer revenue, paid spend) and every period's figure is
 * a ratio of sums. Checkpoints carry a CM3 floor and an aMER floor over their
 * own window, with the qualifying spend derived from the ad budget plan.
 */

import { day as spineDay, dataThrough } from "./business";
import { jitter } from "./random";
import {
  addDays,
  addMonths,
  daysBetween,
  datesFrom,
  fmtMonth,
  isoWeek,
  isoWeekId,
  monthEnd,
  quarterId,
  quarterStart,
} from "@/lib/plan/dates";
import type {
  ActualDay,
  CurveDay,
  PacingRow,
  PacingStatus,
  PeriodType,
  PlanData,
  PlanMetric,
  PlanTask,
  PromoPerf,
} from "@/lib/plan/types";

/** Metrics that add up day by day; aMER (a ratio) is built from its parts. */
const ADDITIVE = ["revenue", "orders", "new_customers", "ad_spend", "cm3"] as const;
type Additive = (typeof ADDITIVE)[number];
type Sums = Record<Additive, number>;

const zero = (): Sums => ({ revenue: 0, orders: 0, new_customers: 0, ad_spend: 0, cm3: 0 });

// Pacing parameters (same placeholders the warehouse uses).
const PHI = 1.48;
const CV = 0.52;
const K_ORDERS = 30;
const Z90 = 1.2816;

/** Weekday weights of the demo curve, Sunday first. */
const WEEKDAY = [0.86, 1.05, 1.07, 1.05, 1.02, 0.97, 0.84];
const PAYDAY = 1.2;

interface Promo {
  taskId: string;
  name: string;
  start: string;
  end: string;
  mult: number;
  mechanic: string;
  /** Attributed-orders target as a share of the window's curve orders. */
  attrShare: number | null;
  merCap: number | null;
}

interface Gate {
  taskId: string;
  name: string;
  start: string;
  end: string;
  thresholdOrders: number | null;
  merCap: number | null;
  /** CM3 floor as a share of the window's CM3 curve. */
  cm3FloorShare: number | null;
  /** aMER floor as a multiple of the plan aMER over the window. */
  amerFloorShare: number | null;
  /** Metrics the checkpoint sets a condition on. */
  metrics: readonly PlanMetric[];
}

interface DayFacts {
  target: Sums & { anum: number; aden: number };
  actual: (Sums & { ncr: number; paid: number }) | null;
  promoTaskId: string | null;
  isPayday: boolean;
}

function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function promosFor(q: string): Promo[] {
  // q = first day of the current quarter. Windows relative to it, plus one
  // closed promo in the quarter before, so every state is on screen.
  const m0 = q;
  const m1 = addMonths(q, 1);
  const m2 = addMonths(q, 2);
  const prev = addMonths(q, -2);
  return [
    { taskId: "demo-f0", name: "F0 · Summer reset", start: addDays(prev, 9), end: addDays(prev, 19), mult: 1.3, mechanic: "Discount code", attrShare: 0.5, merCap: null },
    // Store wide and without cost data, so the Promo view shows both the whole
    // store labelling and the n/a margin on a closed window.
    { taskId: "demo-f9", name: "F9 · Free shipping week", start: addDays(prev, 23), end: addDays(prev, 27), mult: 1.15, mechanic: "Free shipping", attrShare: null, merCap: null },
    { taskId: "demo-f1", name: "F1 · Starter set", start: addDays(m0, 6), end: addDays(m0, 24), mult: 1.22, mechanic: "Bundle", attrShare: 0.4, merCap: null },
    { taskId: "demo-f2", name: "F2 · Loyalty credit", start: addDays(m1, 0), end: addDays(m1, 11), mult: 1.12, mechanic: "Personal credit", attrShare: null, merCap: null },
    { taskId: "demo-f3", name: "F3 · Week of offers", start: addDays(m1, 20), end: addDays(m1, 27), mult: 1.65, mechanic: "Cart discount", attrShare: 0.6, merCap: 25 },
    { taskId: "demo-f4", name: "F4 · Gift sets", start: addDays(m2, 3), end: addDays(m2, 16), mult: 1.45, mechanic: "Bundle", attrShare: 0.35, merCap: null },
  ];
}

function gatesFor(q: string): Gate[] {
  const m0 = q;
  const m1 = addMonths(q, 1);
  return [
    {
      taskId: "demo-g1",
      name: "G1 · Winning ad",
      start: addDays(m0, 6),
      end: addDays(m0, 16),
      thresholdOrders: null,
      merCap: null,
      cm3FloorShare: null,
      amerFloorShare: 1.15,
      metrics: ["orders", "amer"],
    },
    {
      taskId: "demo-g2",
      name: "G2 · Second month on plan",
      start: m1,
      end: monthEnd(m1),
      thresholdOrders: null,
      merCap: null,
      cm3FloorShare: 0.8,
      amerFloorShare: 0.9,
      metrics: ["orders", "new_customers", "cm3", "amer"],
    },
  ];
}

function shortestPromo(promos: Promo[], date: string): Promo | null {
  const hits = promos.filter((p) => p.start <= date && date <= p.end);
  hits.sort((a, b) => daysBetween(a.start, a.end) - daysBetween(b.start, b.end));
  return hits[0] ?? null;
}

function isPayday(date: string): boolean {
  const dom = Number(date.slice(8, 10));
  return dom >= 10 && dom <= 16;
}

/** The demo's month plan: one entry per additive metric, plus the month's aMER. */
function monthPlan(month: string, promos: Promo[]): Sums & { amer: number } {
  const out = zero();
  let gm = 0;
  let ncr = 0;
  for (const d of datesFrom(month, monthEnd(month))) {
    const s = spineDay(d);
    const mult = shortestPromo(promos, d)?.mult ?? 1;
    out.orders += s.orders * mult;
    out.revenue += s.netSales * mult;
    out.new_customers += s.newCustomerOrders * mult;
    out.ad_spend += s.paidSpend;
    gm += (s.cm3 + s.paidSpend) * mult;
    ncr += s.newCustomerRevenue * mult;
  }
  const lift = 1.05 * jitter(`plan:${month}`, 0.07);
  const spend = Math.round((out.ad_spend * 0.97) / 100) * 100;
  return {
    orders: Math.round(out.orders * lift),
    revenue: Math.round((out.revenue * lift) / 100) * 100,
    new_customers: Math.round(out.new_customers * lift),
    ad_spend: spend,
    cm3: Math.round((gm * lift - spend) / 1000) * 1000,
    amer: spend > 0 ? Math.round(((ncr * lift) / spend) * 100) / 100 : 0,
  };
}

function buildDays(months: string[], promos: Promo[], asOf: string): Map<string, DayFacts> {
  const out = new Map<string, DayFacts>();
  for (const month of months) {
    const plan = monthPlan(month, promos);
    const dates = datesFrom(month, monthEnd(month));
    const weights = dates.map((d) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      return WEEKDAY[dow] * (isPayday(d) ? PAYDAY : 1) * (shortestPromo(promos, d)?.mult ?? 1);
    });
    const sumW = weights.reduce((a, b) => a + b, 0);
    dates.forEach((d, i) => {
      const share = weights[i] / sumW;
      const promo = shortestPromo(promos, d);
      const spendDay = plan.ad_spend / dates.length;
      let actual: DayFacts["actual"] = null;
      if (d <= asOf) {
        const s = spineDay(d);
        const mult = (promo?.mult ?? 1) * jitter(`plan-act:${d}`, 0.12);
        const orders = Math.max(0, Math.round(s.orders * mult));
        const ratio = s.orders > 0 ? orders / s.orders : 0;
        const spend = round(s.paidSpend * (promo ? 1.15 : 1));
        actual = {
          orders,
          revenue: round(s.netSales * ratio),
          new_customers: Math.min(orders, Math.round(s.newCustomerOrders * ratio)),
          ad_spend: spend,
          cm3: round((s.cm3 + s.paidSpend) * ratio - spend),
          ncr: round(s.newCustomerRevenue * ratio),
          paid: spend,
        };
      }
      out.set(d, {
        target: {
          orders: plan.orders * share,
          revenue: plan.revenue * share,
          new_customers: plan.new_customers * share,
          ad_spend: spendDay,
          // Gross margin on the revenue curve minus the flat spend plan (sums to the month's CM3).
          cm3: (plan.cm3 + plan.ad_spend) * share - spendDay,
          anum: plan.amer * spendDay,
          aden: spendDay,
        },
        actual,
        promoTaskId: promo?.taskId ?? null,
        isPayday: isPayday(d),
      });
    });
  }
  return out;
}

interface PeriodSpec {
  type: PeriodType;
  id: string;
  label: string;
  start: string;
  end: string;
  taskId: string | null;
  planStatus: string | null;
  merCap: number | null;
  /** Checkpoint threshold on orders, replacing the curve total. */
  thresholdOrders?: number | null;
  /** Checkpoint floors (CM3 money, aMER multiple). */
  cm3Floor?: number | null;
  amerFloor?: number | null;
  /** Ad spend the plan puts in the window (sets the derived aMER qualifying spend). */
  plannedSpend?: number;
  isTargetPartial?: boolean;
  /** Metrics the task sets a target for; the rest get no row (the page fills in actuals). */
  metrics?: readonly PlanMetric[];
}

/** Ratio parts of the aMER rows. */
interface RatioParts {
  num: number;
  den: number;
}

const NO_RATIO = {
  ratioNumActual: null,
  ratioDenActual: null,
  ratioNumTargetToDate: null,
  ratioDenTargetToDate: null,
  ratioNumTarget: null,
  ratioDenTarget: null,
  trailing7dRatio: null,
  requiredRatio: null,
  minSpend: null,
  conditionMet: null,
} as const;

/**
 * Share of the window's planned ad spend an aMER floor must carry before it is
 * judged (same rule as the warehouse: a ratio on a fraction of the planned
 * spend is noise, not a verdict).
 */
const AMER_MIN_SPEND_SHARE = 0.5;

/** aMER over the 7 days ending as of (actual parts). */
function trailingRatio(days: Map<string, DayFacts>, asOf: string): number | null {
  let num = 0;
  let den = 0;
  for (let k = 0; k < 7; k++) {
    const a = days.get(addDays(asOf, -k))?.actual;
    if (!a) continue;
    num += a.ncr;
    den += a.paid;
  }
  return den > 0 ? num / den : null;
}

/** Pacing rows of one period, every metric, by the warehouse's rules. */
function pace(spec: PeriodSpec, days: Map<string, DayFacts>, asOf: string): PacingRow[] {
  const dates = datesFrom(spec.start, spec.end).filter((d) => days.has(d));
  const T = zero();
  const CT = zero();
  const C = zero();
  const tA: RatioParts = { num: 0, den: 0 };
  const ctA: RatioParts = { num: 0, den: 0 };
  const cA: RatioParts = { num: 0, den: 0 };
  for (const d of dates) {
    const f = days.get(d)!;
    for (const m of ADDITIVE) {
      T[m] += f.target[m];
      if (d <= asOf) {
        CT[m] += f.target[m];
        C[m] += f.actual?.[m] ?? 0;
      }
    }
    tA.num += f.target.anum;
    tA.den += f.target.aden;
    if (d <= asOf) {
      ctA.num += f.target.anum;
      ctA.den += f.target.aden;
      cA.num += f.actual?.ncr ?? 0;
      cA.den += f.actual?.paid ?? 0;
    }
  }

  const daysTotal = daysBetween(spec.start, spec.end) + 1;
  const started = spec.start <= asOf;
  const closed = spec.end <= asOf;
  const daysElapsed = started ? Math.min(daysTotal, daysBetween(spec.start, asOf) + 1) : 0;
  const daysRemaining = daysTotal - daysElapsed;
  const inPeriod = (d: string) => spec.start <= d && d <= spec.end;
  const preliminary = started && (inPeriod(asOf) || inPeriod(addDays(asOf, -1)));

  const aov = T.orders > 0 ? T.revenue / T.orders : null;
  const pfOrders = (C.orders + K_ORDERS) / (CT.orders + K_ORDERS);
  const remOrders = (T.orders - CT.orders) * pfOrders;
  const curveShare = T.orders > 0 ? CT.orders / T.orders : 0;
  const gmRate = T.revenue > 0 ? (T.cm3 + T.ad_spend) / T.revenue : 0.6;

  const merPlan = T.revenue > 0 ? (100 * T.ad_spend) / T.revenue : null;
  const merActual = started && C.revenue > 0 ? (100 * C.ad_spend) / C.revenue : null;

  const tooEarlyFor = (ct: number, t: number) =>
    ((spec.type === "month" || spec.type === "quarter") && daysElapsed < 5) ||
    ((spec.type === "promo" || spec.type === "gate") && daysTotal < 7 && ct < 0.3 * t);

  const additive = ADDITIVE.map((metric): PacingRow => {
    let t = T[metric];
    let ct = CT[metric];
    if (metric === "orders" && spec.thresholdOrders != null && T.orders > 0) {
      ct = spec.thresholdOrders * curveShare;
      t = spec.thresholdOrders;
    }
    if (metric === "cm3" && spec.cm3Floor != null) {
      // The floor gets the target's component curve.
      t = spec.cm3Floor;
      ct = (spec.cm3Floor + T.ad_spend) * curveShare - CT.ad_spend;
    }
    const c = started ? C[metric] : null;
    const k = metric === "orders" ? K_ORDERS : T.orders > 0 ? (K_ORDERS * Math.abs(T[metric])) / T.orders : K_ORDERS;
    const pf = c !== null ? (c + k) / (ct + k) : 1;
    let projected = !started ? t : closed ? c : c! + (t - ct) * pf;
    if (metric === "cm3" && started && !closed) {
      const gmT = t + T.ad_spend;
      const gmCT = ct + CT.ad_spend;
      const kk = K_ORDERS * (aov ?? 0) * gmRate;
      const pfGm = (c! + C.ad_spend + kk) / (gmCT + kk);
      projected = c! + (gmT - gmCT) * pfGm - (T.ad_spend - CT.ad_spend);
    }

    let half: number | null = null;
    if (started && !closed && metric !== "ad_spend" && metric !== "cm3") {
      const R = (t - ct) * pf;
      if (metric === "revenue" && aov !== null) half = Z90 * Math.sqrt(PHI * Math.max(0, remOrders) * (1 + CV * CV)) * aov;
      else half = Z90 * Math.sqrt(PHI * Math.max(0, R));
    }

    const pacePct = c !== null && ct > 0 ? (100 * c) / ct : null;
    let z: number | null = null;
    if (c !== null && metric !== "ad_spend") {
      const sd =
        metric === "cm3" && aov !== null
          ? Math.sqrt(PHI * CT.orders * (1 + CV * CV)) * aov * gmRate
          : metric === "revenue" && aov !== null
            ? Math.sqrt(PHI * CT.orders * (1 + CV * CV)) * aov
            : ct > 0
              ? Math.sqrt(PHI * ct)
              : 0;
      z = sd > 0 ? (c - ct) / sd : null;
    }

    let status: PacingStatus = "on_track";
    let tooEarly = false;
    if (!started) status = "not_started";
    else if (closed) status = "closed";
    else if (metric === "cm3") {
      const rel = t !== 0 && c !== null ? (c - ct) / Math.abs(t) : 0;
      if (z !== null && z <= -1.645 && rel < -0.1) status = "off_track";
      else if (z !== null && z <= -1 && rel < -0.03) status = "behind";
      else if (z !== null && z >= 1.645 && rel > 0.1) status = "ahead";
      tooEarly = (spec.type === "month" || spec.type === "quarter") && daysElapsed < 5;
      if (tooEarly) status = "on_track";
    } else if (pacePct !== null) {
      if (metric === "ad_spend") status = pacePct < 80 ? "off_track" : pacePct < 90 ? "behind" : pacePct > 110 ? "ahead" : "on_track";
      else if (z !== null) {
        if (pacePct < 90 && z <= -1.645) status = "off_track";
        else if (pacePct < 97 && z <= -1) status = "behind";
        else if (pacePct > 110 && z >= 1.645) status = "ahead";
      }
      tooEarly = tooEarlyFor(ct, t);
      if (tooEarly) status = "on_track";
    }
    if (spec.type === "day") {
      status = started ? "closed" : "not_started";
      tooEarly = false;
    }

    return {
      periodType: spec.type,
      periodId: spec.id,
      label: spec.label,
      metric,
      taskId: spec.taskId,
      planStatus: spec.planStatus,
      asOf,
      start: spec.start,
      end: spec.end,
      daysTotal,
      daysElapsed,
      daysRemaining,
      isTargetPartial: spec.isTargetPartial ?? false,
      target: t,
      targetToDate: ct,
      actual: c,
      pacePct,
      gap: c !== null ? c - ct : null,
      projected,
      projectedLow: half !== null && projected !== null ? projected - half : null,
      projectedHigh: half !== null && projected !== null ? projected + half : null,
      requiredDaily: daysRemaining > 0 && c !== null ? (t - c) / daysRemaining : !started && daysTotal > 0 ? t / daysTotal : null,
      requiredCurveMult: c !== null && t - ct > 0 ? (t - c) / (t - ct) : null,
      status,
      isTooEarly: tooEarly,
      result: closed && metric !== "ad_spend" && c !== null ? (c >= t ? "met" : "missed") : null,
      isPreliminary: spec.type === "day" ? spec.start >= addDays(asOf, -1) && spec.start <= asOf : preliminary,
      merCapPct: spec.merCap,
      merPlanPct: merPlan,
      merActualPct: merActual,
      ...NO_RATIO,
      conditionMet: spec.type === "gate" && c !== null ? c >= t : null,
      isMeasured: true,
    };
  });

  return [...additive, paceRatio(spec, days, asOf, { tA, ctA, cA, started, closed, daysTotal, daysElapsed, preliminary })];
}

/**
 * The aMER row: ratios of summed parts. A checkpoint judges its floor over its
 * own window (the N days ending on Due) and needs the window's min spend.
 */
function paceRatio(
  spec: PeriodSpec,
  days: Map<string, DayFacts>,
  asOf: string,
  p: { tA: RatioParts; ctA: RatioParts; cA: RatioParts; started: boolean; closed: boolean; daysTotal: number; daysElapsed: number; preliminary: boolean }
): PacingRow {
  const gate = spec.type === "gate" && spec.amerFloor != null;
  const { tA, ctA, cA } = p;
  const started = p.started;
  const plan = tA.den > 0 ? tA.num / tA.den : null;
  const t = gate ? spec.amerFloor! : plan;
  const ct = gate ? spec.amerFloor! : ctA.den > 0 ? ctA.num / ctA.den : null;
  const c = started && cA.den > 0 ? cA.num / cA.den : null;
  const pacePct = c !== null && ct ? (100 * c) / ct : null;
  const rest = Math.max(0, tA.den - ctA.den);
  const restRatio = rest > 0 ? (tA.num - ctA.num) / rest : plan;
  const aovNew = 900;
  const k = K_ORDERS * aovNew;
  const pf = c !== null && ct ? (cA.num + k) / (ct * cA.den + k) : 1;
  const projected = !started
    ? plan
    : p.closed
      ? c
      : cA.den + rest > 0
        ? (cA.num + (restRatio ?? 0) * pf * rest) / (cA.den + rest)
        : c;
  const sd = ct && cA.den > 0 ? Math.sqrt(PHI * ((ct * cA.den) / aovNew) * (1 + CV * CV)) * aovNew : 0;
  const z = c !== null && ct && sd > 0 ? (cA.num - ct * cA.den) / sd : null;
  // Derived, never entered: a share of the ad spend the plan put in the window.
  // Null when the plan has no budget there, and the floor is judged on the ratio alone.
  const plannedSpend = spec.plannedSpend ?? 0;
  const minSpend = gate && plannedSpend > 0 ? AMER_MIN_SPEND_SHARE * plannedSpend : null;

  let status: PacingStatus = "on_track";
  let tooEarly = false;
  if (!started) status = "not_started";
  else if (p.closed) status = "closed";
  else if (spec.type !== "day" && c !== null && pacePct !== null) {
    if (gate) {
      tooEarly = cA.den < 0.3 * (minSpend ?? (tA.den || cA.den + 1));
      if (tooEarly) status = "on_track";
      else if (minSpend !== null && cA.den + rest < minSpend) status = "behind";
      else if (c >= t!) status = pacePct > 110 && z !== null && z >= 1.645 ? "ahead" : "on_track";
      else status = z !== null && z <= -1.645 ? "off_track" : "behind";
    } else {
      if (pacePct < 90 && z !== null && z <= -1.645) status = "off_track";
      else if (pacePct < 97 && z !== null && z <= -1) status = "behind";
      else if (pacePct > 110 && z !== null && z >= 1.645) status = "ahead";
      tooEarly = (spec.type === "month" || spec.type === "quarter") && p.daysElapsed < 5;
      if (tooEarly) status = "on_track";
    }
  }
  if (spec.type === "day") status = started ? "closed" : "not_started";
  const met = c !== null && t !== null ? c >= t && (minSpend === null || cA.den >= minSpend) : null;

  return {
    periodType: spec.type,
    periodId: spec.id,
    label: spec.label,
    metric: "amer",
    taskId: spec.taskId,
    planStatus: spec.planStatus,
    asOf,
    start: spec.start,
    end: spec.end,
    daysTotal: p.daysTotal,
    daysElapsed: p.daysElapsed,
    daysRemaining: p.daysTotal - p.daysElapsed,
    isTargetPartial: spec.isTargetPartial ?? false,
    target: t,
    targetToDate: ct,
    actual: c,
    pacePct,
    gap: c !== null && ct !== null ? c - ct : null,
    projected,
    projectedLow: null,
    projectedHigh: null,
    requiredDaily: null,
    requiredCurveMult: null,
    status,
    isTooEarly: tooEarly && !p.closed,
    result: p.closed && met !== null ? (met ? "met" : "missed") : null,
    isPreliminary: spec.type === "day" ? spec.start >= addDays(asOf, -1) && spec.start <= asOf : p.preliminary,
    merCapPct: null,
    merPlanPct: null,
    merActualPct: null,
    ratioNumActual: started ? cA.num : null,
    ratioDenActual: started ? cA.den : null,
    ratioNumTargetToDate: ctA.num,
    ratioDenTargetToDate: ctA.den,
    ratioNumTarget: tA.num,
    ratioDenTarget: tA.den,
    trailing7dRatio: started && !p.closed && spec.type !== "day" ? trailingRatio(days, asOf) : null,
    requiredRatio:
      started && !p.closed && rest > 0 && t !== null ? (t * (cA.den + rest) - cA.num) / rest : null,
    minSpend,
    conditionMet: spec.type === "gate" && started ? met : null,
    isMeasured: true,
  };
}

let cache: { key: string; data: PlanData } | null = null;

export function demoPlanData(): PlanData {
  const asOf = dataThrough();
  if (cache && cache.key === asOf) return cache.data;

  const q = quarterStart(asOf);
  const first = addMonths(q, -6);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  const lastDay = monthEnd(months[months.length - 1]);
  const promos = promosFor(q);
  const gates = gatesFor(q);
  const days = buildDays(months, promos, asOf);

  const specs: PeriodSpec[] = [];
  const monthTask = (m: string) => `demo-m-${m.slice(0, 7)}`;
  for (const m of months) {
    specs.push({ type: "month", id: m.slice(0, 7), label: fmtMonth(m), start: m, end: monthEnd(m), taskId: monthTask(m), planStatus: "approved", merCap: 28 });
  }
  for (let i = 0; i < months.length; i += 3) {
    const qs = months[i];
    const [y, n] = quarterId(qs).split("-Q");
    // Quarter tasks set no new-customer target, so the page shows its actual-only tile.
    specs.push({ type: "quarter", id: quarterId(qs), label: `Q${n} ${y}`, start: qs, end: monthEnd(months[i + 2]), taskId: `demo-q-${quarterId(qs)}`, planStatus: "approved", merCap: 27, metrics: ["revenue", "orders", "ad_spend", "cm3", "amer"] });
  }
  const weeks = new Map<string, { start: string; end: string }>();
  for (const d of datesFrom(months[0], lastDay)) {
    const id = isoWeekId(d);
    const w = weeks.get(id);
    if (w) w.end = d;
    else weeks.set(id, { start: d, end: d });
  }
  for (const [id, w] of weeks) {
    const { week } = isoWeek(w.start);
    specs.push({
      type: "week",
      id,
      label: `Week ${String(week).padStart(2, "0")} ${id.slice(0, 4)}`,
      start: w.start,
      end: w.end,
      taskId: null,
      planStatus: null,
      merCap: null,
      isTargetPartial: daysBetween(w.start, w.end) < 6,
    });
  }
  for (const d of datesFrom(months[0], lastDay)) {
    specs.push({ type: "day", id: d, label: d, start: d, end: d, taskId: null, planStatus: null, merCap: null });
  }
  for (const p of promos) {
    specs.push({ type: "promo", id: p.taskId, label: p.name, start: p.start, end: p.end, taskId: p.taskId, planStatus: "approved", merCap: p.merCap });
  }

  // Checkpoint thresholds: a touch above the curve, as a stretch bar; floors
  // a little below plan (CM3) or above it (a winning-ad aMER), rounded the way
  // they are typed into the plan.
  const curveSum = (s: string, e: string, pick: (f: DayFacts) => number) =>
    datesFrom(s, e).reduce((sum, d) => sum + (days.has(d) ? pick(days.get(d)!) : 0), 0);
  for (const g of gates) {
    const threshold = g.thresholdOrders ?? Math.round(curveSum(g.start, g.end, (f) => f.target.orders) * 1.05);
    const planNum = curveSum(g.start, g.end, (f) => f.target.anum);
    const planDen = curveSum(g.start, g.end, (f) => f.target.aden);
    const plannedSpend = curveSum(g.start, g.end, (f) => f.target.ad_spend);
    specs.push({
      type: "gate",
      id: g.taskId,
      label: g.name,
      start: g.start,
      end: g.end,
      taskId: g.taskId,
      planStatus: "approved",
      merCap: g.merCap,
      thresholdOrders: threshold,
      cm3Floor: g.cm3FloorShare !== null ? Math.round((curveSum(g.start, g.end, (f) => f.target.cm3) * g.cm3FloorShare) / 1000) * 1000 : null,
      amerFloor: g.amerFloorShare !== null && planDen > 0 ? Math.round((planNum / planDen) * g.amerFloorShare * 10) / 10 : null,
      plannedSpend,
      metrics: g.metrics,
    });
  }

  const rows = specs.flatMap((s) => pace(s, days, asOf).filter((r) => !s.metrics || s.metrics.includes(r.metric as PlanMetric)));

  // G1 counts units (a unit-led checkpoint, like calendars sold): a units row
  // scaled from its orders row, so the card leads with units.
  const g1 = rows.find((r) => r.periodType === "gate" && r.periodId === "demo-g1" && r.metric === "orders");
  if (g1) {
    const k = 0.3;
    const scale = (v: number | null) => (v === null ? null : Math.round(v * k * 10) / 10);
    rows.push({
      ...g1,
      metric: "units",
      target: Math.round((g1.target ?? 0) * k),
      targetToDate: scale(g1.targetToDate),
      actual: scale(g1.actual),
      gap: scale(g1.gap),
      projected: scale(g1.projected),
      projectedLow: scale(g1.projectedLow),
      projectedHigh: scale(g1.projectedHigh),
      requiredDaily: scale(g1.requiredDaily),
      merCapPct: null,
    });
  }

  const curveOrders = (s: string, e: string) => curveSum(s, e, (f) => f.target.orders);
  const curve: CurveDay[] = [...days.entries()].map(([date, f]) => ({ date, promoTaskId: f.promoTaskId, isPayday: f.isPayday }));

  // Target state: from the current quarter's start, a 40% higher monthly
  // run-rate fifteen months later.
  const startMonth = addMonths(q, -3);
  const before = rows.filter((r) => r.periodType === "month" && r.metric === "revenue" && r.start < startMonth && r.status === "closed");
  const base = before.slice(-3).reduce((s, r) => s + (r.actual ?? 0), 0) / Math.max(1, Math.min(3, before.length));
  const targetEnd = monthEnd(addMonths(startMonth, 15));
  const tasks: PlanTask[] = [
    {
      taskId: "demo-target",
      level: "Target state",
      name: `Target state ${targetEnd.slice(5, 7)}/${targetEnd.slice(0, 4)}`,
      start: startMonth,
      end: targetEnd,
      status: "approved",
      targetRevenue: Math.round((base * 1.4) / 1000) * 1000,
      targetOrders: null,
      targetUnits: null,
      mechanic: null,
      hasKeys: false,
    },
    ...promos.map((p) => ({
      taskId: p.taskId,
      level: "Promo",
      name: p.name,
      start: p.start,
      end: p.end,
      status: "approved",
      targetRevenue: null,
      targetOrders: p.attrShare === null ? null : Math.round(curveOrders(p.start, p.end) * p.attrShare),
      targetUnits: null,
      mechanic: p.mechanic,
      // F2 has no code entered yet, so its attributed orders read n/a.
      hasKeys: p.taskId !== "demo-f2",
    })),
  ];

  const promoPerf: PromoPerf[] = promos
    .filter((p) => p.start <= asOf)
    .map((p) => {
      const to = p.end < asOf ? p.end : asOf;
      let storeOrders = 0;
      let storeRevenue = 0;
      let spend = 0;
      for (const d of datesFrom(p.start, to)) {
        const a = days.get(d)?.actual;
        if (!a) continue;
        storeOrders += a.orders;
        storeRevenue += a.revenue;
        spend += a.ad_spend;
      }
      // A store wide mechanic counts every order in the window, so there is no
      // matched subset: the demo exercises that branch on F3.
      const wholeStore = p.mechanic === "Cart discount" || p.mechanic === "Free shipping";
      const share = 0.42 * jitter(`attr:${p.taskId}`, 0.3);
      const attrOrders = wholeStore
        ? storeOrders
        : Math.round(storeOrders * Math.min(0.8, Math.max(0.2, share)));
      const attrRevenue = storeOrders > 0 ? round((storeRevenue * attrOrders) / storeOrders) : 0;
      // Costs: a gross margin rate on the attributed revenue, so the demo shows
      // a margin after COGS. F9 is left uncosted, so that card reads n/a.
      const costed = p.taskId !== "demo-f9";
      const cogs = costed ? round(attrRevenue * 0.33) : null;
      const cm1 = cogs === null ? null : round(attrRevenue - cogs);
      const codeMechanic = p.mechanic === "Discount code" || p.mechanic === "Personal credit";
      const codeOrders = codeMechanic ? attrOrders : Math.round(attrOrders * 0.2);
      const newCustomers = Math.round(attrOrders * 0.55);
      // The store can never have fewer new customers than the promo inside it.
      const storeNew = wholeStore ? newCustomers : Math.max(newCustomers, Math.round(storeOrders * 0.45));
      return {
        taskId: p.taskId,
        phase: p.name.split(" · ")[0],
        mechanic: p.mechanic,
        windowStart: p.start,
        windowEnd: p.end,
        windowDays: daysBetween(p.start, p.end) + 1,
        isComplete: p.end <= asOf,
        isStorewide: wholeStore,
        hasCouponData: true,
        daysElapsed: daysBetween(p.start, p.end < asOf ? p.end : asOf) + 1,
        attrOrders,
        attrUnits: null,
        attrGiftUnits: p.mechanic === "Bundle" ? attrOrders : 0,
        attrRevenue,
        attrNewCustomers: newCustomers,
        attrReturningCustomers: attrOrders - newCustomers,
        attrCodeOrders: codeOrders,
        attrNoCodeOrders: attrOrders - codeOrders,
        attrDiscountedOrders: codeOrders,
        attrDiscountGiven: round(attrRevenue * 0.08),
        attrCogs: cogs,
        attrOrdersCosted: costed ? attrOrders : 0,
        attrCm1: cm1,
        attrCm1Pct: cm1 === null || attrRevenue === 0 ? null : Math.round((1000 * cm1) / attrRevenue) / 10,
        attrMetaSpend: null,
        attrCm3: null,
        matchCoupon: codeMechanic ? attrOrders : 0,
        matchSku: wholeStore || codeMechanic ? 0 : attrOrders,
        matchGiftSku: 0,
        matchUtm: 0,
        matchWindow: wholeStore ? attrOrders : 0,
        storeOrders,
        storeRevenue: round(storeRevenue),
        storeNewCustomers: storeNew,
        storeUnits: null,
        storeCm3: round(storeRevenue * 0.67 - spend),
        metaSpend: round(spend),
        storeMerPct: storeRevenue > 0 ? (100 * spend) / storeRevenue : null,
        merCapPct: p.merCap,
      };
    });

  const actuals: ActualDay[] = [...days.entries()]
    .filter(([, f]) => f.actual !== null)
    .map(([date, f]) => ({
      date,
      orders: f.actual!.orders,
      revenue: f.actual!.revenue,
      new_customers: f.actual!.new_customers,
      ad_spend: f.actual!.ad_spend,
      cm3: f.actual!.cm3,
      amer: f.actual!.paid > 0 ? f.actual!.ncr / f.actual!.paid : null,
      new_customer_revenue: f.actual!.ncr,
      paid_spend: f.actual!.paid,
    }));

  const data: PlanData = { rows, curve, promoPerf, tasks, actuals };
  cache = { key: asOf, data };
  return data;
}
