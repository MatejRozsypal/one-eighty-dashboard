/**
 * Widget resolution: merge filters, resolve clients, period and currency,
 * apply size limits, and decide per (client, metric) whether the client has
 * the capabilities the metric needs.
 *
 * Pure: no BigQuery, no session, no `server-only`. `today` is injectable.
 * Bucket helpers live here too so the resolver (limits) and the evaluator
 * (bucket lists) can never disagree.
 *
 * Design: 11_reporting_suite_design.md section 2.7. Owner: WP1 (RS1).
 */

import { addDays, comparisonRange, daysInRange, presetRange, scanBounds, todayUtc, type DateRange, type ResolvedPeriod } from "@/lib/period";
import type { ClientMetricAvailability, LimitViolation, MergeFilters, ResolveModule, ResolveWidget, ResolvedWidget } from "./contracts";
import { MAX_METRICS_PER_WIDGET, MAX_POINTS, MAX_SPAN, WAREHOUSE_MONTHS } from "./limits";
import { evalCapExpr, missingCapabilities } from "./registry/capabilities";
import { getComponent } from "./registry/components";
import type { MetricId } from "./registry/ids";
import { METRICS, componentsFor } from "./registry/metrics";
import type { MartId, QueryGrain, ReportClient } from "./registry/types";
import { UNASSIGNED_VERTICAL, type ReportFilters, type ResultWarning } from "./types";

// ---------------------------------------------------------------------------
// Date and bucket helpers (UTC, `YYYY-MM-DD` strings only)
// ---------------------------------------------------------------------------

