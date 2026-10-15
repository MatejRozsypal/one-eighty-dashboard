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
 *   - cost cards: CM2 / CM3 math, a card change inside the range, empty
 *     fields and missing cards are n/a with the reason, the Total needs every
 *     card, first-order GP after ads, verdicts and break-even move to CM2,
 *     the ranking moves to CM3 once every sold market has a card;
 *   - the forecast never reaches a total, the ranking or a verdict;
 *   - n/a carries a platform reason (Shoptet discounts, Woo COGS), never zero;
 *   - payback interpolates between cohort ages and says "not yet";
 *   - the nCAC map scale is inverted; LTGP:CAC is on a fixed 0..3 scale;
 *   - map outlines are framed and small, and an unknown country falls back;
 *   - the matrix renders with the forecast labelled and no em dash anywhere;
 *   - the opportunity index: weights, re-weighting over the signals that
 *     exist, the 2-signal minimum, log normalisation, CPM ratio, ties.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoMarkets } from "@/lib/demo/markets";
import {
  buildModel,
  cardOn,
  cohortSummary,
  marketCosts,
  NO_CARD,
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
import type { CohortRow, CostCard, MarketPeriodRaw } from "@/lib/markets/types";
import { PnlMatrix } from "@/components/markets/PnlMatrix";
import { Waterfall } from "@/components/markets/Waterfall";
import { cardToValues, checkCostCard, marketCostSummary, parseAmount } from "@/lib/markets/costCardForm";
import { ScoutingView } from "@/components/markets/ScoutingView";
import {
  candidateSignals,
  cpmRatio,
  logScale,
  opportunityIndex,
  ratioScale,
  type CandidateSignals,
} from "@/lib/markets/opportunity";
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
// The same demo before anybody fills a cost card: the CM1 rules.
const naCm1 = buildModel({ ...demoMarkets("na", RANGE, PREV), costCards: [] });
const euCm1 = buildModel({ ...demoMarkets("eu", RANGE, PREV), costCards: [] });
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
  check(`${name} ranking by CM3 with every card`, m.ranking.key === "cm3" && m.ranking.why === "", JSON.stringify(m.ranking));
  const ranked = m.markets.filter((c) => c.kind === "sold").map((c) => num(c.cur.cm3) ?? -Infinity);
  check(`${name} ranking order`, ranked.every((v, i) => i === 0 || ranked[i - 1] >= v), ranked.join());
  check(`${name} share of client sums to 100%`, close(m.markets.reduce((t, c) => t + (num(c.cur.shareOfClient) ?? 0), 0), 1, 1e-9));
}

for (const [name, m] of [["na", naCm1], ["eu", euCm1]] as const) {
  check(`${name} no cards: ranking by GP after ads`, m.ranking.key === "gpAfterAds" && m.ranking.why === "", JSON.stringify(m.ranking));
  const ranked = m.markets.filter((c) => c.kind === "sold").map((c) => num(c.cur.gpAfterAds) ?? -Infinity);
  check(`${name} no cards: ranking order`, ranked.every((v, i) => i === 0 || ranked[i - 1] >= v), ranked.join());
}

// ── Verdicts and maturity ─────────────────────────────────────────────────
// On CM1 (no cost cards): the rules as first built.
check("US Scale", col(naCm1, "US").verdict?.key === "scale", col(naCm1, "US").verdict?.why);
check("US on CM1", col(naCm1, "US").verdict?.onCm1 === true);
check("CA Fix structure", col(naCm1, "CA").verdict?.key === "fix-structure", col(naCm1, "CA").verdict?.why);
check("CA driver named", /Driver: COGS/.test(col(naCm1, "CA").verdict?.why ?? ""));
check("CZ Hold", col(euCm1, "CZ").verdict?.key === "hold", col(euCm1, "CZ").verdict?.why);
check("SK keeps a verdict while Directional", col(euCm1, "SK").verdict?.key === "fix-acquisition", col(euCm1, "SK").verdict?.key);
// On CM2 (demo cost cards): same verdicts, run on CM2 / CM3 and saying so.
check("US Scale on CM2", col(na, "US").verdict?.key === "scale" && col(na, "US").verdict?.onCm1 === false, JSON.stringify(col(na, "US").verdict));
check("US verdict reads CM3", /^CM3 above 0/.test(col(na, "US").verdict?.why ?? ""), col(na, "US").verdict?.why);
check("CA Fix structure on CM2 margin", col(na, "CA").verdict?.key === "fix-structure" && /^CM2 margin/.test(col(na, "CA").verdict?.why ?? ""), col(na, "CA").verdict?.why);
check("CA driver named", /Driver: COGS/.test(col(na, "CA").verdict?.why ?? ""));
check("Other Directional", col(na, "OTHER").maturity.level === "Directional");
check("CZ Hold", col(eu, "CZ").verdict?.key === "hold", col(eu, "CZ").verdict?.why);
check("SK Directional", col(eu, "SK").maturity.level === "Directional", col(eu, "SK").maturity.why);
check("SK keeps a verdict while Directional", col(eu, "SK").verdict?.key === "fix-acquisition", col(eu, "SK").verdict?.key);
check("PL Young", col(eu, "PL").maturity.level === "Young", col(eu, "PL").maturity.why);
check("PL Young has no verdict", col(eu, "PL").verdict?.key === "none");

