/**
 * Benchmark matching: pick, per benchmarkable metric and client, the one
 * `ref.industry_benchmarks` row that best fits, and convert money values to
 * the display currency.
 *
 * Order of preference (owner decision plus design 2.11):
 * 1. Vertical: the client's vertical, else BENCHMARK_POLICY.allVertical
 *    (clients without a vertical only get the fallback).
 * 2. Region: the client's market, then EU, then GLOBAL. Rows for any other
 *    region never apply (a US figure is not a CZ benchmark).
 * 3. Time: most days overlapping the current range; with no overlap, the
 *    latest period_end within lookbackMonths before the range start. Rows that
 *    start after the range, or ended earlier than the lookback, never apply.
 * 4. Ties: latest as_of, then stat (median, mean, p75, p25), then id.
 * Clients for which the metric is not connected get no benchmark.
 * Matches of the same row are merged; appliesTo lists their client ids.
 *
 * Money rows are converted from their currency at the period_end month,
 * triangulated through CZK like the compiler (direct X to CZK, two-hop X to Y
 * to CZK, CZK identity). No rate, or a money row without a currency: status
 * "no_fx", values null. as_of older than staleAfterMonths: "stale".
 *
 * Pure: no BigQuery. Owner: WP1 (RS1). Loading the rows is WP3 (benchmarks.ts).
 */

import { daysInRange, todayUtc, type DateRange } from "@/lib/period";
import type { BenchmarkMatchModule, BenchmarkRow, FxRate, MatchBenchmarks } from "./contracts";
import { BENCHMARK_POLICY } from "./limits";
import { isMetricId, type MetricId } from "./registry/ids";
import { METRICS } from "./registry/metrics";
import type { ReportClient } from "./registry/types";
import { monthStart, shiftMonthsKeepDay } from "./resolve";
import type { BenchmarkMatch, BenchmarkStat } from "./types";

const STAT_RANK: Readonly<Record<BenchmarkStat, number>> = { median: 0, mean: 1, p75: 2, p25: 3 };

