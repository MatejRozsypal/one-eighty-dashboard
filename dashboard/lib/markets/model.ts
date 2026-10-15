/**
 * Markets: every figure on the page, derived from the contract rows.
 *
 * Pure: no BigQuery, no React. The query layer and the demo fixture both hand
 * over `MarketsRaw`; `buildModel` turns it into columns the page draws, and
 * the check script (scripts/check-markets.ts) pins the rules below.
 *
 * ── Values carry their own n/a reason ───────────────────────────────────────
 * A figure is `{ v }` or `{ na: reason }`. The page shows the glyph "n/a" with
 * the reason in an (i). A reason is decided here, next to the arithmetic that
 * failed, so the explanation can never drift from the cause.
 *
 * ── Columns ─────────────────────────────────────────────────────────────────
 * Sold markets get a column each: paid spend in the trailing 365 days, the
 * client's home market, or at least 5% of net revenue in the period. Every
 * other country is pooled into "Other" (and listed one by one in Scouting).
 * Spend the allocation rules could not place stays visible in its own
 * "Unallocated" column and counts in the Total, never spread over markets.
 *
 * ── What never mixes ────────────────────────────────────────────────────────
 * Period metrics follow the date picker. Cohort metrics are read at a fixed
 * age from complete cohorts and ignore it. The LTGP forecast lives in its own
 * fields and is never part of a total, a ranking or a verdict.
 */

import {
  COHORT_AGES,
  MARKET_OTHER,
  MARKET_UNALLOCATED,
  type Allocation,
  type CohortAge,
  type CohortRow,
  type CostCard,
  type CostDay,
  type DailySums,
  type ForecastRow,
  type MarketLifetimeRaw,
  type MarketPeriodRaw,
  type MarketsRaw,
  type OrderExtras,
  type PaymentShare,
  type ScoutingSignalsRaw,
} from "@/lib/markets/types";
import { candidateSignals, opportunityIndex, scoutCandidates, type Opportunity } from "@/lib/markets/opportunity";
import { researchCandidates } from "@/lib/markets/scouting";

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type Val = { v: number; note?: string } | { na: string };

export function isNa(x: Val): x is { na: string } {
  return "na" in x;
}
export function num(x: Val | null | undefined): number | null {
  return x && !isNa(x) ? x.v : null;
}
function val(v: number | null | undefined, na: string, note?: string): Val {
  if (v === null || v === undefined || !Number.isFinite(v)) return { na };
  return note ? { v, note } : { v };
}
function ratio(a: number | null, b: number | null, naA: string, naB: string): Val {
  if (a === null) return { na: naA };
  if (b === null || b === 0) return { na: naB };
  return { v: a / b };
}

/** A metric the warehouse cannot produce for anyone yet. */
export const NOT_YET = {
  markdown: "No list-price history yet; the daily snapshot starts with F9",
  codeVsAuto: "Discount type split is not in the mart yet",
  delivery: "Delivery mix is not ingested",
  codRefusal: "COD refusal is not recorded by any platform",
  fulfilment: "No fulfilment timestamp in the mart",
  funnel: "Needs GA4 sessions by country with ISO codes (F10)",
  cpm: "Needs Meta insights with the country breakdown (F4)",
} as const;

// ---------------------------------------------------------------------------
// n/a reasons that depend on the platform
// ---------------------------------------------------------------------------

export function gapReason(
  field: "grossSales" | "discounts" | "refunds" | "cogs" | "shipping" | "payments",
  platform: string | null
): string {
  const p = (platform ?? "").toLowerCase();
  switch (field) {
    case "grossSales":
      return p === "shoptet" ? "Shoptet sends no list price, so gross sales are not ingested" : "Gross sales are not in the mart for this client";
    case "discounts":
      return p === "shoptet" ? "Shoptet discount amounts are not ingested, only a line discount flag" : "Discount amounts are not in the mart for this client";
    case "refunds":
      if (p === "shopify") return "Refund amounts are not ingested yet; the payload refunds fix is F8";
      if (p === "shoptet") return "Shoptet refunds are not ingested";
      return "Refund amounts are not in the mart for this client";
    case "cogs":
      return p === "woocommerce" ? "No COGS: no Woo line cost and no product cost rows (F7)" : "No costed orders in this range";
    case "shipping":
      return p === "shoptet" ? "Shoptet folds shipping and the payment fee into the order total" : "Shipping charged is not in the mart for this client";
    case "payments":
      return "Payment method is not ingested for this platform";
  }
}

// ---------------------------------------------------------------------------
// Summing rows (Other, Total, compare)
// ---------------------------------------------------------------------------

