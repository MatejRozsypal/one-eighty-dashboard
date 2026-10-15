/**
 * Markets for the demo client, shaped exactly like the warehouse contract.
 *
 * The generator writes the rows `mk_market_daily`, `mk_market_orders` (as the
 * order-grain extras), `mk_market_spend_daily`, `mk_market_cohorts` and
 * `mk_market_forecast` would hold, then sums them the way the query layer
 * does. The page derives every figure from those rows through
 * `lib/markets/model.ts`, the same code that reads BigQuery, so the demo
 * exercises the real arithmetic rather than a picture of it.
 *
 * Two shapes, picked with `?region=` on the demo client only:
 *
 *   na  a US/CA brand in USD with a small tail of European orders
 *   eu  a CZ/SK brand in CZK with a ten-week-old Polish test market
 *
 * Scouting signals (the opportunity index inputs) are set so the two shapes
 * show every state between them: na has GA4 on 74 of 90 days, no confirmed
 * search terms and CPM benchmarks for US, GB and IE only (none for AU, CH,
 * RS, as in the 295 seed); eu has no GA4, search demand for DE, AT and HU,
 * CPM for CZ, DE, AT and HU, and one country (SI) with too few signals for an
 * index. PL is a sold test market in eu, so
 * the signals view excludes it, as the mart does.
 *
 * The proportions (new-customer share, AOV new vs returning, discount depth
 * and penetration, COGS %, nCAC, repeat curves, COD and free-shipping shares)
 * follow the 2026-10 market audit of a North American and a Czech client
 * (docs/sessions/2026-10-15/markets/research/data-audit.md). Volumes are
 * scaled and every series is generated, so no row is anyone's data.
 */

import { addDays, dataThrough, firstDay } from "./business";
import { jitter, unit } from "./random";
import {
  COHORT_AGES,
  MARKET_OTHER,
  MARKET_UNALLOCATED,
  type CountryOrders,
  type Allocation,
  type CohortAge,
  type CohortRow,
  type DailySums,
  type ForecastRow,
  type MarketLifetimeRaw,
  type MarketPeriodRaw,
  type MarketsRaw,
  type OrderExtras,
  type CpmBenchmark,
  type ScoutingSignalsRaw,
  type ScoutSignalRow,
} from "@/lib/markets/types";

export type DemoRegion = "na" | "eu";
export const DEMO_REGIONS: Array<{ value: DemoRegion; label: string }> = [
  { value: "na", label: "US + CA" },
  { value: "eu", label: "CZ + SK" },
];

export function parseDemoRegion(v: unknown): DemoRegion {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "eu" ? "eu" : "na";
}

interface MarketSpec {
  market: string;
  ordersPerDay: number;
  newShare: number;
  aovNew: number;
  aovRet: number;
  discountRate: number;
  /** Share of orders with a discount, at the start of the window and today. */
  penetration: [number, number];
  /** Share of all discounts given to returning orders, relative to their gross. */
  returningDiscountTilt: number;
  refundOrderRate: number;
  cogsPct: number;
  shippingPerOrder: number;
  zeroShipShare: number;
  codShare: number;
  /** Spend per new customer; null for a market with no campaigns. */
  nCac: number | null;
  /** Days before the last complete day the market's first order fell. */
  startDaysAgo: number;
  /** Orders before the generated window (an old market). */
  preHistoryOrders: number;
  localCurrency: string;
  /** Local units per base unit. */
  fx: number;
  allocation: Allocation;
  /** Cumulative repeat rate and revenue per customer by cohort age. */
  repeat: Record<CohortAge, number>;
  revenue: Record<CohortAge, number>;
  payments: Array<[string, number]>;
}

interface Shape {
  baseCurrency: string;
  platform: string;
  homeMarket: string;
  markets: MarketSpec[];
  /** Spend no rule could place, as a share of allocated spend. */
  unallocatedShare: number;
}

const US_PAY: Array<[string, number]> = [["Shopify Payments", 0.87], ["PayPal", 0.1], ["Afterpay", 0.015], ["Gift card", 0.01], ["Store credit", 0.005]];
const CZ_PAY: Array<[string, number]> = [["Card (GoPay)", 0.66], ["Bank transfer", 0.22], ["Cash on delivery", 0.08], ["Apple Pay", 0.04]];
const SK_PAY: Array<[string, number]> = [["Card (GoPay)", 0.47], ["Cash on delivery", 0.39], ["Bank transfer", 0.1], ["Apple Pay", 0.04]];