// ── Cost cards: CM2 and CM3 ───────────────────────────────────────────────
{
  const card = (market: string, from: string, x: Partial<CostCard> = {}): CostCard => ({
    market, effectiveFrom: from, shipCostPerOrder: 50, payFeePct: 0.02, codFee: 20, returnCost: 100, fixedMonthly: 3000, ...x,
  });
  const p: MarketPeriodRaw = {
    market: "CZ",
    sums: {
      orders: 100, newCustomers: 40, returningOrders: 60, grossSales: null, discounts: null, refunds: null,
      netSales: 90000, netRevenue: 100000, newCustomerRevenue: 40000, returningRevenue: 60000,
      newCustomerNetSales: 36000, returningNetSales: 54000, newCustomerGrossProfit: 24000, newCustomerCostedOrders: 40,
      costedNetSales: 90000, cogs: 30000, grossProfit: 60000, costedOrders: 100, discountedOrders: 5, codOrders: 20,
      zeroShippingOrders: 10, shippingCharged: 3000, spend: 20000,
    },
    extras: null,
  };
  const range = { from: "2026-07-01", to: "2026-09-28" }; // 90 days
  const ctx = { platform: "woocommerce", clientNetRevenue: 100000, days: 90 };
  const costs = marketCosts([card("CZ", "2026-01-01")], p, range, "woocommerce");
  const m = periodMetrics(p, { ...ctx, costs });
  const fixed = 3000 * (12 / 365) * 90;
  // ship 50 x 100 = 5000 net of 3000 charged; fees 2% x 100000 + 20 x 20 COD.
  check("cost card: shipping net of charged", close(num(m.shippingCost), 5000 - 3000));
  check("cost card: payment fees incl. COD", close(num(m.paymentFees), 2000 + 400));
  check("cost card: CM2 = GP + charged - ship - fees - COD", close(num(m.cm2), 60000 + 3000 - 5000 - 2000 - 400));
  check("cost card: CM2 %", close(num(m.cm2Pct), 55600 / 100000));
  check("cost card: fixed monthly pro rata", close(num(m.fixedCost), fixed));
  check("cost card: CM3 = CM2 - spend - fixed", close(num(m.cm3), 55600 - 20000 - fixed));
  check("cost card: CM3 %", close(num(m.cm3Pct), (55600 - 20000 - fixed) / 100000));
  check("cost card: refunds not ingested is a note, not a zero", /return handling is not subtracted/.test((m.shippingCost as { note?: string }).note ?? ""));
  // Return cost x refunded orders once refunds are known.
  const withRefunds = periodMetrics({ ...p, costDays: [{ date: "2026-08-01", orders: 100, codOrders: 20, refundedOrders: 3, netRevenue: 100000 }] }, {
    ...ctx, costs: marketCosts([card("CZ", "2026-01-01")], { ...p, costDays: [{ date: "2026-08-01", orders: 100, codOrders: 20, refundedOrders: 3, netRevenue: 100000 }] }, range, "woocommerce"),
  });
  check("cost card: return cost x refunded orders", close(num(withRefunds.cm2), 55600 - 300));
  // Break-even aMER moves to CM2: first-order GP 600 minus the average cost per order.
  const perOrder = (5000 - 3000 + 400) / 100 + 0.02 * (40000 / 40);
  check("break-even on CM2", m.breakEvenBasis === "cm2" && close(num(m.breakEvenAmer), 900 / (600 - perOrder)), String(num(m.breakEvenAmer)));
  const noCard = periodMetrics(p, ctx);
  check("break-even falls back to CM1", noCard.breakEvenBasis === "cm1" && close(num(noCard.breakEvenAmer), 900 / 600));
  check("missing card: shipping n/a with Settings reason", isNa(noCard.shippingCost) && (noCard.shippingCost as { na: string }).na === NO_CARD);
  check("missing card: fees, CM2, CM3 n/a", isNa(noCard.paymentFees) && isNa(noCard.cm2) && isNa(noCard.cm3) && (noCard.cm2 as { na: string }).na === NO_CARD);
  check("missing card reason names Settings", NO_CARD === "No cost card for this market (Settings > Market costs)");
  // Empty required fields are n/a naming the field; optional ones are not.
  const emptyShip = marketCosts([card("CZ", "2026-01-01", { shipCostPerOrder: null })], p, range, "woocommerce");
  check("empty shipping cost: n/a naming it", "na" in emptyShip && /Shipping cost per order is empty/.test(emptyShip.na));
  const emptyCod = marketCosts([card("CZ", "2026-01-01", { codFee: null })], p, range, "woocommerce");
  check("empty COD fee with COD orders: n/a", "na" in emptyCod && /COD fee is empty/.test(emptyCod.na));
  const noCodOrders = marketCosts([card("CZ", "2026-01-01", { codFee: null })], { ...p, sums: { ...p.sums, codOrders: 0 } }, range, "woocommerce");
  check("empty COD fee without COD orders: fine", !("na" in noCodOrders));
  const noFixed = periodMetrics(p, { ...ctx, costs: marketCosts([card("CZ", "2026-01-01", { fixedMonthly: null })], p, range, "woocommerce") });
  check("empty fixed cost is none", close(num(noFixed.fixedCost), 0) && close(num(noFixed.cm3), 55600 - 20000));
  // CM2 needs gross profit: no COGS stays the COGS reason, not the card's.
  const woo = periodMetrics({ ...p, sums: { ...p.sums, cogs: null, grossProfit: null, costedOrders: 0 } }, { ...ctx, costs });
  check("no COGS: CM2 n/a with the COGS reason", isNa(woo.cm2) && /F7/.test((woo.cm2 as { na: string }).na));
  // A card change inside the range: each day on the card in effect that day.
  const days = [
    { date: "2026-08-30", orders: 10, codOrders: 0, refundedOrders: 0, netRevenue: 10000 },
    { date: "2026-09-02", orders: 10, codOrders: 0, refundedOrders: 0, netRevenue: 10000 },
  ];
  const hist = [card("CZ", "2026-01-01", { shipCostPerOrder: 50, fixedMonthly: null }), card("CZ", "2026-09-01", { shipCostPerOrder: 80, fixedMonthly: null })];
  const split = marketCosts(hist, { ...p, costDays: days, sums: { ...p.sums, shippingCharged: 0 } }, range, "woocommerce");
  check("card history: day by day", !("na" in split) && close(split.shipCost, 10 * 50 + 10 * 80), JSON.stringify(split));
  check("card in effect: latest started", cardOn(hist, "2026-09-15")?.shipCostPerOrder === 80 && cardOn(hist, "2026-08-31")?.shipCostPerOrder === 50);
  check("card before the first: the first applies", cardOn(hist, "2025-06-01")?.shipCostPerOrder === 50);
  // First-order GP after ads: first-order GP of all new customers minus spend.
  check("first-order GP after ads", close(num(m.firstOrderGpAfterAds), 600 * 40 - 20000));
  check("first-order GP after ads = per-customer row x new customers", close(num(m.firstOrderGpAfterAds), num(m.firstOrderProfit)! * 40));
  const gapM = periodMetrics(p, { ...ctx, costs, spendGapDays: 5 });
  check("spend gap: CM3 and first-order GP after ads n/a, CM2 kept", isNa(gapM.cm3) && isNa(gapM.firstOrderGpAfterAds) && !isNa(gapM.cm2));
}
for (const [name, m] of [["na", na], ["eu", eu]] as const) {
  const sold = [...m.markets];
  const cm2 = sold.reduce((t, c) => t + (num(c.cur.cm2) ?? NaN), 0);
  check(`${name} total CM2 = sum of markets`, close(num(m.total.cur.cm2), cm2, 1e-6), `${num(m.total.cur.cm2)} vs ${cm2}`);
  const cm3 = sold.reduce((t, c) => t + (num(c.cur.cm3) ?? NaN), 0) - (m.unallocated ? num(m.unallocated.cur.spend) ?? 0 : 0);
  check(`${name} total CM3 = markets minus unallocated spend`, close(num(m.total.cur.cm3), cm3, 1e-6), `${num(m.total.cur.cm3)} vs ${cm3}`);
  const fo = sold.reduce((t, c) => t + (num(c.cur.firstOrderGpAfterAds) ?? NaN), 0) - (m.unallocated ? num(m.unallocated.cur.spend) ?? 0 : 0);
  check(`${name} total first-order GP after ads = markets minus unallocated`, close(num(m.total.cur.firstOrderGpAfterAds), fo, 1e-6), `${num(m.total.cur.firstOrderGpAfterAds)} vs ${fo}`);
  check(`${name} every market on CM2 break-even`, m.markets.every((c) => c.cur.breakEvenBasis === "cm2"));
}
{
  const raw = demoMarkets("na", RANGE, PREV);
  // Heavy shipping makes CM3 negative while GP after ads stays positive: the verdict follows CM3.
  const heavy = buildModel({ ...raw, costCards: raw.costCards!.map((c) => (c.market === "US" ? { ...c, shipCostPerOrder: 108 } : c)) });
  const usH = col(heavy, "US");
  check("verdict uses CM3 when present", (num(usH.cur.gpAfterAds) ?? 0) > 0 && (num(usH.cur.cm3) ?? 0) <= 0 && usH.verdict?.key === "fix-acquisition" && /^CM3 at or below 0/.test(usH.verdict.why), JSON.stringify(usH.verdict));
  check("same market on CM1 would Scale", col(naCm1, "US").verdict?.key === "scale");
  // A sold market without a card: its lines n/a, the ranking falls back, its chip says on CM1.
  const noCa = buildModel({ ...raw, costCards: raw.costCards!.filter((c) => c.market !== "CA") });
  check("missing CA card: CM2 n/a with reason", isNa(col(noCa, "CA").cur.cm2) && (col(noCa, "CA").cur.cm2 as { na: string }).na === NO_CARD);
  check("missing CA card: ranking falls back to GP after ads", noCa.ranking.key === "gpAfterAds");
  check("missing CA card: CA on CM1, US on CM2", col(noCa, "CA").verdict?.onCm1 === true && col(noCa, "US").verdict?.onCm1 === false);
  check("missing CA card: Total CM2 n/a naming CA", isNa(noCa.total.cur.cm2) && /missing: CA/.test((noCa.total.cur.cm2 as { na: string }).na));
  // No Other card: the Total waits for it, the ranking (sold markets only) does not.
  const noOther = buildModel({ ...raw, costCards: raw.costCards!.filter((c) => c.market !== "OTHER") });
  check("missing Other card: ranking still CM3", noOther.ranking.key === "cm3");
  check("missing Other card: Total CM2 n/a naming Other", isNa(noOther.total.cur.cm2) && /missing: Other/.test((noOther.total.cur.cm2 as { na: string }).na));
  // The rate change 45 days back is applied day by day, not with today's card.
  const flat = buildModel({ ...raw, costCards: raw.costCards!.filter((c) => !(c.market === "US" && c.shipCostPerOrder === 7.2)) });
  check("demo US history: older rate lowers shipping", (num(col(na, "US").cur.shippingCost) ?? 0) < (num(col(flat, "US").cur.shippingCost) ?? 0));
}

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

