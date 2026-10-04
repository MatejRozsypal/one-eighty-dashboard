/**
 * Report filter overrides <-> URL search params.
 *
 * The URL is the state (design 1.1): a link reproduces exactly what the sender
 * saw. Report-level filters live in seven params, every one optional, and an
 * absent param means "use the report's saved default".
 *
 *   clients   all | ids:a,b,c | vertical:x,y        (a bare "a,b" list is read as ids)
 *   preset    7d | 28d | 30d | 90d | mtd | ytd | 12m | all | custom
 *   from, to  YYYY-MM-DD, read only with preset=custom (or alone, as custom)
 *   compare   previous_period | previous_year | none
 *   ccy       CZK | EUR | USD | native
 *   bench     1 | 0
 *
 * `preset`, `from`, `to` and `compare` are the names the existing
 * `DateRangeControl` and `SegmentedControl` already write, so those controls
 * work on a report page unchanged.
 *
 * Guarantees:
 * - Every value is validated with the zod schemas of `types.ts`; an invalid
 *   param is dropped (and reported in `ignored`), never half-applied.
 * - Round trip: `parseFilterParams(filterParamsToString(o)).overrides` equals
 *   `normalizeOverrides(o)` for every valid `o` (normalising only removes
 *   duplicate ids). Serialising twice gives the same string.
 * - Params that are not filter params are preserved in place.
 *
 * Pure module (zod plus type-only imports), safe for the browser bundle.
 * Owner: RS8 (pickers and filter bar).
 */

import {
  ClientSelection,
  COMPARE_MODES,
  PeriodSpec,
  REPORT_CURRENCIES,
  type ReportCurrency,
  type ReportFilters,
} from "./types";

/** Every search param this module owns, in output order. */
export const FILTER_PARAMS = ["clients", "preset", "from", "to", "compare", "ccy", "bench"] as const;
export type FilterParam = (typeof FILTER_PARAMS)[number];

/** Report filter keys, as in `ReportFilters`. */
export type FilterKey = keyof ReportFilters;

/** Partial filters: a key that is absent inherits. */
export type FilterOverrides = Partial<ReportFilters>;

/** What `next/navigation` and pages hand over, or a query string, or URLSearchParams. */
export type ParamSource =
  | URLSearchParams
  | string
  | Readonly<Record<string, string | string[] | undefined>>;

export interface ParsedFilterParams {
  overrides: FilterOverrides;
  /** Filter keys whose params were present but invalid, so dropped. */
  ignored: FilterKey[];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function toParams(src: ParamSource): URLSearchParams {
  if (src instanceof URLSearchParams) return new URLSearchParams(src.toString());
  if (typeof src === "string") return new URLSearchParams(src.startsWith("?") ? src.slice(1) : src);
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(src)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined) out.set(k, first);
  }
  return out;
}

/** First occurrence wins; the empty string counts as absent. */
function read(p: URLSearchParams, key: FilterParam): string | null {
  const v = p.get(key);
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

function parseClients(raw: string): ClientSelection | null {
  if (raw === "all") return { mode: "all" };
  const colon = raw.indexOf(":");
  const kind = colon < 0 ? "ids" : raw.slice(0, colon);
  const body = colon < 0 ? raw : raw.slice(colon + 1);
  const items = unique(
    body
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
  );
  const candidate =
    kind === "ids"
      ? { mode: "list", ids: items }
      : kind === "vertical"
        ? { mode: "vertical", verticals: items }
        : null;
  if (!candidate) return null;
  const r = ClientSelection.safeParse(candidate);
  return r.success ? r.data : null;
}

function parsePeriod(preset: string | null, from: string | null, to: string | null): PeriodSpec | null {
  let candidate: unknown;
  if (preset === "custom" || (preset === null && (from !== null || to !== null))) {
    candidate = { kind: "custom", from, to };
  } else if (preset !== null) {
    candidate = { kind: "preset", preset };
  } else {
    return null;
  }
  const r = PeriodSpec.safeParse(candidate);
  return r.success ? r.data : null;
}

/** "CZK" and "czk" both read; "native" is the one lower-case token. */
function parseCurrency(raw: string): ReportCurrency | null {
  const t = raw.toLowerCase() === "native" ? "native" : raw.toUpperCase();
  return (REPORT_CURRENCIES as readonly string[]).includes(t) ? (t as ReportCurrency) : null;
}

function parseBench(raw: string): boolean | null {
  const t = raw.toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t === "0" || t === "false") return false;
  return null;
}

