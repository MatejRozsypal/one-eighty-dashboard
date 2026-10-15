/**
 * Pure mapping of one `ref.industry_benchmarks` row to a `BenchmarkRow`.
 * No BigQuery, no server-only: benchmarks.ts loads, this file decides what a
 * usable row is, and scripts/check-reports-eval.ts tests it directly.
 */

import { isoDate, num } from "@/lib/coerce";
import type { BenchmarkRow } from "./contracts";
import type { BenchmarkStat } from "./types";

export type BqDate = string | { value: string } | null;

export interface BenchmarkDbRow {
  benchmark_id: string | null;
  vertical: string | null;
  region: string | null;
  metric_id: string | null;
  period_start: BqDate;
  period_end: BqDate;
  stat: string | null;
  value: unknown;
  value_low: unknown;
  value_high: unknown;
  currency: string | null;
  source: string | null;
  source_url: string | null;
  as_of: BqDate;
  definition_note: string | null;
  sample_note: string | null;
  note: string | null;
}

/**
 * The stats Reports reads. Deliberately not 'range' (migration 295): a range
 * row has only a midpoint in `value` plus a low/high band and no median or
 * mean, so it is skipped here; the Markets page reads those rows itself.
 * Region is not filtered: any region is kept (ISO country codes included), and
 * benchmarkMatch.ts only ever applies the client's own market, EU and GLOBAL.
 */
export const STATS: readonly BenchmarkStat[] = ["median", "mean", "p25", "p75"];

export function text(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * Camel-case one row. Rows missing a required field (the DDL makes them NOT
 * NULL, but the table is hand-maintained) are dropped rather than guessed:
 * a benchmark with no source or date must not be drawn.
 */
export function toBenchmarkRow(r: BenchmarkDbRow): BenchmarkRow | null {
  const benchmarkId = text(r.benchmark_id);
  const vertical = text(r.vertical)?.toLowerCase() ?? null;
  const region = text(r.region)?.toUpperCase() ?? null;
  const metricId = text(r.metric_id);
  const periodStart = isoDate(r.period_start);
  const periodEnd = isoDate(r.period_end);
  const stat = text(r.stat)?.toLowerCase() ?? null;
  const value = num(r.value);
  const source = text(r.source);
  const asOf = isoDate(r.as_of);
  if (!benchmarkId || !vertical || !region || !metricId || !periodStart || !periodEnd || !source || !asOf) return null;
  if (value === null || !stat || !(STATS as readonly string[]).includes(stat)) return null;
  if (periodEnd < periodStart) return null;
  return {
    benchmarkId,
    vertical,
    region,
    metricId,
    periodStart,
    periodEnd,
    stat: stat as BenchmarkStat,
    value,
    valueLow: num(r.value_low),
    valueHigh: num(r.value_high),
    currency: text(r.currency)?.toUpperCase() ?? null,
    source,
    sourceUrl: text(r.source_url),
    asOf,
    definitionNote: text(r.definition_note),
    sampleNote: text(r.sample_note),
    note: text(r.note),
  };
}

