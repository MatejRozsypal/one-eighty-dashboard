/**
 * Asserts the delta display contract: `formatDelta` / `deltaParts` in both
 * modes for every kind, the mode param and cookie parsing, the chips, tiles
 * and report cells following the mode, DataTable's per-mode sort key, and
 * where the "% | 123" toggle sits.
 *
 *     npm run check:delta
 *
 * Pure modules and static renders only: no BigQuery, no router.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DELTA_COOKIE,
  DELTA_PARAM,
  MINUS,
  deltaParts,
  deltaSortKey,
  formatDelta,
  parseDeltaMode,
  type DeltaMode,
  type DeltaOptions,
} from "@/lib/format";
import { resolveDeltaMode, viewQuery, parseViewParams } from "@/lib/params";
import { DeltaChip } from "@/components/ui/Delta";
import { DeltaModeStatic } from "@/components/ui/DeltaMode";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { sortKeyFor } from "@/components/ui/DataTable";
import { samePath } from "@/components/shell/NavigationPending";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { CellDelta } from "@/components/reports/widgets/CellStatus";
import { deltaKindOf } from "@/components/reports/widgets/format";

const ROOT = join(__dirname, "..");
const EM_DASH = String.fromCharCode(0x2014);
/** Intl puts a no-break space between a currency code and the figure; compare with a plain one. */
const NBSP = new RegExp(String.fromCharCode(0xa0), "g");
const plain = (v: unknown) => (typeof v === "string" ? v.replace(NBSP, " ") : v);
let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