/** Region preference for one client: own market, then the policy fallbacks, deduplicated. */
export function regionPreference(client: Pick<ReportClient, "region">): string[] {
  const out: string[] = [];
  for (const r of [client.region, ...BENCHMARK_POLICY.regionFallback]) {
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

function overlapDays(row: BenchmarkRow, range: DateRange): number {
  const from = row.periodStart > range.from ? row.periodStart : range.from;
  const to = row.periodEnd < range.to ? row.periodEnd : range.to;
  return from <= to ? daysInRange({ from, to }) : 0;
}

interface Scored {
  row: BenchmarkRow;
  overlap: number;
}

/** Usable rows in time, best first. */
function rankInTime(rows: readonly BenchmarkRow[], range: DateRange): Scored[] {
  const lookbackFrom = shiftMonthsKeepDay(range.from, -BENCHMARK_POLICY.lookbackMonths);
  const usable: Scored[] = [];
  for (const row of rows) {
    if (row.periodEnd < row.periodStart) continue;
    const overlap = overlapDays(row, range);
    if (overlap > 0) usable.push({ row, overlap });
    else if (row.periodEnd < range.from && row.periodEnd >= lookbackFrom) usable.push({ row, overlap: 0 });
  }
  return usable.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      (a.overlap === 0 ? cmpDesc(a.row.periodEnd, b.row.periodEnd) : 0) ||
      cmpDesc(a.row.asOf, b.row.asOf) ||
      (STAT_RANK[a.row.stat] ?? 9) - (STAT_RANK[b.row.stat] ?? 9) ||
      (a.row.benchmarkId < b.row.benchmarkId ? -1 : a.row.benchmarkId > b.row.benchmarkId ? 1 : 0),
  );
}

function cmpDesc(a: string, b: string): number {
  return a > b ? -1 : a < b ? 1 : 0;
}

/** Best row for one client and metric, or null. */
export function pickBenchmark(rows: readonly BenchmarkRow[], metricId: MetricId, client: Pick<ReportClient, "vertical" | "region">, range: DateRange): BenchmarkRow | null {
  const forMetric = rows.filter((r) => r.metricId === metricId);
  const verticals = client.vertical && client.vertical !== BENCHMARK_POLICY.allVertical ? [client.vertical, BENCHMARK_POLICY.allVertical] : [BENCHMARK_POLICY.allVertical];
  const regions = regionPreference(client);
  for (const v of verticals) {
    const ofVertical = forMetric.filter((r) => r.vertical === v);
    if (ofVertical.length === 0) continue;
    for (const region of regions) {
      const best = rankInTime(
        ofVertical.filter((r) => r.region === region),
        range,
      )[0];
      if (best) return best.row;
    }
  }
  return null;
}

/** CZK per one unit of `ccy` in `month`. Null when no rate. */
function toCzk(fx: readonly FxRate[], ccy: string, month: string): number | null {
  if (ccy === "CZK") return 1;
  const direct = fx.find((r) => r.monthStart === month && r.from === ccy && r.to === "CZK");
  if (direct) return direct.rate;
  for (const hop of fx) {
    if (hop.monthStart !== month || hop.from !== ccy || hop.to === "CZK") continue;
    const second = fx.find((r) => r.monthStart === month && r.from === hop.to && r.to === "CZK");
    if (second) return hop.rate * second.rate;
  }
  return null;
}

/** Factor converting `from` money into `to` money in the month of `date`. Null when a rate is missing. */
export function fxFactor(fx: readonly FxRate[], from: string, to: string, date: string): number | null {
  if (from === to) return 1;
  const month = monthStart(date);
  const src = toCzk(fx, from, month);
  const dst = toCzk(fx, to, month);
  if (src === null || dst === null || dst === 0) return null;
  return src / dst;
}

export const matchBenchmarks: MatchBenchmarks = ({ rows, fx, widget, today }) => {
  const now = today ?? todayUtc();
  const staleBefore = shiftMonthsKeepDay(now, -BENCHMARK_POLICY.staleAfterMonths);
  const range = widget.period.current;
  const known = rows.filter((r) => isMetricId(r.metricId));
  const out: BenchmarkMatch[] = [];

  for (const metricId of widget.query.metrics) {
    const metric = METRICS[metricId];
    if (!metric.benchmarkable) continue;
    const byRow = new Map<string, { row: BenchmarkRow; clients: string[] }>();
    for (const client of widget.clients) {
      if (widget.availability[client.id]?.[metricId]?.ok !== true) continue;
      const row = pickBenchmark(known, metricId, client, range);
      if (!row) continue;
      const hit = byRow.get(row.benchmarkId) ?? { row, clients: [] };
      hit.clients.push(client.id);
      byRow.set(row.benchmarkId, hit);
    }
    const matches = [...byRow.values()].sort((a, b) => (a.row.vertical < b.row.vertical ? -1 : a.row.vertical > b.row.vertical ? 1 : a.row.benchmarkId < b.row.benchmarkId ? -1 : 1));
    for (const { row, clients } of matches) {
      let factor: number | null = 1;
      if (metric.unit === "money") factor = row.currency ? fxFactor(fx, row.currency, widget.displayCurrency, row.periodEnd) : null;
      const conv = (v: number | null): number | null => (v === null || factor === null ? null : v * factor);
      const status: BenchmarkMatch["status"] = factor === null ? "no_fx" : row.asOf < staleBefore ? "stale" : "ok";
      out.push({
        metricId,
        vertical: row.vertical,
        region: row.region,
        stat: row.stat,
        status,
        value: conv(row.value),
        low: conv(row.valueLow),
        high: conv(row.valueHigh),
        source: row.source,
        sourceUrl: row.sourceUrl,
        asOf: row.asOf,
        period: { from: row.periodStart, to: row.periodEnd },
        note: row.definitionNote,
        appliesTo: [...clients].sort(),
        benchmarkId: row.benchmarkId,
      });
    }
  }
  return out;
};

const _conforms: BenchmarkMatchModule = { matchBenchmarks };
void _conforms;