function tail(market: string, perDay: number, currency: string, fx: number, base: "USD" | "CZK"): MarketSpec {
  const usd = base === "USD";
  return {
    market,
    ordersPerDay: perDay,
    newShare: 0.4,
    aovNew: usd ? 153 : 1180,
    aovRet: usd ? 188 : 1640,
    discountRate: usd ? 0.22 : 0.09,
    penetration: usd ? [0.82, 0.84] : [0.5, 0.52],
    returningDiscountTilt: 1,
    refundOrderRate: 0.03,
    cogsPct: usd ? 0.209 : 0.33,
    shippingPerOrder: usd ? 14 : 140,
    zeroShipShare: 0.1,
    codShare: 0,
    nCac: null,
    startDaysAgo: 1400,
    preHistoryOrders: 40,
    localCurrency: currency,
    fx,
    allocation: {},
    repeat: { 30: 0.06, 60: 0.1, 90: 0.16, 180: 0.27, 365: 0.41 },
    revenue: usd ? { 30: 168, 60: 189, 90: 214, 180: 290, 365: 424 } : { 30: 1290, 60: 1400, 90: 1560, 180: 1880, 365: 2350 },
    payments: usd ? US_PAY : CZ_PAY,
  };
}

const SHAPES: Record<DemoRegion, Shape> = {
  na: {
    baseCurrency: "USD",
    platform: "shopify",
    homeMarket: "US",
    unallocatedShare: 0.02,
    markets: [
      {
        market: "US",
        ordersPerDay: 24,
        newShare: 0.22,
        aovNew: 115,
        aovRet: 156,
        discountRate: 0.12,
        penetration: [0.68, 0.67],
        returningDiscountTilt: 0.95,
        refundOrderRate: 0.022,
        cogsPct: 0.19,
        shippingPerOrder: 6.5,
        zeroShipShare: 0.35,
        codShare: 0,
        nCac: 44,
        startDaysAgo: 4600,
        preHistoryOrders: 52000,
        localCurrency: "USD",
        fx: 1,
        allocation: { campaign_name: 0.82, geo: 0.18 },
        repeat: { 30: 0.09, 60: 0.15, 90: 0.227, 180: 0.308, 365: 0.424 },
        revenue: { 30: 131, 60: 148, 90: 164, 180: 199, 365: 283 },
        payments: US_PAY,
      },
      {
        market: "CA",
        ordersPerDay: 10.8,
        newShare: 0.18,
        aovNew: 101,
        aovRet: 149,
        discountRate: 0.165,
        penetration: [0.76, 0.82],
        returningDiscountTilt: 1.12,
        refundOrderRate: 0.021,
        cogsPct: 0.253,
        shippingPerOrder: 9,
        zeroShipShare: 0.28,
        codShare: 0,
        nCac: 92,
        startDaysAgo: 1500,
        preHistoryOrders: 6100,
        localCurrency: "CAD",
        fx: 1.37,
        allocation: { campaign_name: 0.93, pro_rata: 0.07 },
        repeat: { 30: 0.08, 60: 0.14, 90: 0.219, 180: 0.311, 365: 0.422 },
        revenue: { 30: 108, 60: 121, 90: 133, 180: 165, 365: 226 },
        payments: US_PAY,
      },
      tail("GB", 0.2, "GBP", 0.79, "USD"),
      tail("IE", 0.08, "EUR", 0.92, "USD"),
      tail("CH", 0.06, "CHF", 0.88, "USD"),
      tail("RS", 0.05, "RSD", 108, "USD"),
    ],
  },
  eu: {
    baseCurrency: "CZK",
    platform: "woocommerce",
    homeMarket: "CZ",
    unallocatedShare: 0.03,
    markets: [
      {
        market: "CZ",
        ordersPerDay: 18,
        newShare: 0.14,
        aovNew: 988,
        aovRet: 1935,
        discountRate: 0.077,
        penetration: [0.55, 0.586],
        returningDiscountTilt: 1,
        refundOrderRate: 0.004,
        cogsPct: 0.3,
        shippingPerOrder: 55,
        zeroShipShare: 0.425,
        codShare: 0.08,
        nCac: 1100,
        startDaysAgo: 1460,
        preHistoryOrders: 21000,
        localCurrency: "CZK",
        fx: 1,
        allocation: { campaign_name: 0.68, geo: 0.32 },
        repeat: { 30: 0.12, 60: 0.2, 90: 0.279, 180: 0.347, 365: 0.406 },
        revenue: { 30: 1350, 60: 1600, 90: 1844, 180: 2522, 365: 3537 },
        payments: CZ_PAY,
      },
      {
        market: "SK",
        ordersPerDay: 3.2,
        newShare: 0.09,
        aovNew: 1099,
        aovRet: 1806,
        discountRate: 0.085,
        penetration: [0.6, 0.651],
        returningDiscountTilt: 1,
        refundOrderRate: 0.004,
        cogsPct: 0.32,
        shippingPerOrder: 92,
        zeroShipShare: 0.478,
        codShare: 0.39,
        nCac: 3057,
        startDaysAgo: 1300,
        preHistoryOrders: 3800,
        localCurrency: "EUR",
        fx: 1 / 25.2,
        allocation: { campaign_name: 0.6, geo: 0.4 },
        repeat: { 30: 0.18, 60: 0.3, 90: 0.418, 180: 0.516, 365: 0.541 },
        revenue: { 30: 1600, 60: 1950, 90: 2412, 180: 3311, 365: 4696 },
        payments: SK_PAY,
      },
      {
        market: "PL",
        ordersPerDay: 1.4,
        newShare: 0.78,
        aovNew: 870,
        aovRet: 1250,
        discountRate: 0.14,
        penetration: [0.7, 0.72],
        returningDiscountTilt: 1,
        refundOrderRate: 0.01,
        cogsPct: 0.31,
        shippingPerOrder: 120,
        zeroShipShare: 0.3,
        codShare: 0.12,
        nCac: 980,
        startDaysAgo: 70,
        preHistoryOrders: 0,
        localCurrency: "PLN",
        fx: 1 / 5.8,
        allocation: { campaign_name: 1 },
        repeat: { 30: 0.07, 60: 0.12, 90: 0.18, 180: 0.25, 365: 0.33 },
        revenue: { 30: 940, 60: 1010, 90: 1090, 180: 1300, 365: 1620 },
        payments: [["BLIK", 0.58], ["Card", 0.28], ["Cash on delivery", 0.12], ["Bank transfer", 0.02]],
      },
      tail("DE", 0.12, "EUR", 1 / 25.2, "CZK"),
      tail("AT", 0.06, "EUR", 1 / 25.2, "CZK"),
      tail("HU", 0.03, "HUF", 15.6, "CZK"),
    ],
  },
};

