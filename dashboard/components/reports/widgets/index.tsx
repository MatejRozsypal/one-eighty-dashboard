"use client";

/**
 * The one door to the widgets.
 *
 * KPI, table and ranked are plain HTML and imported directly. The three chart
 * widgets pull Recharts in, so they are loaded with `next/dynamic` and
 * `ssr: false`: a report made of KPIs and tables never downloads the charting
 * bundle, and no other route does either. Nothing else in the app may import
 * LineWidget, BarWidget or ScatterWidget statically (check-reports-widgets.ts
 * greps for it).
 *
 * `WidgetBody` picks the component for `view.type`. Layout is the frame's job:
 * every widget fills its parent (`h-full`) and draws edge to edge.
 *
 * Owner: RS7 (widgets).
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { WidgetType } from "@/lib/reports/types";
import { KpiWidget } from "./KpiWidget";
import { RankedWidget } from "./RankedWidget";
import { TableWidget } from "./TableWidget";
import type { ChartWidgetProps, WidgetProps } from "./types";

function ChartPlaceholder() {
  return <div className="h-full w-full" aria-busy="true" />;
}

export const LineWidget = dynamic<ChartWidgetProps>(() => import("./LineWidget").then((m) => m.LineWidget), {
  ssr: false,
  loading: ChartPlaceholder,
});
export const BarWidget = dynamic<ChartWidgetProps>(() => import("./BarWidget").then((m) => m.BarWidget), {
  ssr: false,
  loading: ChartPlaceholder,
});
export const ScatterWidget = dynamic<ChartWidgetProps>(() => import("./ScatterWidget").then((m) => m.ScatterWidget), {
  ssr: false,
  loading: ChartPlaceholder,
});

export { KpiWidget, RankedWidget, TableWidget };

export const WIDGET_COMPONENTS: Readonly<Record<WidgetType, ComponentType<WidgetProps>>> = {
  kpi: KpiWidget,
  line: LineWidget,
  bar: BarWidget,
  table: TableWidget,
  ranked: RankedWidget,
  scatter: ScatterWidget,
};

/** Renders the widget for `props.view.type`. */
export function WidgetBody(props: WidgetProps) {
  const Component = WIDGET_COMPONENTS[props.view.type];
  return <Component {...props} />;
}

export type { CaveatTexts, ChartWidgetProps, WidgetMetric, WidgetProps } from "./types";
