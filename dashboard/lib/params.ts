/**
 * Search-param parsing — the app's entire view state.
 *
 * Client, date range, comparison mode and display currency all live in the URL.
 * That makes every view shareable and bookmarkable, lets server components read
 * state without a client round trip, and means the back button does what the
 * user expects. Nothing here is stored in a session or a cookie.
 *
 * Everything is defensive: a hand-edited or stale URL must render a sensible
 * page, never throw.
 */

import {
  presetRange,
  resolvePeriod,
  type ComparisonMode,
  type DateRange,
  type PresetKey,
  type ResolvedPeriod,
} from "@/lib/period";
import { ROLLUP_CURRENCY } from "@/lib/currency";

export type SearchParams = Record<string, string | string[] | undefined>;

const PRESETS: PresetKey[] = ["7d", "28d", "30d", "90d", "mtd", "ytd", "12m"];
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

export function parseViewParams(searchParams: SearchParams): ViewParams {
  const clientId = first(searchParams.client);

  const presetParam = first(searchParams.preset);
  const from = first(searchParams.from);
  const to = first(searchParams.to);

  let presetKey: PresetKey | "custom" = DEFAULT_PRESET;
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
    range = presetRange(DEFAULT_PRESET);
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

/** Rebuild the query string, so links between pages keep the current view. */
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

/** Short label for a delta chip, e.g. "vs prev 30d". */
export function comparisonLabel(params: ViewParams): string | undefined {
  if (params.comparisonMode === "none") return undefined;
  if (params.comparisonMode === "previous_year") return "vs last year";
  return "vs prev period";
}
