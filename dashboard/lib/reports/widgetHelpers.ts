/**
 * Page-state helpers for the Reports client (RS9 integration): default configs
 * for a new widget, the grain a KPI is fetched at, and the override chip.
 *
 * Pure and registry-free (the picker's metric list is passed in), so the
 * browser bundle does not carry the registry.
 */

import type { PickerMetric } from "@/components/reports/pickers/MetricPicker";
import { daysInRange, presetRange } from "@/lib/period";
import { MAX_SPAN } from "./limits";
import type { MetricId } from "./registry/ids";
import { WidgetConfig, type ReportFilters, type WidgetType } from "./types";

// ---------------------------------------------------------------------------
// New widgets
// ---------------------------------------------------------------------------

/** A valid starting config per type, built from metrics the picker offers. */
export function defaultWidgetConfig(type: WidgetType, pool: readonly PickerMetric[]): WidgetConfig {
  const has = (id: MetricId) => pool.some((m) => m.id === id);
  const first: MetricId = has("revenue") ? "revenue" : (pool[0]?.id ?? "revenue");
  const second: MetricId = has("mer") ? "mer" : (pool.find((m) => m.id !== first)?.id ?? first);

  switch (type) {
    case "kpi":
      return WidgetConfig.parse({ v: 1, query: { metrics: [first], grain: "total", split: "combined" }, view: { type } });
    case "line":
      return WidgetConfig.parse({ v: 1, query: { metrics: [first], grain: "week", split: "client" }, view: { type } });
    case "bar":
      return WidgetConfig.parse({ v: 1, query: { metrics: [first], grain: "total", split: "client" }, view: { type } });
    case "table":
      return WidgetConfig.parse({ v: 1, query: { metrics: [first, second].filter((m, i, a) => a.indexOf(m) === i), grain: "total", split: "client" }, view: { type } });
    case "ranked":
      return WidgetConfig.parse({ v: 1, query: { metrics: [first], grain: "total", split: "client" }, view: { type, sort: "desc", limit: 10 } });
    case "scatter": {
      const metrics = first === second ? [first, pool.find((m) => m.id !== first)?.id ?? first] : [first, second];
      const [x, y] = metrics;
      return WidgetConfig.parse({ v: 1, query: { metrics: [...new Set(metrics)], grain: "total", split: "client" }, view: { type, scatter: { x, y } } });
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch shape
// ---------------------------------------------------------------------------

function periodDays(period: ReportFilters["period"]): number {
  const range = period.kind === "preset" ? presetRange(period.preset) : { from: period.from, to: period.to };
  return daysInRange(range);
}

/**
 * The grain a widget is actually queried at. A KPI is configured at grain
 * "total" (one figure), but the tile also draws a week sparkline (design 1.13),
 * so it is fetched at week grain when the range fits: the result carries the
 * same total plus the weekly points. Falls back to the configured grain when
 * the range is too long; the data hook also retries at total on a 413.
 */
export function fetchGrain(config: WidgetConfig, effective: ReportFilters): WidgetConfig["query"]["grain"] {
  const { grain } = config.query;
  if (config.view.type !== "kpi" || grain !== "total") return grain;
  const period = config.query.overrides.period ?? effective.period;
  return periodDays(period) <= (MAX_SPAN.week - 1) * 7 ? "week" : "total";
}

// ---------------------------------------------------------------------------
// Override chip (design 1.4)
// ---------------------------------------------------------------------------

const COMPARE_CHIP: Record<ReportFilters["compare"], string> = {
  previous_period: "Prev period",
  previous_year: "Prev year",
  none: "No compare",
};

/**
 * Short text for the widget header chip when a widget differs from the report
 * filters: "12m", "EUR", "Prev year". Empty string when nothing is overridden.
 * `clientsLabel` renders a client selection (the picker's own label function).
 */
export function overrideChip(config: WidgetConfig, clientsLabel: (sel: NonNullable<ReportFilters["clients"]>) => string): string {
  const o = config.query.overrides;
  const parts: string[] = [];
  if (o.period) parts.push(o.period.kind === "preset" ? o.period.preset : "Custom");
  if (o.compare) parts.push(COMPARE_CHIP[o.compare]);
  if (o.currency) parts.push(o.currency === "native" ? "Native" : o.currency);
  if (o.clients) parts.push(clientsLabel(o.clients));
  if (o.benchmark !== undefined) parts.push(o.benchmark ? "Industry" : "No industry");
  return parts.slice(0, 2).join(", ");
}
