/**
 * Markets page gates.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-markets.ts
 *
 * Pure checks, no warehouse, no server. Pins the rules the Markets page lives
 * by (SPEC sections 3, 4 and 7, CONTRACT UI section):
 *
 *   - totals add up, unallocated spend counts in the Total and in no market;
 *   - countries outside the sold set pool into Other and list in Scouting;
 *   - verdicts follow the rules on CM1 (Scale, Hold, Fix structure, Fix
 *     acquisition), Young markets get none, Directional ones keep theirs;
 *   - the forecast never reaches a total, the ranking or a verdict;
 *   - n/a carries a platform reason (Shoptet discounts, Woo COGS), never zero;
 *   - payback interpolates between cohort ages and says "not yet";
 *   - the nCAC map scale is inverted; LTGP:CAC is on a fixed 0..3 scale;
 *   - map outlines are framed and small, and an unknown country falls back;
 *   - the matrix renders with the forecast labelled and no em dash anywhere.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoMarkets } from "@/lib/demo/markets";
import {
  buildModel,
  cohortSummary,
  discountFlag,
  forecastSummary,
  isNa,
  mapStep,
  num,
  payback,
  periodMetrics,
  type MarketsModel,
} from "@/lib/markets/model";
import { buildMapGeometry } from "@/lib/markets/geo";
import type { CohortRow, MarketPeriodRaw } from "@/lib/markets/types";
import { PnlMatrix } from "@/components/markets/PnlMatrix";
import { Leaderboard } from "@/components/markets/Leaderboard";
import { pageAvailability } from "@/lib/capabilities";
import { NAV } from "@/lib/nav";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const close = (a: number | null, b: number | null, tol = 1e-6) => a !== null && b !== null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const RANGE = { from: "2026-07-16", to: "2026-10-13" };
const PREV = { from: "2026-04-17", to: "2026-07-15" };

const na = buildModel(demoMarkets("na", RANGE, PREV));
const eu = buildModel(demoMarkets("eu", RANGE, PREV));
const col = (m: MarketsModel, k: string) => m.markets.find((c) => c.key === k)!;

// ── Columns and totals ────────────────────────────────────────────────────
check("na sold columns", na.markets.map((c) => c.key).join() === "US,CA,OTHER", na.markets.map((c) => c.key).join());
check("na Other members", col(na, "OTHER").members.sort().join() === "CH,GB,IE,RS", col(na, "OTHER").members.join());
check("eu sold columns", eu.markets.map((c) => c.key).join() === "CZ,SK,PL,OTHER" || eu.markets.map((c) => c.key).join() === "CZ,SK,OTHER,PL" || eu.markets.slice(0, 3).map((c) => c.key).sort().join() === "CZ,PL,SK", eu.markets.map((c) => c.key).join());
for (const [name, m] of [["na", na], ["eu", eu]] as const) {
  const sumNet = m.markets.reduce((t, c) => t + (num(c.cur.netRevenue) ?? 0), 0);
  check(`${name} total net = sum of markets`, close(num(m.total.cur.netRevenue), sumNet));
  const sumSpend = m.markets.reduce((t, c) => t + (num(c.cur.spend) ?? 0), 0) + (m.unallocated ? num(m.unallocated.cur.spend) ?? 0 : 0);
  check(`${name} total spend includes unallocated`, close(num(m.total.cur.spend), sumSpend));
  check(`${name} unallocated column exists`, m.unallocated !== null && (num(m.unallocated.cur.spend) ?? 0) > 0);
  check(`${name} unallocated has no verdict`, m.unallocated?.verdict === null);
  const gpa = num(m.total.cur.gpAfterAds);
  const gpaParts = m.markets.reduce((t, c) => t + (num(c.cur.gpAfterAds) ?? 0), 0) - (m.unallocated ? num(m.unallocated.cur.spend) ?? 0 : 0);
  check(`${name} total GP after ads = markets minus unallocated spend`, close(gpa, gpaParts, 1e-4), `${gpa} vs ${gpaParts}`);
  check(`${name} total has no forecast or cohorts`, m.total.forecast === null && m.total.cohorts === null);
  check(`${name} ranking by GP after ads`, m.ranking.key === "gpAfterAds");
  const ranked = m.markets.filter((c) => c.kind === "sold").map((c) => num(c.cur.gpAfterAds) ?? -Infinity);
  check(`${name} ranking order`, ranked.every((v, i) => i === 0 || ranked[i - 1] >= v), ranked.join());
  check(`${name} share of client sums to 100%`, close(m.markets.reduce((t, c) => t + (num(c.cur.shareOfClient) ?? 0), 0), 1, 1e-9));
}

// ── Verdicts and maturity ─────────────────────────────────────────────────
check("US Scale", col(na, "US").verdict?.key === "scale", col(na, "US").verdict?.why);
check("US on CM1", col(na, "US").verdict?.onCm1 === true);
check("CA Fix structure", col(na, "CA").verdict?.key === "fix-structure", col(na, "CA").verdict?.why);
check("CA driver named", /Driver: COGS/.test(col(na, "CA").verdict?.why ?? ""));
check("Other Directional", col(na, "OTHER").maturity.level === "Directional");
check("CZ Hold", col(eu, "CZ").verdict?.key === "hold", col(eu, "CZ").verdict?.why);
check("SK Directional", col(eu, "SK").maturity.level === "Directional", col(eu, "SK").maturity.why);
check("SK keeps a verdict while Directional", col(eu, "SK").verdict?.key === "fix-acquisition", col(eu, "SK").verdict?.key);
check("PL Young", col(eu, "PL").maturity.level === "Young", col(eu, "PL").maturity.why);
check("PL Young has no verdict", col(eu, "PL").verdict?.key === "none");

// ── Forecast stays out ────────────────────────────────────────────────────
const us = col(na, "US");
check("US has a forecast", us.forecast?.value !== null && us.forecast?.value !== undefined);
check("US forecast band brackets it", !!us.forecast?.value && us.forecast.value.low <= us.forecast.value.forecast && us.forecast.value.forecast <= us.forecast.value.high);
check("SK small market: no forecast, with reason", col(eu, "SK").forecast?.value === null && /50 new customers/.test(col(eu, "SK").forecast?.reason ?? ""));
{
  // Inflate every forecast: nothing a verdict, a total or the ranking reads may move.
  const raw = demoMarkets("na", RANGE, PREV);
  const bumped = buildModel({ ...raw, forecast: raw.forecast.map((f) => ({ ...f, forecastGp365PerCustomer: f.forecastGp365PerCustomer === null ? null : f.forecastGp365PerCustomer * 50 })) });
  check("forecast does not change verdicts", bumped.markets.every((c, i) => c.verdict?.key === na.markets[i].verdict?.key));
  check("forecast does not change ranking", bumped.markets.map((c) => c.key).join() === na.markets.map((c) => c.key).join());
  check("forecast does not change LTGP:CAC 365 actual", close(num(col(bumped, "US").cohorts!.points[365]!.ltgpCac), num(us.cohorts!.points[365]!.ltgpCac)));
}

// ── n/a reasons by platform ───────────────────────────────────────────────
{
  const p: MarketPeriodRaw = {
    market: "CZ",
    sums: {
      orders: 100, newCustomers: 40, returningOrders: 60, grossSales: null, discounts: null, refunds: null,
      netSales: 90000, netRevenue: 100000, newCustomerRevenue: 40000, returningRevenue: 60000,
      newCustomerNetSales: 36000, returningNetSales: 54000, newCustomerGrossProfit: 24000, newCustomerCostedOrders: 40,
      costedNetSales: 80000, cogs: 30000,
      grossProfit: 60000, costedOrders: 100, discountedOrders: 5, codOrders: 20, zeroShippingOrders: null,
      shippingCharged: null, spend: 20000,
    },
    extras: null,
  };
  const m = periodMetrics(p, { platform: "shoptet", clientNetRevenue: 100000, days: 90 });
  check("shoptet discount rate n/a", isNa(m.discountRate) && /Shoptet/.test((m.discountRate as { na: string }).na));
  check("shoptet shipping n/a", isNa(m.shippingCharged) && /Shoptet/.test((m.shippingCharged as { na: string }).na));
  check("shoptet nCAC computed", close(num(m.nCac), 500));
  check("shoptet COD share", close(num(m.codShare), 0.2));
  check("AOV new on net sales (amendment)", close(num(m.aovNew), 900));
  check("first-order GP from daily columns (amendment)", close(num(m.firstOrderGp), 600));
  check("COGS % on costed net sales (amendment)", close(num(m.cogsPct), 30000 / 80000));
  const gap = periodMetrics(p, { platform: "shopify", clientNetRevenue: 100000, days: 90, spendGapDays: 12 });
  check("spend gap: nCAC n/a", isNa(gap.nCac) && /12 days/.test((gap.nCac as { na: string }).na));
  check("spend gap: MER and GP after ads n/a", isNa(gap.mer) && isNa(gap.gpAfterAds));
  check("spend gap: spend still shown, noted", !isNa(gap.spend) && /Partial/.test((gap.spend as { note?: string }).note ?? ""));
  const woo = periodMetrics({ ...p, sums: { ...p.sums, cogs: null, grossProfit: null, costedOrders: 0 } }, { platform: "woocommerce", clientNetRevenue: 100000, days: 90 });
  check("woo no COGS: GP n/a with F7", isNa(woo.grossProfit) && /F7/.test((woo.grossProfit as { na: string }).na));
  check("woo no COGS: GP after ads n/a, not spend", isNa(woo.gpAfterAds));
  const nospend = periodMetrics({ ...p, sums: { ...p.sums, spend: 0 } }, { platform: "shopify", clientNetRevenue: 100000, days: 90 });
  check("no spend: nCAC n/a, not 0", isNa(nospend.nCac));
  check("no spend: MER n/a, not infinite", isNa(nospend.mer));
}

// ── Contract amendments: costed customers, quarterly keys, none rows ───────
{
  const row = (market: string, month: string, customers: number, costed: number, gp365: number | null): CohortRow => ({
    market, cohortMonth: month, customers, costedCustomers: costed, repeatCustomers: { 365: gp365 === null ? null : 10 },
    revenue: { 365: gp365 === null ? null : 1000 }, gp: { 365: gp365 }, cohortSpend: 500, firstOrderGp: costed * 10,
  });
  const cs = cohortSummary([row("US", "2025-01-01", 100, 50, 5000)], { platform: "shopify", nCac: { v: 5 } });
  check("cohort GP per customer divides by costed customers", close(num(cs.points[365]!.gpPerCustomer), 100));
  check("cohort CAC divides by all customers", close(num(cs.points[365]!.cac), 5));
  check("first-order GP per customer over costed", close(num(cs.firstOrderGpPerCustomer), 10));
  const q = forecastSummary(
    [{ market: "CA", cohortMonth: "2026-01-01", customers: 90, asOfAgeDays: 180, actualGpPerCustomer: 110, forecastGp365PerCustomer: 140,
       bandLow: 130, bandHigh: 150, multiplier: 1.3, nReferenceCohorts: 8, method: "multiplier_quarterly", reasonIfNone: null, runDate: "2026-10-14" }],
    [row("CA", "2026-01-01", 40, 30, null), row("CA", "2026-02-01", 30, 30, null), row("CA", "2026-03-01", 30, 30, null)],
    "2026-10-14"
  );
  check("quarterly forecast reads its three months", q.value !== null && close(num(q.ltgpCac), 140 / (1500 / 100)), JSON.stringify(q.ltgpCac));
  const none = forecastSummary(
    [{ market: "CA", cohortMonth: "2026-07-01", customers: null, asOfAgeDays: 60, actualGpPerCustomer: null, forecastGp365PerCustomer: null,
       bandLow: null, bandHigh: null, multiplier: null, nReferenceCohorts: null, method: "none", reasonIfNone: "Before the market's start age (180 d)", runDate: "2026-10-14" }],
    [row("CA", "2026-07-01", 40, 40, null)],
    "2026-10-14"
  );
  check("none row shows its reason", none.value === null && /start age/.test(none.reason) && isNa(none.ltgpCac));
  check("demo UNALLOCATED allocation is none", Object.keys(demoMarkets("na", RANGE, PREV).allocation.UNALLOCATED ?? {}).join() === "none");
  check("demo eu quarterly forecast keyed by quarter", demoMarkets("eu", RANGE, PREV).forecast.filter((f) => f.method === "multiplier_quarterly").every((f) => ["01", "04", "07", "10"].includes(f.cohortMonth.slice(5, 7))));
  check("config decides the sold set", buildModel({ ...demoMarkets("na", RANGE, PREV), configuredMarkets: ["US"] }).markets.map((c) => c.key).join() === "US,OTHER");
}

// ── Payback and map scale ─────────────────────────────────────────────────
{
  const pts = {
    30: { age: 30 as const, customers: 1, months: 1, repeatRate: { v: 0 }, revenuePerCustomer: { v: 0 }, gpPerCustomer: { v: 60 }, cac: { v: 1 }, ltgpCac: { v: 1 } },
    90: { age: 90 as const, customers: 1, months: 1, repeatRate: { v: 0 }, revenuePerCustomer: { v: 0 }, gpPerCustomer: { v: 120 }, cac: { v: 1 }, ltgpCac: { v: 1 } },
  };
  const pb = payback(pts, { v: 40 }, { v: 90 });
  check("payback interpolates 30..90", "days" in pb && pb.days === 60, JSON.stringify(pb));
  const first = payback(pts, { v: 100 }, { v: 90 });
  check("payback on the first order", "days" in first && first.firstOrder);
  const notYet = payback(pts, { v: 10 }, { v: 500 });
  check("payback not yet", "notYet" in notYet && notYet.reachedAge === 90);
  check("payback n/a without nCAC", "na" in payback(pts, { v: 10 }, { na: "x" }));
}
check("nCAC scale inverted", mapStep("ncac", 40, [40, 90]) === 5 && mapStep("ncac", 90, [40, 90]) === 1);
check("GP scale", mapStep("gpa", 100, [100, 50]) === 5 && mapStep("gpa", -5, [100, -5]) === 0);
check("LTGP:CAC fixed 3x scale", mapStep("ltgp", 3, [1, 2]) === 5 && mapStep("ltgp", 1.5, [1.5]) === 3);

// ── Discount flag ─────────────────────────────────────────────────────────
const caFlag = discountFlag(col(na, "CA").cur, col(na, "CA").prev);
check("CA discount-addiction flag on", caFlag.state === "on", caFlag.text);
check("US no flag", discountFlag(us.cur, us.prev).state === "off");

// ── Map outlines ──────────────────────────────────────────────────────────
for (const focus of [["US", "CA"], ["CZ", "SK"], ["CZ", "SK", "PL", "DE", "AT", "HU"], ["US", "CA", "GB", "IE"]]) {
  const g = buildMapGeometry(focus, []);
  check(`outline ${focus.join("+")}`, g !== null && focus.every((iso) => g.labels[iso] !== undefined));
  check(`outline ${focus.join("+")} under 80 KB`, g !== null && JSON.stringify(g).length < 80_000, String(g && JSON.stringify(g).length));
}
check("unknown country falls back to tiles", buildMapGeometry(["XX"]) === null);
{
  const g = buildMapGeometry(["US", "CA"])!;
  const us0 = g.labels.US, ca0 = g.labels.CA;
  check("North America framing: CA above US", ca0[1] < us0[1]);
}

// ── Nav and capability ────────────────────────────────────────────────────
check("nav lists Markets with an icon", NAV.flatMap((g) => g.items).some((i) => i.href === "/markets" && i.icon === "markets"));
check("markets needs a shop", pageAvailability({ capabilities: { shopify: false, shoptet: false, woocommerce: false, klaviyo: false, ecomail: false, meta: true, googleAds: false, ga4: false, instagram: false } }, "/markets") === "not-connected");

// ── Render ────────────────────────────────────────────────────────────────
{
  // InfoTip measures in a layout effect; React warns about that on a server
  // render, which is all this is. Everything else still reaches the console.
  const error = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect")) return;
    error(...args);
  };
  const html = renderToStaticMarkup(createElement(PnlMatrix, { model: na, mode: "base", compareLabel: "vs prev period", periodLabel: "Jul 16 to Oct 13, 2026", onOpen: () => {} }));
  check("matrix renders markets", html.includes(">US<") && html.includes(">CA<") && html.includes("Total"));
  check("matrix labels the forecast", html.includes("forecast"));
  check("matrix shows n/a", html.includes("n/a"));
  check("matrix CM2 placeholder", html.includes("CM2"));
  const local = renderToStaticMarkup(createElement(PnlMatrix, { model: na, mode: "local", periodLabel: "x", onOpen: () => {} }));
  check("matrix local shows CAD", local.includes("CAD"));
  const lb = renderToStaticMarkup(createElement(Leaderboard, { model: eu, mode: "base", onOpen: () => {} }));
  check("leaderboard ranks", lb.includes("Ranked by GP after ads") && lb.includes("Czechia"));
  check("leaderboard shows Young", lb.includes("Young"));
}

// ── No em dash in any Markets source ──────────────────────────────────────
{
  const ROOT = join(__dirname, "..");
  const dirs = ["components/markets", "lib/markets", "app/(app)/markets"].map((d) => join(ROOT, d));
  const files = [...dirs.flatMap((d) => readdirSync(d).map((f) => join(d, f))), join(ROOT, "lib/demo/markets.ts"), join(ROOT, "lib/queries/markets.ts")].filter((f) => statSync(f).isFile());
  for (const f of files) check(`no em dash in ${f.slice(ROOT.length + 1)}`, !readFileSync(f, "utf8").includes("\u2014"));
}



console.log(`check:markets ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