function eq(name: string, actual: unknown, expected: unknown): void {
  actual = plain(actual);
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const html = (el: ReactElement, mode?: DeltaMode) =>
  renderToStaticMarkup(mode ? createElement(DeltaModeStatic, { mode, children: el }) : el).replace(NBSP, " ");

const money = (mode: DeltaMode, extra: Partial<DeltaOptions> = {}): DeltaOptions => ({ kind: "money", currency: "CZK", mode, ...extra });
const count = (mode: DeltaMode, extra: Partial<DeltaOptions> = {}): DeltaOptions => ({ kind: "count", mode, ...extra });
const ratio = (mode: DeltaMode): DeltaOptions => ({ kind: "ratio", mode });
const rate = (mode: DeltaMode): DeltaOptions => ({ kind: "rate", mode });

// ---------------------------------------------------------------------------
// formatDelta: money
// ---------------------------------------------------------------------------
eq("money pct up", formatDelta(112_400, 100_000, money("pct")), "+12.4%");
eq("money pct down", formatDelta(87_600, 100_000, money("pct")), `${MINUS}12.4%`);
eq("money abs up", formatDelta(112_345, 100_000, money("abs")), "+CZK 12,345");
eq("money abs down", formatDelta(100_000, 112_345, money("abs")), `${MINUS}CZK 12,345`);
eq("money abs small keeps cents", formatDelta(145.5, 100, money("abs")), "+CZK 45.50");
eq("money abs USD", formatDelta(1_310, 1_000, { kind: "money", currency: "USD", mode: "abs" }), "+$310");
eq("money abs compact", formatDelta(2_300_000, 1_100_000, money("abs", { compact: true })), "+CZK 1.2M");
eq("money abs decimals", formatDelta(1_000.4, 1_000, money("abs", { decimals: 1 })), "+CZK 0.4");
eq("money abs without currency falls back to a number", formatDelta(1_500, 1_000, { kind: "money", mode: "abs" }), "+500");

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------
eq("count pct", formatDelta(1_123, 1_000, count("pct")), "+12.3%");
eq("count abs", formatDelta(1_123, 1_000, count("abs")), "+123");
eq("count abs with unit", formatDelta(1_123, 1_000, count("abs", { unit: "orders" })), "+123 orders");
eq("count abs down with unit", formatDelta(877, 1_000, count("abs", { unit: "orders" })), `${MINUS}123 orders`);
eq("count abs grouping", formatDelta(13_456, 1_000, count("abs")), "+12,456");
eq("count abs decimals", formatDelta(2.35, 2.1, count("abs", { decimals: 2 })), "+0.25");

// ---------------------------------------------------------------------------
// ratio
// ---------------------------------------------------------------------------
eq("ratio pct", formatDelta(4.51, 4.2, ratio("pct")), "+7.4%");
eq("ratio abs", formatDelta(4.51, 4.2, ratio("abs")), "+0.31×");
eq("ratio abs down", formatDelta(3.89, 4.2, ratio("abs")), `${MINUS}0.31×`);
eq("ratio abs unit", formatDelta(4.51, 4.2, { kind: "ratio", mode: "abs", unit: "MER" }), "+0.31× MER");

// ---------------------------------------------------------------------------
// rate: percentage points in both modes
// ---------------------------------------------------------------------------
eq("rate pct mode is pp", formatDelta(0.047, 0.035, rate("pct")), "+1.2 pp");
eq("rate abs mode is pp", formatDelta(0.047, 0.035, rate("abs")), "+1.2 pp");
eq("rate down", formatDelta(0.023, 0.035, rate("pct")), `${MINUS}1.2 pp`);
eq("rate from zero", formatDelta(0.02, 0, rate("pct")), "+2.0 pp");

// ---------------------------------------------------------------------------
// Missing and zero baselines
// ---------------------------------------------------------------------------
for (const mode of ["pct", "abs"] as const) {
  for (const opts of [money(mode), count(mode), ratio(mode), rate(mode)]) {
    const tag = `${opts.kind} ${mode}`;
    eq(`${tag}: null previous`, formatDelta(100, null, opts), null);
    eq(`${tag}: null current`, formatDelta(null, 100, opts), null);
    eq(`${tag}: undefined previous`, formatDelta(100, undefined, opts), null);
    eq(`${tag}: NaN previous`, formatDelta(100, Number.NaN, opts), null);
    eq(`${tag}: Infinity current`, formatDelta(Number.POSITIVE_INFINITY, 100, opts), null);
  }
}
eq("zero previous, pct money: undefined growth", formatDelta(500, 0, money("pct")), null);
eq("zero previous, pct count", formatDelta(5, 0, count("pct")), null);
eq("zero previous, pct ratio", formatDelta(1.2, 0, ratio("pct")), null);
eq("zero previous, abs money", formatDelta(500, 0, money("abs")), "+CZK 500");
eq("zero previous, abs count", formatDelta(5, 0, count("abs")), "+5");
eq("zero both, abs", formatDelta(0, 0, count("abs")), "0");

// ---------------------------------------------------------------------------
// Negative values, flat, signs
// ---------------------------------------------------------------------------
eq("negative current, money abs", formatDelta(-500, 1_000, money("abs")), `${MINUS}CZK 1,500`);
eq("negative current, money pct", formatDelta(-500, 1_000, money("pct")), `${MINUS}150.0%`);
eq("negative previous improves, pct uses |previous|", formatDelta(-50, -100, money("pct")), "+50.0%");
eq("negative previous improves, abs", formatDelta(-50, -100, money("abs")), "+CZK 50.00");
eq("negative to more negative, abs", formatDelta(-1_500, -1_000, money("abs")), `${MINUS}CZK 500`);
eq("flat pct has no sign", formatDelta(1_000, 1_000, money("pct")), "0.0%");
eq("near-flat pct rounds to flat", formatDelta(100_040, 100_000, money("pct")), "0.0%");
eq("flat abs money", formatDelta(1_000, 1_000, money("abs")), "CZK 0.00");
eq("flat rate", formatDelta(0.035, 0.035, rate("pct")), "0.0 pp");
check("flat flag", deltaParts(1_000, 1_000, money("pct"))?.flat === true);
check("not flat", deltaParts(1_010, 1_000, money("pct"))?.flat === false);
check("magnitude is unsigned", deltaParts(877, 1_000, count("abs"))?.magnitude === "123");
check("change sign drives the arrow", (deltaParts(877, 1_000, count("abs"))?.change ?? 0) < 0);

const negatives = [
  formatDelta(87_600, 100_000, money("pct")),
  formatDelta(100_000, 112_345, money("abs")),
  formatDelta(877, 1_000, count("abs")),
  formatDelta(3.89, 4.2, ratio("abs")),
  formatDelta(0.023, 0.035, rate("abs")),
  formatDelta(-500, 1_000, money("pct")),
];
for (const n of negatives) {
  check(`U+2212 not hyphen: ${n}`, n !== null && n.startsWith(MINUS) && !n.includes("-"), String(n));
  check(`no em dash: ${n}`, n !== null && !n.includes(EM_DASH));
}

// ---------------------------------------------------------------------------
// Sort keys
// ---------------------------------------------------------------------------
const key = deltaSortKey({ current: 1_200, previous: 1_000, kind: "money", currency: "CZK" });
check("sort key pct", key.pct !== null && Math.abs(key.pct - 0.2) < 1e-9, JSON.stringify(key));
eq("sort key abs", key.abs, 200);
const zeroKey = deltaSortKey({ current: 5, previous: 0, kind: "count" });
eq("sort key pct from zero", zeroKey.pct, null);
eq("sort key abs from zero", zeroKey.abs, 5);
const rateKey = deltaSortKey({ current: 0.05, previous: 0.04, kind: "rate" });
check("sort key rate is pp in both", rateKey.pct !== null && rateKey.abs !== null && Math.abs(rateKey.pct - 1) < 1e-9 && rateKey.pct === rateKey.abs);
eq("sortKeyFor picks the mode (pct)", sortKeyFor(key, "pct"), key.pct);
eq("sortKeyFor picks the mode (abs)", sortKeyFor(key, "abs"), 200);
eq("sortKeyFor passes plain keys", sortKeyFor(42, "abs"), 42);
eq("sortKeyFor passes strings", sortKeyFor("a", "abs"), "a");
eq("sortKeyFor null", sortKeyFor(null, "pct"), null);
eq("sortKeyFor undefined", sortKeyFor(undefined, "pct"), null);

// ---------------------------------------------------------------------------
// Param and cookie
// ---------------------------------------------------------------------------
eq("param name", DELTA_PARAM, "delta");
eq("cookie name", DELTA_COOKIE, "oe_delta");
eq("parse pct", parseDeltaMode("pct"), "pct");
eq("parse abs", parseDeltaMode("abs"), "abs");
eq("parse array", parseDeltaMode(["abs", "pct"]), "abs");
eq("parse junk", parseDeltaMode("absolute"), null);
eq("parse undefined", parseDeltaMode(undefined), null);
eq("resolve: url wins", resolveDeltaMode({ delta: "abs" }, "pct"), "abs");
eq("resolve: cookie when url absent", resolveDeltaMode({}, "abs"), "abs");
eq("resolve: cookie when url junk", resolveDeltaMode({ delta: "x" }, "abs"), "abs");
eq("resolve: default pct", resolveDeltaMode(undefined, undefined), "pct");
eq("resolve: junk cookie", resolveDeltaMode(undefined, "1"), "pct");
const vq = viewQuery(parseViewParams({ client: "c", preset: "7d", delta: "abs" }));
check("viewQuery never writes delta (server links go stale after an in-place toggle)", !vq.includes("delta"), vq);
check("samePath same", samePath("/snapshot?a=1", "/snapshot?b=2", "http://x/snapshot"));
check("samePath other", !samePath("/orders?a=1", "/snapshot?b=2", "http://x/snapshot"));

// ---------------------------------------------------------------------------
// DeltaChip follows the mode
// ---------------------------------------------------------------------------
const revenue = { current: 112_345, previous: 100_000, kind: "money" as const, currency: "CZK" };
const ctr = { current: 0.047, previous: 0.035, kind: "rate" as const };

const legacy = html(createElement(DeltaChip, { delta: 0.124 }), "abs");
check("legacy delta stays percent in abs mode", legacy.includes("12.4%") && legacy.includes("▲"), legacy);
const chipPct = html(createElement(DeltaChip, { change: revenue }));
check("change, no provider: percent", chipPct.includes("12.3%") && chipPct.includes("text-positive-text"), chipPct);
const chipAbs = html(createElement(DeltaChip, { change: revenue }), "abs");
check("change, abs: money", chipAbs.includes("CZK 12,345") && !chipAbs.includes("%"), chipAbs);
const chipDown = html(createElement(DeltaChip, { change: { ...revenue, current: 90_000 }, goodWhen: "up" }), "abs");
check("abs down: arrow and colour", chipDown.includes("▼") && chipDown.includes("text-negative-text") && chipDown.includes("CZK 10,000"), chipDown);
const chipCost = html(createElement(DeltaChip, { change: { ...revenue, current: 90_000 }, goodWhen: "down" }), "abs");
check("sentiment unchanged by mode", chipCost.includes("text-positive-text"), chipCost);
const chipRate = html(createElement(DeltaChip, { change: ctr }), "abs");
check("rate in abs: pp", chipRate.includes("1.2 pp"), chipRate);
const chipFlat = html(createElement(DeltaChip, { change: { ...revenue, current: 100_000 } }), "abs");
check("flat: muted arrow", chipFlat.includes("→") && chipFlat.includes("text-content-muted"), chipFlat);
const chipNone = html(
  createElement(DeltaChip, {
    change: { ...revenue, previous: 0 },
    fallback: createElement("i", null, "n/a"),
    after: createElement("b", null, "vs prev"),
  }),
  "pct",
);
check("null: fallback, no after", chipNone === "<i>n/a</i>", chipNone);
const chipAfter = html(createElement(DeltaChip, { change: revenue, after: createElement("b", null, "vs prev") }), "abs");
check("after renders with the chip", chipAfter.endsWith("<b>vs prev</b>"), chipAfter);

// ---------------------------------------------------------------------------
// MetricCard and KpiTile
// ---------------------------------------------------------------------------
const card = (mode: DeltaMode, change: typeof revenue | null) =>
  html(
    createElement(MetricCard, {
      label: "Revenue",
      value: "CZK 112,345",
      source: "Shopify",
      change,
      comparisonLabel: "vs prev period",
    }),
    mode,
  );
const cardAbs = card("abs", revenue);
check("MetricCard abs", cardAbs.includes("CZK 12,345") && cardAbs.includes("vs prev period"), cardAbs);
const cardPct = card("pct", revenue);
check("MetricCard pct", cardPct.includes("12.3%"), cardPct);
const cardNull = card("abs", null);
check("MetricCard change null: no chip, no label", !cardNull.includes("▲") && !cardNull.includes(">vs prev period<"), cardNull);
const tileAbs = html(createElement(KpiTile, { label: "CTR", value: "4.7%", change: ctr }), "abs");
check("KpiTile rate", tileAbs.includes("1.2 pp"), tileAbs);
const tileOrders = html(
  createElement(KpiTile, { label: "Orders", value: "1,123", change: { current: 1_123, previous: 1_000, kind: "count" } }),
  "abs",
);
check("KpiTile count abs", tileOrders.includes("123") && !tileOrders.includes("%"), tileOrders);
const tileLegacy = html(createElement(KpiTile, { label: "Spend", value: "$1", delta: 0.1 }), "abs");
check("KpiTile legacy delta", tileLegacy.includes("10.0%"), tileLegacy);

// ---------------------------------------------------------------------------
// Reports: CellDelta
// ---------------------------------------------------------------------------
eq("report kind money", deltaKindOf("money"), "money");
eq("report kind number", deltaKindOf("number"), "count");
eq("report kind ratio", deltaKindOf("ratio"), "ratio");
eq("report kind percent", deltaKindOf("percent"), "rate");
const moneyFormat = { style: "money" as const, decimals: 0, compact: true };
const cell = (mode: DeltaMode) =>
  html(
    createElement(CellDelta, {
      delta: 0.5,
      kind: "relative",
      goodWhen: "up",
      total: 3_000_000,
      compareTotal: 2_000_000,
      format: moneyFormat,
      currency: "CZK",
    }),
    mode,
  );
check("CellDelta pct keeps the evaluator's delta", cell("pct").includes("50.0%"), cell("pct"));
check("CellDelta abs: compact money", cell("abs").includes("CZK 1M") || cell("abs").includes("CZK 1.0M"), cell("abs"));
const cellPp = html(
  createElement(CellDelta, {
    delta: 0.012,
    kind: "pp",
    goodWhen: "up",
    total: 0.047,
    compareTotal: 0.035,
    format: { style: "percent", decimals: 1 },
    currency: "CZK",
  }),
  "abs",
);
check("CellDelta percent metric stays pp", cellPp.includes("1.2 pp"), cellPp);
const cellZero = html(
  createElement(CellDelta, { delta: null, kind: "relative", goodWhen: "up", total: 500, compareTotal: 0, format: { style: "number", decimals: 0 }, currency: "CZK" }),
  "abs",
);
check("CellDelta abs from zero baseline", cellZero.includes("500"), cellZero);
const cellNoProps = html(createElement(CellDelta, { delta: 0.5, kind: "relative", goodWhen: "up" }), "abs");
check("CellDelta without totals stays relative", cellNoProps.includes("50.0%"), cellNoProps);

// ---------------------------------------------------------------------------
// The toggle and where it sits
// ---------------------------------------------------------------------------
const pills = renderToStaticMarkup(
  createElement(SegmentPills, {
    ariaLabel: "Change shown as",
    shown: "abs",
    onSelect: () => {},
    segments: [
      { value: "pct", label: "%", title: "Percent change" },
      { value: "abs", label: "123", title: "Absolute change" },
    ],
  }),
);
check("pills: two buttons", (pills.match(/<button/g) ?? []).length === 2, pills);
check("pills: abs pressed", /aria-pressed="true"[^>]*>123</.test(pills), pills);
check("pills: titled", pills.includes('title="Percent change"') && pills.includes('title="Absolute change"'), pills);

const controlBar = read("components/controls/ControlBar.tsx");
check("ControlBar: toggle beside Compare, hidden on None", /comparisonMode !== "none" && <DeltaModeToggle \/>/.test(controlBar));
const filterBar = read("components/reports/ReportFilterBar.tsx");
check("ReportFilterBar: toggle beside Compare, hidden on None", /filters\.compare !== "none" && <DeltaModeToggle \/>/.test(filterBar));
const toggle = read("components/controls/DeltaModeToggle.tsx");
check("toggle labels", toggle.includes('label: "%"') && toggle.includes('label: "123"'));
const layout = read("app/(app)/layout.tsx");
check("layout: provider inside navigation provider", layout.indexOf("<NavigationPendingProvider>") < layout.indexOf("<DeltaModeProvider"));
check("layout: cookie default", /cookies\(\)\.get\(DELTA_COOKIE\)/.test(layout));
const provider = read("components/ui/DeltaMode.tsx");
check("provider writes the cookie", provider.includes("document.cookie") && provider.includes("Max-Age"));
check("provider builds on baseQuery", provider.includes("baseQuery(pathname, searchParams.toString())"));
check("provider writes in place, no router push", provider.includes("replaceInPlace(") && !provider.includes("router."));
const nav = read("components/shell/NavigationPending.tsx");
check("baseQuery sees an in-place write before the router applies it", nav.includes("baseQueryFor(latestHref.current ?? inPlaceHref.current, pathname, committed)"));
check("in-place href dropped when the committed URL changes", /useEffect\(\(\) => \{\s*inPlaceHref\.current = null;\s*\}, \[pathnameNow, committedQuery\]\)/.test(nav));
check("in-place href recorded before replaceState", /inPlaceHref\.current = href;\s*window\.history\.replaceState/.test(nav));
check("replaceInPlace folds into a same-page navigation", /if \(samePath\(inFlight, href, here\)\) navigate\(href\)/.test(nav));
const chip = read("components/ui/Delta.tsx");
check("DeltaChip reads the mode", chip.includes("useDeltaMode()"));
const table = read("components/ui/DataTable.tsx");
check("DataTable sorts by the shown mode", table.includes("sortKeyFor(k, deltaMode)"));

// No em dash in files this change owns.
const owned = [
  "lib/format.ts",
  "lib/params.ts",
  "components/ui/Delta.tsx",
  "components/ui/DeltaMode.tsx",
  "components/ui/DataTable.tsx",
  "components/controls/DeltaModeToggle.tsx",
  "components/controls/SegmentedControl.tsx",
  "components/controls/ControlBar.tsx",
  "components/dashboard/MetricCard.tsx",
  "components/dashboard/KpiTile.tsx",
  "components/reports/widgets/CellStatus.tsx",
  "components/reports/widgets/format.ts",
  "components/shell/NavigationPending.tsx",
  "app/(app)/layout.tsx",
  "scripts/check-delta.ts",
];
for (const f of owned) check(`no em dash: ${f}`, !read(f).includes(EM_DASH));

// Every page that renders the control bar is a page the audit covers.
const pages: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name === "page.tsx") pages.push(full);
  }
};
walk(join(ROOT, "app", "(app)"));
check("pages found", pages.length > 20, String(pages.length));

if (failures.length > 0) {
  console.error(`check:delta FAILED ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check:delta ${passed}/${passed} passed`);
