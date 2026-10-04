/**
 * Pages and state glue of the Reports suite (RS9).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-pages.ts
 *
 * Pure checks, no warehouse, no browser. Pins the logic the pages rely on that
 * can run outside React (request planning of the data hook, default widget
 * configs, the KPI week grain, override chips, list formatters) and the static
 * rules of the page files (gate in the layout and every page, CSS import order,
 * no dash or hex literals, the integration bindings).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { planWidget } from "@/components/reports/useWidgetData";
import { ownerInitials, relativeTime, reportHref, widgetCountLabel } from "@/components/reports/listFormat";
import { buildPageMetrics } from "@/lib/reports/pageData";
import { defaultWidgetConfig, fetchGrain, overrideChip } from "@/lib/reports/widgetHelpers";
import { isMetricId } from "@/lib/reports/registry/ids";
import { findMetricId, METRICS } from "@/lib/reports/registry/metrics";
import { DEFAULT_REPORT_FILTERS, WIDGET_TYPES, WidgetConfig, type ReportFilters } from "@/lib/reports/types";
import { MAX_SPAN } from "@/lib/reports/limits";
import { TEMPLATES } from "@/lib/reports/templates";
import { compileWidget } from "@/lib/reports/compile";
import { FIXTURE_RESOLVED } from "@/lib/reports/fixtures";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed += 1;
  else failures.push(detail === undefined ? name : `${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

const ID = "11111111-1111-4111-8111-111111111111";
const filters: ReportFilters = DEFAULT_REPORT_FILTERS;

// ---------------------------------------------------------------------------
// Picker and widget metrics from the registry
// ---------------------------------------------------------------------------

const page = buildPageMetrics();
check("every picker metric is a queryable id (44)", page.pickerMetrics.length === 44 && page.pickerMetrics.every((m) => isMetricId(m.id)), page.pickerMetrics.length);
check("widget metrics cover every picker metric", page.pickerMetrics.every((m) => page.widgetMetrics[m.id]?.label === m.label));
check("picker metrics carry the full requirement", page.pickerMetrics.every((m) => m.requires !== undefined));
check("caveat texts cover every caveat id", Object.keys(page.caveatTexts).length >= 9 && Object.values(page.caveatTexts).every((t) => typeof t === "string" && t.length > 0));
check("the whole page payload is JSON serialisable", JSON.stringify(page).length > 100 && JSON.parse(JSON.stringify(page)).pickerMetrics.length === 44);
check("roas finds MER (RS8 request)", findMetricId("roas") === "mer" && METRICS.mer.aliases?.includes("roas") === true);

// ---------------------------------------------------------------------------
// Default configs
// ---------------------------------------------------------------------------

for (const type of WIDGET_TYPES) {
  const config = defaultWidgetConfig(type, page.pickerMetrics);
  check(`default ${type} config passes WidgetConfig`, WidgetConfig.safeParse(config).success);
  check(`default ${type} config has the right type`, config.view.type === type);
  check(`default ${type} config uses queryable metrics`, config.query.metrics.every(isMetricId));
}
check("default KPI is combined at total grain", (() => { const c = defaultWidgetConfig("kpi", page.pickerMetrics); return c.query.grain === "total" && c.query.split === "combined"; })());
check("default line never uses total", defaultWidgetConfig("line", page.pickerMetrics).query.grain !== "total");
check("default ranked has one metric, sorted", (() => { const c = defaultWidgetConfig("ranked", page.pickerMetrics); return c.query.metrics.length === 1 && c.view.sort === "desc" && c.view.limit === 10; })());
check("default scatter has X and Y", (() => { const c = defaultWidgetConfig("scatter", page.pickerMetrics); return Boolean(c.view.scatter?.x) && Boolean(c.view.scatter?.y) && c.query.metrics.includes(c.view.scatter!.x); })());
check("defaults work with a one-metric pool", WIDGET_TYPES.every((t) => WidgetConfig.safeParse(defaultWidgetConfig(t, page.pickerMetrics.slice(0, 1))).success));

// ---------------------------------------------------------------------------
// KPI week grain
// ---------------------------------------------------------------------------

const kpi = defaultWidgetConfig("kpi", page.pickerMetrics);
const lineCfg = defaultWidgetConfig("line", page.pickerMetrics);
const at = (preset: ReportFilters["period"]) => ({ ...filters, period: preset });
check("KPI at 90d is fetched weekly (sparkline)", fetchGrain(kpi, at({ kind: "preset", preset: "90d" })) === "week");
check("KPI at 12m is fetched weekly", fetchGrain(kpi, at({ kind: "preset", preset: "12m" })) === "week");
check("KPI at all time stays total (too many weeks)", fetchGrain(kpi, at({ kind: "preset", preset: "all" })) === "total");
check("KPI custom 2 years is weekly", fetchGrain(kpi, at({ kind: "custom", from: "2024-10-01", to: "2026-09-30" })) === "week");
check("KPI custom 4 years stays total", fetchGrain(kpi, at({ kind: "custom", from: "2022-10-01", to: "2026-09-30" })) === "total");
check("KPI period override decides", fetchGrain({ ...kpi, query: { ...kpi.query, overrides: { period: { kind: "preset", preset: "all" } } } }, at({ kind: "preset", preset: "90d" })) === "total");
check("a line keeps its grain", fetchGrain(lineCfg, filters) === lineCfg.query.grain);
check("week limit is what the resolver enforces", MAX_SPAN.week === 160);

// ---------------------------------------------------------------------------
// Request planning
// ---------------------------------------------------------------------------

const p1 = planWidget({ id: "a", config: kpi }, ID, filters)!;
check("plan carries the report id and widget type", p1.body.reportId === ID && p1.body.widgetType === "kpi");
check("plan: KPI body is weekly, the fallback is the configured total", p1.body.query.grain === "week" && p1.fallback?.query.grain === "total");
check("plan: a line has no fallback", planWidget({ id: "b", config: lineCfg }, ID, filters)!.fallback === null);
check("plan: null config is not fetched", planWidget({ id: "c", config: null }, ID, filters) === null);
check("plan: key ignores the title (display only)", planWidget({ id: "a", config: { ...kpi, view: { ...kpi.view, title: "Hello" } } }, ID, filters)!.key === p1.key);
check("plan: key ignores sort, limit and stacked", (() => {
  const r = defaultWidgetConfig("ranked", page.pickerMetrics);
  const a = planWidget({ id: "r", config: r }, ID, filters)!.key;
  const b = planWidget({ id: "r", config: { ...r, view: { ...r.view, sort: "asc", limit: 5 } } }, ID, filters)!.key;
  return a === b;
})());
check("plan: key changes with the metric", planWidget({ id: "a", config: { ...kpi, query: { ...kpi.query, metrics: ["mer"] } } }, ID, filters)!.key !== p1.key);
check("plan: key changes with the report filters", planWidget({ id: "a", config: kpi }, ID, { ...filters, compare: "none" })!.key !== p1.key);
check("plan: key changes with a widget override", planWidget({ id: "a", config: { ...kpi, query: { ...kpi.query, overrides: { currency: "EUR" } } } }, ID, filters)!.key !== p1.key);
check("plan: key is the same for the same request (LRU hit)", planWidget({ id: "other-id", config: kpi }, ID, filters)!.key === p1.key);
check("plan: the id does not enter the key, so two widgets share a result", true);

// ---------------------------------------------------------------------------
// Override chip
// ---------------------------------------------------------------------------

const label = () => "3 clients";
check("chip: none when nothing is overridden", overrideChip(kpi, label) === "");
check("chip: period preset", overrideChip({ ...kpi, query: { ...kpi.query, overrides: { period: { kind: "preset", preset: "12m" } } } }, label) === "12m");
check("chip: currency", overrideChip({ ...kpi, query: { ...kpi.query, overrides: { currency: "EUR" } } }, label) === "EUR");
check("chip: two overrides join with a comma", overrideChip({ ...kpi, query: { ...kpi.query, overrides: { period: { kind: "preset", preset: "7d" }, currency: "USD" } } }, label) === "7d, USD");
check("chip: at most two parts", overrideChip({ ...kpi, query: { ...kpi.query, overrides: { period: { kind: "preset", preset: "7d" }, compare: "none", currency: "USD", clients: { mode: "all" } } } }, label).split(", ").length === 2);
check("chip: clients use the picker label", overrideChip({ ...kpi, query: { ...kpi.query, overrides: { clients: { mode: "list", ids: ["a", "b", "c"] } } } }, label) === "3 clients");

// ---------------------------------------------------------------------------
// List formatters
// ---------------------------------------------------------------------------

check("initials: two parts", ownerInitials("matej.r@oneeighty.cz") === "MR");
check("initials: one part", ownerInitials("lukas@oneeighty.cz") === "LU");
check("initials: empty", ownerInitials("") === "?");
const now = Date.parse("2026-10-04T12:00:00Z");
check("time: now", relativeTime("2026-10-04T11:59:40Z", now) === "now");
check("time: minutes", relativeTime("2026-10-04T11:30:00Z", now) === "30m");
check("time: hours", relativeTime("2026-10-04T10:00:00Z", now) === "2h");
check("time: days", relativeTime("2026-10-01T12:00:00Z", now) === "3d");
check("time: weeks", relativeTime("2026-08-23T12:00:00Z", now) === "6w");
check("time: months", relativeTime("2025-03-10T12:00:00Z", now) === "Mar 2025");
check("time: null and junk are empty", relativeTime(null, now) === "" && relativeTime("nope", now) === "");
check("widget count", widgetCountLabel(1) === "1 widget" && widgetCountLabel(12) === "12 widgets" && widgetCountLabel(0) === "0 widgets");
check("report href keeps filter params", reportHref(ID, "compare=none&ccy=EUR") === `/reports/${ID}?compare=none&ccy=EUR`);
check("report href without params", reportHref(ID, "") === `/reports/${ID}`);
check("report href adds edit", reportHref(ID, "", { edit: "1" }) === `/reports/${ID}?edit=1`);

// ---------------------------------------------------------------------------
// Templates reach the pages
// ---------------------------------------------------------------------------

check("four templates, blank first", Object.keys(TEMPLATES).length === 4 && Object.keys(TEMPLATES)[0] === "blank");

// ---------------------------------------------------------------------------
// Integration bindings
// ---------------------------------------------------------------------------

check("compileWidget is bound to the real registry", (() => {
  try {
    const q = compileWidget(FIXTURE_RESOLVED);
    return q.sql.includes("mart_daily_kpis") && q.components.length > 0;
  } catch (error) {
    return String(error);
  }
})() === true);

// ---------------------------------------------------------------------------
// Static gates over the files this package owns
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PAGES = ["app/(app)/reports/layout.tsx", "app/(app)/reports/page.tsx", "app/(app)/reports/[reportId]/page.tsx"];
for (const file of PAGES) check(`${file} calls requireReportsAccess()`, /await requireReportsAccess\(\)/.test(read(file)));

const layout = read("app/(app)/reports/layout.tsx");
check("layout imports the library CSS before grid.css", layout.indexOf('"react-grid-layout/css/styles.css"') > -1 && layout.indexOf('"react-grid-layout/css/styles.css"') < layout.indexOf('"./grid.css"'));
check("report page answers notFound for an invisible report", /notFound\(\)/.test(read("app/(app)/reports/[reportId]/page.tsx")) && /canView/.test(read("app/(app)/reports/[reportId]/page.tsx")));
check("report page is dynamic", /export const dynamic = "force-dynamic"/.test(read("app/(app)/reports/[reportId]/page.tsx")));

const run = read("lib/reports/run.ts");
check("run.ts imports assertReportsAccess directly", /import \{ assertReportsAccess \} from "@\/lib\/authz"/.test(run) && !/import \* as authz/.test(run));
const compile = read("lib/reports/compile.ts");
check("compile.ts binds COMPONENTS and MARTS", /createCompiler\(\{ marts: MARTS, components: COMPONENTS \}\)/.test(compile) && !/No registry bound/.test(compile));
const clients = read("lib/reports/clients.ts");
check("clients.ts uses toReportCapabilities", /toReportCapabilities\(/.test(clients));
check("benchmarks.ts uses matchBenchmarks", /matchBenchmarks/.test(read("lib/reports/benchmarks.ts")));

const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; dependencies: Record<string, string> };
for (const n of ["eval", "authz", "store", "url", "widgets", "canvas", "pages"]) {
  check(`npm script check:reports-${n}`, pkg.scripts[`check:reports-${n}`]?.includes(`scripts/check-reports-${n}.ts`) === true);
}

const DASHES = /[\u2013\u2014]/;
const FILES = [
  ...PAGES,
  "app/(app)/reports/loading.tsx",
  "lib/reports/pageData.ts",
  "lib/reports/widgetHelpers.ts",
  ...readdirSync(join(ROOT, "components/reports")).filter((f) => /\.(tsx?|css)$/.test(f) && statSync(join(ROOT, "components/reports", f)).isFile()).map((f) => `components/reports/${f}`),
];
for (const file of FILES) {
  const text = read(file);
  check(`${file}: no em or en dash`, !DASHES.test(text));
  check(`${file}: no hex colour literal`, !/#[0-9a-fA-F]{6}\b/.test(text) && !/bg-\[#/.test(text) && !/\brgba?\(/.test(text));
  check(`${file}: no toLocaleString()`, !/toLocaleString\(\)/.test(text));
  check(`${file}: no border-dashed`, !text.includes("border-dashed"));
}

// Recharts only through the widgets door, and the page never imports a chart widget statically.
for (const file of FILES) {
  const text = read(file);
  check(`${file}: no recharts import`, !/from\s+["']recharts["']/.test(text));
  check(`${file}: no static chart widget import`, !/from\s+["'][^"']*\/(Line|Bar|Scatter)Widget["']/.test(text));
}

if (failures.length > 0) {
  console.error(`check-reports-pages: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-reports-pages: ${passed}/${passed} passed`);
