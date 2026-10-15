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
 *   *Takeaway         one plain sentence per chart: what it says, n/a-safe
 */

import { formatMoney, formatNumber, formatRatio, MINUS } from "@/lib/format";
import { isNa, marketCosts, periodMetrics, type MarketsModel, type PeriodMetrics, type Val } from "@/lib/markets/model";
import { MARKET_OTHER, MARKET_UNALLOCATED, type CostCard, type DailySums, type MarketPeriodRaw } from "@/lib/markets/types";
import { GA4_MIN_DAYS } from "@/lib/markets/opportunity";

/** "1 day", "2 days", "1,204 orders": the count, then the word in the right number. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${Math.abs(n) === 1 ? one : many}`;
}

/**
 * A compact money label for the bridge: whole units under 1,000 ("CZK 415",
 * never "CZK 415.1"), then K / M with at most one decimal ("CZK 23.4K").
 */
export function bridgeMoney(v: number, currency: string): string {
  if (Math.abs(v) < 1000) return formatMoney(Math.round(v), currency, { decimals: 0 });
  return formatMoney(v, currency, { compact: true });
}

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

/** A point the portfolio chart can place: both coordinates are finite numbers. */
export function isPlottable(p: PortfolioPoint): p is PortfolioPoint & { x: number; y: number } {
  return p.x !== null && p.y !== null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Why the portfolio chart has nothing to draw, or null when at least one
 * market can be plotted. The chart shows this instead of empty axes.
 */
export function portfolioEmptyReason(points: PortfolioPoint[]): string | null {
  if (points.some(isPlottable)) return null;
  if (points.length === 0) return "No market can be plotted: no sold market has orders in this range.";
  const reasons = [...new Set(points.map((p) => p.why).filter((w): w is string => !!w))];
  const head = `No market can be plotted: ${points.length === 1 ? `${nameOf(points[0].market)} has` : "none of the markets has"} both an nCAC and a GP per customer in this range.`;
  return reasons.length === 1 ? `${head} ${reasons[0].replace(/\.?$/, ".")}` : head;
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

/** nCAC and MER are hidden in a week whose spend is under this share of the market's median week. */
export const LOW_SPEND_SHARE = 0.15;
const LOW_SPEND_REASON = "Spend this week was under 15 % of this market's usual week, so the ratio would mislead";

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

  // A week whose spend is a sliver of the market's usual week (a campaign
  // starting or stopping mid-week) gives a meaningless nCAC or MER (CA had a
  // 450x MER week before its campaigns started) and flattens the rest of the
  // chart. Those ratios are hidden with a reason; the spend itself stays.
  const spendOf = (rows: WeekRow[] | null) => new Map((rows ?? []).map((r) => [`${r.market}|${r.week}`, r.sums.spend]));
  const curSpend = spendOf(input.weeks);
  const cmpSpend = spendOf(input.compareWeeks);
  const typical: Record<string, number> = {};
  for (const m of input.markets) {
    const xs = [...input.weeks, ...(input.compareWeeks ?? [])]
      .filter((r) => r.market === m && r.sums.spend > 0)
      .map((r) => r.sums.spend)
      .sort((a, b) => a - b);
    typical[m] = xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  }
  const tinySpend = (m: string, spend: number | undefined) => typical[m] > 0 && (spend ?? 0) < LOW_SPEND_SHARE * typical[m];
  const spendRatio = (k: TrendMetric) => k === "nCac" || k === "mer";

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
        if (spendRatio(t.key) && values[m] !== null && tinySpend(m, curSpend.get(`${m}|${s.start}`))) {
          values[m] = null;
          reasons[m] = LOW_SPEND_REASON;
        }
        const c = prev[i] ? pick(prev[i][m], t.key) : undefined;
        compare[m] = c && !isNa(c) ? c.v : null;
        if (spendRatio(t.key) && compare[m] !== null && cmpSlots[i] && tinySpend(m, cmpSpend.get(`${m}|${cmpSlots[i].start}`))) {
          compare[m] = null;
        }
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

/**
 * Fewest units in a rate's denominator (sessions, engaged sessions, add-to-cart
 * sessions) for the rate and its index to be shown. Under it the page prints
 * the counts and says "too few to compare": 2 purchases of 2 sessions is not
 * a 100 % CVR anybody can act on.
 */
export const FUNNEL_MIN_DENOMINATOR = 30;
/** Every low-data n/a reason starts with this, so the UI can print it as text. */
export const TOO_FEW = "Too few to compare";

export function isTooFew(v: Val): boolean {
  return isNa(v) && v.na.startsWith(TOO_FEW);
}

/** The three step conversions between the four funnel stages. */
export const FUNNEL_STEPS: ReadonlyArray<{ label: string; den: string; over: string; overShort: string }> = [
  { label: "engaged / sessions", den: "sessions", over: "More engaged sessions than sessions in GA4", overShort: "more engaged than sessions" },
  { label: "add to cart / engaged", den: "engaged sessions", over: "Add-to-cart sessions GA4 did not count as engaged", overShort: "not counted as engaged" },
  { label: "purchase / add to cart", den: "add-to-cart sessions", over: "Purchases without a tracked add to cart: GA4 records a purchase even when the session has no add_to_cart event", overShort: "no tracked add to cart" },
];

export interface FunnelStep {
  num: number;
  den: number;
  /** num / den; n/a under FUNNEL_MIN_DENOMINATOR. Above 100 % stays, flagged by `over`. */
  rate: Val;
  /** Why the step is above 100 %; null when it is not. */
  over: string | null;
  /** vs the home market's same step, home = 100; n/a when either side is too few or above 100 %. */
  index: Val;
}

export interface FunnelRow {
  market: string;
  sessions: number;
  engagedSessions: number;
  unpaidEngagedSessions: number;
  addToCartSessions: number;
  purchases: number;
  unpaidShare: Val;
  addToCartRate: Val;
  cvr: Val;
  /** Index vs the home market, home = 100. */
  index: { unpaidShare: Val; addToCartRate: Val; cvr: Val };
  /** engaged / sessions, add to cart / engaged, purchase / add to cart. */
  steps: [FunnelStep, FunnelStep, FunnelStep];
  /** Same figures in the compare range, null without one. */
  previous: { sessions: number; unpaidShare: Val; addToCartRate: Val; cvr: Val } | null;
}

/** a / b, n/a with `why` when b is 0 and "too few to compare" under FUNNEL_MIN_DENOMINATOR. */
export function funnelRate(a: number, b: number, why: string, noun = "sessions"): Val {
  if (!(b > 0)) return { na: why };
  if (b < FUNNEL_MIN_DENOMINATOR) return { na: `${TOO_FEW}: ${formatNumber(b)} ${b === 1 ? noun.replace(/s$/, "") : noun} (needs ${FUNNEL_MIN_DENOMINATOR})` };
  return { v: a / b };
}

function idx(v: Val, home: Val | null, isHome: boolean): Val {
  if (isHome) return isNa(v) ? v : v.v > 1 ? { na: "Above 100 %, not indexed" } : { v: 100 };
  if (!home) return { na: "No home market in the GA4 data" };
  if (isNa(v)) return v;
  if (v.v > 1) return { na: "Above 100 %, not indexed" };
  if (isNa(home)) return { na: isTooFew(home) ? `${TOO_FEW}: the home market has too little data` : "The home market has no value to index against" };
  if (home.v === 0 || home.v > 1) return { na: "The home market has no value to index against" };
  return { v: (v.v / home.v) * 100 };
}

function stepsOf(r: Ga4Row): Array<Omit<FunnelStep, "index">> {
  const pairs: Array<[number, number]> = [
    [r.engagedSessions, r.sessions],
    [r.addToCartSessions, r.engagedSessions],
    [r.purchases, r.addToCartSessions],
  ];
  return pairs.map(([num, den], i) => {
    const step = FUNNEL_STEPS[i];
    const rate = funnelRate(num, den, `No ${step.den} from this market`, step.den);
    return { num, den, rate, over: !isNa(rate) && rate.v > 1 ? step.over : null };
  });
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
 * per session. Countries outside the sold set pool into Other. Low-data rule:
 * no rate and no index on a denominator under FUNNEL_MIN_DENOMINATOR. A step
 * above 100 % (GA4 purchases with no add_to_cart in the session) keeps its
 * value, is flagged and is never indexed, so it cannot read as "better than
 * home".
 */
export function funnelRows(input: { current: Ga4Row[]; previous: Ga4Row[] | null; sold: string[]; home: string | null }): FunnelRow[] {
  const cur = bucket(input.current, input.sold);
  const prev = input.previous ? bucket(input.previous, input.sold) : null;
  const noSessions = "No GA4 sessions from this market in the range";
  const figures = (r: Ga4Row) => ({
    unpaidShare: funnelRate(r.unpaidEngagedSessions, r.engagedSessions, "No engaged sessions from this market", "engaged sessions"),
    addToCartRate: funnelRate(r.addToCartSessions, r.sessions, noSessions),
    cvr: funnelRate(r.purchases, r.sessions, noSessions),
  });
  const homeRow = input.home ? cur.get(input.home) : undefined;
  const home = homeRow ? figures(homeRow) : null;
  const homeSteps = homeRow ? stepsOf(homeRow) : null;
  const order = [...input.sold.filter((m) => cur.has(m)), ...(cur.has(MARKET_OTHER) ? [MARKET_OTHER] : [])];
  return order.map((m) => {
    const r = cur.get(m)!;
    const f = figures(r);
    const isHome = m === input.home;
    const p = prev?.get(m);
    const steps = stepsOf(r).map((st, i) => {
      const h = homeSteps?.[i];
      return { ...st, index: idx(st.rate, h ? h.rate : null, isHome) };
    }) as [FunnelStep, FunnelStep, FunnelStep];
    return {
      market: m,
      sessions: r.sessions,
      engagedSessions: r.engagedSessions,
      unpaidEngagedSessions: r.unpaidEngagedSessions,
      addToCartSessions: r.addToCartSessions,
      purchases: r.purchases,
      ...f,
      index: {
        unpaidShare: idx(f.unpaidShare, home?.unpaidShare ?? null, isHome),
        addToCartRate: idx(f.addToCartRate, home?.addToCartRate ?? null, isHome),
        cvr: idx(f.cvr, home?.cvr ?? null, isHome),
      },
      steps,
      previous: prev ? (p ? { sessions: p.sessions, ...figures(p) } : { sessions: 0, unpaidShare: { na: noSessions }, addToCartRate: { na: noSessions }, cvr: { na: noSessions } }) : null,
    };
  });
}

/**
 * The GA4 coverage warning: GA4 rows on fewer days than GA4_MIN_DAYS (or than
 * the range when the range is shorter). Null when coverage is enough.
 */
export function ga4CoverageNote(daysCovered: number, daysInRange: number): string | null {
  const need = Math.min(GA4_MIN_DAYS, daysInRange);
  if (daysCovered >= need) return null;
  return `GA4 covers only ${plural(daysCovered, "day")} of ${formatNumber(daysInRange)} in this range (needs ${need}): read the counts, not the rates.`;
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
  /** Orders within 10 % below the threshold (fine bins); null without a threshold. */
  near: { from: number; to: number; orders: number; share: number } | null;
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
  const threshold = inferThreshold(m.bins, m.width);
  return { market: m.market, bars, orders, zeroShipShare: orders > 0 ? zero / orders : null, threshold, width, near: nearThreshold(m.bins, m.width, threshold) };
}

// ---------------------------------------------------------------------------
// 7. Takeaways: one plain sentence above each chart
// ---------------------------------------------------------------------------
//
// Every chart on the page answers "so what?" in one or two short sentences,
// computed from the same data it draws. Each returns null when the data is
// missing, so the page prints no sentence rather than a wrong one. Numbers go
// through lib/format, so they read like the rest of the page.

/** "US", "Other", "Unallocated" (the page's own market labels). */
function nameOf(key: string): string {
  if (key === MARKET_OTHER) return "Other";
  if (key === MARKET_UNALLOCATED) return "Unallocated";
  return key;
}

/** "14 %", the page's prose percent (whole, with a space). */
function pctWords(v: number): string {
  return `${Math.abs(Math.round(v * 100))} %`;
}

/** "A, B and C". */
function listWords(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "";
}

/** The LTGP:CAC the page aims for. */
export const TARGET_RATIO = 3;

/**
 * Portfolio: how many times each market pays back what a new customer costs,
 * best and worst, and what a market under 3:1 would need to reach it.
 *   "US pays back 5.0× at 365 days for a $44 nCAC; CA 1.7× for $94. To reach
 *    3:1, CA needs an nCAC under $53 or more GP per customer."
 */
export function portfolioTakeaway(points: PortfolioPoint[], currency: string): string | null {
  const drawn = points
    .filter((p): p is PortfolioPoint & { x: number; y: number; ratio: number } => p.x !== null && p.y !== null && p.ratio !== null && p.x > 0)
    .sort((a, b) => b.ratio - a.ratio);
  if (!drawn.length) return null;
  const money = (v: number) => formatMoney(v, currency);
  const ratio = (v: number) => formatRatio(v, { decimals: 1 });
  const basisWords = (p: PortfolioPoint) => (p.basis === "firstOrder" ? "on the first order" : "at 365 days");
  const shown = drawn.length <= 3 ? drawn : [drawn[0], drawn[drawn.length - 1]];
  const lead = shown[0];
  const clauses = [
    `${nameOf(lead.market)} pays back ${ratio(lead.ratio)} ${basisWords(lead)} for a ${money(lead.x)} nCAC`,
    ...shown.slice(1).map((p) => `${nameOf(p.market)} ${ratio(p.ratio)}${p.basis !== lead.basis ? ` ${basisWords(p)},` : ""} for ${money(p.x)}`),
  ];
  const head = `${clauses.join("; ")}.`;
  const below = drawn.filter((p) => p.ratio < TARGET_RATIO).reverse();
  if (!below.length) return `${head} ${drawn.length > 1 ? "Every market clears" : "That clears"} ${TARGET_RATIO}:1.`;
  const worst = below[0];
  if (worst.y <= 0) return `${head} ${nameOf(worst.market)} makes no gross profit per customer yet, so no nCAC pays back there.`;
  if (below.length === 1) {
    const gpWords = worst.basis === "firstOrder" ? "a higher first-order GP" : "more GP per customer";
    return `${head} To reach ${TARGET_RATIO}:1, ${nameOf(worst.market)} needs an nCAC under ${money(worst.y / TARGET_RATIO)} or ${gpWords}.`;
  }
  const need = below.map((p) => `${money(p.y / TARGET_RATIO)} in ${nameOf(p.market)}`);
  return `${head} For ${TARGET_RATIO}:1 at today's GP per customer, nCAC must fall under ${listWords(need)}.`;
}

/** Full weeks averaged at each end when a weekly trend names its biggest mover. */
export const MOVER_WEEKS = 2;
/** Below this change at both ends a metric reads as flat. */
export const FLAT_SHARE = 0.03;

/**
 * Weekly trends: the market that moved most between the average of the first
 * two and the last two full weeks (partial weeks left out). Totals (revenue,
 * customers, GP) rank by the size of the move; ratios (nCAC, MER) by the
 * percentage move over the sold markets, since Other's ratio swings on a
 * handful of orders.
 *   "Biggest mover: CA, up 14 % from $98 to $112 (worse)."
 */
export function trendTakeaway(s: TrendSeries, markets: string[], currency: string): string | null {
  const full = s.points.filter((p) => !p.partial);
  const additive = s.kind === "money" || s.kind === "count";
  const fmt = (v: number) =>
    s.kind === "money" ? formatMoney(v, currency, { compact: Math.abs(v) >= 10_000 })
      : s.kind === "unit" ? formatMoney(v, currency)
      : s.kind === "count" ? formatNumber(v, { decimals: 0 })
      : formatRatio(v, { decimals: 1 });
  const mean = (xs: number[]) => xs.reduce((t, v) => t + v, 0) / xs.length;
  const moves = markets
    .filter((m) => additive || (m !== MARKET_OTHER && m !== MARKET_UNALLOCATED))
    .map((m) => {
      const vs = full.map((p) => p.values[m]).filter((v): v is number => v !== null && Number.isFinite(v));
      if (vs.length < 2 * MOVER_WEEKS) return null;
      const start = mean(vs.slice(0, MOVER_WEEKS));
      const end = mean(vs.slice(-MOVER_WEEKS));
      const pct = start > 0 ? end / start - 1 : null;
      return { m, start, end, pct, size: additive ? Math.abs(end - start) : pct === null ? -1 : Math.abs(pct) };
    })
    .filter((x): x is { m: string; start: number; end: number; pct: number | null; size: number } => x !== null && x.size >= 0)
    .sort((a, b) => b.size - a.size);
  if (!moves.length) return null;
  if (moves.every((x) => x.pct !== null && Math.abs(x.pct) < FLAT_SHARE)) {
    return `Flat: no market moved more than ${pctWords(FLAT_SHARE)} from the first to the last full weeks.`;
  }
  const top = moves[0];
  const up = top.end >= top.start;
  const good = up === (s.goodWhen === "up");
  const perWeek = additive ? " a week" : "";
  const change = top.pct !== null ? `${up ? "up" : "down"} ${pctWords(top.pct)} ` : "";
  return `Biggest mover: ${nameOf(top.m)}, ${change}from ${fmt(top.start)} to ${fmt(top.end)}${perWeek} (${good ? "better" : "worse"}).`;
}

/**
 * Spend vs new customers: what the next customer costs at today's spend
 * against the average, in words, with the weak-fit caveat when it applies.
 *   "At $2,400 a week, the next US customer costs about $62, 51 % more than the
 *    $41 average: more spend here buys customers at a rising price."
 */
export function responseTakeaway(
  r: { market: string; fit: LogFit | null; marginal: number | null; currentSpend: number | null; avgNcac: number | null },
  currency: string
): string | null {
  if (!r.fit || r.marginal === null || r.currentSpend === null) return null;
  const money = (v: number) => formatMoney(v, currency);
  const head = `At ${money(r.currentSpend)} a week, the next ${nameOf(r.market)} customer costs about ${money(r.marginal)}`;
  let body: string;
  if (r.avgNcac === null || !(r.avgNcac > 0)) {
    body = `${head}.`;
  } else {
    const gap = r.marginal / r.avgNcac - 1;
    if (gap > 0.1) body = `${head}, ${pctWords(gap)} more than the ${money(r.avgNcac)} average: more spend here buys customers at a rising price.`;
    else if (gap < -0.1) body = `${head}, ${pctWords(gap)} less than the ${money(r.avgNcac)} average: there is room to spend more here before returns fall.`;
    else body = `${head}, close to the ${money(r.avgNcac)} average: returns are not falling much yet.`;
  }
  if (r.fit.r2 < WEAK_FIT_R2) {
    body += ` Spend explains only ${pctWords(r.fit.r2)} of the weekly swing, so read this as a direction, not a number.`;
  }
  return body;
}

/**
 * The spend calculator's result in one sentence.
 *   "Moving $240 a week from US to CA trades 3.1 US customers for 4.3 in CA:
 *    1.2 more customers and +$80 GP after ads a week."
 */
export function reallocationTakeaway(from: string, to: string, r: Reallocation, currency: string): string | null {
  if (!(r.move > 0)) return null;
  const n1 = (v: number) => formatNumber(Math.abs(v), { decimals: 1 });
  const net = r.newTotal;
  const netWords = Math.abs(net) < 0.05 ? "about the same number of customers" : `${n1(net)} ${net > 0 ? "more" : "fewer"} customers`;
  const gp = r.gp === null ? "" : ` and ${r.gp >= 0 ? "+" : MINUS}${formatMoney(Math.abs(r.gp), currency)} GP after ads`;
  return `Moving ${formatMoney(r.move, currency)} a week from ${nameOf(from)} to ${nameOf(to)} trades ${n1(r.newFrom)} ${nameOf(from)} customers for ${n1(r.newTo)} in ${nameOf(to)}: ${netWords}${gp} a week.`;
}

/** How far below the threshold an order counts as "just short" of free shipping. */
export const NEAR_THRESHOLD = 0.1;

/**
 * Orders that fell just short of free shipping: within 10 % below the
 * inferred threshold, read on the fine bins (the band starts on a bin edge
 * inside the 10 %).
 */
export function nearThreshold(
  bins: OrderBin[],
  width: number,
  t: Threshold,
  band = NEAR_THRESHOLD
): { from: number; to: number; orders: number; share: number } | null {
  if (!("value" in t) || !(width > 0)) return null;
  const total = bins.reduce((s, b) => s + b.orders, 0);
  if (total <= 0) return null;
  const from = Math.ceil((t.value * (1 - band)) / width - 1e-9) * width;
  const orders = bins.filter((b) => b.lo >= from - 1e-9 && b.lo < t.value - 1e-9).reduce((s, b) => s + b.orders, 0);
  return { from, to: t.value, orders, share: orders / total };
}

/**
 * Order value vs free shipping: the share of orders that fell just short of
 * the threshold, the group an add-on or a nudge could lift over it.
 *   "18 % of US orders (372) fell just short of free shipping, at $144 to
 *    $160: the easiest orders to lift over the threshold."
 */
export function thresholdTakeaway(h: Pick<Histogram, "market" | "threshold" | "near">, currency: string): string | null {
  const n = h.near;
  if (!n || !("value" in h.threshold)) return null;
  const money = (v: number) => formatMoney(v, currency);
  if (n.orders === 0) return `No ${nameOf(h.market)} orders sit within ${pctWords(NEAR_THRESHOLD)} below the ${money(n.to)} threshold, so it is not holding orders back.`;
  const share = Math.round(n.share * 100) < 1 ? "Under 1 %" : pctWords(n.share);
  return `${share} of ${nameOf(h.market)} orders (${formatNumber(n.orders)}) fell just short of free shipping, at ${money(n.from)} to ${money(n.to)}: the easiest orders to lift over the threshold with an add-on.`;
}
