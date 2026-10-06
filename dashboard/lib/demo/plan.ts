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
  CurveDay,
  PacingRow,
  PacingStatus,
  PeriodType,
  PlanData,
  PlanMetric,
  PlanTask,
  PromoPerf,
} from "@/lib/plan/types";
import { PLAN_METRICS } from "@/lib/plan/types";

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
}

interface DayFacts {
  target: Record<PlanMetric, number>;
  actual: Record<PlanMetric, number> | null;
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
    { taskId: "demo-g1", name: "G1 · Winning ad", start: addDays(m0, 6), end: addDays(m0, 16), thresholdOrders: null, merCap: null },
    { taskId: "demo-g2", name: "G2 · Second month on plan", start: m1, end: monthEnd(m1), thresholdOrders: null, merCap: 27 },
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

/** The demo's month plan, one entry per metric. */
function monthPlan(month: string, promos: Promo[]): Record<PlanMetric, number> {
  const out: Record<PlanMetric, number> = { orders: 0, revenue: 0, new_customers: 0, ad_spend: 0 };
  for (const d of datesFrom(month, monthEnd(month))) {
    const s = spineDay(d);
    const mult = shortestPromo(promos, d)?.mult ?? 1;
    out.orders += s.orders * mult;
    out.revenue += s.netSales * mult;
    out.new_customers += s.newCustomerOrders * mult;
    out.ad_spend += s.paidSpend;
  }
  const lift = 1.05 * jitter(`plan:${month}`, 0.07);
  return {
    orders: Math.round(out.orders * lift),
    revenue: Math.round((out.revenue * lift) / 100) * 100,
    new_customers: Math.round(out.new_customers * lift),
    ad_spend: Math.round((out.ad_spend * 0.97) / 100) * 100,
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
      let actual: Record<PlanMetric, number> | null = null;
      if (d <= asOf) {
        const s = spineDay(d);
        const mult = (promo?.mult ?? 1) * jitter(`plan-act:${d}`, 0.12);
        const orders = Math.max(0, Math.round(s.orders * mult));
        const ratio = s.orders > 0 ? orders / s.orders : 0;
        actual = {
          orders,
          revenue: round(s.netSales * ratio),
          new_customers: Math.min(orders, Math.round(s.newCustomerOrders * ratio)),
          ad_spend: round(s.paidSpend * (promo ? 1.15 : 1)),
        };
      }
      out.set(d, {
        target: {
          orders: plan.orders * share,
          revenue: plan.revenue * share,
          new_customers: plan.new_customers * share,
          ad_spend: plan.ad_spend / dates.length,
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
  isTargetPartial?: boolean;
}

/** Pacing rows of one period, all four metrics, by the warehouse's rules. */
function pace(spec: PeriodSpec, days: Map<string, DayFacts>, asOf: string): PacingRow[] {
  const dates = datesFrom(spec.start, spec.end).filter((d) => days.has(d));
  const T = { orders: 0, revenue: 0, new_customers: 0, ad_spend: 0 } as Record<PlanMetric, number>;
  const CT = { ...T };
  const C = { ...T };
  for (const d of dates) {
    const f = days.get(d)!;
    for (const m of PLAN_METRICS) {
      T[m] += f.target[m];
      if (d <= asOf) {
        CT[m] += f.target[m];
        C[m] += f.actual?.[m] ?? 0;
      }
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

  return PLAN_METRICS.map((metric): PacingRow => {
    let t = T[metric];
    let ct = CT[metric];
    if (metric === "orders" && spec.thresholdOrders != null && T.orders > 0) {
      ct = spec.thresholdOrders * (CT.orders / T.orders);
      t = spec.thresholdOrders;
    }
    const c = started ? C[metric] : null;
    const k = metric === "orders" ? K_ORDERS : T.orders > 0 ? (K_ORDERS * T[metric]) / T.orders : K_ORDERS;
    const pf = c !== null ? (c + k) / (ct + k) : 1;
    const projected = !started ? t : closed ? c : c! + (t - ct) * pf;

    let half: number | null = null;
    if (started && !closed && metric !== "ad_spend") {
      const R = (t - ct) * pf;
      if (metric === "revenue" && aov !== null) half = Z90 * Math.sqrt(PHI * Math.max(0, remOrders) * (1 + CV * CV)) * aov;
      else half = Z90 * Math.sqrt(PHI * Math.max(0, R));
    }

    const pacePct = c !== null && ct > 0 ? (100 * c) / ct : null;
    let z: number | null = null;
    if (c !== null && ct > 0 && metric !== "ad_spend") {
      const sd = metric === "revenue" && aov !== null ? Math.sqrt(PHI * CT.orders * (1 + CV * CV)) * aov : Math.sqrt(PHI * ct);
      z = sd > 0 ? (c - ct) / sd : null;
    }

    let status: PacingStatus = "on_track";
    let tooEarly = false;
    if (!started) status = "not_started";
    else if (closed) status = "closed";
    else if (pacePct !== null) {
      if (metric === "ad_spend") status = pacePct < 80 ? "off_track" : pacePct < 90 ? "behind" : pacePct > 110 ? "ahead" : "on_track";
      else if (z !== null) {
        if (pacePct < 90 && z <= -1.645) status = "off_track";
        else if (pacePct < 97 && z <= -1) status = "behind";
        else if (pacePct > 110 && z >= 1.645) status = "ahead";
      }
      const short = daysTotal < 7;
      if ((spec.type === "month" || spec.type === "quarter") && daysElapsed < 5) tooEarly = true;
      if ((spec.type === "promo" || spec.type === "gate") && short && ct < 0.3 * t) tooEarly = true;
      if (tooEarly) status = "on_track";
    }
    if (spec.type === "day") {
      status = started ? "closed" : "not_started";
      tooEarly = false;
    }

    const merPlan = T.revenue > 0 ? (100 * T.ad_spend) / T.revenue : null;
    const merActual = started && C.revenue > 0 ? (100 * C.ad_spend) / C.revenue : null;

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
    };
  });
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
    specs.push({ type: "quarter", id: quarterId(qs), label: `Q${n} ${y}`, start: qs, end: monthEnd(months[i + 2]), taskId: `demo-q-${quarterId(qs)}`, planStatus: "approved", merCap: 27 });
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

  // Checkpoint thresholds: a touch above the curve, as a stretch bar.
  const curveOrders = (s: string, e: string) =>
    datesFrom(s, e).reduce((sum, d) => sum + (days.get(d)?.target.orders ?? 0), 0);
  for (const g of gates) {
    const threshold = g.thresholdOrders ?? Math.round(curveOrders(g.start, g.end) * 1.05);
    specs.push({ type: "gate", id: g.taskId, label: g.name, start: g.start, end: g.end, taskId: g.taskId, planStatus: "approved", merCap: g.merCap, thresholdOrders: threshold });
  }

  const rows = specs.flatMap((s) => pace(s, days, asOf));

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
      mechanic: null,
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
      mechanic: p.mechanic,
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
      const share = 0.42 * jitter(`attr:${p.taskId}`, 0.3);
      const attrOrders = Math.round(storeOrders * Math.min(0.8, Math.max(0.2, share)));
      return {
        taskId: p.taskId,
        phase: p.name.split(" · ")[0],
        mechanic: p.mechanic,
        windowStart: p.start,
        windowEnd: p.end,
        isComplete: p.end <= asOf,
        attrOrders,
        attrRevenue: storeOrders > 0 ? round((storeRevenue * attrOrders) / storeOrders) : 0,
        storeOrders,
        storeRevenue: round(storeRevenue),
        metaSpend: round(spend),
        storeMerPct: storeRevenue > 0 ? (100 * spend) / storeRevenue : null,
        merCapPct: p.merCap,
      };
    });

  const data: PlanData = { rows, curve, promoPerf, tasks };
  cache = { key: asOf, data };
  return data;
}
