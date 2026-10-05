/**
 * Asserts CMP-A (Shop and P&L) on top of the delta display mode: Snapshot,
 * Products, Unit economics and Growth show every change through `change`, so
 * the chips follow the % | 123 toggle, margins and shares read in points, and
 * the paid spend gap rule holds in both modes.
 *
 *     tsx --tsconfig scripts/tsconfig.json scripts/check-delta-shop.ts
 *
 * Pure modules and static renders only: no BigQuery, no router.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeltaMode } from "@/lib/format";
import { DeltaModeStatic } from "@/components/ui/DeltaMode";
import {
  aggregate,
  metricChange,
  paidSpendChange,
  paidSpendDelta,
  type PnlDay,
  type PnlSnapshot,
} from "@/lib/queries/pnl";
import { AcquisitionEconomics } from "@/components/dashboard/AcquisitionEconomics";
import { MarginStack } from "@/components/dashboard/MarginStack";
import { YearOverYear } from "@/components/dashboard/YearOverYear";
import { getGrowth } from "@/lib/queries/growth";
import { DEMO_CLIENT_ID } from "@/lib/demo/client";
import type { YoYSummary } from "@/lib/queries/yoy";

const ROOT = join(__dirname, "..");
const EM_DASH = String.fromCharCode(0x2014);
const MINUS = "−";
const NBSP = new RegExp(String.fromCharCode(0xa0), "g");
let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

// InfoTip uses a layout effect; on the server React says so once per render. Not ours to assert.
const warn = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
  warn(...args);
};
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const html = (el: ReactElement, mode: DeltaMode) =>
  renderToStaticMarkup(createElement(DeltaModeStatic, { mode, children: el })).replace(NBSP, " ");
const has = (h: string, needle: string) => h.includes(needle);

// ── Fixture: a snapshot with a comparison period ──────────────────────────
function day(date: string, o: Partial<PnlDay> = {}): PnlDay {
  return {
    date, currency: "CZK", revenue: 1000, netSales: 900, grossRevenueInclTax: 1000, shippingRevenue: 0,
    taxCollected: 0, newCustomerRevenue: 400, returningCustomerRevenue: 600, cogs: 400, cm1: 600, cm2: 600,
    cm3: 500, metaSpend: 100, googleSpend: null, paidSpend: 100, orders: 10,
    uniqueCustomers: 8, newCustomerOrders: 4, returningCustomerOrders: 6, fulfilmentCost: null, otherCm1Cost: null,
    ...o,
  };
}
const cur = { from: "2026-10-05", to: "2026-10-06" };
const prevR = { from: "2026-10-03", to: "2026-10-04" };
// Current, 2 days: revenue 2000, CM3 1000, spend 200 (10 % of revenue), MER 10, aMER 4, CAC 25, AOV 90, new orders 8, returning 12.
// Previous, 2 days: revenue 800, CM3 200, spend 160 (20 %), MER 5, aMER 1.25, CAC 80, AOV 75, new orders 2, returning 6.
const prevDay = (date: string, o: Partial<PnlDay> = {}) =>
  day(date, {
    revenue: 400, netSales: 300, newCustomerRevenue: 100, cm3: 100, cm1: 200, cm2: 200, cogs: 200,
    paidSpend: 80, metaSpend: 80, orders: 4, newCustomerOrders: 1, returningCustomerOrders: 3, ...o,
  });
const curRows = [day("2026-10-05"), day("2026-10-06")];
const prevRows = [prevDay("2026-10-03"), prevDay("2026-10-04")];
const snap: PnlSnapshot = {
  period: {} as PnlSnapshot["period"],
  currency: "CZK",
  current: aggregate(curRows, { range: cur, paidCapable: true }),
  previous: aggregate(prevRows, { range: prevR, paidCapable: true }),
  series: curRows,
};
const noCompare: PnlSnapshot = { ...snap, previous: null };
/** The text of every change chip in a render, in document order: arrow plus magnitude. */
const chipTexts = (h: string): string[] =>
  [...h.matchAll(/<span aria-hidden="true" class="text-\[9px\]">(.)<\/span>([^<]*)</g)].map((m) => m[1] + m[2]);

