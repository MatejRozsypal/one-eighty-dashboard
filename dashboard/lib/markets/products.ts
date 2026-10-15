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
 * ── Differs most ────────────────────────────────────────────────────────────
 * For each market other than home and Other, every product's share there
 * minus its share at home, in percentage points, largest gap first. A product
 * under `MIN_SHARE` in both markets is noise and left out; a market under
 * `MIN_MARKET_UNITS` units in the period gets no list at all (n/a, with why).
 * Other pools several countries, so it is never compared.
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
/** Products per market in the differs-most list. */
export const DIFFERS_LIMIT = 5;
/** A product below this share in both markets is left out of differs-most. */
export const MIN_SHARE = 0.01;
/** A market with fewer units than this in the period gets no differs-most list. */
export const MIN_MARKET_UNITS = 50;
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

export interface DiffItem {
  product: string;
  share: number;
  homeShare: number;
  /** share minus homeShare, in points (0.034 = 3.4 pp). */
  diff: number;
}

export type DiffResult = { items: DiffItem[] } | { na: string };

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
  differs: Record<string, DiffResult>;
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
 * Products whose share in `market` differs most from their share at `home`,
 * largest absolute gap first; ties by product name. A product under
 * `minShare` in both is left out.
 */
export function differsMost(
  home: ReadonlyMap<string, number>,
  market: ReadonlyMap<string, number>,
  { limit = DIFFERS_LIMIT, minShare = MIN_SHARE }: { limit?: number; minShare?: number } = {}
): DiffItem[] {
  const products = new Set([...home.keys(), ...market.keys()]);
  const items: DiffItem[] = [];
  for (const product of products) {
    const share = market.get(product) ?? 0;
    const homeShare = home.get(product) ?? 0;
    if (share < minShare && homeShare < minShare) continue;
    items.push({ product, share, homeShare, diff: share - homeShare });
  }
  items.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.product.localeCompare(b.product));
  return items.slice(0, limit);
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

  const shares = marketShares(cur);
  const differs: Record<string, DiffResult> = {};
  const home = shares.get(raw.homeMarket);
  for (const m of markets) {
    if (m.isHome || m.key === MARKET_OTHER) continue;
    if (!home || (totals.get(raw.homeMarket) ?? 0) <= 0) {
      differs[m.key] = { na: `No sales in the home market (${raw.homeMarket}) in this period` };
    } else if (m.units < MIN_MARKET_UNITS) {
      differs[m.key] = { na: `Fewer than ${MIN_MARKET_UNITS} units sold in ${m.key} in this period: shares this small are noise` };
    } else {
      differs[m.key] = { items: differsMost(home, shares.get(m.key) ?? new Map()) };
    }
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
    differs,
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

/**
 * What sells differently: the one product whose share differs most from home,
 * over every compared market, and which way.
 *   "Biggest difference: Deep Sleep Tincture is 14.2% of CA net sales against
 *    9.5% in US (+4.7 pp): a product to lead with in CA."
 */
export function differsTakeaway(model: Pick<ProductsModel, "differs" | "homeMarket">): string | null {
  let best: { market: string; item: DiffItem } | null = null;
  for (const [market, res] of Object.entries(model.differs)) {
    if (!("items" in res)) continue;
    for (const item of res.items) if (!best || Math.abs(item.diff) > Math.abs(best.item.diff)) best = { market, item };
  }
  if (!best || formatPp(best.item.diff) === "0.0 pp") return null;
  const { market, item } = best;
  const home = label(model.homeMarket);
  const where = label(market);
  const hint = item.diff > 0 ? `a product to lead with in ${where}` : `worth checking its price or visibility in ${where}`;
  return `Biggest difference: ${item.product} is ${formatPercent(item.share)} of ${where} net sales against ${formatPercent(item.homeShare)} in ${home} (${formatPp(item.diff)}): ${hint}.`;
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
