/**
 * Demo customers: cohorts, the cohort grid, lifetime value, payback and the
 * repeat-purchase gap.
 *
 * The retention curve is the one invented number that matters most here, so it
 * is stated once and everything else is read off it. Cohort sizes come from the
 * daily spine's first-time orders, so the grid's customer counts reconcile with
 * the acquisition figures on every other page.
 */

import type { CohortRow as CohortSummaryRow } from "@/lib/queries/cohorts";
import type {
  CohortGrid,
  CohortMetric,
  CohortRow,
  MarketOption,
} from "@/lib/queries/cohortGrid";
import type {
  CustomerRow,
  LifetimeSummary,
  Payback,
} from "@/lib/queries/lifetime";
import type { GapBucket, GapStats } from "@/lib/queries/gaps";
import {
  addDays,
  dataThrough,
  days,
  firstDay,
  DEMO_CURRENCY,
  type DemoDay,
} from "./business";
import { MARKETS, demoEmail } from "./catalog";
import { intBetween, jitter, unit } from "./random";

const sum = (rows: DemoDay[], f: (d: DemoDay) => number): number =>
  rows.reduce((a, d) => a + f(d), 0);
const div = (a: number, b: number): number | null => (b ? a / b : null);
const r2 = (n: number): number => Math.round(n * 100) / 100;

const MERCH_MARGIN = 0.681;

/**
 * Share of a cohort still buying in a given month offset.
 *
 * Month 0 is 1.0 by definition — everyone bought in the month they joined, and
 * a grid whose first column is not 100% is a grid with a bug. After that it is
 * a power-law decay with a floor: a loyal core keeps buying indefinitely, which
 * is what makes the far-right columns worth showing at all.
 */
export function retention(offset: number, cohortKey = ""): number {
  if (offset <= 0) return 1;
  const base = 0.28 * Math.pow(offset, -0.45);
  const wobble = cohortKey ? jitter(`ret:${cohortKey}:${offset}`, 0.14) : 1;
  return Math.max(0.042, base * wobble);
}

// ── Cohort months ──────────────────────────────────────────────────────────

