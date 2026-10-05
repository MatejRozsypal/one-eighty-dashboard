/**
 * Search-param parsing, the app's entire view state.
 *
 * Client, date range, comparison mode and display currency all live in the URL.
 * That makes every view shareable and bookmarkable, lets server components read
 * state without a client round trip, and means the back button does what the
 * user expects. One exception: the delta display mode (`delta=pct|abs`) also
 * has a cookie default, see `resolveDeltaMode`.
 *
 * Everything is defensive: a hand-edited or stale URL must render a sensible
 * page, never throw.
 */

import {
  PRESET_LABELS,
  addDays,
  todayUtc,
  presetRange,
  resolvePeriod,
  type ComparisonMode,
  type DateRange,
  type PresetKey,
  type ResolvedPeriod,
} from "@/lib/period";
import { ROLLUP_CURRENCY } from "@/lib/currency";
import {
  DEFAULT_DELTA_MODE,
  parseDeltaMode,
  type DeltaMode,
} from "@/lib/format";

export {
  DELTA_COOKIE,
  DELTA_PARAM,
  parseDeltaMode,
  type DeltaMode,
} from "@/lib/format";

export type SearchParams = Record<string, string | string[] | undefined>;

/** No "today": every range ends yesterday at the latest (locked rule). */
const PRESETS: PresetKey[] = ["7d", "28d", "30d", "90d", "mtd", "ytd", "12m", "all"];
const MODES: ComparisonMode[] = ["previous_period", "previous_year", "none"];

const DEFAULT_PRESET: PresetKey = "30d";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface ViewParams {
  clientId?: string;
  range: DateRange;
  presetKey: PresetKey | "custom";
  comparisonMode: ComparisonMode;
  period: ResolvedPeriod;
  /** "native" or a currency code. */
  displayCurrency: string;
}

/**
 * @param defaultPreset What to use when the URL says nothing.
 *
 * Thirty days for the business screens, because that is the period an operator
 * thinks in. The Creative screens pass `all` instead, and the reason is
 * arithmetic rather than taste: a persona tested across five months may reach
 * 80 purchases while no single month reaches 20, and 20 purchases carries a
 * ±51% interval against 80's ±26%. Accumulation is how a small account buys
 * statistical power, and defaulting those screens to a month would throw it
 * away every month. The picker is the same; only where it starts differs.
 */
export function parseViewParams(
  searchParams: SearchParams,
  defaultPreset: PresetKey = DEFAULT_PRESET
): ViewParams {
  const clientId = first(searchParams.client);

  const presetParam = first(searchParams.preset);
  const from = first(searchParams.from);
  // A hand-edited custom range is clamped to end yesterday: today is partial
  // for every ad platform, so it is never part of a range.
  const yesterday = addDays(todayUtc(), -1);
  const rawTo = first(searchParams.to);
  const to = rawTo && rawTo > yesterday ? yesterday : rawTo;

  let presetKey: PresetKey | "custom" = defaultPreset;
  let range: DateRange;

  if (
    presetParam === "custom" &&
    from &&
    to &&
    ISO_DATE.test(from) &&
    ISO_DATE.test(to) &&
    from <= to
  ) {
    presetKey = "custom";
    range = { from, to };
  } else if (presetParam && PRESETS.includes(presetParam as PresetKey)) {
    presetKey = presetParam as PresetKey;
    range = presetRange(presetKey);
  } else {
    range = presetRange(defaultPreset);
  }

  const compareParam = first(searchParams.compare);
  const comparisonMode: ComparisonMode = MODES.includes(
    compareParam as ComparisonMode
  )
    ? (compareParam as ComparisonMode)
    : "previous_period";

  const currencyParam = first(searchParams.currency);
  const displayCurrency =
    currencyParam === ROLLUP_CURRENCY ? ROLLUP_CURRENCY : "native";

  return {
    clientId,
    range,
    presetKey,
    comparisonMode,
    period: resolvePeriod(range, comparisonMode),
    displayCurrency,
  };
}

/**
 * How deltas are shown: the URL's `delta` wins (a shared link shows what its
 * sender saw), then the user's cookie default, then "pct".
 *
 * Display only: no query reads it, so the toggle changes the URL in place
 * without a server render (see `DeltaModeProvider`). The app layout passes the
 * cookie value; the provider reads the URL on the client.
 */
export function resolveDeltaMode(
  searchParams: SearchParams | undefined,
  cookieValue: string | undefined
): DeltaMode {
  return (
    parseDeltaMode(searchParams?.delta) ??
    parseDeltaMode(cookieValue) ??
    DEFAULT_DELTA_MODE
  );
}

/**
 * Rebuild the query string, so links between pages keep the current view.
 *
 * `delta` is deliberately not written here. These strings are built on the
 * server and go stale when the toggle changes the URL in place; a stale
 * explicit `delta` on a link would undo the toggle. Without it, the next page
 * keeps the mode the provider holds (and the cookie on a fresh load). Client
 * links (sidebar, rail, client switch) copy the live query string, `delta`
 * included.
 */
export function viewQuery(params: ViewParams): string {
  const q = new URLSearchParams();
  if (params.clientId) q.set("client", params.clientId);
  q.set("preset", params.presetKey);
  if (params.presetKey === "custom") {
    q.set("from", params.range.from);
    q.set("to", params.range.to);
  }
  q.set("compare", params.comparisonMode);
  if (params.displayCurrency !== "native") q.set("currency", params.displayCurrency);
  return q.toString();
}

/**
 * What period the reader is looking at, in one chip's worth of words.
 *
 * A preset says its own name; a custom range says its two dates, because
 * "Custom" tells the reader nothing they did not already know. The detail
 * panel needs this: every number on it is scoped to the picker at the top of
 * the page, and a panel that opens over the page hides the picker that set it.
 */
export interface RangeLabel {
  /** The preset's own name, or "Custom". */
  label: string;
  /** The actual days, always, a preset name alone hides which weeks these are. */
  dates: string;
}

export function rangeLabel(params: ViewParams): RangeLabel {
  const d = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });

  // The year is printed once, and only when the range crosses one. "Aug 14 to
  // Aug 21, 2026" is what the reader is holding in their head.
  const sameYear = params.range.from.slice(0, 4) === params.range.to.slice(0, 4);
  const dates = `${d(params.range.from, !sameYear)} to ${d(params.range.to, true)}`;

  return {
    label: params.presetKey === "custom" ? "Custom" : PRESET_LABELS[params.presetKey],
    dates,
  };
}

/** Short label for a delta chip, e.g. "vs prev 30d". */
export function comparisonLabel(params: ViewParams): string | undefined {
  if (params.comparisonMode === "none") return undefined;
  if (params.comparisonMode === "previous_year") return "vs last year";
  return "vs prev period";
}
