/**
 * Markets, Trends & analysis: the pure math behind /markets/trends.
 *
 * No BigQuery, no React. The query layer (lib/queries/marketsTrends.ts) and its
 * demo twin (lib/demo/marketsTrends.ts) hand over the raw rows below; the page
 * turns them into charts through these functions, and
 * scripts/check-markets-trends.ts pins the rules.
 *
 * Period figures (nCAC, MER, GP after ads, first-order GP) are never derived
 * here a second time: a week is a `MarketPeriodRaw` and goes through
 * `periodMetrics` from lib/markets/model.ts, the code the Overview page uses,
 * so a week's nCAC and its n/a reason match the matrix by construction.
 *
 * ── Sections and their math ─────────────────────────────────────────────────
 *   portfolioPoints   nCAC vs GP per customer at 365 d (or first-order GP)
 *   weeklyTrends      Monday weeks, partial weeks flagged, compare aligned by index
 *   bridge            GP after ads change, by market and by driver (sequential)
 *   fitLog            new customers = a + b ln(weekly spend), R2, marginal nCAC
 *   reallocate        move X of weekly spend from A to B, read off the two fits
 *   funnelRows        GA4 sessions to purchase by market, indexed to home = 100
 *   inferThreshold    free-shipping threshold from zero-shipping shares by value
 */

import { isNa, marketCosts, periodMetrics, type MarketsModel, type PeriodMetrics, type Val } from "@/lib/markets/model";
import { MARKET_OTHER, MARKET_UNALLOCATED, type CostCard, type DailySums, type MarketPeriodRaw } from "@/lib/markets/types";

// ---------------------------------------------------------------------------
// Dates and weeks
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function ms(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}
export function addDaysIso(d: string, n: number): string {
  return new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
}
/** The Monday of the ISO week a date falls in. */
export function mondayOf(d: string): string {
  const dow = new Date(ms(d)).getUTCDay(); // 0 = Sunday
  return addDaysIso(d, -((dow + 6) % 7));
}

export interface WeekSlot {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** The part of the week inside the range. */
  from: string;
  to: string;
  /** Days of the week inside the range and the data (1..7). */
  days: number;
  /** Fewer than 7 days: the range or the data cuts the week. */
  partial: boolean;
}

/**
 * Monday weeks covering a range, clipped to the range and to the last day with
 * data. A week the range or the data cuts short is `partial`: drawn, but
 * hollow, and left out of fits and averages.
 */
