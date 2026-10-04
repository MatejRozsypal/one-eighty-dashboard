import "server-only";

/**
 * Reference data for the benchmark overlay (design 2.11, contract BenchmarksModule).
 *
 * Loads, it does not match: `matchBenchmarks()` in benchmarkMatch.ts (WP1) is
 * the pure matcher. Two reference reads, shared by every widget and user:
 *
 *   - `ref.industry_benchmarks` (migration 250), rows with is_active. Owner
 *     decision: the table starts empty, and until migration 250 is deployed it
 *     does not exist at all; "Not found: Table" on exactly that table means an
 *     empty list, so the overlay hides itself. Any other error is re-thrown.
 *   - `ref.fx_rates`, every row (about 200: four pairs, monthly since 2022-06),
 *     for converting money benchmarks at their period_end month.
 *
 * Both cached 6 hours (CACHE_TTL_S.reference); benchmark rows also carry the
 * "benchmarks" tag so an entry can be published with one revalidateTag.
 * The gate runs before any cache read.
 */

import { unstable_cache } from "next/cache";
import { query, PROJECT_ID } from "@/lib/bigquery";
import { assertReportsAccess } from "@/lib/authz";
import { isoDate, num } from "@/lib/coerce";
import { matchBenchmarks } from "./benchmarkMatch";
import { isTableNotFound } from "./clients";
import type { BenchmarkRow, FxRate, GetBenchmarkRows, GetBenchmarks, GetFxRates, MatchBenchmarks } from "./contracts";
import { CACHE_TAGS, CACHE_TTL_S } from "./limits";
import type { BenchmarkStat } from "./types";

type BqDate = string | { value: string } | null;

interface BenchmarkDbRow {
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

interface FxDbRow {
  month_start: BqDate;
  from_currency: string | null;
  to_currency: string | null;
  rate: unknown;
}

const STATS: readonly BenchmarkStat[] = ["median", "mean", "p25", "p75"];

function text(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * Camel-case one row. Rows missing a required field (the DDL makes them NOT
 * NULL, but the table is hand-maintained) are dropped rather than guessed:
 * a benchmark with no source or date must not be drawn.
 */
function toBenchmarkRow(r: BenchmarkDbRow): BenchmarkRow | null {
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

async function loadBenchmarkRows(): Promise<BenchmarkRow[]> {
  try {
    const rows = await query<BenchmarkDbRow>(
      `SELECT benchmark_id, vertical, region, metric_id, period_start, period_end, stat,
              value, value_low, value_high, currency, source, source_url, as_of,
              definition_note, sample_note, note
         FROM \`${PROJECT_ID}.ref.industry_benchmarks\`
        WHERE is_active
        ORDER BY benchmark_id`
    );
    return rows.map(toBenchmarkRow).filter((r): r is BenchmarkRow => r !== null);
  } catch (error) {
    if (isTableNotFound(error, "ref.industry_benchmarks")) return [];
    throw error;
  }
}

async function loadFxRates(): Promise<FxRate[]> {
  const rows = await query<FxDbRow>(
    `SELECT month_start, from_currency, to_currency, rate
       FROM \`${PROJECT_ID}.ref.fx_rates\`
      ORDER BY month_start, from_currency, to_currency`
  );
  const out: FxRate[] = [];
  for (const r of rows) {
    const monthStart = isoDate(r.month_start);
    const from = text(r.from_currency)?.toUpperCase();
    const to = text(r.to_currency)?.toUpperCase();
    const rate = num(r.rate);
    if (monthStart && from && to && rate !== null && rate > 0) out.push({ monthStart, from, to, rate });
  }
  return out;
}

const cachedBenchmarkRows = unstable_cache(loadBenchmarkRows, ["reports", "benchmark-rows", "v1"], {
  revalidate: CACHE_TTL_S.reference,
  tags: [CACHE_TAGS.reference, CACHE_TAGS.benchmarks],
});

const cachedFxRates = unstable_cache(loadFxRates, ["reports", "fx-rates", "v1"], {
  revalidate: CACHE_TTL_S.reference,
  tags: [CACHE_TAGS.reference],
});

export const getBenchmarkRows: GetBenchmarkRows = async () => {
  await assertReportsAccess();
  return cachedBenchmarkRows();
};

export const getFxRates: GetFxRates = async () => {
  await assertReportsAccess();
  return cachedFxRates();
};

const match: MatchBenchmarks = matchBenchmarks;

/**
 * [] when the widget's benchmark switch is off, when no requested metric
 * matters (the matcher decides benchmarkability from the registry), or when
 * the table has no usable rows. FX is only read when there is something to
 * convert.
 */
export const getBenchmarks: GetBenchmarks = async (widget) => {
  if (!widget.filters.benchmark) return [];
  await assertReportsAccess();
  const rows = await cachedBenchmarkRows();
  if (rows.length === 0) return [];
  const fx = await cachedFxRates();
  return match({ rows, fx, widget });
};
