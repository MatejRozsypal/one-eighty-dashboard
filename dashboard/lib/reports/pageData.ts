/**
 * Plain-data views of the registry for the Reports pages (RS9 integration).
 *
 * The picker and the widgets never import the registry (design 2.2, RS7 and RS8
 * notes): the server page calls `buildPageMetrics()` once and hands the result
 * to the client as props. Everything here is JSON-serialisable and pure, so it
 * is also safe to call in the browser.
 *
 *   PickerMetric[]                 MetricPicker / WidgetConfigPanel
 *   Record<MetricId, WidgetMetric> WidgetBody (`metrics` prop, picked by id)
 *   CaveatTexts                    WidgetBody (`caveatTexts`, `CAVEATS[id].short`)
 *
 * Imports the registry, so only the server page imports this file. The
 * registry-free helpers the browser needs live in widgetHelpers.ts.
 */

import type { PickerMetric } from "@/components/reports/pickers/MetricPicker";
import type { WidgetMetric, CaveatTexts } from "@/components/reports/widgets/types";
import { CAVEATS } from "./registry/caveats";
import { METRIC_LIST } from "./registry/metrics";
import type { MetricId } from "./registry/ids";
import { isMetricId } from "./registry/ids";
import type { CaveatId } from "./registry/types";

export interface PageMetrics {
  pickerMetrics: PickerMetric[];
  widgetMetrics: Partial<Record<MetricId, WidgetMetric>>;
  caveatTexts: CaveatTexts;
}

export function buildPageMetrics(): PageMetrics {
  const pickerMetrics: PickerMetric[] = [];
  const widgetMetrics: Partial<Record<MetricId, WidgetMetric>> = {};
  for (const m of METRIC_LIST) {
    if (!isMetricId(m.id)) continue;
    pickerMetrics.push({
      id: m.id,
      label: m.label,
      group: m.group,
      unit: m.unit,
      benchmarkable: m.benchmarkable,
      requires: m.meta.requires,
      description: m.description,
      aliases: m.aliases,
    });
    widgetMetrics[m.id] = {
      id: m.id,
      label: m.label,
      unit: m.unit,
      format: m.format,
      goodWhen: m.goodWhen,
      benchmarkable: m.benchmarkable,
      caveats: m.caveats,
    };
  }
  const caveatTexts: Partial<Record<CaveatId, string>> = {};
  for (const [id, def] of Object.entries(CAVEATS)) caveatTexts[id as CaveatId] = def.short;
  return { pickerMetrics, widgetMetrics, caveatTexts };
}
