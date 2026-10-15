/**
 * Markets, Trends & analysis, for the demo client.
 *
 * Weekly rows are not generated a second time: each Monday week is read
 * through `demoMarkets` (lib/demo/markets.ts) for that week's dates, so a
 * week here sums to exactly what the Overview shows for the same days.
 *
 * Two things the Overview fixture does not carry are generated here, from the
 * same period sums so their totals agree:
 *
 *   GA4 by country   na only (eu has no GA4, as the scouting fixture says),
 *                    starting 73 days before the last day, like the real
 *                    2026-08-03 start, so the coverage note shows
 *   order values     a log-normal spread around each market's net sales per
 *                    order, with free shipping above a round threshold set so
 *                    the zero-shipping share lands near the Overview's
 *
 * No row is anyone's data.
 */

import { dataThrough } from "./business";
import { unit } from "./random";
import { demoMarkets, type DemoRegion } from "./markets";
import {
  addDaysIso,
  mondayOf,
  niceWidth,
  weekSlots,
  DISPLAY_BIN_FACTOR,
  type Ga4Raw,
  type Ga4Row,
  type MarketBins,
  type OrderBinsRaw,
  type ResponseRaw,
  type TrendsRaw,
  type WeekRow,
} from "@/lib/markets/analysis";
import { MARKET_UNALLOCATED } from "@/lib/markets/types";

type Range = { from: string; to: string };

function weekRows(region: DemoRegion, range: Range): WeekRow[] {
  const out: WeekRow[] = [];
  for (const s of weekSlots(range, dataThrough())) {
    for (const r of demoMarkets(region, { from: s.from, to: s.to }, null).current) {
      out.push({ market: r.market, week: s.start, sums: r.sums, spendGapDays: 0 });
    }
  }
  return out;
}

export function demoTrendWeeks(region: DemoRegion, range: Range, compare: Range | null): TrendsRaw {
  return { source: "demo", weeks: weekRows(region, range), compareWeeks: compare ? weekRows(region, compare) : null };
}

/** The fit window: 52 Monday weeks ending with the selected range. */
export function responseWindow(range: Range): Range {
  return { from: mondayOf(addDaysIso(range.to, -364)), to: range.to };
}

export function demoResponse(region: DemoRegion, range: Range): ResponseRaw {
  const window = responseWindow(range);
  return { window, rows: weekRows(region, window) };
}

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------

/** Per market: purchase CVR, engaged share, unpaid share of engaged, add-to-cart rate. */
const GA4_SHAPE: Record<string, [number, number, number, number]> = {
  US: [0.021, 0.63, 0.41, 0.074],
  CA: [0.017, 0.6, 0.36, 0.066],
  OTHER: [0.006, 0.52, 0.55, 0.031],
};
/** Days of GA4 history before the last day. */
const GA4_DAYS = 73;

function ga4Rows(region: DemoRegion, range: Range, first: string): { rows: Ga4Row[]; days: number } {
  const last = dataThrough();
  const from = range.from > first ? range.from : first;
  const to = range.to < last ? range.to : last;
  if (to < from) return { rows: [], days: 0 };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const rows = demoMarkets(region, { from, to }, null)
    .current.filter((r) => r.market !== MARKET_UNALLOCATED)
    .map((r) => {
      const [cvr, engaged, unpaid, atc] = GA4_SHAPE[r.market] ?? GA4_SHAPE.OTHER;
      // GA4 sees fewer purchases than the shop (consent, blockers).
      const purchases = Math.round(r.sums.orders * 0.91);
      const sessions = Math.round(r.sums.orders / cvr);
      const eng = Math.round(sessions * engaged);
      return {
        iso: r.market === "OTHER" ? "GB" : r.market,
        sessions,
        engagedSessions: eng,
        unpaidEngagedSessions: Math.round(eng * unpaid),
        addToCartSessions: Math.round(sessions * atc),
        purchases,
      };
    });
  return { rows, days };
}

export function demoGa4(region: DemoRegion, range: Range, compare: Range | null): Ga4Raw {
  if (region === "eu") return { firstDay: null, lastDay: null, daysCurrent: 0, daysPrevious: null, current: [], previous: null };
  const last = dataThrough();
  const first = addDaysIso(last, -GA4_DAYS);
  const cur = ga4Rows(region, range, first);
  const prev = compare ? ga4Rows(region, compare, first) : null;
  return { firstDay: first, lastDay: last, daysCurrent: cur.days, daysPrevious: prev?.days ?? null, current: cur.rows, previous: prev?.rows ?? null };
}

// ---------------------------------------------------------------------------
// Order values
// ---------------------------------------------------------------------------

const SIGMA = 0.5;

function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** z with P(Z >= z) = p, by bisection. */
function upperZ(p: number): number {
  let lo = -6;
  let hi = 6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (1 - normalCdf(mid) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function roundNice(v: number): number {
  const step = niceWidth(v, 10);
  return Math.round(v / step) * step - (v > 50 ? 1 : 0);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** The same binning the SQL does: fine width = nice(p95 / 20) / 5, values capped at p99. */
export function binValues(market: string, values: Array<{ v: number; zero: boolean }>): MarketBins {
  const sorted = values.map((x) => x.v).sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const cap = percentile(sorted, 99);
  const width = niceWidth(p95, 20) / DISPLAY_BIN_FACTOR;
  const bins = new Map<number, { lo: number; orders: number; zeroShip: number }>();
  for (const x of values) {
    const lo = Math.floor(Math.min(Math.max(x.v, 0), cap) / width) * width;
    const b = bins.get(lo) ?? { lo, orders: 0, zeroShip: 0 };
    b.orders += 1;
    if (x.zero) b.zeroShip += 1;
    bins.set(lo, b);
  }
  return { market, width, cap, bins: [...bins.values()].sort((a, b) => a.lo - b.lo) };
}

/** Zero-shipping share per market the threshold is placed for (the Overview fixture's). */
const ZERO_SHARE: Record<string, number> = { US: 0.35, CA: 0.28, CZ: 0.425, SK: 0.478, PL: 0.3, OTHER: 0.1 };

export function demoOrderBins(region: DemoRegion, range: Range): OrderBinsRaw {
  const raw = demoMarkets(region, range, null);
  const markets: MarketBins[] = [];
  for (const r of raw.current) {
    if (r.market === MARKET_UNALLOCATED || r.sums.orders === 0) continue;
    const n = Math.round(r.sums.orders);
    const mean = r.sums.netSales / r.sums.orders;
    const median = mean / Math.exp((SIGMA * SIGMA) / 2);
    const share = ZERO_SHARE[r.market] ?? 0.1;
    const threshold = roundNice(median * Math.exp(SIGMA * upperZ(share)));
    const values: Array<{ v: number; zero: boolean }> = [];
    for (let i = 0; i < n; i++) {
      const k = `mkt:${region}:${r.market}:${range.from}:${i}`;
      const u1 = Math.max(1e-9, unit(`${k}:u`));
      const u2 = unit(`${k}:w`);
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const v = median * Math.exp(SIGMA * z);
      const zero = v >= threshold ? unit(`${k}:z`) < 0.95 : unit(`${k}:z`) < 0.03;
      values.push({ v, zero });
    }
    markets.push(binValues(r.market, values));
  }
  return { markets, reason: null };
}
