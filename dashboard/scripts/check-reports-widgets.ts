/**
 * npm run check:reports-widgets (run with tsx; package.json is RS0's, see the RS7 report)
 *
 * Renders every report widget for every fixture result with react-dom/server
 * and asserts: nothing throws, every cell status shows its words (and the
 * `n/a` glyph, never 0 or a dash), the caveat marker and low-volume rules,
 * the benchmark overlay per widget type, and the static gates for the widget
 * files (no hex literal, no dash characters, Recharts only through
 * next/dynamic, series tokens present).
 *
 * Chart widgets render with an explicit `size`, so their SVG exists on the
 * server too (ResponsiveContainer would render nothing without a browser).
 * No browser, no warehouse.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_RESULTS } from "@/lib/reports/fixtures";
import type { MetricId } from "@/lib/reports/registry/ids";
import type { CaveatId, FormatSpec } from "@/lib/reports/registry/types";
import type { MetricCell, WidgetResult, WidgetType, WidgetView } from "@/lib/reports/types";
import { BarWidget } from "@/components/reports/widgets/BarWidget";
import { KpiWidget } from "@/components/reports/widgets/KpiWidget";
import { LineWidget } from "@/components/reports/widgets/LineWidget";
import { RankedWidget } from "@/components/reports/widgets/RankedWidget";
import { ScatterWidget } from "@/components/reports/widgets/ScatterWidget";
import { TableWidget } from "@/components/reports/widgets/TableWidget";
import { assignSeriesStyles, seriesColor } from "@/components/reports/widgets/chartTheme";
import {
  formatDeltaMagnitude,
  formatMetricValue,
  statusLabel,
} from "@/components/reports/widgets/format";
import type { CaveatTexts, ChartWidgetProps, WidgetMetric, WidgetProps } from "@/components/reports/widgets/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

// ---------------------------------------------------------------------------
// Local metric table (the registry is WP1's; widgets only need these fields)
// ---------------------------------------------------------------------------

const F = {
  money: { style: "money", decimals: 0, compact: true },
  unitCost: { style: "money", decimals: 0, smallDecimals: 2 },
  x: { style: "ratio", decimals: 2 },
  pct: { style: "percent", decimals: 1 },
} as const satisfies Record<string, FormatSpec>;
const SHOP: CaveatId[] = ["revenue_incl_vat", "returns_not_netted"];
const PAID: CaveatId[] = [...SHOP, "google_only_paid"];

function m(id: MetricId, label: string, unit: WidgetMetric["unit"], format: FormatSpec, goodWhen: WidgetMetric["goodWhen"], benchmarkable: boolean, caveats: CaveatId[] = []): WidgetMetric {
  return { id, label, unit, format, goodWhen, benchmarkable, caveats };
}
const META: Partial<Record<MetricId, WidgetMetric>> = {
  revenue: m("revenue", "Revenue", "money", F.money, "up", false, SHOP),
  mer: m("mer", "MER", "ratio", F.x, "up", true, PAID),
  cm3: m("cm3", "CM3", "money", F.money, "up", false, PAID),
  cm3_pct: m("cm3_pct", "CM3 %", "percent", F.pct, "up", true, PAID),
  meta_roas: m("meta_roas", "Meta ROAS", "ratio", F.x, "up", true, ["platform_attributed"]),
  meta_cpm: m("meta_cpm", "Meta CPM", "money", F.unitCost, "down", true),
  returning_order_share: m("returning_order_share", "Returning order share", "percent", F.pct, "neutral", false, ["period_share_not_rcr", "new_flag_window"]),
};
const TEXTS: CaveatTexts = {
  revenue_incl_vat: "Revenue incl. VAT",
  returns_not_netted: "Refunds not netted",
  google_only_paid: "Meta not connected: spend is Google only",
  platform_attributed: "Platform-attributed",
  period_share_not_rcr: "Order share, not cohort repeat rate",
  new_flag_window: "New vs returning within history window",
};

function metricsOf(result: WidgetResult): WidgetMetric[] {
  const ids: MetricId[] = [];
  for (const s of result.series) for (const id of Object.keys(s.cells) as MetricId[]) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => {
    const meta = META[id];
    if (!meta) throw new Error(`check script has no metric meta for ${id}`);
    return meta;
  });
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

const SIZE = { width: 640, height: 360 };

function render<P extends object>(Component: ComponentType<P>, props: P, label: string): string {
  try {
    const html = renderToStaticMarkup(createElement(Component, props));
    check(`${label}: renders`, html.length > 0);
    check(`${label}: no em or en dash`, !/[\u2013\u2014]/.test(html));
    return html;
  } catch (err) {
    failures.push(`${label}: THREW ${(err as Error).message}`);
    return "";
  }
}

/** Single-series, gap-bearing variants and benchmark variants of the fixtures. */
const weekly = FIXTURE_RESULTS.clientWeekly;
const withBenchmarks: WidgetResult = { ...weekly, key: "weekly-bench", benchmarks: FIXTURE_RESULTS.combinedTotalBenchmarks.benchmarks };
const weeklyTotal: WidgetResult = {
  ...withBenchmarks,
  key: "weekly-total",
  grain: "total",
  buckets: [],
  partialBuckets: [],
  series: weekly.series.map((s) => ({
    ...s,
    cells: Object.fromEntries(
      Object.entries(s.cells).map(([id, c]) => [id, { ...(c as MetricCell), points: undefined, comparePoints: undefined }])
    ),
  })),
};

