/**
 * Currency display and FX conversion.
 *
 * Warehouse policy is native-currency-at-rest: Manami is CZK end to end, Dobias
 * is USD end to end, and no mart view converts anything. That is deliberate —
 * converting at ingest destroys the ability to reconcile against Shopify or
 * Shoptet, which report in the shop's own currency.
 *
 * So conversion is a *display* concern and lives here. The dashboard defaults to
 * native and offers a single agency-wide rollup currency, letting you ask "what
 * did we do in total this month" across a CZK client and a USD one.
 *
 * ── Conversion is done at monthly grain, before aggregation ──────────────────
 * A range spanning several months cannot be converted by multiplying the total
 * by one rate; that silently assumes the rate held all along. Instead each daily
 * row is multiplied by its own month's rate inside SQL, and only then summed.
 * `ref.fx_rates` is monthly (`month_start`), which is why the join is on
 * DATE_TRUNC(date, MONTH).
 *
 * ── Known gap ───────────────────────────────────────────────────────────────
 * As of 2026-07-30 `ref.fx_rates` holds exactly one pair — CAD→USD, 48 months,
 * last month 2026-05-01, hand-seeded (`source = 'manual_entry_2026-05-25'`).
 * There is no USD→CZK, so converting Dobias into CZK is not possible yet, and
 * `getConversionCoverage` reports that honestly so the UI can disable the toggle
 * instead of rendering a plausible-looking wrong number. The moment USD→CZK
 * rows land, the toggle lights up with no code change.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { num } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";

/** "native" renders each client in its own currency; anything else converts. */
export type DisplayCurrency = "native" | string;

export const ROLLUP_CURRENCY = "CZK";

export interface ConversionCoverage {
  from: string;
  to: string;
  /** True when every month in the requested range has a rate. */
  complete: boolean;
  /** Months in the range with no rate — the reason `complete` is false. */
  missingMonths: string[];
}

/**
 * Can we convert `from` → `to` across every month of this range?
 *
 * Partial coverage is treated as no coverage. A total assembled from some
 * converted months and some dropped ones is not a smaller number, it is a wrong
 * one, and nothing in the UI would reveal which months went missing.
 */
export async function getConversionCoverage(
  from: string,
  to: string,
  range: DateRange
): Promise<ConversionCoverage> {
  if (from === to) {
    return { from, to, complete: true, missingMonths: [] };
  }

  const rows = await query<{ missing_month: { value: string } }>(
    `WITH wanted AS (
       SELECT month_start
       FROM UNNEST(GENERATE_DATE_ARRAY(
              DATE_TRUNC(@from, MONTH), DATE_TRUNC(@to, MONTH), INTERVAL 1 MONTH
            )) AS month_start
     )
     SELECT w.month_start AS missing_month
     FROM wanted w
     LEFT JOIN \`${PROJECT_ID}.ref.fx_rates\` fx
       ON fx.month_start   = w.month_start
      AND fx.from_currency = @fromCurrency
      AND fx.to_currency   = @toCurrency
     WHERE fx.rate IS NULL
     ORDER BY w.month_start`,
    { from: range.from, to: range.to, fromCurrency: from, toCurrency: to }
  );

  const missingMonths = rows
    .map((r) => r.missing_month?.value)
    .filter((m): m is string => Boolean(m));

  return { from, to, complete: missingMonths.length === 0, missingMonths };
}

/**
 * SQL fragments that convert a mart's money columns into a target currency.
 *
 * Returns a JOIN clause and a `wrap()` that turns a column reference into a
 * converted expression. Callers compose them so the conversion happens inside
 * the same query that aggregates — never as a post-hoc multiply in TypeScript.
 *
 * When `target` is "native" both are no-ops, so the same query builder serves
 * both modes and there is no second, subtly different code path to keep in sync.
 */
export interface FxSql {
  /** JOIN clause to append after the mart table. Empty string in native mode. */
  join: string;
  /** Wrap a numeric column so it is expressed in the target currency. */
  wrap: (column: string) => string;
  /** Currency the resulting figures are in, or null when per-row native. */
  resultCurrency: string | null;
}

export function fxSql(target: DisplayCurrency, tableAlias = "k"): FxSql {
  if (target === "native") {
    return { join: "", wrap: (c) => c, resultCurrency: null };
  }

  return {
    // LEFT JOIN, not INNER: an inner join would silently drop rows whose month
    // has no rate, quietly shrinking the total. The COALESCE below turns a
    // missing rate into NULL instead, which propagates visibly to the metric.
    join: `
      LEFT JOIN \`${PROJECT_ID}.ref.fx_rates\` fx
        ON fx.month_start   = DATE_TRUNC(${tableAlias}.date, MONTH)
       AND fx.from_currency = ${tableAlias}.currency
       AND fx.to_currency   = @displayCurrency`,

    // Rows already in the target currency need no rate and must not be dropped
    // for lacking one — hence the identity branch.
    wrap: (column) =>
      `(${column} * IF(${tableAlias}.currency = @displayCurrency, 1, fx.rate))`,

    resultCurrency: target,
  };
}

/** Params every fx-aware query must bind. Merge into the query's own params. */
export function fxParams(target: DisplayCurrency): Record<string, string> {
  return target === "native" ? {} : { displayCurrency: target };
}

/**
 * Which conversions are possible at all, for building the toggle's options.
 */
export async function getSupportedPairs(): Promise<
  Array<{ from: string; to: string; months: number; lastMonth: string | null }>
> {
  const rows = await query<{
    from_currency: string;
    to_currency: string;
    months: number | string;
    last_month: { value: string } | null;
  }>(
    `SELECT from_currency, to_currency,
            COUNT(*) AS months, MAX(month_start) AS last_month
     FROM \`${PROJECT_ID}.ref.fx_rates\`
     GROUP BY from_currency, to_currency`
  );

  return rows.map((r) => ({
    from: r.from_currency,
    to: r.to_currency,
    months: num(r.months) ?? 0,
    lastMonth: r.last_month?.value ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format money. UI copy is English throughout, so `en-US` grouping is used for
 * every currency — the symbol changes, the separators don't.
 */
export function formatMoney(
  value: number | null,
  currency: string,
  { compact = false }: { compact?: boolean } = {}
): string {
  if (value === null) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function formatNumber(
  value: number | null,
  { compact = false, decimals = 0 }: { compact?: boolean; decimals?: number } = {}
): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Percentages arrive as fractions (0.35), render as "35.0%". */
export function formatPercent(
  value: number | null,
  { decimals = 1 }: { decimals?: number } = {}
): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

/** Ratios like MER / aMER: "4.2×". */
export function formatRatio(
  value: number | null,
  { decimals = 2 }: { decimals?: number } = {}
): string {
  if (value === null) return "—";
  return `${value.toFixed(decimals)}×`;
}
