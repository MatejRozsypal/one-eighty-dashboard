/**
 * Markets, Products: which products sell in which market. Pure, client-safe.
 *
 * One question, kept light on purpose: what does each market buy, and what
 * does a market buy differently from home. No price index and no buying-power
 * adjustment: a lower average selling price in a market is shown as it is,
 * in base and (where the market pays in one currency) in local money.
 *
 * ── Shares ──────────────────────────────────────────────────────────────────
 * A product's share of a market is its net sales in that market divided by the
 * market's net sales, both in base currency, ex VAT. Product net sales are the
 * order's net sales split over its lines by line revenue (the query layer does
 * the split), so the products of a market add up to the market's net sales on
 * the main Markets page and the shares of a column add up to 100 %.
 *
 * ── Mix map (what sells differently) ───────────────────────────────────────
 * For each market other than home and Other, every product's share of the
 * market's units against its share of home's units. Units, not net sales, so
 * a market that pays less per unit does not look like it buys less of it.
 * The index is market share / home share x 100 (100 = same mix). Lines that
 * are not products (shipping insurance, gift cards, `isNonProduct`) and lines
 * given away free (no net sales anywhere in the period) are left out of the
 * units. A product under `MIX_MIN_UNITS` units in the market is drawn faded:
 * its index moves a lot on a few orders. A market under `MIN_MARKET_UNITS`
 * units gets no map at all (n/a, with why). Other pools several countries, so
 * it is never compared.
 *
 * ── Entry products ──────────────────────────────────────────────────────────
 * Per market, the share of first orders (new customers) that contain each
 * product, against home. A first order with three products counts for each,
 * so the shares of a market add up to more than 100 %. Under
 * `ENTRY_MIN_ORDERS` first orders a product is shown faded with "low n",
 * never hidden.
 *
 * ── Local prices ────────────────────────────────────────────────────────────
 * Average selling price in local currency is read only from orders paid in
 * the market's configured local currency with an exchange rate on the order,
 * and shown only when those orders carry at least `LOCAL_COVERAGE` of the
 * market's net sales. A market paid in the base currency shows base only.
 */

import { formatMoney, formatPercent, MINUS } from "@/lib/format";
import { MARKET_OTHER, type MarketsSource } from "@/lib/markets/types";

/** Rows shown in the matrix before the rest pools into "Other products". */
export const TOP_PRODUCTS = 15;
/** Products per market in the top lists. */
export const TOP_PER_MARKET = 5;
/** A market with fewer units than this in the period gets no mix map. */
export const MIN_MARKET_UNITS = 50;
/** Under this many units in the market, a product's mix point is drawn faded. */
export const MIX_MIN_UNITS = 100;
/** Index band read as "same mix": within 15 % of home either way. */
export const MIX_BAND = 0.15;
/** Products named as buying more or less in the mix takeaway, each way. */
export const MIX_NAMED = 3;
/** Products compared in the "same mix" head of the takeaway. */
export const MIX_HEAD = 4;
/** Top-of-mix products within this many points of home read as "the same mix". */
export const MIX_SAME_PP = 0.05;
/** Products listed per market in entry products. */
export const ENTRY_LIMIT = 8;
/** Under this many first orders a product's entry share is shown faded ("low n"). */
export const ENTRY_MIN_ORDERS = 30;
/** Fewer units than this in a cell and the matrix shows no average price (one order would set it). */
export const MIN_PRICE_UNITS = 3;
/** Share of a market's net sales that must be in local-currency orders to show a local price. */
export const LOCAL_COVERAGE = 0.95;

export const OTHER_PRODUCTS = "Other products";