export function weekSlots(range: { from: string; to: string }, lastDay: string): WeekSlot[] {
  const end = range.to < lastDay ? range.to : lastDay;
  if (end < range.from) return [];
  const out: WeekSlot[] = [];
  for (let w = mondayOf(range.from); w <= end; w = addDaysIso(w, 7)) {
    const from = w < range.from ? range.from : w;
    const sunday = addDaysIso(w, 6);
    const to = sunday > end ? end : sunday;
    const days = Math.round((ms(to) - ms(from)) / DAY) + 1;
    out.push({ start: w, from, to, days, partial: days < 7 });
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Oct". */
export function dayLabel(d: string): string {
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
}

// ---------------------------------------------------------------------------
// Raw shapes (query layer and demo produce these)
// ---------------------------------------------------------------------------

/** `market_daily` summed per market and Monday week, clipped to the range. */
export interface WeekRow {
  market: string;
  /** Monday of the week. */
  week: string;
  sums: DailySums;
  /** Days in the clipped week with no spend data for the client. */
  spendGapDays: number;
}

/** GA4 sessions by country (`mart.market_ga4_country_daily`), summed over a range. */
export interface Ga4Row {
  iso: string;
  sessions: number;
  engagedSessions: number;
  unpaidEngagedSessions: number;
  addToCartSessions: number;
  purchases: number;
}

export interface Ga4Raw {
  /** First and last day the client has any GA4 country row; null = not connected. */
  firstDay: string | null;
  lastDay: string | null;
  /** Days with GA4 rows inside each range. */
  daysCurrent: number;
  daysPrevious: number | null;
  current: Ga4Row[];
  previous: Ga4Row[] | null;
}

/** Order value bins of one market, fine grain (the threshold reads these). */
export interface OrderBin {
  /** Lower edge, base currency, net sales ex VAT ex shipping. */
  lo: number;
  orders: number;
  zeroShip: number;
}

export interface MarketBins {
  market: string;
  /** Fine bin width; the chart groups `DISPLAY_BIN_FACTOR` of them. */
  width: number;
  /** Values at or above this are folded into the last bin (the 99th percentile). */
  cap: number;
  bins: OrderBin[];
}

export interface OrderBinsRaw {
  /** Null when the platform sends no shipping split; the reason says why. */
  markets: MarketBins[] | null;
  reason: string | null;
}

/** Weekly spend and new customers over the fit window. */
export interface ResponseRaw {
  /** The window the fit reads (52 weeks ending with the selected range). */
  window: { from: string; to: string };
  rows: WeekRow[];
}

export interface TrendsRaw {
  source: "demo" | "mart_qa" | "mart";
  weeks: WeekRow[];
  compareWeeks: WeekRow[] | null;
}

// ---------------------------------------------------------------------------
// Market colours
// ---------------------------------------------------------------------------

/**
 * One series slot per market, the same on every chart of the page: home first,
 * the other sold markets in the order given, Other in grey.
 */
export function marketColors(keys: string[], home: string | null): Record<string, string> {
  const sold = keys.filter((k) => k !== MARKET_OTHER && k !== MARKET_UNALLOCATED);
  const ordered = home && sold.includes(home) ? [home, ...sold.filter((k) => k !== home)] : sold;
  const out: Record<string, string> = {};
  ordered.forEach((k, i) => (out[k] = `var(--series-${(i % 6) + 1})`));
  out[MARKET_OTHER] = "var(--gray-400)";
  out[MARKET_UNALLOCATED] = "var(--gray-300)";
  return out;
}

// ---------------------------------------------------------------------------
// 1. Portfolio
// ---------------------------------------------------------------------------

export type PortfolioBasis = "ltgp365" | "firstOrder";

export interface PortfolioPoint {
  market: string;
  /** nCAC in the period. */
  x: number | null;
  /** GP per customer: 365 d cohorts, else first-order GP per new customer. */
  y: number | null;
  basis: PortfolioBasis | null;
  /** Net revenue in the period (bubble size). */
  size: number;
  /** y / x. */
  ratio: number | null;
  /** Why the market is not drawn. */
  why: string | null;
}

/**
 * One point per sold market (and Other when it has an nCAC): x is the period's
 * nCAC, y GP per customer at 365 d from complete cohorts, else first-order GP
 * per new customer in the period (marked, never mixed silently).
 */
export function portfolioPoints(model: Pick<MarketsModel, "markets">): PortfolioPoint[] {
  return model.markets
    .filter((c) => c.kind === "sold" || c.kind === "other")
    .map((c): PortfolioPoint => {
      const ltgp = c.cohorts?.points[365]?.gpPerCustomer;
      const first = c.cur.firstOrderGp;
      const y: Val | undefined = ltgp && !isNa(ltgp) ? ltgp : first;
      const basis: PortfolioBasis | null = ltgp && !isNa(ltgp) ? "ltgp365" : !isNa(first) ? "firstOrder" : null;
      const x = c.cur.nCac;
      const size = isNa(c.cur.netRevenue) ? 0 : c.cur.netRevenue.v;
      const xv = isNa(x) ? null : x.v;
      const yv = y && !isNa(y) ? y.v : null;
      const why = isNa(x) ? x.na : y && isNa(y) ? y.na : null;
      return { market: c.key, x: xv, y: yv, basis: yv === null ? null : basis, size, ratio: xv && yv !== null ? yv / xv : null, why };
    })
    .filter((p) => p.market !== MARKET_OTHER || p.x !== null);
}

// ---------------------------------------------------------------------------
// 2. Weekly trends
// ---------------------------------------------------------------------------

export type TrendMetric = "netRevenue" | "newCustomers" | "nCac" | "mer" | "gpAfterAds" | "cm3";
export type TrendKind = "money" | "count" | "unit" | "ratio";

export const TREND_METRICS: Array<{ key: TrendMetric; label: string; kind: TrendKind; goodWhen: "up" | "down" }> = [
  { key: "netRevenue", label: "Net revenue", kind: "money", goodWhen: "up" },
  { key: "newCustomers", label: "New customers", kind: "count", goodWhen: "up" },
  { key: "nCac", label: "nCAC", kind: "unit", goodWhen: "down" },
  { key: "mer", label: "MER", kind: "ratio", goodWhen: "up" },
  { key: "gpAfterAds", label: "GP after ads", kind: "money", goodWhen: "up" },
  { key: "cm3", label: "CM3", kind: "money", goodWhen: "up" },
];

/** A metric of a week, read from `periodMetrics`; undefined when the model has no such field. */
function pick(m: PeriodMetrics, key: TrendMetric): Val | undefined {
  return (m as unknown as Record<string, Val | undefined>)[key];
}

export interface TrendPoint {
  week: string;
  label: string;
  partial: boolean;
  /** Value per market (null = n/a). */
  values: Record<string, number | null>;
  /** Compare period's week at the same index, per market. */
  compare: Record<string, number | null>;
  /** n/a reasons per market, for the tooltip. */
  reasons: Record<string, string>;
}

export interface TrendSeries {
  metric: TrendMetric;
  label: string;
  kind: TrendKind;
  goodWhen: "up" | "down";
  points: TrendPoint[];
}

function emptySums(): DailySums {
  return {
    orders: 0, newCustomers: 0, returningOrders: 0, grossSales: null, discounts: null, refunds: null,
    netSales: 0, netRevenue: 0, newCustomerRevenue: 0, returningRevenue: 0, newCustomerNetSales: null,
    returningNetSales: null, newCustomerGrossProfit: null, newCustomerCostedOrders: null, costedNetSales: null,
    cogs: null, grossProfit: null, costedOrders: 0, discountedOrders: null, codOrders: null,
    zeroShippingOrders: null, shippingCharged: null, spend: 0,
  };
}

function weekMetrics(
  rows: WeekRow[],
  slots: WeekSlot[],
  markets: string[],
  platform: string | null,
  cards: CostCard[]
): Array<Record<string, PeriodMetrics>> {
  const by = new Map(rows.map((r) => [`${r.market}|${r.week}`, r]));
  return slots.map((s) =>
    Object.fromEntries(
      markets.map((m) => {
        const r = by.get(`${m}|${s.start}`);
        const raw: MarketPeriodRaw = { market: m, sums: r?.sums ?? emptySums(), extras: null };
        // CM2 and CM3 come from the Overview's own cost-card arithmetic, applied to the week.
        const mine = cards.filter((c) => c.market === m);
        const costs = mine.length ? marketCosts(mine, raw, { from: s.from, to: s.to }, platform) : undefined;
        return [m, periodMetrics(raw, { platform, clientNetRevenue: null, days: s.days, spendGapDays: r?.spendGapDays ?? 0, costs })];
      })
    )
  );
}

/**
 * Weekly series per metric and market. Weeks are Monday weeks clipped to the
 * range; the compare range's weeks line up by position (week 1 with week 1).
 * CM3 is drawn only when the Overview model exposes it and the client has at
 * least one market cost card (otherwise it is n/a in every week).
 */
export function weeklyTrends(input: {
  weeks: WeekRow[];
  compareWeeks: WeekRow[] | null;
  range: { from: string; to: string };
  compareRange: { from: string; to: string } | null;
  lastDay: string;
  markets: string[];
  platform: string | null;
  costCards?: CostCard[];
}): TrendSeries[] {
  const cards = input.costCards ?? [];
  const slots = weekSlots(input.range, input.lastDay);
  const cmpSlots = input.compareRange ? weekSlots(input.compareRange, input.lastDay) : [];
  const cur = weekMetrics(input.weeks, slots, input.markets, input.platform, cards);
  const prev = input.compareWeeks ? weekMetrics(input.compareWeeks, cmpSlots, input.markets, input.platform, cards) : [];
  const sample = cur[0] ? Object.values(cur[0])[0] : undefined;
  const hasCm3 = cards.length > 0 && sample !== undefined && pick(sample, "cm3") !== undefined;

  return TREND_METRICS.filter((t) => t.key !== "cm3" || hasCm3).map((t) => ({
    metric: t.key,
    label: t.label,
    kind: t.kind,
    goodWhen: t.goodWhen,
    points: slots.map((s, i) => {
      const values: Record<string, number | null> = {};
      const compare: Record<string, number | null> = {};
      const reasons: Record<string, string> = {};
      for (const m of input.markets) {
        const v = pick(cur[i][m], t.key);
        values[m] = v && !isNa(v) ? v.v : null;
        if (v && isNa(v)) reasons[m] = v.na;
        const c = prev[i] ? pick(prev[i][m], t.key) : undefined;
        compare[m] = c && !isNa(c) ? c.v : null;
      }
      return { week: s.start, label: dayLabel(s.start), partial: s.partial, values, compare, reasons };
    }),
  }));
}

// ---------------------------------------------------------------------------
// 3. What changed: GP after ads bridge
// ---------------------------------------------------------------------------

/**
 * GP after ads factorised so the identity holds exactly:
 *
 *   GP after ads = O x A x K x M - S
 *     O  orders
 *     A  gross sales per order (AOV before discounts); net sales per order when
 *        the platform sends no gross sales, and K is then 1
 *     K  net sales / gross sales (what is kept after discounts and refunds)
 *     M  gross profit / net sales (1 - COGS %)
 *     S  ad spend
 */
export interface BridgeFactors {
  orders: number;
  aov: number;
  keep: number;
  margin: number;
  spend: number;
  /** False when gross sales are missing: the discount step is folded into AOV. */
  hasGross: boolean;
}

export type BridgeStepKey = "volume" | "aov" | "discount" | "cogs" | "spend";

/** The decomposition order (documented on the page and in TRENDS.md). */
export const BRIDGE_STEPS: Array<{ key: BridgeStepKey; label: string }> = [
  { key: "volume", label: "Orders" },
  { key: "aov", label: "AOV" },
  { key: "discount", label: "Discount rate" },
  { key: "cogs", label: "COGS %" },
  { key: "spend", label: "Ad spend" },
];

export function bridgeFactors(s: DailySums, platformReasonNoGp: string): BridgeFactors | { na: string } {
  if (s.grossProfit === null || s.costedOrders === 0) return { na: platformReasonNoGp };
  if (s.orders <= 0) return { na: "No orders in this period" };
  if (s.netSales <= 0) return { na: "No net sales in this period" };
  const hasGross = s.grossSales !== null && s.grossSales > 0;
  return {
    orders: s.orders,
    aov: hasGross ? (s.grossSales as number) / s.orders : s.netSales / s.orders,
    keep: hasGross ? s.netSales / (s.grossSales as number) : 1,
    margin: s.grossProfit / s.netSales,
    spend: s.spend,
    hasGross,
  };
}

export function gpaOf(f: BridgeFactors): number {
  return f.orders * f.aov * f.keep * f.margin - f.spend;
}

export interface BridgeStep {
  key: BridgeStepKey;
  label: string;
  /** Effect on GP after ads; null when the step is folded into another. */
  value: number | null;
  note?: string;
}

export interface Decomposition {
  before: number;
  after: number;
  steps: BridgeStep[];
}

/**
 * Sequential (chain) decomposition in the order of BRIDGE_STEPS: each factor
 * moves from compare to current while the ones before it are already current
 * and the ones after it still at compare. The steps sum to the change exactly.
 */
export function decompose(prev: BridgeFactors, cur: BridgeFactors): Decomposition {
  const folded = !prev.hasGross || !cur.hasGross;
  // Without gross sales on both sides, compare like with like: net sales per order.
  const p = folded ? { ...prev, aov: prev.aov * prev.keep, keep: 1 } : prev;
  const c = folded ? { ...cur, aov: cur.aov * cur.keep, keep: 1 } : cur;
  const volume = (c.orders - p.orders) * p.aov * p.keep * p.margin;
  const aov = c.orders * (c.aov - p.aov) * p.keep * p.margin;
  const discount = c.orders * c.aov * (c.keep - p.keep) * p.margin;
  const cogs = c.orders * c.aov * c.keep * (c.margin - p.margin);
  const spend = -(c.spend - p.spend);
  return {
    before: gpaOf(p),
    after: gpaOf(c),
    steps: [
      { key: "volume", label: "Orders", value: volume },
      { key: "aov", label: folded ? "AOV (net)" : "AOV", value: aov, ...(folded ? { note: "No gross sales for this platform: discounts are inside AOV" } : {}) },
      { key: "discount", label: "Discount rate", value: folded ? null : discount, ...(folded ? { note: "No gross sales for this platform: discounts are inside AOV" } : {}) },
      { key: "cogs", label: "COGS %", value: cogs },
      { key: "spend", label: "Ad spend", value: spend },
    ],
  };
}

export interface MarketChange {
  market: string;
  before: number | null;
  after: number | null;
  change: number | null;
  why: string | null;
  decomposition: Decomposition | null;
}

/**
 * Change in GP after ads per market (Unallocated spend is its own bar: only its
 * spend moves), and the driver split of each market.
 */
export function bridge(input: {
  current: MarketPeriodRaw[];
  previous: MarketPeriodRaw[];
  markets: string[];
  noGpReason: string;
  /** Spend data gaps: GP after ads would be a lower bound, so the bridge says n/a. */
  spendGap: string | null;
}): MarketChange[] {
  const by = (rows: MarketPeriodRaw[], m: string) => rows.find((r) => r.market === m)?.sums ?? null;
  const keys = [...input.markets];
  if (input.current.some((r) => r.market === MARKET_UNALLOCATED) || input.previous.some((r) => r.market === MARKET_UNALLOCATED)) {
    keys.push(MARKET_UNALLOCATED);
  }
  return keys.map((m): MarketChange => {
    const c = by(input.current, m) ?? emptySums();
    const p = by(input.previous, m) ?? emptySums();
    if (input.spendGap) return { market: m, before: null, after: null, change: null, why: input.spendGap, decomposition: null };
    if (m === MARKET_UNALLOCATED) {
      return { market: m, before: -p.spend, after: -c.spend, change: -(c.spend - p.spend), why: null, decomposition: null };
    }
    const fc = bridgeFactors(c, input.noGpReason);
    const fp = bridgeFactors(p, input.noGpReason);
    if ("na" in fc) return { market: m, before: null, after: null, change: null, why: fc.na, decomposition: null };
    if ("na" in fp) return { market: m, before: null, after: gpaOf(fc), change: null, why: `Compare period: ${fp.na.charAt(0).toLowerCase()}${fp.na.slice(1)}`, decomposition: null };
    const d = decompose(fp, fc);
    return { market: m, before: d.before, after: d.after, change: d.after - d.before, why: null, decomposition: d };
  });
}

// ---------------------------------------------------------------------------
// 4. Spend vs new customers
// ---------------------------------------------------------------------------

/** Below this many usable weeks the fit is hidden. */
export const MIN_FIT_WEEKS = 8;
/** Below this R2 spend explains too little of the weekly swing to read a margin off the curve. */
export const MIN_FIT_R2 = 0.1;
/** Below this R2 the fit is shown but called weak. */
export const WEAK_FIT_R2 = 0.3;

export interface LogFit {
  /** new customers per week = a + b ln(weekly spend) */
  a: number;
  b: number;
  r2: number;
  n: number;
  /** Spend range the fit has seen. */
  minX: number;
  maxX: number;
}

export interface ResponsePoint {
  week: string;
  spend: number;
  newCustomers: number;
}

/**
 * Least squares of y on ln(x) over weeks with spend > 0. Diminishing returns by
 * construction: each extra unit of spend buys b / x new customers. Null below
 * MIN_FIT_WEEKS points or when spend never varies.
 */
export function fitLog(points: Array<{ x: number; y: number }>): LogFit | null {
  const pts = points.filter((p) => p.x > 0 && Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < MIN_FIT_WEEKS) return null;
  const lx = pts.map((p) => Math.log(p.x));
  const mx = lx.reduce((t, v) => t + v, 0) / n;
  const my = pts.reduce((t, p) => t + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  pts.forEach((p, i) => {
    sxx += (lx[i] - mx) ** 2;
    sxy += (lx[i] - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  });
  if (sxx < 1e-9) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const sse = pts.reduce((t, p, i) => t + (p.y - (a + b * lx[i])) ** 2, 0);
  const r2 = syy > 0 ? 1 - sse / syy : 0;
  return { a, b, r2, n, minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)) };
}

export function predict(fit: LogFit, x: number): number {
  return x > 0 ? fit.a + fit.b * Math.log(x) : 0;
}

/** Spend per extra new customer at weekly spend x (dx / dy = x / b). Null without a positive response. */
export function marginalNcac(fit: LogFit, x: number): number | null {
  return fit.b > 0 && x > 0 ? x / fit.b : null;
}

export interface MarketResponse {
  market: string;
  points: ResponsePoint[];
  fit: LogFit | null;
  /** Why there is no usable fit. */
  why: string | null;
  /** Average weekly spend over the complete weeks of the selected range. */
  currentSpend: number | null;
  marginal: number | null;
}

/**
 * Weekly points and the fit per market. Partial weeks and weeks with spend
 * data gaps are left out (their spend is a lower bound).
 */
export function responseByMarket(input: {
  rows: WeekRow[];
  markets: string[];
  window: { from: string; to: string };
  range: { from: string; to: string };
  lastDay: string;
}): MarketResponse[] {
  const complete = new Set(weekSlots(input.window, input.lastDay).filter((s) => !s.partial).map((s) => s.start));
  const inRange = new Set(weekSlots(input.range, input.lastDay).filter((s) => !s.partial).map((s) => s.start));
  return input.markets.map((m) => {
    const rows = input.rows.filter((r) => r.market === m && complete.has(r.week) && r.spendGapDays === 0);
    const points = rows
      .map((r) => ({ week: r.week, spend: r.sums.spend, newCustomers: r.sums.newCustomers }))
      .sort((a, b) => a.week.localeCompare(b.week));
    const withSpend = points.filter((p) => p.spend > 0);
    const fit = fitLog(withSpend.map((p) => ({ x: p.spend, y: p.newCustomers })));
    const recent = points.filter((p) => inRange.has(p.week));
    const currentSpend = recent.length ? recent.reduce((t, p) => t + p.spend, 0) / recent.length : null;
    let why: string | null = null;
    if (withSpend.length < MIN_FIT_WEEKS) {
      why = withSpend.length === 0
        ? "No complete week with paid spend in this market"
        : `Only ${withSpend.length} complete ${withSpend.length === 1 ? "week" : "weeks"} with spend; the fit needs ${MIN_FIT_WEEKS}`;
    } else if (!fit) {
      why = "Weekly spend barely varies, so no curve can be fitted";
    } else if (fit.b <= 0) {
      why = "More spend did not bring more new customers in these weeks; no response to fit";
    } else if (fit.r2 < MIN_FIT_R2) {
      why = `Weekly spend explains under ${Math.round(MIN_FIT_R2 * 100)} % of the swing in new customers (R² ${fit.r2.toFixed(2)}), so no margin can be read off a curve`;
    }
    const usable = why === null ? fit : null;
    return {
      market: m,
      points,
      fit: usable,
      why,
      currentSpend,
      marginal: usable && currentSpend !== null ? marginalNcac(usable, currentSpend) : null,
    };
  });
}

export interface Reallocation {
  move: number;
  newFrom: number;
  newTo: number;
  newTotal: number;
  /** First-order GP per new customer x new customers; spend in total is unchanged. */
  gp: number | null;
  /** The receiving market goes past the weekly spend its fit has seen. */
  extrapolates: boolean;
}

/**
 * Move `move` of weekly spend from one market to another and read the change
 * in new customers off each market's fit. GP after ads changes by the
 * first-order GP of those customers (total spend is the same).
 */
export function reallocate(
  from: { fit: LogFit; spend: number; gpPerNew: number | null },
  to: { fit: LogFit; spend: number; gpPerNew: number | null },
  move: number
): Reallocation {
  const x = Math.max(0, Math.min(move, from.spend));
  // A fitted week never has fewer than 0 new customers (ln of a small spend goes negative).
  const at = (fit: LogFit, s: number) => (s > 0 ? Math.max(0, predict(fit, s)) : 0);
  const newFrom = at(from.fit, from.spend - x) - at(from.fit, from.spend);
  const newTo = at(to.fit, to.spend + x) - at(to.fit, to.spend);
  const gp = from.gpPerNew !== null && to.gpPerNew !== null ? newFrom * from.gpPerNew + newTo * to.gpPerNew : null;
  return {
    move: x,
    newFrom,
    newTo,
    newTotal: newFrom + newTo,
    gp,
    extrapolates: to.spend + x > to.fit.maxX * 1.1 || from.spend - x < from.fit.minX * 0.9,
  };
}

// ---------------------------------------------------------------------------
// 5. Funnel
// ---------------------------------------------------------------------------

export interface FunnelRow {
  market: string;
  sessions: number;
  engagedSessions: number;
  unpaidShare: Val;
  addToCartRate: Val;
  cvr: Val;
  /** Index vs the home market, home = 100. */
  index: { unpaidShare: Val; addToCartRate: Val; cvr: Val };
  /** Same figures in the compare range, null without one. */
  previous: { sessions: number; unpaidShare: Val; addToCartRate: Val; cvr: Val } | null;
}

function rate(a: number, b: number, why: string): Val {
  return b > 0 ? { v: a / b } : { na: why };
}

function idx(v: Val, home: Val | null, isHome: boolean): Val {
  if (isHome) return isNa(v) ? v : { v: 100 };
  if (!home) return { na: "No home market in the GA4 data" };
  if (isNa(v)) return v;
  if (isNa(home) || home.v === 0) return { na: "The home market has no value to index against" };
  return { v: (v.v / home.v) * 100 };
}

function bucket(rows: Ga4Row[], sold: string[]): Map<string, Ga4Row> {
  const out = new Map<string, Ga4Row>();
  for (const r of rows) {
    const key = sold.includes(r.iso) ? r.iso : MARKET_OTHER;
    const t = out.get(key) ?? { iso: key, sessions: 0, engagedSessions: 0, unpaidEngagedSessions: 0, addToCartSessions: 0, purchases: 0 };
    t.sessions += r.sessions;
    t.engagedSessions += r.engagedSessions;
    t.unpaidEngagedSessions += r.unpaidEngagedSessions;
    t.addToCartSessions += r.addToCartSessions;
    t.purchases += r.purchases;
    out.set(key, t);
  }
  return out;
}

/**
 * Sessions to purchase per market. Unpaid share = unpaid engaged sessions /
 * engaged sessions (organic and direct); add-to-cart rate and purchase CVR are
 * per session. Countries outside the sold set pool into Other.
 */
export function funnelRows(input: { current: Ga4Row[]; previous: Ga4Row[] | null; sold: string[]; home: string | null }): FunnelRow[] {
  const cur = bucket(input.current, input.sold);
  const prev = input.previous ? bucket(input.previous, input.sold) : null;
  const noSessions = "No GA4 sessions from this market in the range";
  const figures = (r: Ga4Row) => ({
    unpaidShare: rate(r.unpaidEngagedSessions, r.engagedSessions, "No engaged sessions from this market"),
    addToCartRate: rate(r.addToCartSessions, r.sessions, noSessions),
    cvr: rate(r.purchases, r.sessions, noSessions),
  });
  const homeRow = input.home ? cur.get(input.home) : undefined;
  const home = homeRow ? figures(homeRow) : null;
  const order = [...input.sold.filter((m) => cur.has(m)), ...(cur.has(MARKET_OTHER) ? [MARKET_OTHER] : [])];
  return order.map((m) => {
    const r = cur.get(m)!;
    const f = figures(r);
    const isHome = m === input.home;
    const p = prev?.get(m);
    return {
      market: m,
      sessions: r.sessions,
      engagedSessions: r.engagedSessions,
      ...f,
      index: {
        unpaidShare: idx(f.unpaidShare, home?.unpaidShare ?? null, isHome),
        addToCartRate: idx(f.addToCartRate, home?.addToCartRate ?? null, isHome),
        cvr: idx(f.cvr, home?.cvr ?? null, isHome),
      },
      previous: prev ? (p ? { sessions: p.sessions, ...figures(p) } : { sessions: 0, unpaidShare: { na: noSessions }, addToCartRate: { na: noSessions }, cvr: { na: noSessions } }) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 6. Order value and free shipping
// ---------------------------------------------------------------------------

/** Fine bins per display bin. */
export const DISPLAY_BIN_FACTOR = 5;
/** Share of orders above a value that must ship free for it to read as the threshold. */
export const THRESHOLD_SHARE = 0.8;

/** A round bin width (1, 2 or 5 x 10^k) giving about `target` bins up to `top`. */
export function niceWidth(top: number, target: number): number {
  if (!(top > 0)) return 1;
  const raw = top / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return mag * (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10);
}

export type Threshold = { value: number; share: number; ordersAbove: number } | { none: string };

/** Orders the local window at a candidate edge must hold before its share counts. */
const WINDOW_MIN_ORDERS = 5;

/**
 * The inferred free-shipping threshold, read over the fine bins: the smallest
 * bin edge where at least 80 % of the orders at or above it ship free AND at
 * least 80 % of the orders just above it do (a window of two fine bins,
 * widened until it holds 5 orders). The second test stops a cliff of
 * free-shipping orders further up from pulling the edge below the real step.
 * Needs enough orders above the edge (20, or 5 % of the market) so a handful
 * of large orders cannot set it. When most orders ship free from the first
 * bin, or almost none do, there is no threshold to infer.
 */
export function inferThreshold(bins: OrderBin[], width: number, share = THRESHOLD_SHARE): Threshold {
  const sorted = [...bins].filter((b) => b.orders > 0).sort((a, b) => a.lo - b.lo);
  const total = sorted.reduce((t, b) => t + b.orders, 0);
  const zero = sorted.reduce((t, b) => t + b.zeroShip, 0);
  if (total === 0) return { none: "No orders in this range" };
  if (zero / total < 0.05) return { none: "Under 5 % of orders ship free, so there is no threshold to read" };
  const minAbove = Math.max(20, Math.ceil(total * 0.05));
  const windowShare = (i: number): number => {
    let o = 0;
    let z = 0;
    for (let j = i; j < sorted.length; j++) {
      const within = sorted[j].lo < sorted[i].lo + 2 * width - 1e-9;
      if (!within && o >= WINDOW_MIN_ORDERS) break;
      o += sorted[j].orders;
      z += sorted[j].zeroShip;
    }
    return o > 0 ? z / o : 0;
  };
  let ordersAbove = total;
  let zeroAbove = zero;
  for (let i = 0; i < sorted.length; i++) {
    if (ordersAbove < minAbove) break;
    if (zeroAbove / ordersAbove >= share && windowShare(i) >= share) {
      if (i === 0) return { none: "Most orders ship free at every value: free shipping, not a threshold" };
      return { value: sorted[i].lo, share: zeroAbove / ordersAbove, ordersAbove };
    }
    ordersAbove -= sorted[i].orders;
    zeroAbove -= sorted[i].zeroShip;
  }
  return { none: `No value above which ${Math.round(share * 100)} % of orders ship free` };
}

export interface HistogramBar {
  lo: number;
  hi: number;
  /** Last bar holds everything from `lo` up (the cap). */
  open: boolean;
  orders: number;
  zeroShip: number;
  paidShip: number;
}

export interface Histogram {
  market: string;
  bars: HistogramBar[];
  orders: number;
  zeroShipShare: number | null;
  threshold: Threshold;
  width: number;
}

/** Fine bins grouped into display bars, with the threshold read on the fine grain. */
export function histogram(m: MarketBins): Histogram {
  const width = m.width * DISPLAY_BIN_FACTOR;
  const groups = new Map<number, HistogramBar>();
  const capLo = Math.floor(m.cap / width) * width;
  for (const b of m.bins) {
    const lo = Math.min(Math.floor(b.lo / width + 1e-9) * width, capLo);
    const g = groups.get(lo) ?? { lo, hi: lo + width, open: lo === capLo, orders: 0, zeroShip: 0, paidShip: 0 };
    g.orders += b.orders;
    g.zeroShip += b.zeroShip;
    g.paidShip = g.orders - g.zeroShip;
    groups.set(lo, g);
  }
  const bars: HistogramBar[] = [];
  const top = groups.size ? Math.max(...groups.keys()) : 0;
  for (let lo = 0; lo <= top + 1e-9; lo += width) {
    const key = Math.round(lo / width) * width;
    bars.push(groups.get(key) ?? { lo: key, hi: key + width, open: key === capLo, orders: 0, zeroShip: 0, paidShip: 0 });
  }
  const orders = bars.reduce((t, b) => t + b.orders, 0);
  const zero = bars.reduce((t, b) => t + b.zeroShip, 0);
  return { market: m.market, bars, orders, zeroShipShare: orders > 0 ? zero / orders : null, threshold: inferThreshold(m.bins, m.width), width };
}