const MONTH_FACTOR = [0.86, 0.9, 0.97, 0.99, 1.02, 0.94, 0.9, 0.95, 1.03, 1.1, 1.42, 1.25];
const WEEKDAY_FACTOR = [0.9, 1.05, 1.06, 1.04, 1.02, 0.98, 0.86];
/** Volume grows about 1.5 % a month toward today. */
const MONTHLY_GROWTH = 0.015;

interface Day {
  date: string;
  sums: DailySums;
  extras: OrderExtras;
}

function emptyExtras(currency: string): OrderExtras {
  return {
    firstOrderGrossProfit: 0, firstOrderCosted: 0, discountedGross: 0, discountedDiscounts: 0,
    fullPriceRevenue: 0, newGross: 0, newDiscounts: 0, returningGross: 0, returningDiscounts: 0,
    refundedOrders: 0, localRevenue: 0, localCurrency: currency, paymentMix: [],
  };
}

function genDay(spec: MarketSpec, date: string, last: string): Day | null {
  const daysAgo = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (daysAgo > spec.startDaysAgo) return null;
  const d = new Date(`${date}T00:00:00Z`);
  const k = `mk:${spec.market}:${date}`;
  const growth = Math.pow(1 + MONTHLY_GROWTH, -daysAgo / 30.4);
  // A young market ramps up over its first weeks.
  const ramp = spec.startDaysAgo < 180 ? Math.min(1, 0.35 + (spec.startDaysAgo - daysAgo) / 60) : 1;
  const expected = spec.ordersPerDay * MONTH_FACTOR[d.getUTCMonth()] * WEEKDAY_FACTOR[d.getUTCDay()] * growth * ramp * jitter(`${k}:o`, 0.22);
  // Fractional volumes (small markets) become whole counts by a stable draw.
  const draw = (x: number, tag: string) => Math.floor(x) + (unit(`${k}:${tag}`) < x % 1 ? 1 : 0);
  const orders = draw(expected, "frac");
  if (orders === 0) return null;

  const newCustomers = Math.min(orders, draw(orders * spec.newShare * jitter(`${k}:n`, 0.25), "nf"));
  const returningOrders = orders - newCustomers;
  const newRev = newCustomers * spec.aovNew * jitter(`${k}:an`, 0.12);
  const retRev = returningOrders * spec.aovRet * jitter(`${k}:ar`, 0.12);
  const netRevenue = newRev + retRev;
  const shippingCharged = orders * spec.shippingPerOrder * (1 - spec.zeroShipShare);
  const netSales = Math.max(0, netRevenue - shippingCharged);
  const refunds = netSales * spec.refundOrderRate * 0.6;
  const discountRate = spec.discountRate * jitter(`${k}:dr`, 0.1);
  const grossSales = (netSales + refunds) / (1 - discountRate);
  const discounts = grossSales - netSales - refunds;
  const cogs = netSales * spec.cogsPct * jitter(`${k}:c`, 0.04);
  const progress = Math.max(0, 1 - daysAgo / 365);
  const pen = spec.penetration[0] + (spec.penetration[1] - spec.penetration[0]) * progress;
  const discountedOrders = Math.min(orders, draw(orders * pen, "pf"));
  // Spend follows the expected acquisitions, not the day's draw: budgets do not stop on a day with no new customer.
  const spend = spec.nCac === null ? 0 : orders * spec.newShare * spec.nCac * jitter(`${k}:s`, 0.2);

  const newShareRev = netRevenue > 0 ? newRev / netRevenue : 0;
  const newGross = grossSales * newShareRev;
  const retGross = grossSales - newGross;
  const tilt = spec.returningDiscountTilt;
  const retDiscounts = Math.min(retGross, (discounts * retGross * tilt) / (retGross * tilt + newGross || 1));
  const newDiscounts = discounts - retDiscounts;
  const salesShare = netRevenue > 0 ? netSales / netRevenue : 0;
  const firstGp = newRev * salesShare * (1 - spec.cogsPct) * 0.93;

  return {
    date,
    sums: {
      orders,
      newCustomers,
      returningOrders,
      grossSales,
      discounts,
      refunds,
      netSales,
      netRevenue,
      newCustomerRevenue: newRev,
      returningRevenue: retRev,
      newCustomerNetSales: newRev * salesShare,
      returningNetSales: retRev * salesShare,
      newCustomerGrossProfit: firstGp,
      newCustomerCostedOrders: newCustomers,
      costedNetSales: netSales,
      cogs,
      grossProfit: netSales - cogs,
      costedOrders: orders,
      discountedOrders,
      codOrders: draw(orders * spec.codShare, "cf"),
      zeroShippingOrders: draw(orders * spec.zeroShipShare, "zf"),
      shippingCharged,
      spend,
    },
    extras: {
      firstOrderGrossProfit: firstGp,
      firstOrderCosted: newCustomers,
      discountedGross: grossSales * Math.min(1, pen * 1.05),
      discountedDiscounts: discounts,
      fullPriceRevenue: netRevenue * (1 - pen) * 1.08,
      newGross,
      newDiscounts,
      returningGross: retGross,
      returningDiscounts: retDiscounts,
      refundedOrders: unit(`${k}:rf`) < orders * spec.refundOrderRate ? 1 : 0,
      localRevenue: netRevenue * spec.fx,
      localCurrency: spec.localCurrency,
      paymentMix: spec.payments.map(([method, share]) => ({ method, orders: orders * share })),
    },
  };
}