function addN(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/** Nullable fields stay null when any part is null: a total of what we know is not a total. */
export function sumSums(list: DailySums[]): DailySums | null {
  if (list.length === 0) return null;
  return list.slice(1).reduce<DailySums>(
    (t, s) => ({
      orders: t.orders + s.orders,
      newCustomers: t.newCustomers + s.newCustomers,
      returningOrders: t.returningOrders + s.returningOrders,
      grossSales: addN(t.grossSales, s.grossSales),
      discounts: addN(t.discounts, s.discounts),
      refunds: addN(t.refunds, s.refunds),
      netSales: t.netSales + s.netSales,
      netRevenue: t.netRevenue + s.netRevenue,
      newCustomerRevenue: t.newCustomerRevenue + s.newCustomerRevenue,
      returningRevenue: t.returningRevenue + s.returningRevenue,
      newCustomerNetSales: addN(t.newCustomerNetSales, s.newCustomerNetSales),
      returningNetSales: addN(t.returningNetSales, s.returningNetSales),
      newCustomerGrossProfit: addN(t.newCustomerGrossProfit, s.newCustomerGrossProfit),
      newCustomerCostedOrders: addN(t.newCustomerCostedOrders, s.newCustomerCostedOrders),
      costedNetSales: addN(t.costedNetSales, s.costedNetSales),
      cogs: addN(t.cogs, s.cogs),
      grossProfit: addN(t.grossProfit, s.grossProfit),
      costedOrders: t.costedOrders + s.costedOrders,
      discountedOrders: addN(t.discountedOrders, s.discountedOrders),
      codOrders: addN(t.codOrders, s.codOrders),
      zeroShippingOrders: addN(t.zeroShippingOrders, s.zeroShippingOrders),
      shippingCharged: addN(t.shippingCharged, s.shippingCharged),
      spend: t.spend + s.spend,
    }),
    { ...list[0] }
  );
}

function mergeMix(lists: PaymentShare[][]): PaymentShare[] {
  const m = new Map<string, number>();
  for (const l of lists) for (const p of l) m.set(p.method, (m.get(p.method) ?? 0) + p.orders);
  return [...m.entries()].map(([method, orders]) => ({ method, orders })).sort((a, b) => b.orders - a.orders).slice(0, 5);
}

export function sumExtras(list: Array<OrderExtras | null>): OrderExtras | null {
  if (list.length === 0 || list.some((x) => x === null)) return null;
  const xs = list as OrderExtras[];
  const currencies = new Set(xs.map((x) => x.localCurrency));
  return {
    firstOrderGrossProfit: xs.reduce<number | null>((t, x) => addN(t, x.firstOrderGrossProfit), 0),
    firstOrderCosted: xs.reduce((t, x) => t + x.firstOrderCosted, 0),
    discountedGross: xs.reduce<number | null>((t, x) => addN(t, x.discountedGross), 0),
    discountedDiscounts: xs.reduce<number | null>((t, x) => addN(t, x.discountedDiscounts), 0),
    fullPriceRevenue: xs.reduce<number | null>((t, x) => addN(t, x.fullPriceRevenue), 0),
    newGross: xs.reduce<number | null>((t, x) => addN(t, x.newGross), 0),
    newDiscounts: xs.reduce<number | null>((t, x) => addN(t, x.newDiscounts), 0),
    returningGross: xs.reduce<number | null>((t, x) => addN(t, x.returningGross), 0),
    returningDiscounts: xs.reduce<number | null>((t, x) => addN(t, x.returningDiscounts), 0),
    refundedOrders: xs.reduce<number | null>((t, x) => addN(t, x.refundedOrders), 0),
    localRevenue: currencies.size === 1 ? xs.reduce<number | null>((t, x) => addN(t, x.localRevenue), 0) : null,
    localCurrency: currencies.size === 1 ? xs[0].localCurrency : null,
    paymentMix: mergeMix(xs.map((x) => x.paymentMix)),
  };
}

function pool(rows: MarketPeriodRaw[], market: string): MarketPeriodRaw | null {
  const sums = sumSums(rows.map((r) => r.sums));
  if (!sums) return null;
  // A row with no orders (the unallocated spend) has no order-grain figures to add.
  const withOrders = rows.filter((r) => r.extras !== null || r.sums.orders > 0);
  return { market, sums, extras: sumExtras(withOrders.map((r) => r.extras)), costDays: poolCostDays(withOrders) };
}

/** Day counts of several markets, summed by date; null when any part has none. */
function poolCostDays(rows: MarketPeriodRaw[]): CostDay[] | null {
  if (rows.length === 0 || rows.some((r) => !r.costDays)) return null;
  const by = new Map<string, CostDay>();
  for (const r of rows) {
    for (const d of r.costDays as CostDay[]) {
      const t = by.get(d.date);
      if (!t) by.set(d.date, { ...d });
      else {
        t.orders += d.orders;
        t.codOrders = addN(t.codOrders, d.codOrders);
        t.refundedOrders = addN(t.refundedOrders, d.refundedOrders);
        t.netRevenue += d.netRevenue;
      }
    }
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Market cost cards: CM2 and CM3 (SPEC 3.4, fix F6)
// ---------------------------------------------------------------------------

/** The n/a reason of every CM2 / CM3 line of a market without a card. */
export const NO_CARD = "No cost card for this market (Settings > Market costs)";

/**
 * A market's costs beyond COGS over one range, from its cost card(s). Money in
 * base currency. `notes` say what a card states but the data cannot apply
 * (COD orders or refunds not ingested); the line is then subtracted without it.
 */
export interface MarketCosts {
  /** Shipping and fulfilment cost: card cost per order x orders. */
  shipCost: number;
  /** Return handling: card cost per refunded order x refunded orders. */
  returnCost: number;
  /** Shipping charged to customers (already in net revenue, not in gross profit). */
  shipCharged: number;
  /** Payment fee % x net revenue. */
  pctFees: number;
  /** COD fee x COD orders. */
  codFees: number;
  /** Fixed monthly market cost, pro rata over the days of the range. */
  fixed: number;
  shipNotes: string[];
  feeNotes: string[];
}
export type CostResult = MarketCosts | { na: string };

export function isCostNa(c: CostResult): c is { na: string } {
  return "na" in c;
}

/**
 * The card in effect on a day: the latest one that started on or before it.
 * Before the first card, the first card applies: the owner types today's rates
 * and expects last quarter to be costed with them until history says otherwise.
 */
export function cardOn(cards: CostCard[], date: string): CostCard | null {
  if (cards.length === 0) return null;
  const sorted = [...cards].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let hit = sorted[0];
  for (const c of sorted) if (c.effectiveFrom <= date) hit = c;
  return hit;
}

function addDaysIso(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Fixed monthly cost is spread evenly: 12 months over 365 days. */
const FIXED_PER_DAY = 12 / 365;

/**
 * Applies a market's cost cards to one period. A required field left empty is
 * n/a with the field named: shipping cost and the payment fee always, the COD
 * fee once the market has COD orders, return cost once it has refunded orders.
 * The fixed monthly cost is optional (empty = none).
 */
export function marketCosts(
  cards: CostCard[],
  p: MarketPeriodRaw,
  range: { from: string; to: string },
  platform: string | null
): CostResult {
  if (cards.length === 0) return { na: NO_CARD };
  const s = p.sums;
  const days: CostDay[] =
    p.costDays ??
    (s.orders > 0 || s.netRevenue !== 0
      ? [{ date: range.to, orders: s.orders, codOrders: s.codOrders, refundedOrders: p.extras?.refundedOrders ?? null, netRevenue: s.netRevenue }]
      : []);
  const name = (c: CostCard) => `the ${c.market === "OTHER" ? "Other" : c.market} cost card from ${c.effectiveFrom}`;
  const out: MarketCosts = { shipCost: 0, returnCost: 0, shipCharged: s.shippingCharged ?? 0, pctFees: 0, codFees: 0, fixed: 0, shipNotes: [], feeNotes: [] };
  let codUnknown = false;
  let refundsUnknown = false;
  for (const d of days) {
    const c = cardOn(cards, d.date)!;
    if (d.orders > 0 && c.shipCostPerOrder === null) return { na: `Shipping cost per order is empty on ${name(c)}` };
    if (d.netRevenue !== 0 && c.payFeePct === null) return { na: `Payment fee % is empty on ${name(c)}` };
    out.shipCost += (c.shipCostPerOrder ?? 0) * d.orders;
    out.pctFees += (c.payFeePct ?? 0) * d.netRevenue;
    if (d.codOrders === null) {
      if ((c.codFee ?? 0) > 0) codUnknown = true;
    } else if (d.codOrders > 0) {
      if (c.codFee === null) return { na: `COD fee is empty on ${name(c)}, and the market has COD orders` };
      out.codFees += c.codFee * d.codOrders;
    }
    if (d.refundedOrders === null) {
      if ((c.returnCost ?? 0) > 0) refundsUnknown = true;
    } else if (d.refundedOrders > 0) {
      if (c.returnCost === null) return { na: `Return cost is empty on ${name(c)}, and the market has refunded orders` };
      out.returnCost += c.returnCost * d.refundedOrders;
    }
  }
  for (let d = range.from; d <= range.to; d = addDaysIso(d, 1)) {
    out.fixed += (cardOn(cards, d)!.fixedMonthly ?? 0) * FIXED_PER_DAY;
  }
  if (s.shippingCharged === null && (platform ?? "").toLowerCase() !== "shoptet") {
    out.shipNotes.push("Shipping charged is not in the mart, so the cost is not offset by it");
  }
  if (refundsUnknown) out.shipNotes.push("Refunded orders are not ingested, so return handling is not subtracted");
  if (codUnknown) out.feeNotes.push("COD orders are not ingested, so the COD fee is not subtracted");
  return out;
}

/** Costs of several columns added up (the Total); n/a when any column has none. */
export function sumCosts(list: Array<{ key: string; costs: CostResult }>): CostResult {
  const missing = list.filter((x) => isCostNa(x.costs));
  if (list.length === 0) return { na: NO_CARD };
  if (missing.length > 0) {
    const names = missing.map((x) => (x.key === "OTHER" ? "Other" : x.key)).join(", ");
    return { na: `Not every market has a cost card (missing: ${names}; Settings > Market costs)` };
  }
  const xs = list.map((x) => x.costs as MarketCosts);
  const uniq = (a: string[]) => [...new Set(a)];
  return {
    shipCost: xs.reduce((t, x) => t + x.shipCost, 0),
    returnCost: xs.reduce((t, x) => t + x.returnCost, 0),
    shipCharged: xs.reduce((t, x) => t + x.shipCharged, 0),
    pctFees: xs.reduce((t, x) => t + x.pctFees, 0),
    codFees: xs.reduce((t, x) => t + x.codFees, 0),
    fixed: xs.reduce((t, x) => t + x.fixed, 0),
    shipNotes: uniq(xs.flatMap((x) => x.shipNotes)),
    feeNotes: uniq(xs.flatMap((x) => x.feeNotes)),
  };
}

// ---------------------------------------------------------------------------
// Period metrics
// ---------------------------------------------------------------------------

export interface PeriodMetrics {
  orders: Val;
  newCustomers: Val;
  returningOrders: Val;
  returningRevenueShare: Val;
  shareOfClient: Val;
  grossSales: Val;
  discounts: Val;
  discountRate: Val;
  discountPenetration: Val;
  refunds: Val;
  refundRate: Val;
  netSales: Val;
  shippingCharged: Val;
  netRevenue: Val;
  aovNew: Val;
  aovReturning: Val;
  cogsPct: Val;
  grossProfit: Val;
  cm1Pct: Val;
  spend: Val;
  gpAfterAds: Val;
  gpAfterAdsPct: Val;
  /** Shipping and fulfilment cost incl. return handling, net of shipping charged (cost card). */
  shippingCost: Val;
  /** Payment fees incl. the COD fee (cost card). */
  paymentFees: Val;
  /** Fixed monthly market cost, pro rata over the range (cost card; 0 when none). */
  fixedCost: Val;
  /** CM2 = gross profit - shipping and fulfilment (net) - payment fees. */
  cm2: Val;
  cm2Pct: Val;
  /** CM3 = CM2 - ad spend - fixed market cost. */
  cm3: Val;
  cm3Pct: Val;
  /** First-order gross profit of every new customer in the range minus the ad spend. */
  firstOrderGpAfterAds: Val;
  /** First-order CM2 per new customer: first-order GP minus the market's average variable cost per order. */
  firstOrderCm2: Val;
  /** What break-even aMER is computed on. */
  breakEvenBasis: "cm2" | "cm1";
  nCac: Val;
  mer: Val;
  amer: Val;
  breakEvenAmer: Val;
  firstOrderGp: Val;
  firstOrderProfit: Val;
  avgDepth: Val;
  fullPriceShare: Val;
  newDiscountRate: Val;
  returningDiscountRate: Val;
  codShare: Val;
  zeroShippingShare: Val;
  shippingPerOrder: Val;
  /** Orders per 7 days in the range, for the maturity rule. */
  ordersPerWeek: number;
}

export function daysInclusive(range: { from: string; to: string }): number {
  const a = Date.parse(`${range.from}T00:00:00Z`);
  const b = Date.parse(`${range.to}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function periodMetrics(
  p: MarketPeriodRaw,
  ctx: {
    platform: string | null;
    clientNetRevenue: number | null;
    days: number;
    spendLabel?: string;
    /** Days in the range with no spend data for the client: spend ratios are lower bounds, so n/a. */
    spendGapDays?: number;
    /** The market's costs from its cost card(s); absent = no card. */
    costs?: CostResult;
  }
): PeriodMetrics {
  const s = p.sums;
  const x = p.extras;
  const plat = ctx.platform;
  const NOX = "Order-level figures are not available for this range";

  const noSpend = "No paid spend allocated to this market";
  const noNew = "No new customers in this range";

  const gpNa = s.grossProfit === null || s.costedOrders === 0 ? gapReason("cogs", plat) : null;
  const costedShare = s.orders > 0 ? s.costedOrders / s.orders : 0;
  const costNote =
    gpNa === null && costedShare < 0.95
      ? `Only ${Math.round(costedShare * 100)}% of orders are costed`
      : undefined;

  const gross = s.grossSales;
  const grossNa = gapReason("grossSales", plat);
  const discNa = gapReason("discounts", plat);

  const grossProfit: Val = gpNa ? { na: gpNa } : val(s.grossProfit, gpNa ?? "", costNote);
  const gpa: Val = isNa(grossProfit) ? grossProfit : { v: (s.grossProfit as number) - s.spend, ...(costNote ? { note: costNote } : {}) };

  const gap = ctx.spendGapDays ?? 0;
  const spendGap = gap > 0 ? `Spend data covers only part of this range (${gap} days without any), so spend ratios would be lower bounds` : null;
  const nCac: Val =
    spendGap ? { na: spendGap }
    : s.spend <= 0 ? { na: noSpend }
    : s.newCustomers === 0 ? { na: noNew }
    : { v: s.spend / s.newCustomers };
  // First-order GP: the daily columns when the source has them (contract
  // amendment), else the order-grain extras.
  const firstOrderGp: Val =
    s.newCustomerGrossProfit !== null && s.newCustomerCostedOrders !== null
      ? s.newCustomerCostedOrders > 0
        ? { v: s.newCustomerGrossProfit / s.newCustomerCostedOrders }
        : { na: gpNa ?? gapReason("cogs", plat) }
      : !x ? { na: NOX }
      : x.firstOrderGrossProfit === null || x.firstOrderCosted === 0 ? { na: gpNa ?? gapReason("cogs", plat) }
      : { v: x.firstOrderGrossProfit / x.firstOrderCosted };
  // AOV on net sales (contract amendment); net revenue on a source without the column.
  const aovNew = ratio(s.newCustomerNetSales ?? s.newCustomerRevenue, s.newCustomers, "", noNew);

  // ── CM2 and CM3 from the cost card ──────────────────────────────────────
  const costs: CostResult = ctx.costs ?? { na: NO_CARD };
  const joinNotes = (...n: Array<string | undefined>) => {
    const t = n.filter(Boolean).join(". ");
    return t || undefined;
  };
  const withNote = (v: number, note?: string): Val => (note ? { v, note } : { v });
  const shippingCost: Val = isCostNa(costs)
    ? costs
    : withNote(costs.shipCost + costs.returnCost - costs.shipCharged, joinNotes(...costs.shipNotes));
  const paymentFees: Val = isCostNa(costs) ? costs : withNote(costs.pctFees + costs.codFees, joinNotes(...costs.feeNotes));
  const fixedCost: Val = isCostNa(costs) ? costs : { v: costs.fixed };
  const cm2: Val =
    isNa(grossProfit) ? grossProfit
    : isCostNa(costs) ? costs
    : withNote(
        grossProfit.v - (costs.shipCost + costs.returnCost - costs.shipCharged) - (costs.pctFees + costs.codFees),
        joinNotes(costNote, ...costs.shipNotes, ...costs.feeNotes)
      );
  const cm3: Val =
    isNa(cm2) ? cm2
    : spendGap ? { na: spendGap }
    : withNote(cm2.v - s.spend - (fixedCost as { v: number }).v, cm2.note);
  const pctOfNet = (x: Val): Val => (isNa(x) ? x : ratio(x.v, s.netRevenue, "", "No net revenue in this range"));

  // First-order CM2 per new customer: the market's average variable cost per
  // order comes off the first-order GP, the payment fee on the new customers'
  // own revenue. Order-level costs of first orders alone are not in the mart.
  const firstOrderCm2: Val = (() => {
    if (isNa(firstOrderGp)) return firstOrderGp;
    if (isCostNa(costs)) return costs;
    if (s.orders === 0 || s.newCustomers === 0) return { na: noNew };
    const perOrder = (costs.shipCost + costs.returnCost - costs.shipCharged + costs.codFees) / s.orders;
    const feeRate = s.netRevenue !== 0 ? costs.pctFees / s.netRevenue : 0;
    return { v: firstOrderGp.v - perOrder - feeRate * (s.newCustomerRevenue / s.newCustomers) };
  })();

  // Break-even aMER on CM2 once the market has a cost card, on CM1 before.
  const beBase = isNa(firstOrderCm2) ? firstOrderGp : firstOrderCm2;
  const breakEvenBasis: "cm2" | "cm1" = isNa(firstOrderCm2) ? "cm1" : "cm2";
  const breakEvenAmer: Val =
    isNa(beBase) ? beBase
    : isNa(aovNew) ? aovNew
    : beBase.v <= 0 ? { na: breakEvenBasis === "cm2" ? "First-order CM2 is at or below 0" : "First-order gross profit is at or below 0" }
    : { v: aovNew.v / beBase.v };

  const firstOrderGpAfterAds: Val =
    spendGap ? { na: spendGap }
    : s.newCustomers === 0 ? { na: noNew }
    : isNa(firstOrderGp) ? firstOrderGp
    : { v: firstOrderGp.v * s.newCustomers - s.spend };

  return {
    orders: { v: s.orders },
    newCustomers: { v: s.newCustomers },
    returningOrders: { v: s.returningOrders },
    returningRevenueShare: ratio(s.returningRevenue, s.netRevenue, "", "No net revenue in this range"),
    shareOfClient: ratio(s.netRevenue, ctx.clientNetRevenue, "", "Client total needs every market"),
    grossSales: val(gross, grossNa),
    discounts: val(s.discounts, discNa),
    discountRate: s.discounts === null ? { na: discNa } : ratio(s.discounts, gross, discNa, grossNa),
    discountPenetration: ratio(s.discountedOrders, s.orders, discNa, "No orders in this range"),
    refunds: val(s.refunds, gapReason("refunds", plat)),
    refundRate: !x ? { na: NOX } : ratio(x.refundedOrders, s.orders, gapReason("refunds", plat), "No orders in this range"),
    netSales: { v: s.netSales },
    shippingCharged: val(s.shippingCharged, gapReason("shipping", plat)),
    netRevenue: { v: s.netRevenue },
    aovNew,
    aovReturning: ratio(s.returningNetSales ?? s.returningRevenue, s.returningOrders, "", "No returning orders in this range"),
    cogsPct: gpNa
      ? { na: gpNa }
      : ratio(s.cogs, s.costedNetSales ?? s.netSales, gpNa ?? "", "No costed net sales in this range"),
    grossProfit,
    cm1Pct: isNa(grossProfit) ? grossProfit : ratio(grossProfit.v, s.netSales, "", "No net sales in this range"),
    spend: spendGap
      ? { v: s.spend, note: `Partial: ${gap} days in this range have no spend data` }
      : { v: s.spend, ...(ctx.spendLabel ? { note: ctx.spendLabel } : {}) },
    gpAfterAds: spendGap && !isNa(gpa) ? { na: spendGap } : gpa,
    gpAfterAdsPct: spendGap ? { na: spendGap } : isNa(gpa) ? gpa : ratio(gpa.v, s.netRevenue, "", "No net revenue in this range"),
    shippingCost,
    paymentFees,
    fixedCost,
    cm2,
    cm2Pct: pctOfNet(cm2),
    cm3,
    cm3Pct: pctOfNet(cm3),
    firstOrderGpAfterAds,
    firstOrderCm2,
    breakEvenBasis,
    nCac,
    mer: spendGap ? { na: spendGap } : s.spend <= 0 ? { na: noSpend } : { v: s.netRevenue / s.spend },
    amer: spendGap ? { na: spendGap } : s.spend <= 0 ? { na: noSpend } : { v: s.newCustomerRevenue / s.spend },
    breakEvenAmer,
    firstOrderGp,
    firstOrderProfit: isNa(firstOrderGp) ? firstOrderGp : isNa(nCac) ? nCac : { v: firstOrderGp.v - nCac.v },
    avgDepth: !x ? { na: NOX } : ratio(x.discountedDiscounts, x.discountedGross, discNa, "No discounted orders in this range"),
    fullPriceShare: !x ? { na: NOX } : ratio(x.fullPriceRevenue, s.netRevenue, discNa, "No net revenue in this range"),
    newDiscountRate: !x ? { na: NOX } : ratio(x.newDiscounts, x.newGross, discNa, grossNa),
    returningDiscountRate: !x ? { na: NOX } : ratio(x.returningDiscounts, x.returningGross, discNa, grossNa),
    codShare: ratio(s.codOrders, s.orders, gapReason("payments", plat), "No orders in this range"),
    zeroShippingShare: ratio(s.zeroShippingOrders, s.orders, gapReason("shipping", plat), "No orders in this range"),
    shippingPerOrder: ratio(s.shippingCharged, s.orders, gapReason("shipping", plat), "No orders in this range"),
    ordersPerWeek: s.orders / (ctx.days / 7),
  };
}

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

/** Complete cohorts read per age: the latest this many months that reached it. */
export const COHORT_WINDOW = 12;

export interface CohortPoint {
  age: CohortAge;
  customers: number;
  months: number;
  repeatRate: Val;
  revenuePerCustomer: Val;
  gpPerCustomer: Val;
  cac: Val;
  ltgpCac: Val;
}

export type Payback =
  | { days: number; firstOrder: boolean }
  | { notYet: true; reachedAge: number }
  | { na: string };

export interface CohortSummary {
  points: Partial<Record<CohortAge, CohortPoint>>;
  /** First-order GP per customer over the latest complete cohorts: the curve at day 0. */
  firstOrderGpPerCustomer: Val;
  payback: Payback;
}

/** Cohort rows of several markets, summed month by month. */
function poolCohorts(rows: CohortRow[]): CohortRow[] {
  const by = new Map<string, CohortRow>();
  for (const r of rows) {
    const t = by.get(r.cohortMonth);
    if (!t) {
      by.set(r.cohortMonth, {
        ...r,
        repeatCustomers: { ...r.repeatCustomers },
        revenue: { ...r.revenue },
        gp: { ...r.gp },
      });
      continue;
    }
    t.customers += r.customers;
    t.costedCustomers += r.costedCustomers;
    for (const a of COHORT_AGES) {
      t.repeatCustomers[a] = addN(t.repeatCustomers[a] ?? null, r.repeatCustomers[a] ?? null);
      t.revenue[a] = addN(t.revenue[a] ?? null, r.revenue[a] ?? null);
      t.gp[a] = addN(t.gp[a] ?? null, r.gp[a] ?? null);
    }
    t.cohortSpend = addN(t.cohortSpend, r.cohortSpend);
    t.firstOrderGp = addN(t.firstOrderGp, r.firstOrderGp);
  }
  return [...by.values()].sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
}

export function cohortSummary(
  rows: CohortRow[],
  ctx: { platform: string | null; nCac: Val }
): CohortSummary {
  const months = poolCohorts(rows);
  const points: Partial<Record<CohortAge, CohortPoint>> = {};
  const gpReason = gapReason("cogs", ctx.platform);

  for (const age of COHORT_AGES) {
    const reached = months.filter((m) => m.revenue[age] !== null && m.revenue[age] !== undefined && m.customers > 0);
    const win = reached.slice(-COHORT_WINDOW);
    if (win.length === 0) continue;
    const customers = win.reduce((t, m) => t + m.customers, 0);
    const costed = win.reduce((t, m) => t + m.costedCustomers, 0);
    const sumOf = (pick: (m: CohortRow) => number | null | undefined) =>
      win.reduce<number | null>((t, m) => addN(t, pick(m) ?? null), 0);
    const rep = sumOf((m) => m.repeatCustomers[age]);
    const rev = sumOf((m) => m.revenue[age]);
    const gp = sumOf((m) => m.gp[age]);
    const spend = sumOf((m) => m.cohortSpend);

    // GP sums cover costed customers only (contract amendment): divide by those.
    const gpPerCustomer: Val = gp === null || costed === 0 ? { na: gpReason } : { v: gp / costed };
    const cac: Val =
      spend === null ? { na: "Spend history does not reach these cohort months" }
      : spend <= 0 ? { na: "No paid spend in these cohort months" }
      : { v: spend / customers };
    points[age] = {
      age,
      customers,
      months: win.length,
      repeatRate: rep === null ? { na: "Repeat counts are not in the mart" } : { v: rep / customers },
      revenuePerCustomer: rev === null ? { na: "Cohort revenue is not in the mart" } : { v: rev / customers },
      gpPerCustomer,
      cac,
      ltgpCac: isNa(gpPerCustomer) ? gpPerCustomer : isNa(cac) ? cac : { v: gpPerCustomer.v / cac.v },
    };
  }

  // Day 0 of the curve: first-order GP per customer over the latest complete
  // year of cohorts (those that reached 365 d), or the latest 12 otherwise.
  const base = months.filter((m) => m.customers > 0).slice(-COHORT_WINDOW);
  const fgSum = base.reduce<number | null>((t, m) => addN(t, m.firstOrderGp), 0);
  const fgCust = base.reduce((t, m) => t + m.costedCustomers, 0);
  const firstOrderGpPerCustomer: Val =
    base.length === 0 ? { na: "No cohorts for this market" } : fgSum === null || fgCust === 0 ? { na: gpReason } : { v: fgSum / fgCust };

  return { points, firstOrderGpPerCustomer, payback: payback(points, firstOrderGpPerCustomer, ctx.nCac) };
}

/**
 * First day cumulative GP per customer crosses nCAC, linear between the ages
 * the warehouse reads. "Not yet" when the latest age read is still below it.
 */
export function payback(
  points: Partial<Record<CohortAge, CohortPoint>>,
  day0: Val,
  nCac: Val
): Payback {
  if (isNa(nCac)) return { na: nCac.na };
  if (isNa(day0)) return { na: day0.na };
  const curve: Array<[number, number]> = [[0, day0.v]];
  for (const a of COHORT_AGES) {
    const p = points[a];
    if (p && !isNa(p.gpPerCustomer)) curve.push([a, p.gpPerCustomer.v]);
  }
  if (curve[0][1] >= nCac.v) return { days: 0, firstOrder: true };
  for (let i = 1; i < curve.length; i++) {
    const [a0, v0] = curve[i - 1];
    const [a1, v1] = curve[i];
    if (v1 >= nCac.v) {
      const t = v1 === v0 ? 0 : (nCac.v - v0) / (v1 - v0);
      return { days: Math.round(a0 + t * (a1 - a0)), firstOrder: false };
    }
  }
  if (curve.length === 1) return { na: "No cohort GP to read payback from" };
  return { notYet: true, reachedAge: curve[curve.length - 1][0] };
}

// ---------------------------------------------------------------------------
// Forecast (Option A, maturity multiplier). Display only.
// ---------------------------------------------------------------------------

export interface ForecastSummary {
  /** Null when there is no forecast; `reason` says why. */
  value: {
    asOfAge: number;
    actual: number;
    forecast: number;
    low: number;
    high: number;
    customers: number;
    cohorts: number;
    method: string;
    references: number;
  } | null;
  reason: string;
  ltgpCac: Val;
}

function monthsFrom(first: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${first.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Pools the latest run's forecast rows for young cohorts. A `none` row is the
 * warehouse saying the backtest does not support a forecast there (no COGS,
 * volume, too young, before the market's start age); it is never filled in,
 * its reason is what the page shows. Quarterly rows carry the quarter's first
 * month and cover three cohort months for the CAC.
 */
export function forecastSummary(
  forecastRows: ForecastRow[],
  cohortRows: CohortRow[],
  lastCompleteDay: string
): ForecastSummary {
  const horizon = new Date(Date.parse(`${lastCompleteDay}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 7);
  const usable = forecastRows.filter(
    (f) =>
      f.method !== "none" &&
      f.forecastGp365PerCustomer !== null &&
      f.actualGpPerCustomer !== null &&
      f.asOfAgeDays < 365 &&
      f.cohortMonth.slice(0, 7) > horizon
  );

  if (usable.length === 0) {
    const latest = [...forecastRows].sort((a, b) => b.cohortMonth.localeCompare(a.cohortMonth))[0];
    const reason =
      latest?.reasonIfNone ??
      (forecastRows.length === 0 ? "No forecast rows for this market" : "No young cohort has a forecast yet");
    return { value: null, reason, ltgpCac: { na: reason } };
  }

  const rowOf = (market: string, month: string) => cohortRows.find((r) => r.market === market && r.cohortMonth.slice(0, 7) === month.slice(0, 7));

  let w = 0, actual = 0, fc = 0, lo = 0, hi = 0, age = 0, refs = 0;
  let spend: number | null = 0;
  let allCustomers = 0;
  const methods = new Set<string>();
  for (const f of usable) {
    const months = monthsFrom(f.cohortMonth, f.method === "multiplier_quarterly" ? 3 : 1);
    const rows = months.map((m) => rowOf(f.market, m)).filter((r): r is CohortRow => r !== undefined);
    // Weight: the forecast's own costed customers; an older source falls back to the cohort rows.
    const c = f.customers ?? rows.reduce((t, r) => t + r.costedCustomers, 0);
    if (c <= 0) continue;
    w += c;
    actual += (f.actualGpPerCustomer as number) * c;
    fc += (f.forecastGp365PerCustomer as number) * c;
    lo += (f.bandLow ?? (f.forecastGp365PerCustomer as number)) * c;
    hi += (f.bandHigh ?? (f.forecastGp365PerCustomer as number)) * c;
    age += f.asOfAgeDays * c;
    refs = Math.max(refs, f.nReferenceCohorts ?? 0);
    for (const r of rows) {
      spend = addN(spend, r.cohortSpend);
      allCustomers += r.customers;
    }
    if (rows.length === 0) spend = null;
    methods.add(f.method);
  }
  if (w === 0) return { value: null, reason: "No customers in the forecast cohorts", ltgpCac: { na: "No customers in the forecast cohorts" } };

  const forecast = fc / w;
  const ltgpCac: Val =
    spend === null ? { na: "Spend history does not reach these cohort months" }
    : spend <= 0 || allCustomers === 0 ? { na: "No paid spend in these cohort months" }
    : { v: forecast / (spend / allCustomers) };
  return {
    value: {
      asOfAge: Math.round(age / w),
      actual: actual / w,
      forecast,
      low: lo / w,
      high: hi / w,
      customers: w,
      cohorts: usable.length,
      method: methods.has("multiplier_quarterly") ? "quarterly cohorts" : "monthly cohorts",
      references: refs,
    },
    reason: "",
    ltgpCac,
  };
}

// ---------------------------------------------------------------------------
// Maturity and verdict (SPEC section 4)
// ---------------------------------------------------------------------------

export type Maturity = "Young" | "Directional" | "Established";

export function maturity(
  lifetime: MarketLifetimeRaw | null,
  cur: PeriodMetrics,
  lastCompleteDay: string
): { level: Maturity; why: string } {
  if (lifetime) {
    const ageDays = (Date.parse(`${lastCompleteDay}T00:00:00Z`) - Date.parse(`${lifetime.firstOrderDate}T00:00:00Z`)) / 86_400_000;
    if (lifetime.orders < 100) return { level: "Young", why: "Under 100 orders lifetime" };
    if (ageDays < 90) return { level: "Young", why: "First order under 90 days ago" };
  }
  const nc = num(cur.newCustomers) ?? 0;
  if (cur.ordersPerWeek < 50) return { level: "Directional", why: "Under 50 orders a week in this range" };
  if (nc < 30) return { level: "Directional", why: "Under 30 new customers in this range" };
  return { level: "Established", why: "" };
}

export type VerdictKey = "scale" | "hold" | "fix-acquisition" | "fix-structure" | "exit" | "none";

export interface Verdict {
  key: VerdictKey;
  label: string;
  /** Rules ran on CM1 because the market has no cost card (no CM2). */
  onCm1: boolean;
  why: string;
}

export const VERDICT_LABEL: Record<VerdictKey, string> = {
  scale: "Scale",
  hold: "Hold",
  "fix-acquisition": "Fix acquisition",
  "fix-structure": "Fix structure",
  exit: "Exit or pause",
  none: "No verdict",
};

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

export function verdict(input: {
  market: string;
  homeMarket: string | null;
  maturity: Maturity;
  cur: PeriodMetrics;
  prev: PeriodMetrics | null;
  home: PeriodMetrics | null;
  ltgp365: Val;
  payback: Payback;
}): Verdict {
  const { cur, prev, home } = input;
  // CM2 basis once the market has a cost card (CM2 and CM3 both measured);
  // CM1 before, and the chip says "on CM1".
  const onCm2 = !isNa(cur.cm2) && !isNa(cur.cm3);
  const none = (why: string): Verdict => ({ key: "none", label: VERDICT_LABEL.none, onCm1: false, why });
  const make = (key: VerdictKey, why: string): Verdict => ({ key, label: VERDICT_LABEL[key], onCm1: !onCm2, why });

  if (input.maturity === "Young") return none("Young market: read the leading indicators instead of a verdict");
  if (isNa(cur.grossProfit)) return none(cur.grossProfit.na);
  const profitVal = onCm2 ? cur.cm3 : cur.gpAfterAds;
  if (isNa(profitVal)) return none(profitVal.na);
  const profit = profitVal.v;
  const P = onCm2 ? "CM3" : "GP after ads";
  const profitPct = num(onCm2 ? cur.cm3Pct : cur.gpAfterAdsPct);

  // Exit: deep loss now and in the comparison period, with no improvement.
  const prevPct = prev ? num(onCm2 ? prev.cm3Pct : prev.gpAfterAdsPct) : null;
  const prevProfit = prev ? num(onCm2 ? prev.cm3 : prev.gpAfterAds) : null;
  if (profitPct !== null && profitPct < -0.1 && prevPct !== null && prevPct < -0.1 && prevProfit !== null && profit <= prevProfit) {
    return make("exit", `${P} is ${pct1(profitPct)} of net revenue, below −10% in both periods and not improving.`);
  }

  // Fix structure: margin more than 5 pp under the home market. CM2 margin
  // when both have a cost card, gross margin otherwise.
  const structureOnCm2 = onCm2 && home !== null && !isNa(home.cm2Pct);
  const margin = num(structureOnCm2 ? cur.cm2Pct : cur.cm1Pct);
  const homeMargin = home ? num(structureOnCm2 ? home.cm2Pct : home.cm1Pct) : null;
  const marginName = structureOnCm2 ? "CM2 margin" : "Gross margin";
  const isHome = input.market === input.homeMarket;
  if (!isHome && margin !== null && homeMargin !== null && homeMargin - margin > 0.05) {
    const gaps: Array<[string, number]> = [];
    const c = num(cur.cogsPct), hc = home ? num(home.cogsPct) : null;
    if (c !== null && hc !== null) gaps.push(["COGS", c - hc]);
    const d = num(cur.discountRate), hd = home ? num(home.discountRate) : null;
    if (d !== null && hd !== null) gaps.push(["discounts", d - hd]);
    if (structureOnCm2 && home) {
      const share = (x: Val, m: PeriodMetrics) => {
        const a = num(x), n = num(m.netRevenue);
        return a !== null && n ? a / n : null;
      };
      const sh = share(cur.shippingCost, cur), hsh = share(home.shippingCost, home);
      if (sh !== null && hsh !== null) gaps.push(["shipping and fulfilment", sh - hsh]);
      const f = share(cur.paymentFees, cur), hf = share(home.paymentFees, home);
      if (f !== null && hf !== null) gaps.push(["payment fees", f - hf]);
    }
    gaps.sort((a, b) => b[1] - a[1]);
    const driver = gaps[0] && gaps[0][1] > 0 ? ` Driver: ${gaps[0][0]}, ${(gaps[0][1] * 100).toFixed(1)} pp above ${input.homeMarket}.` : "";
    return make("fix-structure", `${marginName} ${pct1(margin)} vs ${pct1(homeMargin)} in ${input.homeMarket}.${driver}`);
  }

  const ltgp = num(input.ltgp365);
  const pb = "days" in input.payback ? input.payback.days : null;
  if (profit <= 0 || (ltgp !== null && ltgp < 2)) {
    return make(
      "fix-acquisition",
      profit <= 0
        ? `${P} at or below 0 while ${marginName.toLowerCase()} is within 5 pp of home.`
        : `LTGP:CAC at 365 d is ${ltgp!.toFixed(2)}, under 2.0.`
    );
  }

  const amer = num(cur.amer);
  const be = num(cur.breakEvenAmer);
  const amerOk = amer !== null && be !== null && amer > be * 1.1;
  const amerNear = amer !== null && be !== null && Math.abs(amer - be) <= be * 0.1;
  if ((ltgp !== null && ltgp >= 3) || (pb !== null && pb < 180)) {
    if (amerOk) {
      return make(
        "scale",
        `${P} above 0, ${ltgp !== null && ltgp >= 3 ? `LTGP:CAC 365 d ${ltgp.toFixed(2)}` : `payback ${pb} d`}, aMER ${amer!.toFixed(2)} vs break-even ${be!.toFixed(2)}.`
      );
    }
  }
  if ((ltgp !== null && ltgp >= 2 && ltgp < 3) || amerNear) {
    return make("hold", ltgp !== null && ltgp < 3 ? `LTGP:CAC at 365 d is ${ltgp.toFixed(2)}, between 2 and 3.` : "aMER within 10% of break-even.");
  }
  const missing: string[] = [];
  if (ltgp === null) missing.push(`LTGP:CAC 365 d (${isNa(input.ltgp365) ? input.ltgp365.na.toLowerCase() : "n/a"})`);
  if (amer === null || be === null) missing.push("aMER or its break-even");
  return none(missing.length ? `No rule matched; missing ${missing.join(" and ")}.` : `${P} above 0, but no Scale or Hold rule matched.`);
}

// ---------------------------------------------------------------------------
// The page model
// ---------------------------------------------------------------------------

export type ColumnKind = "sold" | "other" | "unallocated" | "total";

export interface MarketColumn {
  key: string;
  kind: ColumnKind;
  /** ISO codes the column covers (Other lists its countries). */
  members: string[];
  cur: PeriodMetrics;
  prev: PeriodMetrics | null;
  localCurrency: string | null;
  /** Local units per base unit, per period: SUM(net revenue local) / SUM(net revenue). */
  rate: { cur: number | null; prev: number | null };
  allocation: Allocation;
  lifetime: MarketLifetimeRaw | null;
  cohorts: CohortSummary | null;
  forecast: ForecastSummary | null;
  maturity: { level: Maturity; why: string };
  verdict: Verdict | null;
  /** Payment mix, current period. */
  paymentMix: PaymentShare[];
}

export interface MarketsModel {
  baseCurrency: string;
  platform: string | null;
  homeMarket: string | null;
  lastCompleteDay: string;
  days: number;
  hasCompare: boolean;
  /** Sold markets in rank order, then Other. */
  markets: MarketColumn[];
  unallocated: MarketColumn | null;
  total: MarketColumn;
  ranking: { key: RankKey; why: string };
  /** Countries pooled into Other, with their own period figures, for Scouting. */
  scouting: Array<{ iso: string; orders: number; netRevenue: number; newCustomers: number; aovNew: Val }>;
  /** Scouting candidates: signals view + research + countries with orders, minus the sold set. */
  candidates: string[];
  /** Opportunity index per candidate, ranked (lib/markets/opportunity). */
  opportunity: Opportunity[];
  /** The raw signals behind the index; null when the view cannot be read. */
  signals: ScoutingSignalsRaw | null;
  /** Candidates drawn and labelled on the Scouting map: research plus the top indexed. */
  scoutMap: string[];
}

/** How many indexed candidates the Scouting map labels next to the research ones. */
export const SCOUT_MAP_TOP = 8;

export type RankKey = "cm3" | "gpAfterAds" | "grossProfit" | "netRevenue";

export const RANK_LABEL: Record<RankKey, string> = {
  cm3: "CM3",
  gpAfterAds: "GP after ads",
  grossProfit: "gross profit",
  netRevenue: "net revenue",
};

/** Fallbacks below CM3, which ranks only once every sold market has a cost card. */
const RANK_KEYS: RankKey[] = ["gpAfterAds", "grossProfit", "netRevenue"];

export function soldMarkets(raw: MarketsRaw): string[] {
  // The client's market config is the sold set when it exists.
  if (raw.configuredMarkets && raw.configuredMarkets.length > 0) {
    return raw.configuredMarkets.filter((m) => m !== MARKET_OTHER && m !== MARKET_UNALLOCATED);
  }
  const clientNet = raw.current.reduce((t, r) => t + r.sums.netRevenue, 0);
  const real = (m: string) => m !== MARKET_OTHER && m !== MARKET_UNALLOCATED;
  const set = new Set<string>();
  for (const m of raw.spendMarkets365) if (real(m)) set.add(m);
  if (raw.homeMarket) set.add(raw.homeMarket);
  for (const r of raw.current) {
    if (real(r.market) && clientNet > 0 && r.sums.netRevenue / clientNet >= 0.05) set.add(r.market);
    if (real(r.market) && r.sums.spend > 0) set.add(r.market);
  }
  return [...set];
}

function emptySums(): DailySums {
  return {
    orders: 0, newCustomers: 0, returningOrders: 0, grossSales: 0, discounts: 0, refunds: 0,
    netSales: 0, netRevenue: 0, newCustomerRevenue: 0, returningRevenue: 0,
    newCustomerNetSales: 0, returningNetSales: 0, newCustomerGrossProfit: null, newCustomerCostedOrders: 0, costedNetSales: 0,
    cogs: null, grossProfit: null, costedOrders: 0, discountedOrders: 0, codOrders: 0, zeroShippingOrders: 0, shippingCharged: 0, spend: 0,
  };
}

function localRate(p: MarketPeriodRaw | null): number | null {
  const x = p?.extras;
  if (!p || !x || x.localRevenue === null || x.localCurrency === null || p.sums.netRevenue === 0) return null;
  return x.localRevenue / p.sums.netRevenue;
}

function allocationLabel(a: Allocation | undefined): string | undefined {
  if (!a) return undefined;
  const total = Object.values(a).reduce((t, v) => t + (v ?? 0), 0);
  if (total <= 0) return undefined;
  const names: Record<string, string> = { geo: "platform geo", campaign_name: "campaign name", client_default: "client country", pro_rata: "new-customer share split", none: "no rule" };
  const parts = Object.entries(a)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
    .map(([k, v]) => `${Math.round(((v ?? 0) / total) * 100)}% ${names[k] ?? k}`);
  return `Allocated by ${parts.join(", ")}`;
}

export function buildModel(raw: MarketsRaw): MarketsModel {
  const days = daysInclusive(raw.range);
  const prevDays = raw.compareRange ? daysInclusive(raw.compareRange) : days;
  const sold = soldMarkets(raw);
  const isSold = (m: string) => sold.includes(m);
  const isOtherMember = (m: string) => m !== MARKET_UNALLOCATED && !isSold(m);

  const curBy = new Map(raw.current.map((r) => [r.market, r]));
  const prevBy = new Map((raw.previous ?? []).map((r) => [r.market, r]));
  const clientNet = raw.current.filter((r) => r.market !== MARKET_UNALLOCATED).reduce((t, r) => t + r.sums.netRevenue, 0);
  const clientNetPrev = (raw.previous ?? []).filter((r) => r.market !== MARKET_UNALLOCATED).reduce((t, r) => t + r.sums.netRevenue, 0);

  const ctx = { platform: raw.platform, clientNetRevenue: clientNet || null, days, spendGapDays: raw.spendGapDays.current };
  const ctxPrev = { platform: raw.platform, clientNetRevenue: clientNetPrev || null, days: prevDays, spendGapDays: raw.spendGapDays.previous ?? 0 };

  const otherMembers = [...new Set([...raw.current, ...(raw.previous ?? [])].map((r) => r.market).filter(isOtherMember))];

  type Spec = { key: string; kind: ColumnKind; members: string[]; cur: MarketPeriodRaw | null; prev: MarketPeriodRaw | null };
  const specs: Spec[] = sold.map((m) => ({
    key: m,
    kind: "sold" as const,
    members: [m],
    cur: curBy.get(m) ?? { market: m, sums: emptySums(), extras: null },
    prev: raw.previous ? prevBy.get(m) ?? null : null,
  }));
  if (otherMembers.length > 0) {
    specs.push({
      key: MARKET_OTHER,
      kind: "other",
      // A source that buckets countries into OTHER splits them back in `otherCountries`.
      members: [...new Set([...otherMembers.filter((m) => m !== MARKET_OTHER), ...raw.otherCountries.map((c) => c.iso)])].filter((m) => !isSold(m)),
      cur: pool(raw.current.filter((r) => otherMembers.includes(r.market)), MARKET_OTHER),
      prev: raw.previous ? pool(raw.previous.filter((r) => otherMembers.includes(r.market)), MARKET_OTHER) : null,
    });
  }

  // Cost cards by market. Other has its own card (key OTHER) for every country
  // pooled into it; Unallocated carries spend only and needs none.
  const cards = raw.costCards ?? [];
  const cardsOf = (key: string) => cards.filter((c) => c.market === key);
  const costsOf = (key: string, p: MarketPeriodRaw | null, range: { from: string; to: string } | null): CostResult =>
    !p || !range ? { na: NO_CARD } : marketCosts(cardsOf(key), p, range, raw.platform);
  const costed: Array<{ key: string; cur: CostResult; prev: CostResult | null }> = [];

  const homeCur = raw.homeMarket ? curBy.get(raw.homeMarket) ?? null : null;
  const homeMetrics = homeCur && raw.homeMarket ? periodMetrics(homeCur, { ...ctx, costs: costsOf(raw.homeMarket, homeCur, raw.range) }) : null;

  const build = (s: Spec): MarketColumn => {
    const curRaw = s.cur ?? { market: s.key, sums: emptySums(), extras: null };
    const spendLabel = allocationLabel(raw.allocation[s.key]);
    const costCur = costsOf(s.key, curRaw, raw.range);
    const costPrev = s.prev ? costsOf(s.key, s.prev, raw.compareRange) : null;
    if (s.kind === "sold" || s.kind === "other") costed.push({ key: s.key, cur: costCur, prev: costPrev });
    const cur = periodMetrics(curRaw, { ...ctx, spendLabel, costs: costCur });
    const prev = s.prev ? periodMetrics(s.prev, { ...ctxPrev, costs: costPrev ?? undefined }) : null;
    const cohortRows = raw.cohorts.filter((r) => s.members.includes(r.market) || (s.kind === "other" && r.market === MARKET_OTHER));
    const fcRows = raw.forecast.filter((r) => s.members.includes(r.market) || (s.kind === "other" && r.market === MARKET_OTHER));
    const cohorts = cohortRows.length ? cohortSummary(cohortRows, { platform: raw.platform, nCac: cur.nCac }) : null;
    const forecast = forecastSummary(fcRows, cohortRows, raw.lastCompleteDay);
    const lifetimeKeys = s.kind === "other" ? [...s.members, MARKET_OTHER] : s.members;
    const lifetimeParts = lifetimeKeys.map((m) => raw.lifetime[m]).filter(Boolean);
    const lifetime: MarketLifetimeRaw | null = lifetimeParts.length
      ? {
          firstOrderDate: lifetimeParts.map((l) => l.firstOrderDate).sort()[0],
          orders: lifetimeParts.reduce((t, l) => t + l.orders, 0),
        }
      : null;
    const mat = maturity(lifetime, cur, raw.lastCompleteDay);
    const ltgp365 = cohorts?.points[365]?.ltgpCac ?? { na: "No cohort has reached 365 days" };
    const v = verdict({
      market: s.key,
      homeMarket: raw.homeMarket,
      maturity: mat.level,
      cur,
      prev,
      home: homeMetrics,
      ltgp365,
      payback: cohorts?.payback ?? { na: "No cohorts for this market" },
    });
    return {
      key: s.key,
      kind: s.kind,
      members: s.members,
      cur,
      prev,
      localCurrency: curRaw.extras?.localCurrency ?? null,
      rate: { cur: localRate(curRaw), prev: localRate(s.prev) },
      allocation: raw.allocation[s.key] ?? {},
      lifetime,
      cohorts,
      forecast,
      maturity: mat,
      verdict: v,
      paymentMix: curRaw.extras?.paymentMix ?? [],
    };
  };

  const columns = specs.map(build);

  // Ranking: CM3 once every sold market has it (SPEC 1: CM3 decides), else
  // the first key every market has, GP after ads first.
  let rankKey: RankKey = "netRevenue";
  let why = "";
  const soldCols = columns.filter((c) => c.kind === "sold");
  if (soldCols.length > 0 && soldCols.every((c) => !isNa(c.cur.cm3))) {
    rankKey = "cm3";
  } else {
    for (const k of RANK_KEYS) {
      if (columns.every((c) => !isNa(c.cur[k]))) {
        rankKey = k;
        break;
      }
      const missing = columns.find((c) => isNa(c.cur[k]));
      if (!why && missing) why = (missing.cur[k] as { na: string }).na;
    }
  }
  if (rankKey === "gpAfterAds" || rankKey === "cm3") why = "";
  const ranked = columns
    .filter((c) => c.kind === "sold")
    .sort((a, b) => (num(b.cur[rankKey]) ?? -Infinity) - (num(a.cur[rankKey]) ?? -Infinity));
  const markets = [...ranked, ...columns.filter((c) => c.kind === "other")];

  // Unallocated spend: its own column, never spread.
  const unCur = curBy.get(MARKET_UNALLOCATED);
  const unPrev = prevBy.get(MARKET_UNALLOCATED);
  const unallocated =
    (unCur && unCur.sums.spend > 0) || (unPrev && unPrev.sums.spend > 0)
      ? build({
          key: MARKET_UNALLOCATED,
          kind: "unallocated",
          members: [],
          cur: unCur ?? null,
          prev: raw.previous ? unPrev ?? { market: MARKET_UNALLOCATED, sums: emptySums(), extras: null } : null,
        })
      : null;
  if (unallocated) {
    unallocated.verdict = null;
    unallocated.cohorts = null;
    unallocated.forecast = null;
  }

  // Total: every row summed, unallocated spend included. Its costs are the
  // markets' costs added up (each market on its own card), so the Total has
  // CM2 only when every column does.
  const totalCur = pool(raw.current, "TOTAL") ?? { market: "TOTAL", sums: emptySums(), extras: null };
  const totalPrev = raw.previous ? pool(raw.previous, "TOTAL") : null;
  const tCur = periodMetrics(totalCur, { ...ctx, costs: sumCosts(costed.map((c) => ({ key: c.key, costs: c.cur }))) });
  const total: MarketColumn = {
    key: "TOTAL",
    kind: "total",
    members: [],
    cur: tCur,
    prev: totalPrev
      ? periodMetrics(totalPrev, { ...ctxPrev, costs: sumCosts(costed.map((c) => ({ key: c.key, costs: c.prev ?? { na: NO_CARD } }))) })
      : null,
    localCurrency: totalCur.extras?.localCurrency ?? null,
    rate: { cur: localRate(totalCur), prev: localRate(totalPrev) },
    allocation: {},
    lifetime: null,
    cohorts: null,
    forecast: null,
    maturity: { level: "Established", why: "" },
    verdict: null,
    paymentMix: totalCur.extras?.paymentMix ?? [],
  };

  const fromRows = raw.current
    .filter((r) => isOtherMember(r.market) && r.market !== MARKET_OTHER)
    .map((r) => ({
      iso: r.market,
      orders: r.sums.orders,
      netRevenue: r.sums.netRevenue,
      newCustomers: r.sums.newCustomers,
      aovNew: ratio(r.sums.newCustomerNetSales ?? r.sums.newCustomerRevenue, r.sums.newCustomers, "", "No new customers in this range"),
    }));
  const fromCountries = raw.otherCountries
    .filter((c) => !isSold(c.iso) && !fromRows.some((r) => r.iso === c.iso))
    .map((c) => ({
      iso: c.iso,
      orders: c.orders,
      netRevenue: c.netRevenue,
      newCustomers: c.newCustomers,
      aovNew: ratio(c.newCustomerNetSales, c.newCustomers, "", "No new customers in this range"),
    }));
  const scouting = [...fromRows, ...fromCountries].sort((a, b) => b.orders - a.orders);

  const research = researchCandidates(sold).filter((iso) => !isSold(iso));
  const candidates = scoutCandidates({ sold, withOrders: scouting.map((s) => s.iso), research, signals: raw.scoutingSignals });
  const opportunity = opportunityIndex(candidateSignals({ candidates, home: raw.homeMarket, signals: raw.scoutingSignals }));
  const indexed = opportunity.filter((o) => o.index !== null).map((o) => o.iso);
  const byOrders = scouting.map((s) => s.iso).filter((iso) => candidates.includes(iso));
  const scoutMap = [...new Set([...research, ...(indexed.length ? indexed : byOrders).slice(0, SCOUT_MAP_TOP)])];

  return {
    baseCurrency: raw.baseCurrency,
    platform: raw.platform,
    homeMarket: raw.homeMarket,
    lastCompleteDay: raw.lastCompleteDay,
    days,
    hasCompare: raw.previous !== null,
    markets,
    unallocated,
    total,
    ranking: { key: rankKey, why },
    scouting,
    candidates,
    opportunity,
    signals: raw.scoutingSignals,
    scoutMap,
  };
}

// ---------------------------------------------------------------------------
// Map, discount flag, leading indicators
// ---------------------------------------------------------------------------

export type MapMetric = "gpa" | "net" | "ncac" | "ltgp" | "status";

export const MAP_METRICS: Array<{ key: MapMetric; label: string }> = [
  { key: "gpa", label: "GP after ads" },
  { key: "net", label: "Net revenue" },
  { key: "ncac", label: "nCAC" },
  { key: "ltgp", label: "LTGP:CAC" },
  { key: "status", label: "Status" },
];

/**
 * The figure a market shows on the map. `gpa` is the profit line the ranking
 * uses: CM3 once every sold market has a cost card, GP after ads before.
 */
export function mapValue(c: MarketColumn, metric: MapMetric, rank?: RankKey): Val {
  switch (metric) {
    case "gpa":
      return rank === "cm3" ? c.cur.cm3 : c.cur.gpAfterAds;
    case "net":
      return c.cur.netRevenue;
    case "ncac":
      return c.cur.nCac;
    case "ltgp":
      return c.cohorts?.points[365]?.ltgpCac ?? { na: "No cohort has reached 365 days" };
    case "status":
      return { na: "Status is categorical" };
  }
}

/**
 * Choropleth step 1..5 for a value, 0 for at-or-below zero. nCAC is lower-is-
 * better, so its scale is inverted: the cheapest market is the darkest.
 * LTGP:CAC is on a fixed 0..3 scale (3:1 is the target).
 */
export function mapStep(metric: MapMetric, v: number, all: number[]): number {
  if (metric === "ncac") {
    const lo = Math.min(...all), hi = Math.max(...all);
    if (hi === lo) return 3;
    return 1 + Math.round(((hi - v) / (hi - lo)) * 4);
  }
  if (v <= 0) return 0;
  const max = metric === "ltgp" ? 3 : Math.max(...all, 0);
  return 1 + Math.round(Math.min(1, v / (max || 1)) * 4);
}

export interface DiscountFlag {
  state: "on" | "off" | "watch" | "na";
  text: string;
}

export function discountFlag(cur: PeriodMetrics, prev: PeriodMetrics | null): DiscountFlag {
  if (isNa(cur.discountRate)) return { state: "na", text: cur.discountRate.na };
  const rate = cur.discountRate.v;
  if (rate <= 0.15) return { state: "off", text: `No flag: effective rate ${pct1(rate)} is under 15%` };
  const signals: string[] = [];
  const pen = num(cur.discountPenetration), penP = prev ? num(prev.discountPenetration) : null;
  if (pen !== null && penP !== null && pen - penP > 0.005) signals.push(`penetration up ${((pen - penP) * 100).toFixed(1)} pp`);
  const fp = num(cur.fullPriceShare), fpP = prev ? num(prev.fullPriceShare) : null;
  if (fp !== null && fpP !== null && fpP - fp > 0.005) signals.push(`full-price share down ${((fpP - fp) * 100).toFixed(1)} pp`);
  const rd = num(cur.returningDiscountRate), nd = num(cur.newDiscountRate);
  if (rd !== null && nd !== null && rd > nd) signals.push("returning customers discounted deeper than new");
  if (signals.length === 0) return { state: "watch", text: `Effective rate ${pct1(rate)} is over 15%; no second signal` };
  return { state: "on", text: `Discount-addiction flag: effective rate ${pct1(rate)}, ${signals.join(", ")}` };
}

export function indexVsHome(a: Val, home: Val | null): Val {
  if (isNa(a)) return a;
  if (!home) return { na: "No home market to compare with" };
  if (isNa(home)) return { na: home.na };
  if (home.v === 0) return { na: "Home market value is 0" };
  return { v: (a.v / home.v) * 100 };
}
