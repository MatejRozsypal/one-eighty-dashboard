/**
 * The control bar's period and comparison: the URL contract and the menus.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-period.ts
 *
 * Pure modules and source pins. Old links must keep reading the same ranges;
 * "Today" is the one preset the URL now accepts that it used to drop.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDays,
  comparisonRange,
  includesToday,
  presetRange,
  todayUtc,
  type DateRange,
  type PresetKey,
} from "@/lib/period";
import { parseViewParams, viewQuery, type SearchParams } from "@/lib/params";
import { formatRange } from "@/components/controls/rangeText";

const ROOT = join(__dirname, "..");
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const j = (v: unknown) => JSON.stringify(v);
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, j(actual) === j(expected), `got ${j(actual)}, want ${j(expected)}`);
}
const r = (from: string, to: string): DateRange => ({ from, to });
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const parse = (q: SearchParams, def?: PresetKey) => parseViewParams(q, def);

const today = todayUtc();
const yesterday = addDays(today, -1);
const OLD: PresetKey[] = ["7d", "28d", "30d", "90d", "mtd", "ytd", "12m", "all"];

// ── Old links ───────────────────────────────────────────────────────────────
for (const key of OLD) {
  const p = parse({ preset: key });
  check(`preset=${key}: same key and range`, p.presetKey === key && j(p.range) === j(presetRange(key)), j(p.range));
}
for (const mode of ["previous_period", "previous_year", "none"] as const) {
  const p = parse({ preset: "30d", compare: mode });
  check(`compare=${mode}`, p.comparisonMode === mode && j(p.period.comparison) === j(comparisonRange(p.range, mode)));
}
{
  const p = parse({ preset: "30d" });
  eq("previous period: the same days right before", p.period.comparison, r(addDays(p.range.from, -30), addDays(p.range.from, -1)));
  const y = parse({ preset: "30d", compare: "previous_year" });
  eq("previous year: 364 days back", y.period.comparison, r(addDays(y.range.from, -364), addDays(y.range.to, -364)));
}
eq("unknown compare: previous period", parse({ compare: "previous_year_calendar" }).comparisonMode, "previous_period");
eq("custom compare is not a mode", parse({ compare: "custom", compare_from: "2026-01-01", compare_to: "2026-01-31" }).comparisonMode, "previous_period");
eq("no preset: 30 days", parse({}).presetKey, "30d");
eq("no preset: the page default", parse({}, "all").presetKey, "all");
eq("unknown preset: the default", parse({ preset: "last-1-month" }).presetKey, "30d");
{
  const p = parse({ preset: "custom", from: "2026-05-01", to: "2026-05-31" });
  check("custom range", p.presetKey === "custom" && j(p.range) === j(r("2026-05-01", "2026-05-31")), j(p));
  check("custom range survives viewQuery", viewQuery(p).includes("preset=custom&from=2026-05-01&to=2026-05-31"), viewQuery(p));
}
eq("custom range is clamped to yesterday", parse({ preset: "custom", from: "2026-01-01", to: "2999-01-01" }).range.to, yesterday);

// ── Today ───────────────────────────────────────────────────────────────────
{
  const p = parse({ preset: "today" });
  check("preset=today reads today", p.presetKey === "today" && p.range.from === today && p.range.to === today, j(p.range));
  check("today is flagged partial", includesToday(p.range));
  eq("today compares with yesterday", p.period.comparison, r(yesterday, yesterday));
  check("today survives viewQuery", viewQuery(p).includes("preset=today"));
}

// ── Pill text ───────────────────────────────────────────────────────────────
eq("format: one month", formatRange(r("2026-09-01", "2026-09-30")), `Sep 1${EN_DASH}30, 2026`);
eq("format: two months", formatRange(r("2026-08-02", "2026-09-30")), `Aug 2${EN_DASH}Sep 30, 2026`);
eq("format: two years", formatRange(r("2025-12-01", "2026-01-05")), `Dec 1, 2025${EN_DASH}Jan 5, 2026`);
eq("format: one day", formatRange(r("2026-09-30", "2026-09-30")), "Sep 30, 2026");

// ── Menus ───────────────────────────────────────────────────────────────────
const date = read("components/controls/DateRangeControl.tsx");
check(
  "period menu: the original presets in order",
  date.includes('["today"],\n  ["7d", "28d", "30d", "90d"],\n  ["mtd", "ytd"],\n  ["12m", "all"],')
);
check("period menu: Today only where asked", date.includes('withToday || k !== "today"'));
check("control bar asks for Today", read("components/controls/ControlBar.tsx").includes("presetKey={presetKey} withToday"));
check("Reports does not", read("components/reports/ReportFilterBar.tsx").includes("<DateRangeControl range={range} presetKey={presetKey} />"));
const cmp = read("components/controls/ComparisonControl.tsx");
check(
  "comparison menu: the three modes",
  ["previous_period", "previous_year", "none"].every((m) => cmp.includes(`mode: "${m}"`)) &&
    (cmp.match(/\{ mode: "/g) ?? []).length === 3
);

for (const f of [
  "lib/params.ts",
  "components/controls/Pill.tsx",
  "components/controls/RangeCalendar.tsx",
  "components/controls/rangeText.ts",
  "components/controls/DateRangeControl.tsx",
  "components/controls/ComparisonControl.tsx",
  "components/controls/CurrencyControl.tsx",
  "components/controls/ControlBar.tsx",
  "components/controls/MarketFilter.tsx",
  "components/controls/SegmentedControl.tsx",
  "components/controls/DeltaModeToggle.tsx",
  "scripts/check-period.ts",
]) {
  const src = read(f);
  check(`no em dash: ${f}`, !src.includes(EM_DASH));
  check(`no literal en dash: ${f}`, !src.includes(EN_DASH));
}

if (failures.length) {
  console.error(`check-period: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-period: ${passed}/${passed} passed`);