// ── metricChange / paidSpendChange ────────────────────────────────────────
{
  const rev = metricChange(snap, (x) => x.revenue, "money");
  check("metricChange money carries both values and the display currency",
    rev?.current === 2000 && rev?.previous === 800 && rev?.kind === "money" && rev?.currency === "CZK");
  const mer = metricChange(snap, (x) => x.mer, "ratio");
  check("metricChange ratio has no currency", mer?.kind === "ratio" && mer?.currency === undefined);
  check("metricChange is null without a comparison", metricChange(noCompare, (x) => x.revenue, "money") === null);
  const usd: PnlSnapshot = { ...snap, currency: "USD" };
  check("metricChange follows the snapshot currency (rollup)", metricChange(usd, (x) => x.revenue, "money")?.currency === "USD");

  const spend = paidSpendChange(snap);
  check("paidSpendChange: money, both values", spend?.kind === "money" && spend?.current === 200 && spend?.previous === 160);
  check("paidSpendDelta unchanged (relative, legacy accessor)", Math.abs((paidSpendDelta(snap) ?? 0) - 0.25) < 1e-9);

  // Gap rule: current starts before spend, then comparison starts before spend.
  const gapCur = aggregate([day("2026-10-05", { paidSpend: null, metaSpend: null }), day("2026-10-06")], { range: cur, paidCapable: true });
  const gapPrev = aggregate([prevDay("2026-10-03", { paidSpend: null, metaSpend: null }), prevDay("2026-10-04")], { range: prevR, paidCapable: true });
  check("fixture: current gap detected", gapCur.leadingSpendGap === true);
  check("paidSpendChange withheld under a current gap", paidSpendChange({ ...snap, current: gapCur }) === null);
  check("paidSpendChange withheld under a comparison gap", paidSpendChange({ ...snap, previous: gapPrev }) === null);
  check("paidSpendChange withheld exactly when paidSpendDelta is",
    (paidSpendChange({ ...snap, previous: gapPrev }) === null) === (paidSpendDelta({ ...snap, previous: gapPrev }) === null));
}

// ── Acquisition economics: both modes ─────────────────────────────────────
{
  const el = () => createElement(AcquisitionEconomics, { snapshot: snap, comparisonLabel: "vs prev period" });
  // Card order: MER, aMER, CAC, Ad spend share, AOV (net), then order mix new and returning.
  eq("acq pct chips", chipTexts(html(el(), "pct")), ["\u25b2100.0%", "\u25b2220.0%", "\u25bc68.8%", "\u25bc10.0 pp", "\u25b220.0%", "\u25b2300.0%", "\u25b2100.0%"]);
  eq("acq abs chips", chipTexts(html(el(), "abs")), ["\u25b25.00\u00d7", "\u25b22.75\u00d7", "\u25bcCZK 55.00", "\u25bc10.0 pp", "\u25b2CZK 15.00", "\u25b26", "\u25b26"]);
  check("acq: order mix still labels the comparison", has(html(el(), "pct"), "vs prev period") && has(html(el(), "abs"), "vs prev period"));
  const none = html(createElement(AcquisitionEconomics, { snapshot: noCompare, comparisonLabel: "vs prev period" }), "abs");
  eq("acq: no comparison, no chips", chipTexts(none), []);
  check("acq: no comparison, no label", !has(none, "vs prev period"));
  // Gap: ratios over spend show "Missing days" and no chip, in both modes.
  const gapCur = aggregate([day("2026-10-05", { paidSpend: null, metaSpend: null }), day("2026-10-06")], { range: cur, paidCapable: true });
  const gap = { ...snap, current: gapCur };
  for (const mode of ["pct", "abs"] as const) {
    const h = html(createElement(AcquisitionEconomics, { snapshot: gap }), mode);
    check(`acq gap ${mode}: four ratio cards say Missing days`, (h.match(/Missing days/g) ?? []).length === 4);
    eq(`acq gap ${mode}: only AOV and the order mix keep chips`, chipTexts(h).length, 3);
  }
}

