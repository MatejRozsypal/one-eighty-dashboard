/**
 * Number and money formatting.
 *
 * ── Why these are not in lib/currency.ts ───────────────────────────────────
 * They used to be. That module also holds the FX SQL helpers, so it imports
 * `lib/bigquery`, which is `server-only` — and the moment a client component
 * wanted to render a figure, the whole BigQuery client came with it and the
 * build failed with an error that names `server-only` rather than the import
 * that dragged it in.
 *
 * These four functions are pure: a number in, a string out. Splitting them here
 * lets a client component format a figure without pulling a database client
 * into the browser bundle. `lib/currency.ts` re-exports them, so every existing
 * import keeps working and there is still exactly one implementation of each.
 *
 * UI copy is English throughout, so `en-US` grouping is used for every
 * currency — the symbol changes, the separators do not.
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
