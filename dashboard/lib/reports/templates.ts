/**
 * Code-defined report templates (design 1.3, 4.1, work package RS4).
 *
 * Pure module. A template is a starting point: createReport() copies its
 * filters and widgets into a new report owned by the caller, so editing a
 * template here never touches a saved report.
 *
 * Every metric id is a phase-1 METRIC_IDS member, and every config goes
 * through WidgetConfig.parse() when this module loads, so a typo in an id, an
 * oversized widget or a bad scatter slot fails at import (and in
 * scripts/check-reports-store.ts) instead of in a user's report.
 *
 * Sizes follow WIDGET_SIZE (design 1.13) unless a template widens a table.
 */

import { TEMPLATE_KEYS, type ReportTemplate, type TemplateKey, type TemplateWidget } from "./contracts";
import { WIDGET_SIZE } from "./limits";
import type { MetricId } from "./registry/ids";
import {
  DEFAULT_REPORT_FILTERS,
  WidgetConfig,
  type WidgetConfigInput,
  type WidgetSplit,
  type WidgetType,
} from "./types";

type Grain = "total" | "day" | "week" | "month";

interface Spot {
  x: number;
  y: number;
  /** Overrides the default width of the type. */
  w?: number;
  /** Overrides the default height of the type. */
  h?: number;
}

function widget(type: WidgetType, config: WidgetConfigInput, at: Spot): TemplateWidget {
  const size = WIDGET_SIZE[type];
  return {
    type,
    config: WidgetConfig.parse(config),
    x: at.x,
    y: at.y,
    w: at.w ?? size.w,
    h: at.h ?? size.h,
  };
}

function kpi(metric: MetricId, x: number, y = 0): TemplateWidget {
  return widget(
    "kpi",
    { v: 1, query: { metrics: [metric], grain: "total", split: "combined" }, view: { type: "kpi" } },
    { x, y },
  );
}

function chart(
  type: "line" | "bar",
  metrics: MetricId[],
  grain: Grain,
  split: WidgetSplit,
  at: Spot,
  view: { title?: string; stacked?: boolean } = {},
): TemplateWidget {
  return widget(type, { v: 1, query: { metrics, grain, split }, view: { type, ...view } }, at);
}

function table(metrics: MetricId[], at: Spot, title?: string): TemplateWidget {
  return widget(
    "table",
    {
      v: 1,
      query: { metrics, grain: "total", split: "client" },
      view: { type: "table", ...(title ? { title } : {}) },
    },
    at,
  );
}

function ranked(metric: MetricId, at: Spot, limit = 10): TemplateWidget {
  return widget(
    "ranked",
    {
      v: 1,
      query: { metrics: [metric], grain: "total", split: "client" },
      view: { type: "ranked", sort: "desc", limit },
    },
    at,
  );
}

function scatter(x: MetricId, y: MetricId, size: MetricId, at: Spot): TemplateWidget {
  return widget(
    "scatter",
    {
      v: 1,
      query: { metrics: [x, y, size], grain: "total", split: "client" },
      view: { type: "scatter", scatter: { x, y, size } },
    },
    at,
  );
}

/** Four KPIs across the top: 3 columns each. */
function kpiRow(metrics: [MetricId, MetricId, MetricId, MetricId]): TemplateWidget[] {
  return metrics.map((m, i) => kpi(m, i * 3));
}

const filters = () => structuredClone(DEFAULT_REPORT_FILTERS);

export const TEMPLATES: Readonly<Record<TemplateKey, ReportTemplate>> = {
  blank: {
    key: "blank",
    name: "Blank",
    filters: filters(),
    widgets: [],
  },

  portfolio_overview: {
    key: "portfolio_overview",
    name: "Portfolio overview",
    filters: filters(),
    widgets: [
      ...kpiRow(["revenue", "cm3", "mer", "new_customers"]),
      chart("line", ["revenue"], "week", "combined", { x: 0, y: 3 }, { title: "Revenue, weekly" }),
      chart("bar", ["revenue"], "total", "client", { x: 6, y: 3 }, { title: "Revenue by client" }),
      table(["revenue", "orders", "aov", "mer", "cm3_pct", "new_customers"], { x: 0, y: 10 }),
    ],
  },

  paid_efficiency: {
    key: "paid_efficiency",
    name: "Paid efficiency",
    filters: filters(),
    widgets: [
      ...kpiRow(["paid_spend", "mer", "amer", "cac"]),
      chart("line", ["mer", "amer"], "week", "combined", { x: 0, y: 3 }, { title: "MER and aMER, weekly" }),
      chart("line", ["meta_roas", "google_roas"], "week", "combined", { x: 6, y: 3 }, { title: "Platform ROAS, weekly" }),
      scatter("paid_spend", "mer", "revenue", { x: 0, y: 10 }),
      table(["paid_spend", "mer", "cac", "meta_spend_share", "meta_roas", "google_roas"], { x: 6, y: 10, w: 6, h: 8 }),
    ],
  },

  retention_mix: {
    key: "retention_mix",
    name: "Retention mix",
    filters: filters(),
    widgets: [
      ...kpiRow(["returning_order_share", "returning_revenue_share", "new_revenue_share", "aov_returning"]),
      chart("line", ["returning_order_share", "returning_revenue_share"], "week", "combined", { x: 0, y: 3 }, {
        title: "Returning share, weekly",
      }),
      chart("bar", ["new_customers", "returning_orders"], "month", "combined", { x: 6, y: 3 }, {
        title: "New and returning orders",
        stacked: true,
      }),
      ranked("returning_order_share", { x: 0, y: 10 }),
      table(["returning_order_share", "returning_revenue_share", "new_revenue_share", "aov", "aov_returning"], { x: 4, y: 10, w: 8, h: 7 }),
    ],
  },
};

/** A template by key, or null for an unknown key. */
export function getTemplate(key: string): ReportTemplate | null {
  return (TEMPLATE_KEYS as readonly string[]).includes(key) ? TEMPLATES[key as TemplateKey] : null;
}

/** All templates in picker order (Blank first). */
export function listTemplates(): ReportTemplate[] {
  return TEMPLATE_KEYS.map((k) => TEMPLATES[k]);
}