interface Generated {
  last: string;
  byMarket: Map<string, Day[]>;
}

const memo = new Map<string, Generated>();

function generate(region: DemoRegion): Generated {
  const last = dataThrough();
  const key = `${region}:${last}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const shape = SHAPES[region];
  const start = firstDay();
  const byMarket = new Map<string, Day[]>();
  for (const spec of shape.markets) {
    const days: Day[] = [];
    for (let d = start; d <= last; d = addDays(d, 1)) {
      const day = genDay(spec, d, last);
      if (day) days.push(day);
    }
    byMarket.set(spec.market, days);
  }
  const g = { last, byMarket };
  memo.clear();
  memo.set(key, g);
  return g;
}

const ZERO_SUMS: DailySums = {
  orders: 0, newCustomers: 0, returningOrders: 0, grossSales: 0, discounts: 0, refunds: 0, netSales: 0,
  netRevenue: 0, newCustomerRevenue: 0, returningRevenue: 0, newCustomerNetSales: 0, returningNetSales: 0,
  newCustomerGrossProfit: 0, newCustomerCostedOrders: 0, costedNetSales: 0, cogs: 0, grossProfit: 0, costedOrders: 0,
  discountedOrders: 0, codOrders: 0, zeroShippingOrders: 0, shippingCharged: 0, spend: 0,
};

function sumDays(days: Day[], currency: string | null): { sums: DailySums; extras: OrderExtras } | null {
  if (days.length === 0) return null;
  const s: DailySums = { ...ZERO_SUMS };
  const x = emptyExtras(currency ?? "");
  const mix = new Map<string, number>();
  for (const d of days) {
    for (const key of Object.keys(s) as Array<keyof DailySums>) {
      (s[key] as number) = (s[key] as number) + ((d.sums[key] as number) ?? 0);
    }
    for (const key of ["firstOrderGrossProfit", "firstOrderCosted", "discountedGross", "discountedDiscounts", "fullPriceRevenue", "newGross", "newDiscounts", "returningGross", "returningDiscounts", "refundedOrders", "localRevenue"] as const) {
      (x[key] as number) = (x[key] as number) + ((d.extras[key] as number) ?? 0);
    }
    for (const p of d.extras.paymentMix) mix.set(p.method, (mix.get(p.method) ?? 0) + p.orders);
  }
  x.paymentMix = [...mix.entries()].map(([method, orders]) => ({ method, orders: Math.round(orders) })).sort((a, b) => b.orders - a.orders).slice(0, 5);
  if (currency === null) {
    // OTHER spans several currencies: no local figure, exactly as the mart has it.
    x.localCurrency = null;
    x.localRevenue = null;
  }
  return { sums: s, extras: x };
}

/** Markets the demo client "configured" (mk_client_markets): the ones with campaigns. */
function configured(shape: Shape): MarketSpec[] {
  return shape.markets.filter((s) => s.nCac !== null);
}
function tails(shape: Shape): MarketSpec[] {
  return shape.markets.filter((s) => s.nCac === null);
}

function inRange(days: Day[], range: { from: string; to: string }): Day[] {
  return days.filter((d) => d.date >= range.from && d.date <= range.to);
}

/**
 * One row per configured market, every other country pooled into OTHER (the
 * mart buckets them the same way), and the spend no rule placed as
 * UNALLOCATED with spend only.
 */
function periodRows(region: DemoRegion, range: { from: string; to: string }): MarketPeriodRaw[] {
  const g = generate(region);
  const shape = SHAPES[region];
  const rows: MarketPeriodRaw[] = [];
  let allocatedSpend = 0;
  for (const spec of configured(shape)) {
    const summed = sumDays(inRange(g.byMarket.get(spec.market) ?? [], range), spec.localCurrency);
    if (!summed) continue;
    allocatedSpend += summed.sums.spend;
    rows.push({ market: spec.market, ...summed });
  }
  const other = sumDays(tails(shape).flatMap((spec) => inRange(g.byMarket.get(spec.market) ?? [], range)), null);
  if (other) rows.push({ market: MARKET_OTHER, ...other });
  if (allocatedSpend > 0) {
    rows.push({ market: MARKET_UNALLOCATED, sums: { ...ZERO_SUMS, spend: allocatedSpend * shape.unallocatedShare }, extras: null });
  }
  return rows;
}

function otherCountries(region: DemoRegion, range: { from: string; to: string }): CountryOrders[] {
  const g = generate(region);
  return tails(SHAPES[region])
    .map((spec) => {
      const s = sumDays(inRange(g.byMarket.get(spec.market) ?? [], range), spec.localCurrency)?.sums;
      return s
        ? { iso: spec.market, orders: s.orders, newCustomers: s.newCustomers, netRevenue: s.netRevenue, newCustomerNetSales: s.newCustomerNetSales ?? 0 }
        : null;
    })
    .filter((c): c is CountryOrders => c !== null);
}

function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(month: string): string {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function quarterStart(month: string): string {
  const m = Number(month.slice(5, 7));
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${month.slice(0, 4)}-${String(q).padStart(2, "0")}-01`;
}