const RESULTS: Array<[string, WidgetResult]> = [
  ["clientWeekly", weekly],
  ["clientWeekly+benchmarks", withBenchmarks],
  ["clientWeekly total grain", weeklyTotal],
  ["combinedTotalBenchmarks", FIXTURE_RESULTS.combinedTotalBenchmarks],
  ["combinedMonthlyFxMissing", FIXTURE_RESULTS.combinedMonthlyFxMissing],
  ["verticalMonthly", FIXTURE_RESULTS.verticalMonthly],
];

function viewFor(type: WidgetType, metrics: WidgetMetric[]): WidgetView {
  switch (type) {
    case "kpi":
      return { type: "kpi" };
    case "line":
      return { type: "line" };
    case "bar":
      return { type: "bar", stacked: true };
    case "table":
      return { type: "table", sort: "desc" };
    case "ranked":
      return { type: "ranked", sort: "desc", limit: 10 };
    case "scatter":
      return { type: "scatter", scatter: { x: metrics[0].id, y: metrics[Math.min(1, metrics.length - 1)].id, size: metrics[2]?.id } };
  }
}

function props(result: WidgetResult, metrics: WidgetMetric[], type: WidgetType): WidgetProps {
  return { result, metrics, caveatTexts: TEXTS, view: viewFor(type, metrics) };
}

// ---------------------------------------------------------------------------
// 1. Every fixture x every widget type: no throw, expected status text
// ---------------------------------------------------------------------------

