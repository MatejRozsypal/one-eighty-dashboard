/**
 * Report filter URL round trips (RS8).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-url.ts
 *
 * Pure checks, no warehouse. Pins lib/reports/url.ts: every valid filter set
 * survives write then read, serialising is idempotent, invalid params are
 * dropped and reported, and params that are not filters are preserved.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  diffFilters,
  encodeFilters,
  filterParamsToString,
  FILTER_PARAMS,
  filtersEqual,
  normalizeOverrides,
  parseFilterParams,
  patchFilterParams,
  withOverrides,
  writeFilterParams,
  type FilterOverrides,
} from "@/lib/reports/url";
import { DEFAULT_REPORT_FILTERS, ReportFilters, REPORT_CURRENCIES, REPORT_PRESETS, COMPARE_MODES } from "@/lib/reports/types";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}

function roundTrip(name: string, o: FilterOverrides): void {
  const qs = filterParamsToString(o);
  const back = parseFilterParams(qs);
  check(`${name}: nothing ignored`, back.ignored.length === 0, JSON.stringify(back.ignored));
  check(`${name}: reads back`, JSON.stringify(back.overrides) === JSON.stringify(normalizeOverrides(o)), `${qs} -> ${JSON.stringify(back.overrides)}`);
  check(`${name}: serialising is idempotent`, filterParamsToString(back.overrides) === qs, qs);
  check(`${name}: URLSearchParams source agrees`, JSON.stringify(parseFilterParams(new URLSearchParams(qs)).overrides) === JSON.stringify(back.overrides));
  check(`${name}: record source agrees`, JSON.stringify(parseFilterParams(Object.fromEntries(new URLSearchParams(qs))).overrides) === JSON.stringify(back.overrides));
}

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

roundTrip("empty", {});
roundTrip("defaults as overrides", DEFAULT_REPORT_FILTERS);
roundTrip("clients all", { clients: { mode: "all" } });
roundTrip("clients list", { clients: { mode: "list", ids: ["alpha", "bravo_2", "c3"] } });
roundTrip("clients single", { clients: { mode: "list", ids: ["alpha"] } });
roundTrip("clients vertical", { clients: { mode: "vertical", verticals: ["pet_food", "beauty"] } });
roundTrip("custom period", { period: { kind: "custom", from: "2026-01-01", to: "2026-03-31" } });
roundTrip("custom single day", { period: { kind: "custom", from: "2026-02-28", to: "2026-02-28" } });
roundTrip("leap day", { period: { kind: "custom", from: "2024-02-29", to: "2024-03-01" } });
for (const preset of REPORT_PRESETS) roundTrip(`preset ${preset}`, { period: { kind: "preset", preset } });
for (const compare of COMPARE_MODES) roundTrip(`compare ${compare}`, { compare });
for (const currency of REPORT_CURRENCIES) roundTrip(`ccy ${currency}`, { currency });
roundTrip("bench on", { benchmark: true });
roundTrip("bench off", { benchmark: false });
roundTrip("everything", {
  clients: { mode: "vertical", verticals: ["pet_food"] },
  period: { kind: "custom", from: "2025-10-01", to: "2026-09-30" },
  compare: "previous_year",
  currency: "native",
  benchmark: true,
});

// Exhaustive cross product of the small enums.
{
  let n = 0;
  for (const preset of REPORT_PRESETS)
    for (const compare of COMPARE_MODES)
      for (const currency of REPORT_CURRENCIES)
        for (const benchmark of [true, false]) {
          const o: FilterOverrides = { period: { kind: "preset", preset }, compare, currency, benchmark };
          const back = parseFilterParams(filterParamsToString(o)).overrides;
          if (JSON.stringify(back) === JSON.stringify(o)) n += 1;
        }
  check("cross product round trips", n === REPORT_PRESETS.length * COMPARE_MODES.length * REPORT_CURRENCIES.length * 2, String(n));
}

// Every override that parses is a valid ReportFilters fragment.
{
  const parsed = parseFilterParams("clients=ids:a,b&preset=custom&from=2026-01-01&to=2026-02-01&compare=none&ccy=EUR&bench=1").overrides;
  check("parsed fragment completes to valid filters", ReportFilters.safeParse(withOverrides(DEFAULT_REPORT_FILTERS, parsed)).success);
}

// Duplicates are removed on the way out and in; the order of first sight stays.
{
  const o: FilterOverrides = { clients: { mode: "list", ids: ["a", "b", "a"] } };
  check("duplicate ids collapse", filterParamsToString(o) === "clients=ids:a,b", filterParamsToString(o));
  const back = parseFilterParams("clients=ids:b,a,b").overrides;
  check("duplicate ids collapse on read, order kept", JSON.stringify(back.clients) === JSON.stringify({ mode: "list", ids: ["b", "a"] }));
}

// ---------------------------------------------------------------------------
// Compatibility with the existing controls and hand-written links
// ---------------------------------------------------------------------------

{
  // DateRangeControl writes preset=custom&from&to; SegmentedControl writes compare=<value>.
  const r = parseFilterParams("preset=custom&from=2026-05-01&to=2026-05-31&compare=previous_year");
  check("date control custom range", JSON.stringify(r.overrides.period) === JSON.stringify({ kind: "custom", from: "2026-05-01", to: "2026-05-31" }) && r.overrides.compare === "previous_year");
  check("preset wins over stray from and to", JSON.stringify(parseFilterParams("preset=30d&from=2026-05-01&to=2026-05-31").overrides.period) === JSON.stringify({ kind: "preset", preset: "30d" }));
  check("from and to alone read as custom", parseFilterParams("from=2026-05-01&to=2026-05-31").overrides.period?.kind === "custom");
  check("bare client list reads as ids", JSON.stringify(parseFilterParams("clients=alpha,bravo").overrides.clients) === JSON.stringify({ mode: "list", ids: ["alpha", "bravo"] }));
  check("lower-case currency reads", parseFilterParams("ccy=czk").overrides.currency === "CZK");
  check("NATIVE reads", parseFilterParams("ccy=NATIVE").overrides.currency === "native");
  check("bench true and false words", parseFilterParams("bench=true").overrides.benchmark === true && parseFilterParams("bench=false").overrides.benchmark === false);
  check("leading question mark is fine", parseFilterParams("?compare=none").overrides.compare === "none");
  check("array values take the first", parseFilterParams({ compare: ["none", "previous_year"] }).overrides.compare === "none");
}

// ---------------------------------------------------------------------------
// Garbage in: dropped, reported, never thrown
// ---------------------------------------------------------------------------

const bad: Array<[string, string, string]> = [
  ["unknown client kind", "clients=team:alpha", "clients"],
  ["client id with a quote", "clients=ids:x'%20OR%201=1", "clients"],
  ["upper-case client id", "clients=ids:Alpha", "clients"],
  ["empty id list", "clients=ids:", "clients"],
  ["too many ids", `clients=ids:${Array.from({ length: 31 }, (_, i) => `c${i}`).join(",")}`, "clients"],
  ["too many verticals", `clients=vertical:${Array.from({ length: 11 }, (_, i) => `v${i}`).join(",")}`, "clients"],
  ["today preset", "preset=today", "period"],
  ["unknown preset", "preset=2w", "period"],
  ["custom without dates", "preset=custom", "period"],
  ["custom, one date", "preset=custom&from=2026-01-01", "period"],
  ["from after to", "preset=custom&from=2026-03-01&to=2026-01-01", "period"],
  ["impossible date", "preset=custom&from=2026-02-30&to=2026-03-01", "period"],
  ["malformed date", "preset=custom&from=2026-1-1&to=2026-01-31", "period"],
  ["unknown compare", "compare=yoy", "compare"],
  ["unknown currency", "ccy=GBP", "currency"],
  ["unknown bench", "bench=maybe", "benchmark"],
];
for (const [name, qs, key] of bad) {
  const r = parseFilterParams(qs);
  check(`rejects ${name}`, r.ignored.includes(key as never) && Object.keys(r.overrides).length === 0, `${qs} -> ${JSON.stringify(r)}`);
}
check("empty values count as absent", JSON.stringify(parseFilterParams("clients=&preset=&compare=&ccy=&bench=")) === JSON.stringify({ overrides: {}, ignored: [] }));
{
  const r = parseFilterParams("compare=none&ccy=GBP&bench=1");
  check("a bad param does not take good ones down", r.overrides.compare === "none" && r.overrides.benchmark === true && r.ignored.length === 1 && r.ignored[0] === "currency");
}

// ---------------------------------------------------------------------------
// Writing keeps other params, replaces filter params, is order independent
// ---------------------------------------------------------------------------

{
  const out = filterParamsToString({ compare: "none" }, "tab=2&compare=previous_year&clients=all&x=a%20b");
  check("keeps other params and replaces filters", out === "tab=2&x=a+b&compare=none", out);
  check("clearing all filters keeps others", filterParamsToString({}, "tab=2&compare=none&bench=1&preset=7d&from=2026-01-01") === "tab=2");
  check("filter params come out in a fixed order", Object.keys(encodeFilters({ benchmark: true, currency: "EUR", compare: "none", period: { kind: "custom", from: "2026-01-01", to: "2026-01-02" }, clients: { mode: "all" } })).join() === FILTER_PARAMS.join());
  const a = parseFilterParams("compare=none&bench=1&clients=all").overrides;
  const b = parseFilterParams("clients=all&bench=1&compare=none").overrides;
  check("param order does not matter", filtersEqual(a, b));
  check("writeFilterParams returns URLSearchParams", writeFilterParams({ benchmark: undefined }).toString() === "");
}

// Switching a custom range to a preset drops from and to.
{
  const out = patchFilterParams("preset=custom&from=2026-01-01&to=2026-01-31&tab=1", { period: { kind: "preset", preset: "28d" } });
  check("preset patch drops custom dates", out === "tab=1&preset=28d", out);
}
// Patching to the saved default removes the key; other keys stay.
{
  const out = patchFilterParams("compare=none&bench=1", { compare: "previous_period" }, DEFAULT_REPORT_FILTERS);
  check("patch to default removes the key", out === "bench=1", out);
  const keep = patchFilterParams("compare=none", { currency: "EUR" }, DEFAULT_REPORT_FILTERS);
  check("patch keeps untouched keys", keep === "compare=none&ccy=EUR", keep);
  const noDefaults = patchFilterParams("", { compare: "previous_period" });
  check("no defaults: value is written", noDefaults === "compare=previous_period", noDefaults);
  const periodSame = patchFilterParams("preset=7d", { period: { kind: "preset", preset: "90d" } }, DEFAULT_REPORT_FILTERS);
  check("period patch equal to default removes preset", periodSame === "", periodSame);
}

// diffFilters and withOverrides are inverses over a base.
{
  const target: ReportFilters = { ...DEFAULT_REPORT_FILTERS, compare: "none", benchmark: true };
  const diff = diffFilters(target, DEFAULT_REPORT_FILTERS);
  check("diff holds only changed keys", Object.keys(diff).sort().join() === "benchmark,compare", Object.keys(diff).join());
  check("withOverrides(diff) restores", JSON.stringify(withOverrides(DEFAULT_REPORT_FILTERS, diff)) === JSON.stringify(target));
  check("no diff, no params", filterParamsToString(diffFilters(DEFAULT_REPORT_FILTERS, DEFAULT_REPORT_FILTERS)) === "");
}

// ---------------------------------------------------------------------------
// House rule: no em dash or en dash in the files of this package
// ---------------------------------------------------------------------------

const DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
const OWNED = [
  "lib/reports/url.ts",
  "scripts/check-reports-url.ts",
  "components/reports/ReportFilterBar.tsx",
  "components/reports/pickers/MetricPicker.tsx",
  "components/reports/pickers/ClientPicker.tsx",
  "components/reports/pickers/WidgetTypePicker.tsx",
  "components/reports/pickers/WidgetConfigPanel.tsx",
];
for (const file of OWNED) {
  let text = "";
  try {
    text = readFileSync(join(process.cwd(), file), "utf8");
  } catch {
    check(`${file} exists`, false);
    continue;
  }
  check(`${file} has no em or en dash`, !DASHES.test(text));
  check(`${file} has no hex colour literal`, !/#[0-9a-fA-F]{6}\b/.test(text) && !/bg-\[#/.test(text));
}

if (failures.length > 0) {
  console.error(`check-reports-url: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`check-reports-url: ${passed}/${passed} passed`);