function monthKey(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

interface DemoCohort {
  month: string;
  customers: number;
  ageMonths: number;
  /** New-customer revenue in the joining month — the base for later offsets. */
  firstMonthRevenue: number;
}

function cohorts(): DemoCohort[] {
  const rows = days(firstDay(), dataThrough());
  const byMonth = new Map<string, { customers: number; revenue: number }>();

  for (const d of rows) {
    const key = monthKey(d.date);
    const entry = byMonth.get(key) ?? { customers: 0, revenue: 0 };
    entry.customers += d.newCustomerOrders;
    entry.revenue += d.newCustomerRevenue;
    byMonth.set(key, entry);
  }

  const now = monthKey(dataThrough());
  return [...byMonth.entries()]
    .map(([month, v]) => ({
      month,
      customers: v.customers,
      ageMonths: monthsBetween(month, now),
      firstMonthRevenue: v.revenue,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ── Cohort summary (Cohorts page) ──────────────────────────────────────────

export function demoCohorts(monthsBack: number): CohortSummaryRow[] {
  const all = cohorts();
  const kept = monthsBack > 0 ? all.slice(-monthsBack) : all;

  return kept.map((c) => {
    const aov = div(c.firstMonthRevenue, c.customers) ?? 61.5;
    // Lifetime orders per customer = 1 (the first) + every later month's share.
    let ordersPerCustomer = 1;
    for (let o = 1; o <= c.ageMonths; o++) {
      ordersPerCustomer += retention(o, c.month) * 1.12;
    }
    const ltv = r2(ordersPerCustomer * aov * 1.08);
    const ltgp = r2(ltv * MERCH_MARGIN);

    // The year-one figures only mean anything once the cohort has had a year.
    const isMature = c.ageMonths >= 12;
    let y1Orders = 1;
    for (let o = 1; o <= 12; o++) y1Orders += retention(o, c.month) * 1.12;
    const y1Ltv = isMature ? r2(y1Orders * aov * 1.08) : null;

    const repeatRate = Math.min(
      0.62,
      0.19 + Math.min(c.ageMonths, 18) * 0.011 * jitter(`repeat:${c.month}`, 0.1)
    );

    return {
      cohortMonth: c.month,
      customerCount: c.customers,
      y1CompleteCustomers: isMature ? c.customers : null,
      ltv,
      ltgp,
      y1Ltv,
      y1Ltgp: y1Ltv === null ? null : r2(y1Ltv * MERCH_MARGIN),
      ordersPerCustomer: r2(ordersPerCustomer),
      repeatRate,
      ageMonths: c.ageMonths,
      isMature,
    };
  });
}

// ── Cohort grid ────────────────────────────────────────────────────────────

function cellValue(
  metric: CohortMetric,
  offset: number,
  c: DemoCohort,
  aov: number
): number {
  const ret = retention(offset, c.month);
  switch (metric) {
    case "retention":
      return ret;
    case "activeCustomers":
      return Math.round(c.customers * ret);
    case "revenuePerCustomer":
      return r2(ret * aov * (offset === 0 ? 1 : 1.24));
    case "cumulativeRevenuePerCustomer": {
      let total = 0;
      for (let o = 0; o <= offset; o++) {
        total += retention(o, c.month) * aov * (o === 0 ? 1 : 1.24);
      }
      return r2(total);
    }
    case "grossProfitPerCustomer":
      return r2(ret * aov * (offset === 0 ? 1 : 1.24) * MERCH_MARGIN);
    case "aov":
      return r2(aov * (offset === 0 ? 1 : 1.24) * jitter(`gaov:${c.month}:${offset}`, 0.07));
    case "ordersPerCustomer":
      return r2(ret * (offset === 0 ? 1 : 1.12));
  }
}

export function demoCohortGrid(options: {
  metric?: CohortMetric;
  markets?: string[];
  maxOffset?: number;
  monthsBack?: number;
}): CohortGrid {
  const {
    metric = "retention",
    markets: selected,
    maxOffset = 24,
    monthsBack = 12,
  } = options;

  const all = cohorts();
  const kept = monthsBack > 0 ? all.slice(-monthsBack) : all;

  // A market filter shrinks every cohort by that market's share of customers.
  const marketShare =
    selected && selected.length > 0
      ? MARKETS.filter((m) => selected.includes(m.code)).reduce((a, m) => a + m.share, 0)
      : 1;

  const rows: CohortRow[] = kept.map((c) => {
    const customers = Math.max(1, Math.round(c.customers * marketShare));
    const aov = div(c.firstMonthRevenue, c.customers) ?? 61.5;
    const cells: Array<number | null> = [];
    for (let o = 0; o <= maxOffset; o++) {
      // Null, not zero: the cohort simply has not lived this long yet.
      cells.push(o > c.ageMonths ? null : cellValue(metric, o, c, aov));
    }
    return { month: c.month, customers, cells };
  });

  // The summary row is weighted by cohort size — a mean of the rows would let a
  // 40-customer cohort pull as hard as a 4,000-customer one.
  const allCohorts: Array<number | null> = [];
  for (let o = 0; o <= maxOffset; o++) {
    let weighted = 0;
    let weight = 0;
    for (const row of rows) {
      const v = row.cells[o];
      if (v === null) continue;
      weighted += v * row.customers;
      weight += row.customers;
    }
    allCohorts.push(weight === 0 ? null : r2(weighted / weight));
  }

  const totalCustomers = rows.reduce((a, r) => a + r.customers, 0);
  const marketOptions: MarketOption[] = MARKETS.map((m) => ({
    code: m.code,
    customers: Math.round(totalCustomers * m.share),
  }));

  return {
    marketKind: "country",
    markets: marketOptions,
    rows,
    allCohorts,
    maxOffset,
    totalCustomers,
  };
}

// ── Lifetime ───────────────────────────────────────────────────────────────

export function demoLifetimeSummary(): LifetimeSummary {
  const rows = days(firstDay(), dataThrough());
  const customers = sum(rows, (d) => d.newCustomerOrders);
  const orders = sum(rows, (d) => d.orders);
  const revenue = sum(rows, (d) => d.revenue);
  const grossProfit = sum(rows, (d) => d.cm1);

  return {
    currency: DEMO_CURRENCY,
    customers,
    ltv: div(revenue, customers),
    ltgp: div(grossProfit, customers),
    ltgpRatio: div(grossProfit, revenue),
    ordersPerCustomer: div(orders, customers),
    avgAov: div(revenue, orders),
    repeatRate: 0.312,
    avgDaysActive: 147,
  };
}

export function demoTopCustomers(limit: number): CustomerRow[] {
  const through = dataThrough();

  return Array.from({ length: limit }, (_, i) => {
    const key = `top:${i}`;
    // Top customers by definition sit in the tail — many orders, high value.
    const orders = intBetween(`${key}:orders`, 6, 24) - Math.floor(i / 6);
    const aov = 88 * jitter(`${key}:aov`, 0.34);
    const lifetimeRevenue = r2(Math.max(2, orders) * aov);
    const daysActive = intBetween(`${key}:days`, 90, 780);
    const lastOrder = addDays(through, -intBetween(`${key}:recency`, 1, 70));

    return {
      email: demoEmail(9000 + i),
      firstOrder: addDays(lastOrder, -daysActive),
      lastOrder,
      orders: Math.max(2, orders),
      lifetimeRevenue,
      lifetimeGrossProfit: r2(lifetimeRevenue * MERCH_MARGIN),
      aov: r2(aov),
      daysActive,
      isReturning: true,
    };
  }).sort((a, b) => (b.lifetimeRevenue ?? 0) - (a.lifetimeRevenue ?? 0));
}

export function demoPayback(monthsBack: number): Payback | null {
  const from = addDays(dataThrough(), -Math.round(monthsBack * 30.4));
  const rows = days(from, dataThrough());
  if (rows.length === 0) return null;

  const customers = sum(rows, (d) => d.newCustomerOrders);
  const paidSpend = sum(rows, (d) => d.paidSpend);
  const firstOrderAov = div(sum(rows, (d) => d.newCustomerRevenue), customers) ?? 61.5;

  // 30 days is the first order plus a small early-repeat tail; 90 days adds the
  // first real replenishment. Both are gross profit, not revenue.
  const ltgp30 = r2(firstOrderAov * MERCH_MARGIN * 1.08);
  const ltgp90 = r2(firstOrderAov * MERCH_MARGIN * 1.32);
  const cac = div(paidSpend, customers);

  return {
    customers,
    ltgp30,
    ltgp90,
    cac,
    recovery30: cac ? ltgp30 / cac : null,
    ltgpToCac: cac ? ltgp90 / cac : null,
  };
}

// ── Repeat-purchase gap ────────────────────────────────────────────────────

/**
 * Days between consecutive orders. The shape is bimodal on purpose: a spike in
 * the first week that is mostly order hygiene rather than loyalty, then the
 * real replenishment hump where the product actually runs out.
 */
export function demoGapStats(): GapStats | null {
  const shape: Array<{ label: string; weight: number }> = [
    { label: "0–7 days", weight: 0.094 },
    { label: "8–14 days", weight: 0.061 },
    { label: "15–30 days", weight: 0.118 },
    { label: "31–60 days", weight: 0.229 },
    { label: "61–90 days", weight: 0.187 },
    { label: "91–180 days", weight: 0.176 },
    { label: "181–365 days", weight: 0.096 },
    { label: "365+ days", weight: 0.039 },
  ];

  const totalGaps = 8642;
  const counts = shape.map((s) => Math.round(totalGaps * s.weight));
  const modal = counts.indexOf(Math.max(...counts));

  const buckets: GapBucket[] = shape.map((s, i) => ({
    label: s.label,
    count: counts[i],
    isModal: i === modal,
    isOrderHygiene: i === 0,
  }));

  return {
    totalGaps: counts.reduce((a, b) => a + b, 0),
    median: 54,
    mean: 82.4,
    p25: 27,
    p75: 118,
    p90: 214,
    buckets,
    windowLabel: "all repeat orders",
  };
}
