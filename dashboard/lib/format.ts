/**
 * Number and money formatting.
 *
 * ── Why these are not in lib/currency.ts ───────────────────────────────────
 * They used to be. That module also holds the FX SQL helpers, so it imports
 * `lib/bigquery`, which is `server-only`, and the moment a client component
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
 * currency: the symbol changes, the separators do not.
 *
 * Every negative (money, percentage, count) uses U+2212 (see `tidySign`); a
 * negative that rounds to zero prints without a sign.
 *
 * Missing values: every formatter returns `NO_VALUE` ("n/a") for null. Never a
 * dash, never "0". Render sites mute it (`<Value>` in components/ui/EmptyState,
 * and DataTable / MetricCard / KpiTile do it automatically).
 */

/** The one "no value" glyph. Muted at render time; never a dash, never "0". */
export const NO_VALUE = "n/a";

/** The minus sign used for every negative money value (U+2212, not a hyphen). */
export const MINUS = "\u2212";

/**
 * Sign rule shared by every formatter. A negative that rounds to zero ("-$0",
 * "-0.0%") loses its sign; any other negative (money, percentage, count) gets
 * the U+2212 minus so the margin stack, discounts, deltas and growth lines all
 * read alike. Intl always emits an ASCII hyphen-minus, which is what is swapped.
 */
function tidySign(formatted: string): string {
  if (!formatted.includes("-")) return formatted;
  if (!/[1-9]/.test(formatted)) return formatted.replace("-", "");
  return formatted.replace("-", MINUS);
}

/** True when a formatted string is the no-value glyph (for muting). */
export function isNoValue(text: unknown): boolean {
  return text === NO_VALUE;
}

/**
 * Money, en-US, ISO code or symbol from Intl ("CZK 108,357", "$4,210").
 *
 * - default: whole units.
 * - `compact`: "CZK 1.2M".
 * - `unit`: unit costs (CPC, CPM, CPA, CAC, AUR). 2 decimals below 100, whole above.
 * - `decimals`: an exact number of decimals, for callers that know better.
 */
export function formatMoney(
  value: number | null | undefined,
  currency: string,
  {
    compact = false,
    unit = false,
    decimals,
  }: { compact?: boolean; unit?: boolean; decimals?: number } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;

  const digits =
    decimals !== undefined
      ? decimals
      : compact
        ? null
        : unit && Math.abs(value) < 100
          ? 2
          : 0;

  return tidySign(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      ...(digits === null
        ? { maximumFractionDigits: 1 }
        : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    }).format(value)
  );
}

/** Plain number, en-US grouping. `decimals` is a maximum. */
export function formatNumber(
  value: number | null | undefined,
  { compact = false, decimals = 0 }: { compact?: boolean; decimals?: number } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return tidySign(
    new Intl.NumberFormat("en-US", {
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: decimals,
    }).format(value)
  );
}

/** Percentages arrive as fractions (0.35), render as "35.0%". */
export function formatPercent(
  value: number | null | undefined,
  { decimals = 1 }: { decimals?: number } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return tidySign(
    new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value)
  );
}

/** Ratios like MER / aMER: "4.20×". */
export function formatRatio(
  value: number | null | undefined,
  { decimals = 2 }: { decimals?: number } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return tidySign(`${value.toFixed(decimals)}×`);
}

/**
 * Em dashes (U+2014) in client data, such as Klaviyo flow names, become a
 * hyphen at render. The data itself is untouched. Spaces around the dash are
 * kept as they were.
 */
export function plainDashes(text: string): string {
  return text.replace(/\u2014/g, "-");
}