/** One product in one market for one period, as the query layer returns it. */
export interface ProductSalesRow {
  market: string;
  product: string;
  /** Base currency, ex VAT: the order's net sales split over its lines. */
  netSales: number;
  /** Null when the platform sent no quantity for any line. */
  units: number | null;
  /** Net sales in local money, from orders paid in the market's local currency with a rate. */
  localNetSales: number;
  /** Units in those same orders. */
  localUnits: number;
  /** Base net sales of those same orders: the coverage numerator. */
  localCoveredNetSales: number;
  /** First orders (new customers) that contain this product. */
  entryOrders: number;
}

export interface ProductsRaw {
  source: MarketsSource;
  baseCurrency: string;
  homeMarket: string;
  /** Configured local currency per market (client_markets). */
  localCurrencyOf: Record<string, string>;
  range: { from: string; to: string };
  compareRange: { from: string; to: string } | null;
  current: ProductSalesRow[];
  previous: ProductSalesRow[] | null;
  /** First orders (new customers) per market in the current period; empty when unknown. */
  newOrders: Record<string, number>;
}

export interface MarketColumn {
  key: string;
  netSales: number;
  units: number;
  isHome: boolean;
  /** Local currency the price column is shown in; null when base only or n/a. */
  localCurrency: string | null;
  /** Why there is no local price for this market; null when there is one or local is base. */
  localWhy: string | null;
}

export interface ProductCell {
  netSales: number;
  units: number | null;
  share: number | null;
  prevShare: number | null;
  prevNetSales: number | null;
  /** Average selling price, base currency: net sales / units. */
  asp: number | null;
  /** Average selling price in the market's local currency, when shown. */
  aspLocal: number | null;
}

export interface ProductRow {
  product: string;
  /** The pooled tail row; always last, never sorted. */
  pooled: boolean;
  /** Number of products pooled into this row (pooled row only). */
  pooledCount: number;
  /** All markets together. */
  total: ProductCell;
  cells: Record<string, ProductCell>;
}

export interface TopItem {
  product: string;
  netSales: number;
  share: number;
  prevShare: number | null;
  /** Rank in the comparison period, 1-based; null when not sold then. */
  prevRank: number | null;
}

export interface MixPoint {
  product: string;
  units: number;
  homeUnits: number;
  /** Share of the market's units (0.209 = 20.9 %). */
  share: number;
  homeShare: number;
  /** share / homeShare (1.24 = index 124); null when home sold none. */
  index: number | null;
  /** Fewer than `MIX_MIN_UNITS` units in the market: drawn faded. */
  low: boolean;
}

export type MixResult =
  | { points: MixPoint[]; units: number; homeUnits: number; excluded: string[] }
  | { na: string };

export interface EntryItem {
  product: string;
  orders: number;
  homeOrders: number;
  /** Share of the market's first orders that contain the product. */
  share: number;
  homeShare: number;
  index: number | null;
  low: boolean;
  homeLow: boolean;
}

export type EntryResult = { items: EntryItem[]; newOrders: number; homeNewOrders: number } | { na: string };

export interface ProductsModel {
  source: MarketsSource;
  baseCurrency: string;
  homeMarket: string;
  hasCompare: boolean;
  markets: MarketColumn[];
  rows: ProductRow[];
  /** Products sold in the period, before pooling. */
  productCount: number;
  top: Record<string, TopItem[]>;
  /** Per compared market (not home, not Other): units mix against home. */
  mix: Record<string, MixResult>;
  /** Per compared market: entry products against home. */
  entry: Record<string, EntryResult>;
}

// ── Small pure helpers (pinned by scripts/check-markets-products.ts) ───────

/** Net sales per market, summed over products. */
export function marketTotals(rows: readonly ProductSalesRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.market, (out.get(r.market) ?? 0) + r.netSales);
  return out;
}

/**
 * Each product's share of each market's net sales. A market with no net sales
 * has no shares (empty map), never a division by zero.
 */