// ── Cost card form validation ─────────────────────────────────────────────
{
  const blank = { shipCostPerOrder: "", payFeePct: "", codFee: "", returnCost: "", fixedMonthly: "" };
  const ok = checkCostCard({ effectiveFrom: "2026-10-01", values: { ...blank, shipCostPerOrder: "7,9", payFeePct: "2.9" } });
  check("form: comma decimal, percent stored as share", ok.card !== null && ok.card.shipCostPerOrder === 7.9 && close(ok.card.payFeePct, 0.029) && ok.card.codFee === null);
  check("form: empty is null, not 0", ok.card?.returnCost === null && ok.card?.fixedMonthly === null);
  check("form: every field empty refused", checkCostCard({ effectiveFrom: "2026-10-01", values: blank }).errors.card !== undefined);
  check("form: negative refused", checkCostCard({ effectiveFrom: "2026-10-01", values: { ...blank, codFee: "-1" } }).errors.codFee === "Cannot be negative");
  check("form: text refused", checkCostCard({ effectiveFrom: "2026-10-01", values: { ...blank, returnCost: "abc" } }).errors.returnCost === "Enter a number");
  check("form: percent over 100 refused", checkCostCard({ effectiveFrom: "2026-10-01", values: { ...blank, payFeePct: "120" } }).errors.payFeePct !== undefined);
  check("form: bad date refused", checkCostCard({ effectiveFrom: "2026-02-30", values: { ...blank, codFee: "1" } }).errors.effectiveFrom !== undefined);
  check("form: parseAmount", parseAmount(" 1 200,5 ") === 1200.5 && parseAmount("") === null && Number.isNaN(parseAmount("1e3") as number));
  check("form: stored share shown as percent", cardToValues({ market: "US", effectiveFrom: "2026-01-01", shipCostPerOrder: 7, payFeePct: 0.029, codFee: null, returnCost: null, fixedMonthly: null }).payFeePct === "2.9");
  const rows = [{ market: "US", isHome: true }, { market: "CA", isHome: false }, { market: "OTHER", isHome: false }];
  check("form summary: missing named", marketCostSummary(rows, demoMarkets("na", RANGE, PREV).costCards!.filter((c) => c.market !== "CA")) === "2 of 3 have a card · missing CA");
  check("form summary: none", marketCostSummary(rows, []) === "No cards: CM2 and CM3 show n/a");
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
  // 130 KB raw: the map pans one frame past each edge (2026-10-15), so it
  // carries neighbours too; path text gzips about 3 to 4x on the wire.
  check(`outline ${focus.join("+")} under 130 KB`, g !== null && JSON.stringify(g).length < 130_000, String(g && JSON.stringify(g).length));
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

// ── Opportunity index ─────────────────────────────────────────────────────
{
  const v = (x: number) => ({ v: x });
  const nv = (r: string) => ({ na: r });
  const c = (iso: string, pull: CandidateSignals["pull"], unpaid: CandidateSignals["unpaid"], search: CandidateSignals["search"], cost: CandidateSignals["cost"]): CandidateSignals => ({ iso, pull, unpaid, search, cost });

  // Log normalisation: log1p(x) / log1p(max).
  check("log scale 0 is 0", logScale(0, 100) === 0);
  check("log scale max is 1", logScale(100, 100) === 1);
  check("log scale is log1p, not linear", close(logScale(9, 99), 0.5), String(logScale(9, 99)));
  check("log scale with max 0 is 0, not NaN", logScale(0, 0) === 0);
  check("ratio scale caps to 0..1", ratioScale(2, 4) === 0.5 && ratioScale(5, 4) === 1 && ratioScale(-1, 4) === 0);

  // Weights: 0.35 / 0.25 / 0.25 / 0.15 over all four signals.
  {
    const r = opportunityIndex([c("AA", v(100), v(0), v(0), v(0.5)), c("BB", v(0), v(100), v(100), v(2))]);
    const a = r.find((o) => o.iso === "AA")!, b = r.find((o) => o.iso === "BB")!;
    // AA: pull 1, cost 0.5/2 = 0.25 -> 0.35 + 0.0375 = 0.3875 -> 39
    check("weights: pull 0.35 + cost share", a.index === 39, String(a.index));
    check("weights: unpaid + search + cost = 65", b.index === 65, String(b.index));
    check("coverage 4 of 4", a.coverage === 4 && b.coverage === 4);
    check("ranked by index", r[0].iso === "BB" && r[0].rank === 1 && r[1].rank === 2);
    check("best on every signal is 100", opportunityIndex([c("AA", v(5), v(5), v(5), v(1.2)), c("BB", v(1), v(1), v(1), v(0.6))])[0].index === 100);
  }

  // Re-weighting: a missing signal leaves the denominator, it is not a zero.
  {
    const r = opportunityIndex([c("XX", v(10), v(10), nv("no terms"), nv("no CPM")), c("YY", v(10), v(0), nv("no terms"), nv("no CPM"))]);
    const x = r.find((o) => o.iso === "XX")!, y = r.find((o) => o.iso === "YY")!;
    check("re-weighted: full marks on the available signals is 100", x.index === 100, String(x.index));
    check("re-weighted: pull only over 0.6 = 58", y.index === 58, String(y.index));
    check("re-weighted coverage 2 of 4", y.coverage === 2);
    check("n/a signal has no score", y.signals.search.score === null && "na" in y.signals.search.raw);
    // A measured zero counts: same candidate with search 0 measured scores lower.
    const z = opportunityIndex([c("XX", v(10), v(10), v(0), nv("x")), c("YY", v(10), v(0), v(100), nv("x"))]);
    check("measured zero counts against the index", z.find((o) => o.iso === "XX")!.index === Math.round((100 * 0.6) / 0.85));
  }

  // The 2-signal minimum.
  {
    const r = opportunityIndex([c("ZZ", v(5), nv("GA4 is not connected"), nv("No terms"), nv("Benchmarks not loaded")), c("WW", v(1), v(3), nv("x"), nv("x"))]);
    const z = r.find((o) => o.iso === "ZZ")!;
    check("one signal: index n/a", z.index === null && z.rank === null && z.coverage === 1);
    check("n/a names the missing signals", !!z.na && z.na.includes("unpaid interest (GA4 is not connected)") && z.na.includes("search demand") && z.na.includes("cost to reach (Benchmarks not loaded)"), z.na ?? "");
    check("n/a sorts last", r[r.length - 1].iso === "ZZ");
    check("two signals is enough", r.find((o) => o.iso === "WW")!.index !== null);
  }

  // Ties share a rank, order is by coverage then ISO, the next rank skips.
  {
    const r = opportunityIndex([c("CC", v(4), v(4), nv("x"), nv("x")), c("BB", v(4), v(4), nv("x"), nv("x")), c("DD", v(1), v(1), nv("x"), nv("x"))]);
    check("tie: equal index", r[0].index === r[1].index);
    check("tie: shared rank, ISO order", r[0].iso === "BB" && r[1].iso === "CC" && r[0].rank === 1 && r[1].rank === 1);
    check("tie: next rank skips", r[2].rank === 3);
    const t = opportunityIndex([c("AA", v(4), v(4), nv("x"), nv("x")), c("BB", v(4), v(4), v(0), nv("x"))]);
    check("tie on index broken by coverage", t[0].index === t[1].index || t[0].iso === "AA");
  }

  // Cost to reach: home CPM / country CPM, same vertical and currency.
  {
    const row = (iso: string, value: number, vertical = "all_ecommerce", currency = "USD", source = "t") => ({ iso, vertical, value, currency, source, asOf: "2026-10-01" });
    const cpm = [row("US", 12, "all_ecommerce"), row("GB", 6, "all_ecommerce"), row("IE", 8, "pet_supplements"), row("US", 10, "pet_supplements"), row("AU", 9, "all_ecommerce", "AUD")];
    check("cpm ratio home / country", close((cpmRatio("GB", "US", cpm, "pet_supplements") as { v: number }).v, 2));
    check("cpm ratio prefers the client vertical", close((cpmRatio("IE", "US", cpm, "pet_supplements") as { v: number }).v, 10 / 8));
    check("cpm not loaded", "na" in cpmRatio("GB", "US", null, null) && (cpmRatio("GB", "US", null, null) as { na: string }).na === "Benchmarks not loaded");
    check("cpm missing country", (cpmRatio("RS", "US", cpm, null) as { na: string }).na === "No Meta CPM benchmark for RS");
    check("cpm currency mismatch is n/a", "na" in cpmRatio("AU", "US", cpm, null));
    check("cpm missing home", (cpmRatio("GB", "CA", cpm, null) as { na: string }).na.includes("home market"));
    // Two sources: the pair comes from one source, the one covering more countries.
    const two = [row("US", 16, "all_ecommerce", "USD", "Wide"), row("GB", 8, "all_ecommerce", "USD", "Wide"), row("DE", 10, "all_ecommerce", "USD", "Wide"), row("CZ", 6, "all_ecommerce", "USD", "Wide"),
      row("US", 23, "all_ecommerce", "USD", "Narrow"), row("GB", 10, "all_ecommerce", "USD", "Narrow"), row("IE", 11, "all_ecommerce", "USD", "Narrow")];
    check("cpm pair from the widest source", close((cpmRatio("GB", "US", two, null) as { v: number }).v, 2));
    check("cpm falls to a source that has both", close((cpmRatio("IE", "US", two, null) as { v: number }).v, 23 / 11));
    check("cpm never mixes sources", "na" in cpmRatio("DE", "US", [row("US", 16, "all_ecommerce", "USD", "A"), row("DE", 10, "all_ecommerce", "USD", "B")], null));
  }

  // From the signals view: no row is a measured zero; no GA4 is n/a.
  {
    const base = { iso: "GB", orders365: 3, newCustomers365: 2, netRevenue365: 100, aovNew365: 50, ga4Days90: null, sessions90: null, engagedSessions90: null, unpaidEngagedSessions90: null, addToCartSessions90: null, ga4Purchases90: null, searchVolumeCore: null, searchTermsCore: null, searchAsOf: null };
    const noGa4 = candidateSignals({ candidates: ["GB", "IE"], home: "US", signals: { rows: [base], ga4Days90: null, vertical: null, cpm: null } });
    check("no GA4: unpaid n/a", "na" in noGa4[0].unpaid && (noGa4[0].unpaid as { na: string }).na.includes("GA4"));
    check("no row: pull is a measured 0", "v" in noGa4[1].pull && noGa4[1].pull.v === 0);
    const ga4 = candidateSignals({ candidates: ["IE"], home: "US", signals: { rows: [{ ...base, ga4Days90: 60 }], ga4Days90: 60, vertical: null, cpm: [] } });
    check("GA4 on, no row: unpaid is 0", "v" in ga4[0].unpaid && ga4[0].unpaid.v === 0);
    check("no signals view: every signal n/a", candidateSignals({ candidates: ["GB"], home: "US", signals: null }).every((x) => "na" in x.pull && "na" in x.cost));
  }

  // The demo renders every state.
  const naGb = na.opportunity.find((o) => o.iso === "GB");
  check("demo na: GB indexed on 3 of 4", naGb?.index !== null && naGb?.coverage === 3, JSON.stringify(naGb?.coverage));
  check("demo na: RS indexed on 2 of 4 (no CPM)", na.opportunity.find((o) => o.iso === "RS")?.coverage === 2);
  check("demo na: AU listed from GA4 alone", na.candidates.includes("AU"));
  check("demo na: no search signal", na.opportunity.every((o) => o.signals.search.score === null));
  check("demo eu: SI n/a below 2 signals", eu.opportunity.find((o) => o.iso === "SI")?.index === null);
  check("demo eu: DE on search", eu.opportunity.find((o) => o.iso === "DE")?.signals.search.score !== null);
  check("demo eu: HU on search and CPM", eu.opportunity.find((o) => o.iso === "HU")?.coverage === 3);
  check("demo na: AU has no CPM benchmark", na.opportunity.find((o) => o.iso === "AU")?.signals.cost.score === null);
  check("demo eu: sold PL is no candidate", !eu.candidates.includes("PL"));
  check("demo eu: unpaid n/a, GA4 off", eu.opportunity.every((o) => o.signals.unpaid.score === null));
  check("demo: index in 0..100", [...na.opportunity, ...eu.opportunity].every((o) => o.index === null || (o.index >= 0 && o.index <= 100)));
}

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
  check("matrix CM2 row", html.includes("CM2"));
  const rowAt = (label: string) => html.indexOf(`${label}<`);
  check("matrix: First-order GP after ads right after GP after ads", rowAt("GP after ads") > 0 && rowAt("First-order GP after ads") > rowAt("GP after ads") && rowAt("First-order GP after ads") < html.indexOf(">CM3<"), `${rowAt("GP after ads")} ${rowAt("First-order GP after ads")} ${html.indexOf(">CM3<")}`);
  check("matrix keeps First-order GP minus nCAC", html.includes("First-order GP minus nCAC"));
  const rowOf = (h: string, label: string) => {
    const i = h.indexOf(`>${label}<`);
    return i < 0 ? "" : h.slice(i, h.indexOf("</tr>", i));
  };
  const htmlCm1 = renderToStaticMarkup(createElement(PnlMatrix, { model: naCm1, mode: "base", periodLabel: "x", onOpen: () => {} }));
  for (const label of ["Shipping and fulfilment", "Payment fees incl. COD", "CM2", "CM3", "First-order GP after ads"]) {
    check(`matrix ${label} filled with cards`, rowOf(html, label) !== "" && !rowOf(html, label).includes("n/a"), rowOf(html, label).slice(0, 200));
  }
  check("matrix CM2 n/a without cards", rowOf(htmlCm1, "CM2").includes("n/a"));
  check("no cards: CM2 reason points to Settings", (col(naCm1, "US").cur.cm2 as { na: string }).na === NO_CARD);
  const wf = renderToStaticMarkup(createElement(Waterfall, { m: col(na, "US").cur, currency: "USD", factor: 1 }));
  check("waterfall ends at CM3 with cards", wf.includes("gross sales to CM3") && !wf.includes("border-dashed"));
  const wf1 = renderToStaticMarkup(createElement(Waterfall, { m: col(naCm1, "US").cur, currency: "USD", factor: 1 }));
  check("waterfall keeps dashed CM2 placeholders without cards", wf1.includes("gross sales to GP after ads") && wf1.includes("border-dashed"));
  const local = renderToStaticMarkup(createElement(PnlMatrix, { model: na, mode: "local", periodLabel: "x", onOpen: () => {} }));
  check("matrix local shows CAD", local.includes("CAD"));
  const lb = renderToStaticMarkup(createElement(Leaderboard, { model: eu, mode: "base", onOpen: () => {} }));
  check("leaderboard ranks by CM3 with cards", lb.includes("Ranked by CM3") && lb.includes("Czechia"));
  const lb1 = renderToStaticMarkup(createElement(Leaderboard, { model: euCm1, mode: "base", onOpen: () => {} }));
  check("leaderboard ranks by GP after ads without cards", lb1.includes("Ranked by GP after ads"));
  check("leaderboard shows Young", lb.includes("Young"));
  const scoutNa = renderToStaticMarkup(createElement(ScoutingView, { model: na, geometry: null, candidates: na.candidates, ga4Connected: true, rangeText: "x" }));
  check("scouting lists the index", scoutNa.includes("Opportunity index") && scoutNa.includes("3 of 4") && scoutNa.includes("not a verdict"));
  check("scouting says GA4 day coverage", scoutNa.includes("GA4 covers 74 of 90 days"));
  check("scouting drops the old GA4 text", !scoutNa.includes("F10") && !scoutNa.includes("Not computable"));
  const scoutEu = renderToStaticMarkup(createElement(ScoutingView, { model: eu, geometry: null, candidates: eu.candidates, ga4Connected: false, rangeText: "x" }));
  check("scouting eu: GA4 not connected", scoutEu.includes("GA4 is not connected"));
  check("scouting eu: search demand shown", scoutEu.includes("18,400"));
}

// ── No em dash in any Markets source ──────────────────────────────────────
{
  const ROOT = join(__dirname, "..");
  const dirs = ["components/markets", "lib/markets", "app/(app)/markets"].map((d) => join(ROOT, d));
  const files = [...dirs.flatMap((d) => readdirSync(d).map((f) => join(d, f))), join(ROOT, "lib/demo/markets.ts"), join(ROOT, "lib/queries/markets.ts"), join(ROOT, "components/settings/MarketCostCards.tsx"), join(ROOT, "app/dev/market-costs/page.tsx"), join(ROOT, "app/(app)/settings/actions.ts"), join(ROOT, "app/(app)/settings/page.tsx")].filter((f) => statSync(f).isFile());
  for (const f of files) check(`no em dash in ${f.slice(ROOT.length + 1)}`, !readFileSync(f, "utf8").includes("\u2014"));
}



console.log(`check:markets ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