function ms(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Monday of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  const dow = new Date(ms(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the month `n` months after `date`'s month. */
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-01`;
}

/** Same day `n` months earlier or later, clamped to the month's last day (Mar 31 - 1 month = Feb 28). */
export function shiftMonthsKeepDay(date: string, n: number): string {
  const first = addMonths(date, n);
  const day = Number(date.slice(8, 10));
  const last = Number(addDays(addMonths(first, 1), -1).slice(8, 10));
  return `${first.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Bucket start of `date` for a grain. */
export function bucketOf(date: string, grain: QueryGrain): string {
  if (grain === "week") return isoWeekStart(date);
  if (grain === "month") return monthStart(date);
  if (grain === "day") return date;
  return "1970-01-01";
}

/** Bucket starts covering `range`, in order. Grain "total" has none. */
export function buildBuckets(range: DateRange, grain: QueryGrain): string[] {
  if (grain === "total") return [];
  const out: string[] = [];
  const last = bucketOf(range.to, grain);
  let b = bucketOf(range.from, grain);
  while (b <= last) {
    out.push(b);
    b = grain === "day" ? addDays(b, 1) : grain === "week" ? addDays(b, 7) : addMonths(b, 1);
  }
  return out;
}

/** Last day of the bucket that starts at `start`. */
export function bucketEnd(start: string, grain: QueryGrain): string {
  if (grain === "week") return addDays(start, 6);
  if (grain === "month") return addDays(addMonths(start, 1), -1);
  return start;
}

/** Indexes of buckets that the range covers only partly (first and last week or month). */
export function partialBucketIndexes(range: DateRange, grain: QueryGrain): number[] {
  if (grain === "total" || grain === "day") return [];
  const buckets = buildBuckets(range, grain);
  const out: number[] = [];
  buckets.forEach((b, i) => {
    if (b < range.from || bucketEnd(b, grain) > range.to) out.push(i);
  });
  return out;
}

/** Calendar months between the two dates' months (Jan 15 to Mar 2 is 2). */
function monthSpan(range: DateRange): number {
  const [fy, fm] = range.from.split("-").map(Number);
  const [ty, tm] = range.to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Widget override where set, else the report filter. */
export const mergeFilters: MergeFilters = (report, overrides) => ({
  clients: overrides.clients ?? report.clients,
  period: overrides.period ?? report.period,
  compare: overrides.compare ?? report.compare,
  currency: overrides.currency ?? report.currency,
  benchmark: overrides.benchmark ?? report.benchmark,
});

/** Vertical key of a client for grouping and vertical selection. */
export function verticalKey(client: ReportClient): string {
  return client.vertical ?? UNASSIGNED_VERTICAL;
}

function selectClients(filters: ReportFilters, all: readonly ReportClient[]): ReportClient[] {
  const sel = filters.clients;
  let picked: ReportClient[];
  if (sel.mode === "all") picked = [...all];
  else if (sel.mode === "list") {
    const ids = new Set(sel.ids);
    picked = all.filter((c) => ids.has(c.id));
  } else {
    const verts = new Set(sel.verticals);
    picked = all.filter((c) => verts.has(verticalKey(c)));
  }
  const seen = new Set<string>();
  return picked.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function resolveRange(filters: ReportFilters, today: string, warnings: ResultWarning[]): DateRange {
  const yesterday = addDays(today, -1);
  if (filters.period.kind === "preset") return presetRange(filters.period.preset, today);
  const minFrom = shiftMonthsKeepDay(yesterday, -WAREHOUSE_MONTHS);
  let { from, to } = filters.period;
  let clamped = false;
  if (to > yesterday) {
    to = yesterday;
    clamped = true;
  }
  if (from < minFrom) {
    from = minFrom;
    clamped = true;
  }
  if (to < minFrom) {
    to = minFrom;
    clamped = true;
  }
  if (from > to) {
    from = to;
    clamped = true;
  }
  if (clamped) warnings.push({ code: "range_clamped" });
  return { from, to };
}

function resolveCurrency(filters: ReportFilters, clients: readonly ReportClient[], warnings: ResultWarning[]): string {
  if (filters.currency !== "native") return filters.currency;
  const ccys = [...new Set(clients.map((c) => c.currency))];
  if (ccys.length === 1) return ccys[0];
  if (ccys.length > 1) warnings.push({ code: "currency_coerced" });
  return "CZK";
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const COARSER: Record<QueryGrain, string | undefined> = {
  day: "Use week grain",
  week: "Use month grain",
  month: undefined,
  total: undefined,
};

function seriesCount(split: ResolvedWidget["query"]["split"], clients: readonly ReportClient[]): number {
  if (split === "combined") return 1;
  if (split === "vertical") return new Set(clients.map(verticalKey)).size;
  return clients.length;
}

function checkLimits(range: DateRange, grain: QueryGrain, nMetrics: number, nSeries: number): LimitViolation | null {
  if (nMetrics > MAX_METRICS_PER_WIDGET) {
    return { code: "too_large", limit: "metrics", message: `At most ${MAX_METRICS_PER_WIDGET} metrics` };
  }
  const span = grain === "day" ? daysInRange(range) : grain === "week" ? buildBuckets(range, "week").length : monthSpan(range);
  if (span > MAX_SPAN[grain]) {
    const suggestion = COARSER[grain] ?? "Shorten the range";
    return { code: "too_large", limit: "span", message: "Range too long for this grain", suggestion };
  }
  const nBuckets = grain === "total" ? 1 : buildBuckets(range, grain).length;
  if (nBuckets * Math.max(1, nSeries) > MAX_POINTS) {
    return { code: "too_large", limit: "points", message: "Too many points", suggestion: COARSER[grain] ?? "Select fewer clients" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

export const resolveWidget: ResolveWidget = (input) => {
  const today = input.today ?? todayUtc();
  const query = input.query;
  const filters = mergeFilters(input.filters, query.overrides ?? {});
  const warnings: ResultWarning[] = [];

  const clients = selectClients(filters, input.clients);
  const current = resolveRange(filters, today, warnings);
  const period: ResolvedPeriod = { current, comparison: comparisonRange(current, filters.compare), mode: filters.compare };
  const grain = query.grain;

  const violation = checkLimits(current, grain, query.metrics.length, seriesCount(query.split, clients));
  if (violation) return { ok: false, error: violation };

  const displayCurrency = resolveCurrency(filters, clients, warnings);

  const availability: Record<string, Partial<Record<MetricId, ClientMetricAvailability>>> = {};
  const queryClientIds: string[] = [];
  for (const c of clients) {
    const row: Partial<Record<MetricId, ClientMetricAvailability>> = {};
    let any = false;
    for (const id of query.metrics) {
      const req = METRICS[id].meta.requires;
      const ok = evalCapExpr(req, c.capabilities);
      row[id] = { ok, missing: ok ? [] : missingCapabilities(req, c.capabilities) };
      any ||= ok;
    }
    availability[c.id] = row;
    if (any) queryClientIds.push(c.id);
  }

  const components = componentsFor(query.metrics);
  const marts = [...new Set(components.map((c) => getComponent(c).mart))].sort() as MartId[];

  const widget: ResolvedWidget = {
    query,
    filters,
    clients,
    queryClientIds,
    period,
    scan: scanBounds(period),
    grain,
    displayCurrency,
    components,
    marts,
    availability,
    warnings,
  };
  return { ok: true, widget };
};

const _conforms: ResolveModule = { mergeFilters, resolveWidget };
void _conforms;