export function marketShares(rows: readonly ProductSalesRow[]): Map<string, Map<string, number>> {
  const totals = marketTotals(rows);
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const t = totals.get(r.market) ?? 0;
    if (!out.has(r.market)) out.set(r.market, new Map());
    if (t <= 0) continue;
    const m = out.get(r.market)!;
    m.set(r.product, (m.get(r.product) ?? 0) + r.netSales / t);
  }
  return out;
}

/**
 * Lines that are not products: shipping insurance, gift cards and vouchers,
 * placeholder lines. They sell in units but say nothing about what a market
 * buys, so the mix map and entry products leave them out. Samples sold at a
 * price stay in: they are products.
 */
const NON_PRODUCT = /shipping insurance|hold for shipping|gift ?card|d\u00e1rkov\u00fd (poukaz|voucher)|^(po\u0161tovn\u00e9|doprava|dob\u00edrka)$/i;

export function isNonProduct(product: string): boolean {
  return NON_PRODUCT.test(product.trim());
}

/** Products the mix map and entry products read: real products with net sales somewhere in the period. */
export function mixProducts(rows: readonly ProductSalesRow[]): { keep: Set<string>; excluded: string[] } {
  const net = new Map<string, number>();
  for (const r of rows) net.set(r.product, (net.get(r.product) ?? 0) + r.netSales);
  const keep = new Set<string>();
  const excluded: string[] = [];
  for (const [p, v] of net) {
    if (isNonProduct(p) || v <= 0) excluded.push(p);
    else keep.add(p);
  }
  return { keep, excluded: excluded.sort((a, b) => a.localeCompare(b)) };
}

function unitsBy(rows: readonly ProductSalesRow[], market: string, keep: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.market !== market || !keep.has(r.product) || r.units === null || r.units <= 0) continue;
    out.set(r.product, (out.get(r.product) ?? 0) + r.units);
  }
  return out;
}

/**
 * Units mix of `market` against `home`: every product sold in either, its
 * share of each market's units and the index. Sorted by the market's units,
 * then home's, then name.
 */
export function unitMix(
  rows: readonly ProductSalesRow[],
  market: string,
  home: string,
  keep: ReadonlySet<string>,
  minUnits = MIX_MIN_UNITS
): { points: MixPoint[]; units: number; homeUnits: number } {
  const m = unitsBy(rows, market, keep);
  const h = unitsBy(rows, home, keep);
  const units = [...m.values()].reduce((t, v) => t + v, 0);
  const homeUnits = [...h.values()].reduce((t, v) => t + v, 0);
  const points: MixPoint[] = [];
  for (const product of new Set([...m.keys(), ...h.keys()])) {
    const u = m.get(product) ?? 0;
    const hu = h.get(product) ?? 0;
    const share = units > 0 ? u / units : 0;
    const homeShare = homeUnits > 0 ? hu / homeUnits : 0;
    points.push({ product, units: u, homeUnits: hu, share, homeShare, index: homeShare > 0 ? share / homeShare : null, low: u < minUnits });
  }
  points.sort((a, b) => b.units - a.units || b.homeUnits - a.homeUnits || a.product.localeCompare(b.product));
  return { points, units, homeUnits };
}

/**
 * Entry products of `market` against `home`: share of each market's first
 * orders that contain the product, the market's top `limit` by that share.
 */
export function entryProducts(
  rows: readonly ProductSalesRow[],
  market: string,
  home: string,
  newOrders: Readonly<Record<string, number>>,
  keep: ReadonlySet<string>,
  { limit = ENTRY_LIMIT, minOrders = ENTRY_MIN_ORDERS }: { limit?: number; minOrders?: number } = {}
): EntryItem[] {
  const count = (mk: string) => {
    const out = new Map<string, number>();
    for (const r of rows) if (r.market === mk && keep.has(r.product) && r.entryOrders > 0) out.set(r.product, (out.get(r.product) ?? 0) + r.entryOrders);
    return out;
  };
  const m = count(market);
  const h = count(home);
  const n = newOrders[market] ?? 0;
  const hn = newOrders[home] ?? 0;
  if (n <= 0) return [];
  return [...m.entries()]
    .map(([product, orders]) => {
      const homeOrders = h.get(product) ?? 0;
      const share = orders / n;
      const homeShare = hn > 0 ? homeOrders / hn : 0;
      return { product, orders, homeOrders, share, homeShare, index: homeShare > 0 ? share / homeShare : null, low: orders < minOrders, homeLow: homeOrders < minOrders };
    })
    .sort((a, b) => b.share - a.share || a.product.localeCompare(b.product))
    .slice(0, limit);
}