/** Read the filter overrides out of search params. Never throws. */
export function parseFilterParams(src: ParamSource): ParsedFilterParams {
  const p = toParams(src);
  const overrides: FilterOverrides = {};
  const ignored: FilterKey[] = [];

  const clients = read(p, "clients");
  if (clients !== null) {
    const v = parseClients(clients);
    if (v) overrides.clients = v;
    else ignored.push("clients");
  }

  const preset = read(p, "preset");
  const from = read(p, "from");
  const to = read(p, "to");
  if (preset !== null || from !== null || to !== null) {
    const v = parsePeriod(preset, from, to);
    if (v) overrides.period = v;
    else ignored.push("period");
  }

  const compare = read(p, "compare");
  if (compare !== null) {
    if ((COMPARE_MODES as readonly string[]).includes(compare)) overrides.compare = compare as ReportFilters["compare"];
    else ignored.push("compare");
  }

  const ccy = read(p, "ccy");
  if (ccy !== null) {
    const v = parseCurrency(ccy);
    if (v) overrides.currency = v;
    else ignored.push("currency");
  }

  const bench = read(p, "bench");
  if (bench !== null) {
    const v = parseBench(bench);
    if (v !== null) overrides.benchmark = v;
    else ignored.push("benchmark");
  }

  return { overrides, ignored };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Canonical params of a value set, in FILTER_PARAMS order. Absent keys produce no param. */
export function encodeFilters(overrides: FilterOverrides): Partial<Record<FilterParam, string>> {
  const out: Partial<Record<FilterParam, string>> = {};
  const c = overrides.clients;
  if (c) {
    out.clients =
      c.mode === "all"
        ? "all"
        : c.mode === "list"
          ? `ids:${unique(c.ids).join(",")}`
          : `vertical:${unique(c.verticals).join(",")}`;
  }
  const p = overrides.period;
  if (p) {
    if (p.kind === "preset") {
      out.preset = p.preset;
    } else {
      out.preset = "custom";
      out.from = p.from;
      out.to = p.to;
    }
  }
  if (overrides.compare !== undefined) out.compare = overrides.compare;
  if (overrides.currency !== undefined) out.ccy = overrides.currency;
  if (overrides.benchmark !== undefined) out.bench = overrides.benchmark ? "1" : "0";
  return out;
}

/** `normalizeOverrides(o)` is what `parseFilterParams` gives back for the serialised `o`. */
export function normalizeOverrides(overrides: FilterOverrides): FilterOverrides {
  const out: FilterOverrides = { ...overrides };
  const c = overrides.clients;
  if (c?.mode === "list") out.clients = { mode: "list", ids: unique(c.ids) };
  if (c?.mode === "vertical") out.clients = { mode: "vertical", verticals: unique(c.verticals) };
  return out;
}

/** True when both sets produce the same params, so the same view. */
export function filtersEqual(a: FilterOverrides, b: FilterOverrides): boolean {
  return JSON.stringify(encodeFilters(a)) === JSON.stringify(encodeFilters(b));
}

/**
 * Params with the filter keys replaced by `overrides`. Every other param is
 * kept where it was; the filter params follow, in FILTER_PARAMS order.
 */
export function writeFilterParams(overrides: FilterOverrides, base?: ParamSource): URLSearchParams {
  const out = new URLSearchParams();
  if (base !== undefined) {
    for (const [k, v] of toParams(base)) {
      if (!(FILTER_PARAMS as readonly string[]).includes(k)) out.append(k, v);
    }
  }
  const enc = encodeFilters(overrides);
  for (const k of FILTER_PARAMS) {
    const v = enc[k];
    if (v !== undefined) out.set(k, v);
  }
  return out;
}

/**
 * Query string without the leading `?`. The separators of the filter values
 * (`:` and `,`) stay readable instead of becoming %3A and %2C.
 */
export function filterParamsToString(overrides: FilterOverrides, base?: ParamSource): string {
  return writeFilterParams(overrides, base).toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}

/**
 * Query string after changing some filters. A key whose new value equals the
 * report's saved default is removed rather than written, so undoing a change
 * restores a clean URL. Keys not in `patch` keep their current URL value.
 */
export function patchFilterParams(current: ParamSource, patch: FilterOverrides, defaults?: ReportFilters): string {
  const { overrides } = parseFilterParams(current);
  const next: FilterOverrides = { ...overrides };
  for (const key of Object.keys(patch) as FilterKey[]) {
    const value = patch[key];
    if (value === undefined) {
      delete next[key];
      continue;
    }
    const same = defaults !== undefined && filtersEqual({ [key]: value }, { [key]: defaults[key] });
    if (same) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return filterParamsToString(next, current);
}

/** The keys of `filters` that differ from `defaults`: the minimal override set for a link. */
export function diffFilters(filters: ReportFilters, defaults: ReportFilters): FilterOverrides {
  const out: FilterOverrides = {};
  for (const key of Object.keys(filters) as FilterKey[]) {
    if (!filtersEqual({ [key]: filters[key] }, { [key]: defaults[key] })) {
      (out as Record<string, unknown>)[key] = filters[key];
    }
  }
  return out;
}

/** Report filters with the overrides on top. Same rule as `mergeFilters` in contracts.ts. */
export function withOverrides(base: ReportFilters, overrides: FilterOverrides): ReportFilters {
  return {
    clients: overrides.clients ?? base.clients,
    period: overrides.period ?? base.period,
    compare: overrides.compare ?? base.compare,
    currency: overrides.currency ?? base.currency,
    benchmark: overrides.benchmark ?? base.benchmark,
  };
}