// ── Margin stack: both modes, spend gap ───────────────────────────────────
{
  const el = (snapshot: PnlSnapshot) => createElement(MarginStack, { snapshot });
  // Steps with a chip, in order: Revenue, COGS, CM1, CM2, Paid spend, CM3.
  eq("stack pct chips", chipTexts(html(el(snap), "pct")), ["\u25b2150.0%", "\u25b2100.0%", "\u25b2200.0%", "\u25b2200.0%", "\u25b225.0%", "\u25b2400.0%"]);
  eq("stack abs chips", chipTexts(html(el(snap), "abs")), ["\u25b2CZK 1,200", "\u25b2CZK 400", "\u25b2CZK 800", "\u25b2CZK 800", "\u25b2CZK 40.00", "\u25b2CZK 800"]);
  const gapPrev = aggregate([prevDay("2026-10-03", { paidSpend: null, metaSpend: null }), prevDay("2026-10-04")], { range: prevR, paidCapable: true });
  const gapSnap = { ...snap, previous: gapPrev };
  for (const mode of ["pct", "abs"] as const) {
    eq(`stack gap ${mode}: the paid spend chip is withheld (5 of 6)`, chipTexts(html(el(gapSnap), mode)).length, 5);
  }
  eq("stack: no comparison, no chips", chipTexts(html(el(noCompare), "abs")), []);
}

// ── Year over year ────────────────────────────────────────────────────────
{
  const data: YoYSummary = {
    years: [
      { year: 2026, revenue: 700, cm3: 100, monthsWithData: 7, isCurrent: true, isComplete: false, cappedRevenue: 600, cappedYoY: 0.2, cappedPrevious: 500 },
      { year: 2025, revenue: 1200, cm3: 200, monthsWithData: 12, isCurrent: false, isComplete: true, cappedRevenue: 500, cappedYoY: null, cappedPrevious: null },
    ],
    cappedThroughMonth: 6,
    currentYear: 2026,
    projection: null,
    projectionBlockedBy: "No projection.",
  };
  const pct = html(createElement(YearOverYear, { data, currency: "CZK" }), "pct");
  const abs = html(createElement(YearOverYear, { data, currency: "CZK" }), "abs");
  check("yoy pct: +20.0%", has(pct, "20.0%"));
  check("yoy abs: +CZK 100, not a percent", has(abs, "CZK 100") && !has(abs, "20.0%"));
  check("yoy: first year keeps the muted n/a with its title", has(pct, "No prior year data") && has(abs, "No prior year data"));
  const down = { ...data, years: [{ ...data.years[0], cappedRevenue: 400, cappedPrevious: 500, cappedYoY: -0.2 }, data.years[1]] };
  eq("yoy abs: decline chip", chipTexts(html(createElement(YearOverYear, { data: down, currency: "CZK" }), "abs")), ["\u25bcCZK 100"]);
  eq("yoy pct chip", chipTexts(pct), ["\u25b220.0%"]);
  eq("yoy abs chip", chipTexts(abs), ["\u25b2CZK 100"]);
}

// ── Growth data: previous-month figures ───────────────────────────────────
async function growthChecks(): Promise<void> {
  const g = await getGrowth(DEMO_CLIENT_ID, "USD", 6);
  const months = g.months;
  check("growth demo: months returned newest first", months.length > 2 && months[0].monthStart > months[1].monthStart);
  const mid = months[1];
  check("growth: previous month figures come from the month before",
    mid.previousRevenue === months[2].revenue && mid.previousNewCustomerOrders === months[2].newCustomerOrders);
  const oldest = months[months.length - 1];
  check("growth: the oldest shown month has its predecessor (helper month read, then dropped)", oldest.previousRevenue !== null);
  check("growth: demo window unchanged in size (monthsBack rows)", months.length === 6, String(months.length));
  const matches = months.every((m) =>
    m.revenueMoM === null || m.previousRevenue === null || Math.abs((m.revenue! - m.previousRevenue) / m.previousRevenue - m.revenueMoM) < 1e-9);
  check("growth: previous revenue reproduces the mart's MoM", matches);
}