/** The top `limit` products of one market by net sales, with their share and the comparison share. */
export function topProducts(
  current: readonly ProductSalesRow[],
  previous: readonly ProductSalesRow[] | null,
  market: string,
  limit = TOP_PER_MARKET
): TopItem[] {
  const cur = current.filter((r) => r.market === market && r.netSales > 0);
  const total = cur.reduce((t, r) => t + r.netSales, 0);
  if (total <= 0) return [];
  const byProduct = new Map<string, number>();
  for (const r of cur) byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.netSales);

  let prevShare: Map<string, number> | null = null;
  let prevRank: Map<string, number> | null = null;
  if (previous) {
    prevShare = marketShares(previous.filter((r) => r.market === market)).get(market) ?? new Map();
    const ranked = [...prevShare.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    prevRank = new Map(ranked.map(([p], i) => [p, i + 1]));
  }

  return [...byProduct.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([product, netSales]) => ({
      product,
      netSales,
      share: netSales / total,
      prevShare: prevShare ? prevShare.get(product) ?? 0 : null,
      prevRank: prevRank ? prevRank.get(product) ?? null : null,
    }));
}

/** Column order: home first, then by net sales, Other last. */
export function orderMarkets(totals: ReadonlyMap<string, number>, home: string): string[] {
  return [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => {
      const rank = (k: string) => (k === home ? 0 : k === MARKET_OTHER ? 2 : 1);
      return rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([k]) => k);
}

// ── The model ──────────────────────────────────────────────────────────────

interface Acc {
  netSales: number;
  units: number | null;
  localNet: number;
  localUnits: number;
}

function add(acc: Acc | undefined, r: ProductSalesRow): Acc {
  const a = acc ?? { netSales: 0, units: null, localNet: 0, localUnits: 0 };
  a.netSales += r.netSales;
  if (r.units !== null) a.units = (a.units ?? 0) + r.units;
  a.localNet += r.localNetSales;
  a.localUnits += r.localUnits;
  return a;
}

const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 || !Number.isFinite(a / b) ? null : a / b;

function localColumn(
  market: string,
  rows: readonly ProductSalesRow[],
  netSales: number,
  raw: Pick<ProductsRaw, "baseCurrency" | "localCurrencyOf">
): { localCurrency: string | null; localWhy: string | null } {
  if (market === MARKET_OTHER) return { localCurrency: null, localWhy: "Other pools several countries and currencies" };
  const ccy = raw.localCurrencyOf[market];
  if (!ccy) return { localCurrency: null, localWhy: "No local currency is configured for this market" };
  if (ccy === raw.baseCurrency) return { localCurrency: null, localWhy: null };
  const covered = rows.reduce((t, r) => t + (r.market === market ? r.localCoveredNetSales : 0), 0);
  if (covered <= 0) return { localCurrency: null, localWhy: `No ${ccy} exchange rate on this market's orders in the warehouse` };
  const share = netSales > 0 ? covered / netSales : 0;
  if (share < LOCAL_COVERAGE) {
    return {
      localCurrency: null,
      localWhy: `Only ${Math.round(share * 100)} % of net sales paid in ${ccy} with a rate; a local price needs ${Math.round(LOCAL_COVERAGE * 100)} %`,
    };
  }
  return { localCurrency: ccy, localWhy: null };
}

export function buildProductsModel(raw: ProductsRaw, { topN = TOP_PRODUCTS }: { topN?: number } = {}): ProductsModel {
  const cur = raw.current.filter((r) => Number.isFinite(r.netSales));
  const prev = raw.previous?.filter((r) => Number.isFinite(r.netSales)) ?? null;

  const totals = marketTotals(cur);
  const prevTotals = prev ? marketTotals(prev) : null;
  const order = orderMarkets(totals, raw.homeMarket);
  const allTotal = order.reduce((t, m) => t + (totals.get(m) ?? 0), 0);
  const prevAllTotal = prevTotals ? [...prevTotals.values()].reduce((t, v) => t + Math.max(0, v), 0) : null;

  const markets: MarketColumn[] = order.map((key) => {
    const units = cur.reduce((t, r) => t + (r.market === key ? r.units ?? 0 : 0), 0);
    return {
      key,
      netSales: totals.get(key) ?? 0,
      units,
      isHome: key === raw.homeMarket,
      ...localColumn(key, cur, totals.get(key) ?? 0, raw),
    };
  });

  // Products ranked by net sales across all markets; the tail pools.
  const byProduct = new Map<string, number>();
  for (const r of cur) byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.netSales);
  const ranked = [...byProduct.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const keep = new Set(ranked.slice(0, topN).map(([p]) => p));
  const pooledCount = byProduct.size - keep.size;
  const rowKey = (p: string) => (keep.has(p) ? p : OTHER_PRODUCTS);

  const accCur = new Map<string, Map<string, Acc>>();
  const accPrev = new Map<string, Map<string, Acc>>();
  const TOTAL = "__all_markets__";
  for (const [rows, acc] of [[cur, accCur], [prev ?? [], accPrev]] as const) {
    for (const r of rows) {
      const k = rowKey(r.product);
      if (!acc.has(k)) acc.set(k, new Map());
      const m = acc.get(k)!;
      m.set(r.market, add(m.get(r.market), r));
      m.set(TOTAL, add(m.get(TOTAL), r));
    }
  }

  const localOf = new Map(markets.map((m) => [m.key, m.localCurrency]));
  const cell = (k: string, market: string, total: number, prevTotal: number | null, local: boolean): ProductCell => {
    const a = accCur.get(k)?.get(market);
    const p = accPrev.get(k)?.get(market);
    const netSales = a?.netSales ?? 0;
    const units = a ? a.units : 0;
    return {
      netSales,
      units,
      share: div(netSales, total),
      prevShare: prev ? div(p?.netSales ?? 0, prevTotal) : null,
      prevNetSales: prev ? p?.netSales ?? 0 : null,
      asp: div(netSales, units),
      aspLocal: local && a ? div(a.localNet, a.localUnits) : null,
    };
  };

  const names = [...ranked.slice(0, topN).map(([p]) => p), ...(pooledCount > 0 ? [OTHER_PRODUCTS] : [])];
  const rows: ProductRow[] = names.map((product) => ({
    product,
    pooled: product === OTHER_PRODUCTS && pooledCount > 0,
    pooledCount: product === OTHER_PRODUCTS ? pooledCount : 0,
    total: cell(product, TOTAL, allTotal, prevAllTotal, false),
    cells: Object.fromEntries(
      order.map((m) => [m, cell(product, m, totals.get(m) ?? 0, prevTotals?.get(m) ?? null, !!localOf.get(m))])
    ),
  }));

  const top: Record<string, TopItem[]> = {};
  for (const m of order) top[m] = topProducts(cur, prev, m);

  const { keep: mixKeep, excluded } = mixProducts(cur);
  const mix: Record<string, MixResult> = {};
  const entry: Record<string, EntryResult> = {};
  const home = raw.homeMarket;
  const homeCol = markets.find((m) => m.isHome);
  for (const m of markets) {
    if (m.isHome || m.key === MARKET_OTHER) continue;
    const u = unitMix(cur, m.key, home, mixKeep);
    if (!homeCol || homeCol.netSales <= 0) {
      mix[m.key] = { na: `No sales in the home market (${home}) in this period` };
    } else if (u.homeUnits <= 0 || u.units <= 0) {
      mix[m.key] = { na: "No units recorded for these lines" };
    } else if (u.units < MIN_MARKET_UNITS) {
      mix[m.key] = { na: `Fewer than ${MIN_MARKET_UNITS} units sold in ${m.key} in this period: a mix this small is noise` };
    } else {
      mix[m.key] = { ...u, excluded: excluded.filter((p) => cur.some((r) => r.product === p && (r.market === m.key || r.market === home) && (r.units ?? 0) > 0)) };
    }
    const n = raw.newOrders[m.key] ?? 0;
    const hn = raw.newOrders[home] ?? 0;
    if (!Object.keys(raw.newOrders).length) entry[m.key] = { na: "First orders are not available for this client" };
    else if (n <= 0) entry[m.key] = { na: `No first orders in ${m.key} in this period` };
    else if (hn <= 0) entry[m.key] = { na: `No first orders in the home market (${home}) in this period` };
    else entry[m.key] = { items: entryProducts(cur, m.key, home, raw.newOrders, mixKeep), newOrders: n, homeNewOrders: hn };
  }

  return {
    source: raw.source,
    baseCurrency: raw.baseCurrency,
    homeMarket: raw.homeMarket,
    hasCompare: prev !== null,
    markets,
    rows,
    productCount: ranked.length,
    top,
    mix,
    entry,
  };
}

// ── Takeaways: one plain sentence above each view ──────────────────────────
//
// Each answers "so what?" for its view from the model it draws, and returns
// null when there is nothing to say (no compared market, no prices), so the
// page prints no sentence rather than a wrong one.

/** Percentage points, "+3.4 pp" / "−3.4 pp"; a gap that rounds to zero is "0.0 pp". */
export function formatPp(diff: number): string {
  const v = Math.abs(diff * 100).toFixed(1);
  if (!/[1-9]/.test(v)) return "0.0 pp";
  return `${diff > 0 ? "+" : MINUS}${v} pp`;
}

const label = (key: string) => (key === MARKET_OTHER ? "Other" : key);

function listWords(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "";
}

/** A market or column total: compact from 10,000 ("€23K"), whole below it ("€880", never "€879.5"). */
export function formatTotal(value: number, currency: string): string {
  return formatMoney(value, currency, Math.abs(value) >= 10_000 ? { compact: true } : { decimals: 0 });
}

/** Index as printed: 1.237 is "124". */
export function formatIndex(index: number): string {
  return String(Math.round(index * 100));
}

/** Points between two shares as printed: each share rounded to 0.1 % first, so the gap matches the two figures shown. */
export function formatPpBetween(share: number, base: number): string {
  return formatPp((Math.round(share * 1000) - Math.round(base * 1000)) / 1000);
}

const named = (items: MixPoint[]) => listWords(items.map((p) => `${p.product} (${formatIndex(p.index!)})`));

/**
 * The mix map: does the market buy the home mix, by units, and which
 * products it buys clearly more or less of (outside the band, enough units).
 *   "By units, CA buys the US mix: the top 4 products are all within 4.1 pts.
 *    It buys more of MitoBoost (137), GreenMin (130) and GutSense (124), and
 *    less of Omega H+ (67)."
 */
export function mixTakeaway(res: MixResult, market: string, home: string): string | null {
  if ("na" in res || res.points.length === 0) return null;
  const where = label(market);
  const at = label(home);
  const top = [...res.points].sort((a, b) => b.homeShare - a.homeShare || a.product.localeCompare(b.product)).slice(0, MIX_HEAD);
  const widest = top.reduce((w, p) => (Math.abs(p.share - p.homeShare) > Math.abs(w.share - w.homeShare) ? p : w), top[0]);
  const gapPts = Math.abs(Math.round(widest.share * 1000) - Math.round(widest.homeShare * 1000)) / 10;
  const head =
    gapPts / 100 <= MIX_SAME_PP
      ? `By units, ${where} buys the ${at} mix: the top ${top.length} products are all within ${gapPts.toFixed(1)} pts.`
      : `By units, ${where} buys a different mix: ${widest.product} is ${formatPercent(widest.share)} of units against ${formatPercent(widest.homeShare)} in ${at}.`;
  const solid = res.points.filter((p) => !p.low && p.index !== null);
  const more = solid.filter((p) => p.index! >= 1 + MIX_BAND).sort((a, b) => b.index! - a.index!).slice(0, MIX_NAMED);
  const less = solid.filter((p) => p.index! <= 1 - MIX_BAND).sort((a, b) => a.index! - b.index!).slice(0, MIX_NAMED);
  if (!more.length && !less.length) return `${head} No product with ${MIX_MIN_UNITS} or more units sits outside ${Math.round(MIX_BAND * 100)} % of ${at}.`;
  const parts = [more.length ? `more of ${named(more)}` : null, less.length ? `less of ${named(less)}` : null].filter(Boolean);
  return `${head} It buys ${parts.join(", and ")}.`;
}

/**
 * Entry products: the product that opens clearly more first orders in the
 * market than at home (enough orders in both), else the market's top opener.
 *   "GutSense is in 44.1% of CA first orders against 26.0% in US: the CA entry product."
 */
export function entryTakeaway(res: EntryResult, market: string, home: string): string | null {
  if ("na" in res || res.items.length === 0) return null;
  const where = label(market);
  const at = label(home);
  const lead = res.items
    .filter((i) => !i.low && !i.homeLow && i.index !== null && i.index >= 1 + MIX_BAND)
    .sort((a, b) => b.share - a.share)[0];
  if (lead) return `${lead.product} is in ${formatPercent(lead.share)} of ${where} first orders against ${formatPercent(lead.homeShare)} in ${at}: the ${where} entry product.`;
  const first = res.items[0];
  return `${first.product} opens the most ${where} first orders, ${formatPercent(first.share)} against ${formatPercent(first.homeShare)} in ${at}.`;
}

/** Products counted as "the top" when the matrix reads concentration. */
export const TOP_CONCENTRATION = 3;
/** Units a product needs in both markets before its price gap is named. */
export const MIN_GAP_UNITS = 10;

/**
 * The matrix. Share: how much of net sales the top three products carry and
 * where that leans. Price: the widest gap in average selling price against
 * home, on products with enough units in both markets.
 *   "The top 3 products make 43.5% of net sales: from 36.0% in CA to 45.2% in US."
 *   "Widest price gap vs US: Travel Duo sells for $62 in CA against $74 in US (−16 %)."
 */
export function matrixTakeaway(model: Pick<ProductsModel, "rows" | "markets" | "homeMarket" | "baseCurrency">, metric: "share" | "price"): string | null {
  const products = model.rows.filter((r) => !r.pooled);
  const markets = model.markets.filter((m) => m.key !== MARKET_OTHER && m.netSales > 0);
  if (metric === "share") {
    const top = products.slice(0, TOP_CONCENTRATION);
    if (top.length < 2) return null;
    const all = top.reduce((t, r) => t + (r.total.share ?? 0), 0);
    const by = markets.map((m) => ({ key: m.key, share: top.reduce((t, r) => t + (r.cells[m.key]?.share ?? 0), 0) })).sort((a, b) => a.share - b.share);
    const head = `The top ${top.length} products make ${formatPercent(all)} of net sales`;
    if (by.length < 2) return `${head}.`;
    const lo = by[0];
    const hi = by[by.length - 1];
    if (hi.share - lo.share < 0.03) return `${head}, about the same in every market.`;
    return `${head}: from ${formatPercent(lo.share)} in ${label(lo.key)} to ${formatPercent(hi.share)} in ${label(hi.key)}.`;
  }
  const home = model.homeMarket;
  let best: { product: string; market: string; asp: number; homeAsp: number; gap: number } | null = null;
  for (const r of products) {
    const h = r.cells[home];
    if (!h || h.asp === null || h.units === null || h.units < MIN_GAP_UNITS) continue;
    for (const m of markets) {
      if (m.key === home) continue;
      const c = r.cells[m.key];
      if (!c || c.asp === null || c.units === null || c.units < MIN_GAP_UNITS) continue;
      const gap = c.asp / h.asp - 1;
      if (!best || Math.abs(gap) > Math.abs(best.gap)) best = { product: r.product, market: m.key, asp: c.asp, homeAsp: h.asp, gap };
    }
  }
  if (!best) return null;
  const pct = Math.round(best.gap * 100);
  if (pct === 0) return `Average selling prices match ${label(home)} within 1 % on every product with ${MIN_GAP_UNITS} or more units.`;
  const money = (v: number) => formatMoney(v, model.baseCurrency);
  return `Widest price gap vs ${label(home)}: ${best.product} sells for ${money(best.asp)} in ${label(best.market)} against ${money(best.homeAsp)} in ${label(home)} (${pct > 0 ? "+" : MINUS}${Math.abs(pct)} %).`;
}

/**
 * Top 5 per market: whether the same product leads everywhere, and with
 * Compare on, the biggest change in share inside a top 5.
 *   "Radiance Serum 30ml leads in every market, from 15.0% in CA to 21.0% in US."
 *   "The top seller differs: Radiance Serum 30ml in US (17.0%), Deep Sleep Tincture in CA (14.2%)."
 */
export function topTakeaway(model: Pick<ProductsModel, "top" | "markets" | "hasCompare">): string | null {
  const leaders = model.markets
    .map((m) => ({ key: m.key, item: model.top[m.key]?.[0] }))
    .filter((x): x is { key: string; item: TopItem } => !!x.item);
  if (!leaders.length) return null;
  let head: string;
  const named = leaders.filter((l) => l.key !== MARKET_OTHER);
  const pool = named.length ? named : leaders;
  if (pool.length === 1) {
    head = `${pool[0].item.product} leads ${label(pool[0].key)} with ${formatPercent(pool[0].item.share)} of net sales.`;
  } else if (pool.every((l) => l.item.product === pool[0].item.product)) {
    const sorted = [...pool].sort((a, b) => a.item.share - b.item.share);
    head = `${pool[0].item.product} leads in every market, from ${formatPercent(sorted[0].item.share)} in ${label(sorted[0].key)} to ${formatPercent(sorted[sorted.length - 1].item.share)} in ${label(sorted[sorted.length - 1].key)}.`;
  } else {
    head = `The top seller differs: ${listWords(pool.map((l) => `${l.item.product} in ${label(l.key)} (${formatPercent(l.item.share)})`))}.`;
  }
  if (!model.hasCompare) return head;
  let move: { key: string; product: string; diff: number } | null = null;
  for (const m of model.markets) {
    const items = model.top[m.key] ?? [];
    // Other pools many countries on few orders, and a market that did not sell
    // in the comparison has no shift to report.
    if (m.key === MARKET_OTHER || items.every((it) => it.prevRank === null)) continue;
    for (const it of items) {
      if (it.prevShare === null) continue;
      const diff = it.share - it.prevShare;
      if (!move || Math.abs(diff) > Math.abs(move.diff)) move = { key: m.key, product: it.product, diff };
    }
  }
  if (!move || Math.abs(move.diff) < 0.01) return head;
  return `${head} Biggest shift against the comparison: ${move.product} in ${label(move.key)}, ${formatPp(move.diff)}.`;
}