/** Cohort rows per market and month (tails pooled into OTHER), plus their specs for the forecast. */
function cohortRows(region: DemoRegion): Array<{ row: CohortRow; spec: MarketSpec; age: number }> {
  const g = generate(region);
  const shape = SHAPES[region];
  const out = new Map<string, { row: CohortRow; spec: MarketSpec; age: number }>();
  for (const spec of shape.markets) {
    const market = spec.nCac === null ? MARKET_OTHER : spec.market;
    const byMonth = new Map<string, Day[]>();
    for (const d of g.byMarket.get(spec.market) ?? []) {
      const m = monthOf(d.date);
      const list = byMonth.get(m) ?? [];
      list.push(d);
      byMonth.set(m, list);
    }
    // A share of customers has an uncosted order within the year: GP sums and
    // GP per customer cover the costed ones only (contract amendment).
    const costedShare = region === "eu" ? 0.96 : 0.99;
    const gpRatio = (1 - spec.cogsPct) * 0.94;
    for (const [m, days] of byMonth) {
      const customers = days.reduce((t, d) => t + d.sums.newCustomers, 0);
      if (customers === 0) continue;
      const costed = Math.round(customers * costedShare);
      const age = daysBetween(monthEnd(m), g.last);
      const k = `mkc:${spec.market}:${m}`;
      const row: CohortRow = {
        market,
        cohortMonth: m,
        customers,
        costedCustomers: costed,
        repeatCustomers: {},
        revenue: {},
        gp: {},
        cohortSpend: spec.nCac === null ? 0 : days.reduce((t, d) => t + d.sums.spend, 0),
        firstOrderGp: days.reduce((t, d) => t + (d.extras.firstOrderGrossProfit ?? 0), 0) * costedShare,
      };
      for (const a of COHORT_AGES) {
        if (age < a) {
          row.repeatCustomers[a] = null;
          row.revenue[a] = null;
          row.gp[a] = null;
          continue;
        }
        const j = jitter(`${k}:${a}`, 0.08);
        row.repeatCustomers[a] = Math.round(customers * spec.repeat[a] * j);
        row.revenue[a] = customers * spec.revenue[a] * j;
        row.gp[a] = costed * spec.revenue[a] * gpRatio * j;
      }
      const key = `${market}:${m}`;
      const hit = out.get(key);
      if (!hit) {
        out.set(key, { row, spec, age });
        continue;
      }
      // Several tail countries share OTHER: one row per month, summed, as the mart has it.
      const t = hit.row;
      t.customers += row.customers;
      t.costedCustomers += row.costedCustomers;
      t.cohortSpend = (t.cohortSpend ?? 0) + (row.cohortSpend ?? 0);
      t.firstOrderGp = (t.firstOrderGp ?? 0) + (row.firstOrderGp ?? 0);
      for (const a of COHORT_AGES) {
        const add = (x: number | null | undefined, y: number | null | undefined) => (x == null || y == null ? null : x + y);
        t.repeatCustomers[a] = add(t.repeatCustomers[a], row.repeatCustomers[a]);
        t.revenue[a] = add(t.revenue[a], row.revenue[a]);
        t.gp[a] = add(t.gp[a], row.gp[a]);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.row.cohortMonth.localeCompare(b.row.cohortMonth));
}

/**
 * The forecast run, as `mk_market_forecast` writes it: every young cohort gets
 * a row; `none` carries the reason. 50+ new customers a month: monthly; 20
 * to 49: quarterly, keyed by the quarter's first month; fewer: none.
 */
function forecastRows(region: DemoRegion, cohorts: Array<{ row: CohortRow; spec: MarketSpec; age: number }>): ForecastRow[] {
  const last = generate(region).last;
  const out: ForecastRow[] = [];
  const byMarket = new Map<string, Array<{ row: CohortRow; spec: MarketSpec; age: number }>>();
  for (const c of cohorts) byMarket.set(c.row.market, [...(byMarket.get(c.row.market) ?? []), c]);
  for (const [market, list] of byMarket) {
    const recent = list.slice(-6);
    const avgNew = recent.reduce((t, c) => t + c.row.customers, 0) / Math.max(1, recent.length);
    const method = avgNew >= 50 ? "multiplier_monthly" : avgNew >= 20 ? "multiplier_quarterly" : "none";
    const young = list.filter((c) => c.age < 365);
    const none = (cohortMonth: string, age: number, reason: string) =>
      out.push({
        market, cohortMonth, customers: null, asOfAgeDays: Math.max(0, age), actualGpPerCustomer: null,
        forecastGp365PerCustomer: null, bandLow: null, bandHigh: null, multiplier: null, nReferenceCohorts: null,
        method: "none", reasonIfNone: reason, runDate: last,
      });
    if (method === "none") {
      for (const c of young) none(c.row.cohortMonth, c.age, "Under 50 new customers a month: no forecast for this market");
      continue;
    }
    // Group young cohorts by forecast key (the month, or the quarter's first month).
    const groups = new Map<string, typeof young>();
    for (const c of young) {
      const key = method === "multiplier_quarterly" ? quarterStart(c.row.cohortMonth) : c.row.cohortMonth;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const [key, members] of groups) {
      const age = Math.min(...members.map((c) => c.age));
      const asOf = COHORT_AGES.filter((a) => a < 365 && age >= a).pop();
      if (asOf === undefined) {
        none(key, age, "Cohort under 30 days old");
        continue;
      }
      const costed = members.reduce((t, c) => t + c.row.costedCustomers, 0);
      const gpAt = members.reduce((t, c) => t + ((c.row.gp[asOf] as number | null) ?? 0), 0);
      const spec = members[0].spec;
      const actual = gpAt / Math.max(1, costed);
      const mult = (spec.revenue[365] / spec.revenue[asOf]) * jitter(`mkf:${market}:${key}`, 0.06);
      const fc = actual * mult;
      const spread = 0.05 + ((365 - asOf) / 365) * 0.12 + (method === "multiplier_quarterly" ? 0.05 : 0);
      out.push({
        market, cohortMonth: key, customers: costed, asOfAgeDays: asOf, actualGpPerCustomer: actual,
        forecastGp365PerCustomer: fc, bandLow: fc * (1 - spread), bandHigh: fc * (1 + spread), multiplier: mult,
        nReferenceCohorts: method === "multiplier_monthly" ? 12 : 8, method, reasonIfNone: null, runDate: last,
      });
    }
  }
  return out;
}

/** GA4 90-day figures per candidate: sessions, engaged, unpaid engaged, add to cart, purchases. */
const DEMO_GA4: Record<DemoRegion, Record<string, [number, number, number, number, number]>> = {
  na: {
    GB: [4200, 2650, 1480, 210, 31],
    IE: [980, 610, 402, 41, 7],
    AU: [1650, 990, 720, 62, 4],
    CH: [520, 300, 170, 18, 2],
    RS: [310, 150, 122, 5, 0],
  },
  eu: {},
};
/** Core search volume per month and number of core terms. */
const DEMO_SEARCH: Record<DemoRegion, Record<string, [number, number]>> = {
  na: {},
  eu: { DE: [18400, 5], AT: [2900, 5], HU: [3600, 4] },
};
const DEMO_CPM: Record<DemoRegion, Array<[string, number, string]>> = {
  na: [["US", 16.1, "USD"], ["GB", 11.8, "USD"], ["IE", 8.3, "USD"]],
  eu: [["CZ", 5.7, "USD"], ["DE", 9.1, "USD"], ["AT", 8.6, "USD"], ["HU", 5.2, "USD"]],
};
/** Countries with orders earlier in the year but none generated (signals view only). */
const DEMO_SIGNAL_ONLY: Record<DemoRegion, Record<string, [number, number, number]>> = {
  na: {},
  eu: { SI: [2, 2, 2240] },
};
const DEMO_GA4_DAYS: Record<DemoRegion, number | null> = { na: 74, eu: null };

/** `mart.market_scouting_signals` for the demo client, plus its vertical and CPM rows. */
function scoutingSignals(region: DemoRegion): ScoutingSignalsRaw {
  const g = generate(region);
  const shape = SHAPES[region];
  const year = { from: addDays(g.last, -364), to: g.last };
  const ga4Days = DEMO_GA4_DAYS[region];
  const isos = new Set([
    ...tails(shape).map((s) => s.market),
    ...Object.keys(DEMO_GA4[region]),
    ...Object.keys(DEMO_SEARCH[region]),
    ...Object.keys(DEMO_SIGNAL_ONLY[region]),
  ]);
  const rows: ScoutSignalRow[] = [...isos].map((iso) => {
    const spec = tails(shape).find((s) => s.market === iso);
    const sums = spec ? sumDays(inRange(g.byMarket.get(iso) ?? [], year), spec.localCurrency)?.sums ?? null : null;
    const only = DEMO_SIGNAL_ONLY[region][iso];
    const orders = sums?.orders ?? only?.[0] ?? 0;
    const newCustomers = sums?.newCustomers ?? only?.[1] ?? 0;
    const net = sums?.netRevenue ?? only?.[2] ?? 0;
    const newNet = sums ? sums.newCustomerNetSales ?? 0 : net;
    const ga4 = DEMO_GA4[region][iso] ?? [0, 0, 0, 0, 0];
    const search = DEMO_SEARCH[region][iso];
    const withGa4 = (v: number) => (ga4Days === null ? null : v);
    return {
      iso,
      orders365: Math.round(orders),
      newCustomers365: Math.round(newCustomers),
      netRevenue365: net,
      aovNew365: newCustomers > 0 ? newNet / newCustomers : null,
      ga4Days90: ga4Days,
      sessions90: withGa4(ga4[0]),
      engagedSessions90: withGa4(ga4[1]),
      unpaidEngagedSessions90: withGa4(ga4[2]),
      addToCartSessions90: withGa4(ga4[3]),
      ga4Purchases90: withGa4(ga4[4]),
      searchVolumeCore: search?.[0] ?? null,
      searchTermsCore: search?.[1] ?? null,
      searchAsOf: search ? addDays(g.last, -1) : null,
    };
  });
  const cpm: CpmBenchmark[] = DEMO_CPM[region].map(([iso, value, currency]) => ({
    iso,
    vertical: "all_ecommerce",
    value,
    currency,
    source: "Demo benchmark",
    asOf: addDays(g.last, -30),
  }));
  return { rows, ga4Days90: ga4Days, vertical: null, cpm };
}

export function demoMarkets(
  region: DemoRegion,
  range: { from: string; to: string },
  compareRange: { from: string; to: string } | null
): MarketsRaw {
  const g = generate(region);
  const shape = SHAPES[region];
  const current = periodRows(region, range);
  const previous = compareRange ? periodRows(region, compareRange) : null;

  const allocation: Record<string, Allocation> = {};
  for (const r of current) {
    if (r.market === MARKET_UNALLOCATED) {
      allocation[r.market] = { none: r.sums.spend };
      continue;
    }
    const spec = shape.markets.find((s) => s.market === r.market);
    if (!spec || r.sums.spend <= 0) continue;
    allocation[r.market] = Object.fromEntries(Object.entries(spec.allocation).map(([k, share]) => [k, r.sums.spend * (share ?? 0)]));
  }

  const lifetime: Record<string, MarketLifetimeRaw> = {};
  for (const spec of shape.markets) {
    const market = spec.nCac === null ? MARKET_OTHER : spec.market;
    const days = g.byMarket.get(spec.market) ?? [];
    const first = addDays(g.last, -spec.startDaysAgo);
    const orders = spec.preHistoryOrders + days.reduce((t, d) => t + d.sums.orders, 0);
    const prev = lifetime[market];
    lifetime[market] = prev
      ? { firstOrderDate: prev.firstOrderDate < first ? prev.firstOrderDate : first, orders: prev.orders + orders }
      : { firstOrderDate: first, orders };
  }

  const cohorts = cohortRows(region);
  return {
    source: "demo",
    baseCurrency: shape.baseCurrency,
    platform: shape.platform,
    homeMarket: shape.homeMarket,
    lastCompleteDay: g.last,
    range,
    compareRange,
    current,
    previous,
    allocation,
    lifetime,
    configuredMarkets: configured(shape).map((s) => s.market),
    localCurrencyOf: Object.fromEntries(configured(shape).map((s) => [s.market, s.localCurrency])),
    spendMarkets365: configured(shape).map((s) => s.market),
    spendGapDays: { current: 0, previous: compareRange ? 0 : null },
    otherCountries: otherCountries(region, range),
    cohorts: cohorts.map((c) => c.row),
    forecast: forecastRows(region, cohorts),
    scoutingSignals: scoutingSignals(region),
  };
}
