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

// ---------------------------------------------------------------------------
// Deltas: change against the comparison period
// ---------------------------------------------------------------------------

/**
 * How a change is shown. One global choice (URL `delta`, cookie default),
 * read by every chip through `useDeltaMode()` in components/ui/DeltaMode.
 *
 *   "pct"  relative change, "+12.4%".
 *   "abs"  the difference in the metric's own unit, "+CZK 12,345", "+123".
 *
 * Rates (CTR, CVR, margin %, share) are in percentage points in both modes:
 * a relative change of a rate ("CTR +8%") is easy to misread as points.
 */
export type DeltaMode = "pct" | "abs";
export const DELTA_MODES: readonly DeltaMode[] = ["pct", "abs"];
export const DEFAULT_DELTA_MODE: DeltaMode = "pct";
/** Search param carrying the mode. */
export const DELTA_PARAM = "delta";
/** Cookie holding the user's default, so the choice sticks across pages and sessions. */
export const DELTA_COOKIE = "oe_delta";

/** A valid mode, or null for anything else (absent, stale, hand-edited). */
export function parseDeltaMode(value: unknown): DeltaMode | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "pct" || v === "abs" ? v : null;
}

/**
 * What the metric is, which decides the absolute unit.
 *   money  display currency ("+CZK 12,345", 2 decimals below 100)
 *   count  plain number ("+123", optional `unit` noun)
 *   ratio  MER, ROAS ("+0.31×")
 *   rate   a fraction shown as a percent (CTR, CVR, margin %): always pp
 */
export type DeltaKind = "money" | "count" | "ratio" | "rate";

/** Everything a chip needs to draw a change in either mode. */
export interface DeltaInput {
  current: number | null | undefined;
  previous: number | null | undefined;
  kind: DeltaKind;
  /** Required for `money`. */
  currency?: string;
  /** Optional noun after a count or ratio in absolute mode ("orders", "MER"). */
  unit?: string;
  /** Overrides the default decimals of the absolute figure (count 0, ratio 2, rate 1). */
  decimals?: number;
  /** Compact absolute money ("CZK 1.2M"), for narrow cells. */
  compact?: boolean;
}

export interface DeltaOptions extends Omit<DeltaInput, "current" | "previous"> {
  mode: DeltaMode;
}

export interface DeltaParts {
  /** Signed change in the shown unit: a fraction (pct), the difference (abs), points (rate). Drives the arrow. */
  change: number;
  /** True when the shown magnitude rounds to zero. */
  flat: boolean;
  /** Unsigned figure, for a chip whose arrow carries the direction: "12.4%", "CZK 12,345", "1.2 pp". */
  magnitude: string;
  /** Signed figure: "+12.4%", "−CZK 12,345", "+1.2 pp". A flat change has no sign. */
  text: string;
}

function finite(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/**
 * The change between two values, ready to draw. Null when there is nothing
 * honest to show: either side missing, or a relative change from zero (growth
 * from zero is undefined, not infinite). An absolute change from zero is fine.
 */
export function deltaParts(
  current: number | null | undefined,
  previous: number | null | undefined,
  { kind, mode, currency, unit, decimals, compact }: DeltaOptions
): DeltaParts | null {
  if (!finite(current) || !finite(previous)) return null;

  let change: number;
  let magnitude: string;

  if (kind === "rate") {
    change = (current - previous) * 100;
    magnitude = `${Math.abs(change).toFixed(decimals ?? 1)} pp`;
  } else if (mode === "pct") {
    if (previous === 0) return null;
    change = (current - previous) / Math.abs(previous);
    magnitude = formatPercent(Math.abs(change));
  } else {
    change = current - previous;
    const size = Math.abs(change);
    const noun = unit ? ` ${unit}` : "";
    if (kind === "money") {
      magnitude = currency
        ? formatMoney(
            size,
            currency,
            compact ? { compact } : decimals !== undefined ? { decimals } : { unit: true }
          )
        : formatNumber(size, { compact, decimals: decimals ?? 0 });
    } else if (kind === "ratio") {
      magnitude = `${size.toFixed(decimals ?? 2)}×${noun}`;
    } else {
      magnitude = `${formatNumber(size, { decimals: decimals ?? 0 })}${noun}`;
    }
  }

  // Currency codes and units carry no digits, so a magnitude with no non-zero
  // digit is one that rounds to zero at the precision shown.
  const flat = !/[1-9]/.test(magnitude);
  const sign = flat ? "" : change > 0 ? "+" : MINUS;
  return { change, flat, magnitude, text: `${sign}${magnitude}` };
}

/**
 * The change as one signed string: "+12.4%", "+CZK 12,345", "−123 orders",
 * "+0.31×", "+1.2 pp". Null when `deltaParts` is null. Negatives use U+2212.
 */
export function formatDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  options: DeltaOptions
): string | null {
  return deltaParts(current, previous, options)?.text ?? null;
}

/** Sort key of a delta column in each mode, for DataTable's `sort` array. */
export interface ModeSortKey {
  pct: number | null;
  abs: number | null;
}

export function deltaSortKey(input: DeltaInput): ModeSortKey {
  const opts = { kind: input.kind, currency: input.currency };
  return {
    pct: deltaParts(input.current, input.previous, { ...opts, mode: "pct" })?.change ?? null,
    abs: deltaParts(input.current, input.previous, { ...opts, mode: "abs" })?.change ?? null,
  };
}
