/**
 * Demo shop data: orders, markets, products, unit economics, freshness.
 *
 * Every total here is summed from the same daily spine as the P&L, so the
 * Orders page and the headline agree for any range the user picks. That is the
 * property a demo lives or dies on — a prospect who spots the Orders page
 * disagreeing with the snapshot stops believing the whole screen.
 */

import type { DateRange } from "@/lib/period";
import type {
  MarketRow,
  OrderRow,
  OrdersSummary,
} from "@/lib/queries/orders";
import type { ProductRow } from "@/lib/queries/products";
import type { SegmentEconomics, UnitEconomics } from "@/lib/queries/unitEconomics";
import type { DataThrough } from "@/lib/queries/context";
import { dataThrough, day, days, type DemoDay } from "./business";
import { MARKETS, PRODUCTS, demoEmail } from "./catalog";
import { intBetween, jitter, unit } from "./random";

const sum = (rows: DemoDay[], f: (d: DemoDay) => number): number =>
  rows.reduce((a, d) => a + f(d), 0);

const div = (a: number, b: number): number | null => (b ? a / b : null);
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Discounts the brand gives away — a share of gross retail, not a measured field. */
const DISCOUNT_RATE = 0.081;

// ── Orders ─────────────────────────────────────────────────────────────────

export function demoOrdersSummary(range: DateRange): OrdersSummary | null {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return null;

  const orders = sum(rows, (d) => d.orders);
  const revenue = r2(sum(rows, (d) => d.revenue));
  const netSales = r2(sum(rows, (d) => d.netSales));
  const margin = r2(sum(rows, (d) => d.cm1));
  const returning = sum(rows, (d) => d.returningCustomerOrders);

  // Markets split the period's totals by fixed shares, with a little drift so
  // the table doesn't read as suspiciously round.
  const markets: MarketRow[] = MARKETS.map((m) => {
    const wobble = jitter(`market:${m.code}:${range.from}`, 0.08);
    const share = m.share * wobble;
    const mOrders = Math.round(orders * share);
    const mRevenue = r2(revenue * share);
    return {
      key: m.code,
      orders: mOrders,
      revenue: mRevenue,
      aov: div(mRevenue, mOrders),
      returningShare: div(returning, orders),
    };
  }).sort((a, b) => b.orders - a.orders);

  return {
    platform: "shopify",
    dimension: "country",
    orders,
    revenue,
    netSales,
    margin,
    marginRate: div(margin, revenue),
    aovNet: div(netSales, orders),
    aovInclShipping: div(revenue, orders),
    returningShare: div(returning, orders),
    markets,
    hasShippingSplit: true,
    hasDiscounts: true,
  };
}

export function demoRecentOrders(range: DateRange, limit: number): OrderRow[] {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return [];

  const out: OrderRow[] = [];
  // Walk back from the newest day, taking a few orders from each, until the
  // limit is met — the same "most recent first" shape the real query returns.
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const d = rows[i];
    const take = Math.min(d.orders, limit - out.length, 6);
    for (let n = 0; n < take; n++) {
      const key = `order:${d.date}:${n}`;
      const isReturning = unit(`${key}:ret`) < d.returningCustomerOrders / d.orders;
      const value = r2(
        (isReturning ? 88 : 61.5) * jitter(`${key}:v`, 0.55)
      );
      const netSales = r2(value * 0.942);
      out.push({
        date: d.date,
        orderNumber: `#${20000 + i * 37 + n}`,
        customerEmail: demoEmail(intBetween(`${key}:cust`, 1, 4800)),
        market: MARKETS[Math.min(MARKETS.length - 1, Math.floor(unit(`${key}:m`) * 8))]?.code ?? "US",
        revenue: value,
        netSales,
        margin: r2(value * 0.681),
        discounts: r2(value * DISCOUNT_RATE * jitter(`${key}:disc`, 0.9)),
        financialStatus: unit(`${key}:fs`) < 0.965 ? "paid" : "pending",
        isReturning,
      });
    }
  }
  return out;
}

// ── Products ───────────────────────────────────────────────────────────────

export function demoProducts(range: DateRange, limit: number): ProductRow[] {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return [];
  const revenue = sum(rows, (d) => d.revenue);

  return PRODUCTS.map((p) => {
    const share = p.share * jitter(`product:${p.name}:${range.from}`, 0.1);
    const pRevenue = r2(revenue * share);
    const units = Math.round(pRevenue / p.price);
    const margin = r2(pRevenue * p.marginPct);
    return {
      productName: p.name,
      productLine: p.line,
      units,
      revenue: pRevenue,
      margin,
      marginPct: p.marginPct,
    };
  })
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
    .slice(0, limit);
}

// ── Unit economics ─────────────────────────────────────────────────────────

function segment(
  rows: DemoDay[],
  which: "first" | "returning"
): SegmentEconomics {
  const orders =
    which === "first"
      ? sum(rows, (d) => d.newCustomerOrders)
      : sum(rows, (d) => d.returningCustomerOrders);
  const revenue =
    which === "first"
      ? sum(rows, (d) => d.newCustomerRevenue)
      : sum(rows, (d) => d.returningCustomerRevenue);

  // Returning customers buy more items per order — the whole reason the page
  // splits the two segments at all.
  const upt = which === "first" ? 1.42 : 1.94;
  const units = Math.round(orders * upt);
  const grossRetail = revenue / (1 - DISCOUNT_RATE);
  const netSales = revenue * 0.942;
  const cogsPct = which === "first" ? 0.334 : 0.305;
  const grossProfitPct = 1 - cogsPct;

  // All acquisition spend is charged to first-time orders; returning orders
  // carry none. That is the whole point of splitting the segments — the second
  // order is worth far more than the first, and the page has to show it.
  const paidSpend = which === "first" ? sum(rows, (d) => d.paidSpend) : 0;
  const paidShare = div(paidSpend, revenue) ?? 0;

  return {
    orders,
    units,
    aur: div(grossRetail, units),
    upt: div(units, orders),
    grossRetailPerOrder: div(grossRetail, orders),
    trueAov: div(netSales, orders),
    discountRate: DISCOUNT_RATE,
    cogsPct,
    grossProfitPct,
    contributionMarginPct: grossProfitPct - paidShare,
    paidSpend: r2(paidSpend),
  };
}

export function demoUnitEconomics(range: DateRange): UnitEconomics | null {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return null;
  return {
    first: segment(rows, "first"),
    returning: segment(rows, "returning"),
    hasDiscounts: true,
  };
}

// ── Context ────────────────────────────────────────────────────────────────

export function demoDataThroughContext(): DataThrough {
  const through = dataThrough();
  return { shop: through, ads: through };
}

export function demoDiscounts(range: DateRange): number | null {
  const rows = days(range.from, range.to);
  if (rows.length === 0) return null;
  const revenue = sum(rows, (d) => d.revenue);
  return r2((revenue / (1 - DISCOUNT_RATE)) * DISCOUNT_RATE);
}

/**
 * Nothing is excluded: the demo brand sells in one currency, so there is no
 * second-currency tail to drop. Returning an empty list is the honest answer,
 * not a missing one.
 */
export function demoExcludedCurrencies(): Array<{
  currency: string;
  orders: number;
  revenue: number;
}> {
  return [];
}

export { day as demoDay };