for (const [name, result] of RESULTS) {
  const metrics = metricsOf(result);

  // Table: every series x metric. Gaps show n/a and their words.
  {
    const html = render(TableWidget, props(result, metrics, "table"), `${name} table`);
    for (const s of result.series) {
      for (const metric of metrics) {
        const cell = s.cells[metric.id];
        if (cell && cell.status !== "ok") check(`${name} table ${s.id}/${metric.id}: "${statusLabel(cell)}"`, html.includes(statusLabel(cell)));
      }
    }
    check(`${name} table: no literal 0 for a gap`, !/>\s*0\s*</.test(html) || result.series.every((s) => Object.values(s.cells).every((c) => c?.status === "ok")));
  }

  // KPI: one tile per series x metric.
  for (const s of result.series) {
    for (const metric of metrics) {
      const cell = s.cells[metric.id];
      if (!cell) continue;
      const html = render(KpiWidget, { ...props(result, [metric], "kpi"), seriesId: s.id, metricId: metric.id }, `${name} kpi ${s.id}/${metric.id}`);
      if (cell.status === "ok") {
        check(`${name} kpi ${s.id}/${metric.id}: value`, html.includes(formatMetricValue(cell.total, metric.format, result.currency)));
        check(`${name} kpi ${s.id}/${metric.id}: no n/a glyph`, !html.includes('text-content-muted">n/a'));
      } else {
        check(`${name} kpi ${s.id}/${metric.id}: "${statusLabel(cell)}"`, html.includes(statusLabel(cell)));
        check(`${name} kpi ${s.id}/${metric.id}: n/a glyph`, html.includes("n/a"));
        check(`${name} kpi ${s.id}/${metric.id}: delta hidden`, !html.includes("▲") && !html.includes("▼"));
      }
    }
  }

  // Ranked: one metric at a time.
  for (const metric of metrics) {
    const html = render(RankedWidget, props(result, [metric], "ranked"), `${name} ranked ${metric.id}`);
    for (const s of result.series) {
      const cell = s.cells[metric.id];
      if (cell && cell.status !== "ok") check(`${name} ranked ${metric.id}/${s.id}: "${statusLabel(cell)}"`, html.includes(statusLabel(cell)));
      if (cell && cell.status !== "ok") {
        // A gap sinks: its label comes after every ranked row's label.
        const okLabels = result.series.filter((x) => x.cells[metric.id]?.status === "ok").map((x) => html.indexOf(`>${x.label}<`));
        const gapIndex = html.indexOf(`>${s.label}<`);
        check(`${name} ranked ${metric.id}/${s.id}: sinks`, okLabels.every((i) => i < gapIndex));
      }
    }
  }

  // Line, Bar: legend carries each gap series' words (all metrics, via the switch default = first metric,
  // so also render with each metric alone).
  for (const type of ["line", "bar"] as const) {
    const Component = type === "line" ? LineWidget : BarWidget;
    for (const metric of metrics) {
      const html = render<ChartWidgetProps>(Component, { ...props(result, [metric], type), size: SIZE }, `${name} ${type} ${metric.id}`);
      for (const s of result.series) {
        const cell = s.cells[metric.id];
        if (cell && cell.status !== "ok") check(`${name} ${type} ${metric.id}/${s.id}: "${statusLabel(cell)}"`, html.includes(statusLabel(cell)));
      }
      if (result.series.length >= 2) check(`${name} ${type} ${metric.id}: legend`, html.includes('aria-label="Series"'));
    }
    // All metrics at once: the switch exists.
    if (metrics.length > 1) {
      const html = render<ChartWidgetProps>(Component, { ...props(result, metrics, type), size: SIZE }, `${name} ${type} all metrics`);
      check(`${name} ${type}: metric switch`, html.includes('aria-label="Metric"'));
    }
  }

  // Scatter: X and Y from the first metrics. Omitted series are named with their reason.
  if (metrics.length >= 2) {
    const html = render<ChartWidgetProps>(ScatterWidget, { ...props(result, metrics, "scatter"), size: SIZE }, `${name} scatter`);
    const view = viewFor("scatter", metrics).scatter;
    for (const s of result.series) {
      const gap = [s.cells[view?.x as MetricId], s.cells[view?.y as MetricId]].find((c) => c && c.status !== "ok");
      if (gap) check(`${name} scatter footnote ${s.id}`, html.includes(`${s.label}: ${gap.reason ?? statusLabel(gap)}`));
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Specific rules
// ---------------------------------------------------------------------------

{
  const mer = META.mer as WidgetMetric;
  const cm3 = META.cm3 as WidgetMetric;
  const roas = META.meta_roas as WidgetMetric;
  const table = renderToStaticMarkup(createElement(TableWidget, props(weekly, [mer, cm3, roas], "table")));

  check("caveat marker: ^ with the list in its accessible name", table.includes("^") && table.includes("Revenue incl. VAT"));
  check("caveat list is metric-scoped (roas has only platform-attributed)", table.includes('aria-label="Platform-attributed"'));
  check("low volume is muted and titled", table.includes('title="Low volume"'));
  check("No FX month in the cell", table.includes("No FX Oct 2026"));
  check("No cost data", table.includes("No cost data"));
  check("Not connected (short label, reason on hover)", table.includes("Not connected") && table.includes("Meta not connected"));
  check("No data", table.includes("No data"));
  check("gaps sort last (null sort keys): table rows exist for all clients", ["Alpha", "Bravo", "Charlie", "Delta"].every((n) => table.includes(n)));

  // Combined rollup coverage "1 of 2 clients" behind the marker.
  const cpm = META.meta_cpm as WidgetMetric;
  const kpi = renderToStaticMarkup(
    createElement(KpiWidget, { ...props(FIXTURE_RESULTS.combinedTotalBenchmarks, [cpm], "kpi"), metricId: "meta_cpm" })
  );
  check("coverage 1 of 2 behind the marker", kpi.includes("1 of 2 clients"));
  check("partial rollup marker is the compact 1 of 2, not ^", kpi.includes(">1 of 2</span>"));

  // Gap rule 2026-10-04: left-out clients are named with their reason behind the compact marker.
  {
    const base = FIXTURE_RESULTS.combinedTotalBenchmarks;
    const withExcluded = {
      ...base,
      series: base.series.map((s) => ({
        ...s,
        cells: {
          ...s.cells,
          mer: { ...s.cells.mer!, coverage: { included: 4, of: 5 }, excluded: [{ id: "rawbark", name: "RawBark", reason: "Missing days" }] },
        },
      })),
    };
    const ex = renderToStaticMarkup(createElement(KpiWidget, { ...props(withExcluded, [mer], "kpi"), metricId: "mer" }));
    check("excluded: compact 4 of 5 marker", ex.includes(">4 of 5</span>"));
    check("excluded: hover names the client and reason", ex.includes("4 of 5 clients. RawBark: Missing days"));
    check("excluded: value still shown", !ex.includes("No data"));
    check("excluded: no em dash in the marker", !ex.includes("\u2014"));
  }
  check("benchmark no_fx hidden with its reason", kpi.includes("I") && kpi.includes("No FX Dec 2026"));

  const merKpi = renderToStaticMarkup(createElement(KpiWidget, { ...props(FIXTURE_RESULTS.combinedTotalBenchmarks, [mer], "kpi"), metricId: "mer" }));
  check("benchmark ok: card text", merKpi.includes("Industry median 3.10×") && merKpi.includes("vertical a, CZ, 2026-01 to 2026-06") && merKpi.includes("As of 2026-09-15") && merKpi.includes("Revenue ex VAT; blended paid"));
  check("benchmark stale: Stale in the card", merKpi.includes("Stale"));

  // pp delta
  check("pp delta text", formatDeltaMagnitude(0.021, "pp") === "2.1 pp" && formatDeltaMagnitude(-0.125, "relative") === "12.5%");
  const share = META.returning_order_share as WidgetMetric;
  const vertical = renderToStaticMarkup(createElement(TableWidget, props(FIXTURE_RESULTS.verticalMonthly, [mer, share], "table")));
  check("pp delta rendered in the table", vertical.includes("3.0 pp") && vertical.includes("2.0 pp"));
}

// Benchmark overlays per widget type
{
  const mer = META.mer as WidgetMetric;
  const line = renderToStaticMarkup(createElement(LineWidget, { ...props(withBenchmarks, [mer], "line"), size: SIZE }));
  check("line: dashed benchmark line + label", line.includes('stroke-dasharray="4 4"') && line.includes("I 3.10×"));
  const barBucket = renderToStaticMarkup(createElement(BarWidget, { ...props(withBenchmarks, [mer], "bar"), size: SIZE }));
  check("bar (columns): benchmark marker line", barBucket.includes('stroke-dasharray="4 4"'));
  const barTotal = renderToStaticMarkup(createElement(BarWidget, { ...props(weeklyTotal, [mer], "bar"), size: SIZE }));
  check("bar (total): benchmark marker line", barTotal.includes('stroke-dasharray="4 4"'));
  const ranked = renderToStaticMarkup(createElement(RankedWidget, props(withBenchmarks, [mer], "ranked")));
  check("ranked: benchmark marker", ranked.includes("Industry median 3.10×"));
  const roas = META.meta_roas as WidgetMetric;
  const scatter = renderToStaticMarkup(createElement(ScatterWidget, { ...props(withBenchmarks, [mer, roas], "scatter"), size: SIZE }));
  check("scatter: crosshair line", scatter.includes('stroke-dasharray="4 4"'));
  const table = renderToStaticMarkup(createElement(TableWidget, props(withBenchmarks, [mer], "table")));
  check("table: Industry row per vertical", table.includes("Industry vertical a") && table.includes("Industry all ecommerce"));
  // Benchmarks off: nothing drawn.
  const plain = renderToStaticMarkup(createElement(LineWidget, { ...props(weekly, [mer], "line"), size: SIZE }));
  check("benchmarks off: no benchmark overlay", !plain.includes('stroke-dasharray="4 4"') && !plain.includes("Industry"));

  // Hatched placeholder + status words for a gap bar (grain total)
  const roasBar = renderToStaticMarkup(createElement(BarWidget, { ...props(weeklyTotal, [roas], "bar"), size: SIZE }));
  check("bar (total): hatched placeholder for a gap", roasBar.includes("url(#hatch-") && roasBar.includes("n/a Not connected") && roasBar.includes("n/a No data"));

  // Stacked vs grouped on a ratio: a ratio never stacks.
  const cm3 = META.cm3 as WidgetMetric;
  const stacked = renderToStaticMarkup(createElement(BarWidget, { ...props(weekly, [cm3], "bar"), size: SIZE }));
  check("bar stacked money renders", stacked.includes("recharts-bar"));

  // Gap point in a line is a break, never 0: bravo cm3 last bucket is null.
  const lineCm3 = renderToStaticMarkup(createElement(LineWidget, { ...props(weekly, [cm3], "line"), size: SIZE }));
  check("line: legend shows fx and cost gaps", lineCm3.includes("No FX Oct 2026") && lineCm3.includes("No cost data"));
}

// ---------------------------------------------------------------------------
// 3. Format and theme helpers
// ---------------------------------------------------------------------------

// Intl puts a no-break space after the currency code; compare with plain spaces.
const plain = (t: string) => t.replace(/\u00a0/g, " ");
check("money compact", plain(formatMetricValue(654200, F.money, "CZK")) === "CZK 654.2K", formatMetricValue(654200, F.money, "CZK"));
check("count below 100k is written out", formatMetricValue(4172, { style: "number", decimals: 0, compact: true }, "CZK") === "4,172");
check("count from 100k is compact", formatMetricValue(250000, { style: "number", decimals: 0, compact: true }, "CZK") === "250K");
check("money compact keeps one decimal from 100k", plain(formatMetricValue(13000000, F.money, "CZK")) === "CZK 13.0M", formatMetricValue(13000000, F.money, "CZK"));
check("money below 100k is whole units", plain(formatMetricValue(65420, F.money, "CZK")) === "CZK 65,420", formatMetricValue(65420, F.money, "CZK"));
{
  // A metric the result on screen has no cell for: skeleton while pending, n/a otherwise.
  const mer0 = META.mer as WidgetMetric;
  const fresh = m("cac", "CAC", "money", F.money, "down", false);
  const waiting = renderToStaticMarkup(createElement(TableWidget, { ...props(weekly, [mer0, fresh], "table"), pending: true }));
  const settled = renderToStaticMarkup(createElement(TableWidget, props(weekly, [mer0, fresh], "table")));
  check("pending table: missing metric cells are skeletons", waiting.includes("oe-skeleton"));
  check("settled table: a missing metric is n/a No data", !settled.includes("oe-skeleton") && settled.includes("No data"));
  const waitingKpi = renderToStaticMarkup(createElement(KpiWidget, { ...props(weekly, [fresh], "kpi"), pending: true }));
  check("pending kpi: skeleton, not n/a", waitingKpi.includes("oe-skeleton") && !waitingKpi.includes("No data"));
}
check("unit cost small decimals", formatMetricValue(5.2, F.unitCost, "USD") === "$5.20", formatMetricValue(5.2, F.unitCost, "USD"));
check("unit cost whole above 10", plain(formatMetricValue(612, F.unitCost, "CZK")) === "CZK 612", formatMetricValue(612, F.unitCost, "CZK"));
check("ratio", formatMetricValue(3.1, F.x, "CZK") === "3.10×");
check("percent", formatMetricValue(0.3, F.pct, "CZK") === "30.0%");
check("null is n/a", formatMetricValue(null, F.x, "CZK") === "n/a" && formatMetricValue(NaN, F.pct, "CZK") === "n/a");
check("status labels", statusLabel({ status: "not_connected" }) === "Not connected" && statusLabel({ status: "no_data" }) === "No data" && statusLabel({ status: "not_measured" }) === "No cost data");
check("fx status label from months", statusLabel({ status: "fx_missing", fxMonths: ["2026-10-01"] }) === "No FX Oct 2026");
check("series slot colours", seriesColor(0) === "var(--series-1)" && seriesColor(5) === "var(--series-6)" && seriesColor(6) === "var(--series-1)");
{
  const styles = assignSeriesStyles([{ slot: 0 }, { slot: 1 }, { slot: 0 }]);
  check("repeat slot gets a dash", styles[0].dash === undefined && styles[2].dash !== undefined && styles[0].color === styles[2].color);
}

// ---------------------------------------------------------------------------
// 4. Static gates on the widget files and the tokens
// ---------------------------------------------------------------------------

const DIR = join(process.cwd(), "components/reports/widgets");
const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));
const CHART_FILES = new Set(["LineWidget.tsx", "BarWidget.tsx", "ScatterWidget.tsx", "ChartFrame.tsx"]);
for (const f of files) {
  const src = readFileSync(join(DIR, f), "utf8");
  check(`${f}: no em or en dash`, !/[\u2013\u2014]/.test(src));
  check(`${f}: no hex colour literal`, !/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/url\(#[^)]*\)/g, "")));
  check(`${f}: no border-dashed`, !src.includes("border-dashed"));
  check(`${f}: no toLocaleString`, !src.includes("toLocaleString"));
  const importsRecharts = /from\s+["']recharts["']/.test(src);
  check(`${f}: recharts only in chart files`, !importsRecharts || CHART_FILES.has(f));
  const staticChartImport = /import\s+[^;]*from\s+["']\.\/(Line|Bar|Scatter)Widget["']/.test(src);
  check(`${f}: chart widgets are never imported statically`, !staticChartImport);
}
check("index.tsx loads charts with next/dynamic and ssr false", (() => {
  const src = readFileSync(join(DIR, "index.tsx"), "utf8");
  return (src.match(/dynamic</g) ?? []).length === 3 && (src.match(/^\s+ssr: false,/gm) ?? []).length === 3;
})());

const colors = readFileSync(join(process.cwd(), "styles/tokens/colors.css"), "utf8");
for (let i = 1; i <= 6; i += 1) check(`colors.css --series-${i}`, new RegExp(`--series-${i}:\\s*var\\(--[a-z0-9-]+\\)`).test(colors));
check("colors.css --benchmark", /--benchmark:\s*var\(--gray-300\)/.test(colors));
// Re-stepped in RS9 with the dataviz validator (the design's ink, gray and light-green slots failed it).
// The hexes below are the validated palette; the script re-runs the validator when the skill is installed locally.
{
  const slot = (n: number) => new RegExp(`--series-${n}:\\s*var\\(--([a-z0-9-]+)\\)`).exec(colors)?.[1];
  const raw = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(colors)?.[1]?.toUpperCase();
  check("series slots follow the validated order", slot(1) === "growth-600" && slot(2) === "series-purple" && slot(3) === "warning-700" && slot(4) === "series-pink" && slot(5) === "info" && slot(6) === "series-teal");
  check("series hexes are the validated palette", raw("series-purple") === "#7F54B3" && raw("series-pink") === "#D6409F" && raw("series-teal") === "#0B8FA3" && raw("growth-600") === "#0E9F5D" && raw("warning-700") === "#8A5B0A" && raw("info") === "#0866FF");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // The door: six components, charts behind next/dynamic. Rendering them on the server must not throw.
  try {
    const mod = await import("@/components/reports/widgets/index");
    check("index exports six widgets", Object.keys(mod.WIDGET_COMPONENTS).length === 6);
    const mer = META.mer as WidgetMetric;
    for (const type of ["kpi", "line", "bar", "table", "ranked", "scatter"] as const) {
      const html = renderToStaticMarkup(createElement(mod.WidgetBody, props(weekly, [mer, META.meta_roas as WidgetMetric], type)));
      check(`index WidgetBody ${type}: renders on the server`, typeof html === "string");
    }
  } catch (err) {
    failures.push(`index: THREW ${(err as Error).message}`);
  }

  if (failures.length > 0) {
    console.error(`FAILED ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-reports-widgets: ${passed}/${passed} passed`);
}

void main();