// ── Source pins ───────────────────────────────────────────────────────────
function pins(): void {
  const snapshotPage = read("app/(app)/snapshot/page.tsx");
  check("snapshot: four cards use change", (snapshotPage.match(/change=\{/g) ?? []).length === 4);
  check("snapshot: CM3 % is a rate", /x\.cm3Pct, "rate"/.test(snapshotPage));
  check("snapshot: paid spend through paidSpendChange", snapshotPage.includes("paidSpendChange"));
  check("snapshot: no legacy delta prop left", !/\bdelta=\{/.test(snapshotPage));

  const acq = read("components/dashboard/AcquisitionEconomics.tsx");
  check("acq: ad spend share is a rate, MER and aMER ratios, CAC money",
    /x\.mer, "ratio"/.test(acq) && /x\.amer, "ratio"/.test(acq) && /x\.cac, "money"/.test(acq) && /"rate"\s*\)/.test(acq));
  check("acq: no legacy delta", !/\bdelta=\{/.test(acq) && !/<DeltaChip delta=/.test(acq));
  const stack = read("components/dashboard/MarginStack.tsx");
  check("stack: no legacy delta", !/delta=\{/.test(stack) && !/\.delta\b/.test(stack));

  const products = read("app/(app)/products/page.tsx");
  check("products: margin % is a rate", /marginPct, "rate"/.test(products));
  check("products: revenue and margin are money, products count", /t\.revenue, "money"/.test(products) && /t\.margin, "money"/.test(products) && /t\.count, "count"/.test(products));
  check("products: no legacy delta prop", !/\bdelta=\{/.test(products));

  const ue = read("app/(app)/unit-economics/page.tsx");
  const rateRows = ["Discount rate", "Return rate", "COGS %", "Gross profit %", "Contribution margin %"];
  check("unit economics: every % row is a rate",
    rateRows.every((l) => new RegExp(`label: "${l}",\\s+(info: [^\\n]+\\n\\s+)?(value: [^\\n]+\\n\\s+format: [^\\n]+\\n\\s+goodWhen: [^\\n]+\\n\\s+)?delta: "rate"`).test(ue)));
  check("unit economics: money rows carry the client currency", /currency: row\.delta === "money" \? client\.currency/.test(ue));
  check("unit economics: no legacy delta call", !/\bdelta\(now/.test(ue) && !/<DeltaChip delta=/.test(ue));

  const growth = read("app/(app)/growth/page.tsx");
  check("growth: the toggle sits right after its own Compare control", /ariaLabel="Growth comparison"[\s\S]*?\/>\s*\{\/\*[^]*?\*\/\}\s*<DeltaModeToggle \/>/.test(growth));
  check("growth: MoM columns sort by deltaSortKey", (growth.match(/deltaSortKey\(/g) ?? []).length === 2);
  check("growth: partial month stays n/a", /m\.isPartial \? \(\s*<NoValue \/>/.test(growth));
  check("growth: no legacy delta prop", !/<DeltaChip delta=/.test(growth));
  const yoyView = read("components/dashboard/YearOverYear.tsx");
  check("yoy view: no legacy delta prop", !/<DeltaChip delta=/.test(yoyView));

  for (const f of [
    "app/(app)/snapshot/page.tsx", "app/(app)/products/page.tsx", "app/(app)/unit-economics/page.tsx", "app/(app)/growth/page.tsx",
    "components/dashboard/AcquisitionEconomics.tsx", "components/dashboard/MarginStack.tsx", "components/dashboard/YearOverYear.tsx",
    "lib/queries/growth.ts", "lib/queries/yoy.ts", "lib/queries/pnl.ts", "scripts/check-delta-shop.ts",
  ]) {
    check(`no em dash in ${f}`, !read(f).includes(EM_DASH));
  }
  check("minus sign constant is U+2212", MINUS === "−");
}

void (async () => {
  pins();
  await growthChecks();
  console.log(`check-delta-shop: ${passed}/${passed + failures.length} checks passed`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`);
    process.exit(1);
  }
})();
