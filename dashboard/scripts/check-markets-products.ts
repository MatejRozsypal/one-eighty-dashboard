/**
 * Markets, Products gates.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-markets-products.ts
 *
 * Pure checks, no warehouse, no server. Pins:
 *
 *   - shares: per market they add up to 100 %, a zero market has none;
 *   - the mix map: unit shares, the index, non-products and free lines left
 *     out, the faded floor, a product sold in only one of the two markets;
 *   - entry products: share of first orders, low n, top by the market's share;
 *   - top per market: order, share, comparison share and rank;
 *   - the model: home first and Other last, the pooled row, the market's
 *     products adding up to the market's net sales on the main Markets page,
 *     local price only with enough local-currency coverage, n/a reasons;
 *   - the demo: both regions build, CA and SK buy differently from home,
 *     Compare fills every comparison field;
 *   - the takeaways: same mix or not, what a market buys more and less of,
 *     the entry product, the top-3
 *     concentration, the widest price gap with enough units, the leader per
 *     market and the biggest shift, and no sentence without data;
 *   - the views render (static markup) and no source holds an em dash.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildProductsModel,
  entryProducts,
  entryTakeaway,
  formatPp,
  formatPpBetween,
  formatTotal,
  isNonProduct,
  mixProducts,
  mixTakeaway,
  unitMix,
  matrixTakeaway,
  topTakeaway,
  marketShares,
  marketTotals,
  orderMarkets,
  topProducts,
  LOCAL_COVERAGE,
  MIN_MARKET_UNITS,
  OTHER_PRODUCTS,
  type ProductSalesRow,
  type ProductsRaw,
} from "@/lib/markets/products";
import { demoMarketsProducts } from "@/lib/demo/marketsProducts";
import { demoMarkets } from "@/lib/demo/markets";
import { MINUS } from "@/lib/format";
import { ProductMatrix, shareStep } from "@/components/markets/products/ProductMatrix";
import { MixMap } from "@/components/markets/products/MixMap";
import { EntryProducts } from "@/components/markets/products/EntryProducts";
import { TopByMarket } from "@/components/markets/products/TopByMarket";

/** Built from its code point so this file never holds the character it bans. */
const EM_DASH = String.fromCharCode(0x2014);

// InfoTip measures in a layout effect; static rendering warns about it, harmlessly.
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("useLayoutEffect")) return;
  consoleError(...args);
};

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const close = (a: number | null | undefined, b: number | null | undefined, tol = 1e-9) =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const row = (market: string, product: string, netSales: number, units: number | null = 1, local?: Partial<ProductSalesRow>): ProductSalesRow => ({
  market,
  product,
  netSales,
  units,
  localNetSales: 0,
  localUnits: 0,
  localCoveredNetSales: 0,
  entryOrders: 0,
  ...local,
});

// ── Shares ─────────────────────────────────────────────────────────────────
{
  const rows = [row("US", "A", 60), row("US", "B", 30), row("US", "C", 10), row("CA", "A", 20), row("CA", "B", 60), row("CA", "D", 20), row("XX", "A", 0)];
  const s = marketShares(rows);
  check("shares: US A 60 %", close(s.get("US")!.get("A")!, 0.6));
  check("shares: CA B 60 %", close(s.get("CA")!.get("B")!, 0.6));
  for (const m of ["US", "CA"]) check(`shares: ${m} sums to 1`, close([...s.get(m)!.values()].reduce((t, v) => t + v, 0), 1));
  check("shares: zero market has no shares", s.get("XX")!.size === 0);
  check("shares: same product twice in a market adds up", close(marketShares([row("US", "A", 1), row("US", "A", 1), row("US", "B", 2)]).get("US")!.get("A")!, 0.5));
  check("totals", marketTotals(rows).get("CA") === 100);

  // ── Mix map ──────────────────────────────────────────────────────────────
  const units = [
    row("US", "A", 600, 600), row("US", "B", 300, 300), row("US", "C", 100, 100), row("US", "Shipping Insurance", 5, 50),
    row("CA", "A", 200, 200), row("CA", "B", 600, 600), row("CA", "D", 200, 200), row("CA", "Free Sample", 0, 90),
  ];
  const { keep, excluded } = mixProducts(units);
  check("mix: non-products and free lines left out", excluded.join() === "Free Sample,Shipping Insurance", excluded.join());
  check("non-product names", isNonProduct("Pawsome Shipping Insurance") && isNonProduct("Healthy Dog Gift Card") && isNonProduct("Dárkový poukaz na parfém") && !isNonProduct("Testovací dárková sada & poukaz na parfém") && !isNonProduct("Vzorek parfému"));
  const mx = unitMix(units, "CA", "US", keep, 250);
  check("mix: totals in units, non-products out", mx.units === 1000 && mx.homeUnits === 1000, `${mx.units} ${mx.homeUnits}`);
  const pt = (p: string) => mx.points.find((x) => x.product === p)!;
  check("mix: shares of units", close(pt("B").share, 0.6) && close(pt("B").homeShare, 0.3));
  check("mix: index is share / home share", close(pt("B").index, 2) && close(pt("A").index, 1 / 3));
  check("mix: product only in market has no index", pt("D").index === null && pt("D").homeShare === 0);
  check("mix: product only at home keeps share 0", pt("C").share === 0 && close(pt("C").index, 0));
  check("mix: under the floor is low", pt("D").low && !pt("B").low);
  check("mix: sorted by market units", mx.points[0].product === "B");
  const priced = unitMix([row("US", "A", 100, 10), row("US", "B", 100, 10), row("CA", "A", 50, 10), row("CA", "B", 200, 10)], "CA", "US", new Set(["A", "B"]));
  check("mix: price does not move the mix (units equal, net sales not)", close(priced.points[0].index, 1) && close(priced.points[1].index, 1));

  // ── Entry products ───────────────────────────────────────────────────────
  const firsts = [
    row("US", "A", 1, 1, { entryOrders: 50 }), row("US", "B", 1, 1, { entryOrders: 20 }),
    row("CA", "A", 1, 1, { entryOrders: 10 }), row("CA", "B", 1, 1, { entryOrders: 40 }), row("CA", "Gift Card", 1, 1, { entryOrders: 5 }),
  ];
  const en = entryProducts(firsts, "CA", "US", { US: 100, CA: 80 }, mixProducts(firsts).keep, { minOrders: 30 });
  check("entry: top by the market's share", en.map((i) => i.product).join() === "B,A", en.map((i) => i.product).join());
  check("entry: share of first orders", close(en[0].share, 0.5) && close(en[0].homeShare, 0.2) && close(en[0].index, 2.5));
  check("entry: low n flagged, not hidden", en[1].low && !en[0].low && !en[1].homeLow && en[0].homeLow);
  check("entry: no first orders, no list", entryProducts(firsts, "CA", "US", { US: 100 }, mixProducts(firsts).keep).length === 0);
  check("pp between rounded shares (QA 10)", formatPpBetween(0.221, 0.201) === "+2.0 pp" && formatPpBetween(0.0134, 0.0064) === "+0.7 pp", `${formatPpBetween(0.221, 0.201)} ${formatPpBetween(0.0134, 0.0064)}`);
  check("totals print whole under 10,000 (QA 16)", formatTotal(879.5, "EUR") === "€880" && formatTotal(23456, "CZK").includes("K"), `${formatTotal(879.5, "EUR")} ${formatTotal(23456, "CZK")}`);
  check("pp format", formatPp(0.0342) === "+3.4 pp" && formatPp(-0.0342) === `${MINUS}3.4 pp` && formatPp(0.0001) === "0.0 pp", `${formatPp(0.0342)} ${formatPp(-0.0342)}`);
}

// ── Top per market ─────────────────────────────────────────────────────────
{
  const cur = [row("US", "A", 50), row("US", "B", 30), row("US", "C", 20), row("CA", "A", 5)];
  const prev = [row("US", "B", 60), row("US", "A", 40)];
  const t = topProducts(cur, prev, "US", 2);
  check("top: two by net sales", t.map((i) => i.product).join() === "A,B");
  check("top: share", close(t[0].share, 0.5));
  check("top: previous share", close(t[0].prevShare, 0.4) && close(t[1].prevShare, 0.6));
  check("top: previous rank", t[0].prevRank === 2 && t[1].prevRank === 1);
  const t3 = topProducts(cur, prev, "US", 3);
  check("top: not sold before = share 0, rank null", t3[2].prevShare === 0 && t3[2].prevRank === null);
  check("top: no compare = nulls", topProducts(cur, null, "US")[0].prevShare === null);
  check("top: empty market", topProducts(cur, null, "DE").length === 0);
}

// ── Column order ───────────────────────────────────────────────────────────
check("order: home first, Other last, rest by net sales", orderMarkets(new Map([["OTHER", 900], ["CA", 50], ["US", 10], ["PL", 70], ["ZZ", 0]]), "US").join() === "US,PL,CA,OTHER");

// ── Model ──────────────────────────────────────────────────────────────────
{
  const products = Array.from({ length: 20 }, (_, i) => `P${String(i).padStart(2, "0")}`);
  const cur: ProductSalesRow[] = [];
  products.forEach((p, i) => {
    cur.push(row("CZ", p, 1000 - i * 40, 10));
    cur.push(row("SK", p, 100 + i * 5, 3, { localNetSales: (100 + i * 5) / 25, localUnits: 3, localCoveredNetSales: 100 + i * 5 }));
  });
  cur.push(row("PL", "P00", 30, 2, { localNetSales: 1, localUnits: 1, localCoveredNetSales: 10 }));
  cur.push(row("OTHER", "P01", 50, 1));
  const raw: ProductsRaw = {
    source: "demo",
    baseCurrency: "CZK",
    homeMarket: "CZ",
    localCurrencyOf: { CZ: "CZK", SK: "EUR", PL: "PLN" },
    range: { from: "2026-07-01", to: "2026-09-30" },
    compareRange: null,
    current: cur,
    previous: null,
    newOrders: { CZ: 100, SK: 40 },
  };
  const m = buildProductsModel(raw);
  check("model: columns", m.markets.map((c) => c.key).join() === "CZ,SK,PL,OTHER", m.markets.map((c) => c.key).join());
  check("model: 15 rows + pooled", m.rows.length === 16 && m.rows[15].product === OTHER_PRODUCTS && m.rows[15].pooled && m.rows[15].pooledCount === 5);
  for (const c of m.markets) {
    const sum = m.rows.reduce((t, r) => t + (r.cells[c.key]?.netSales ?? 0), 0);
    check(`model: ${c.key} products add up to the market`, close(sum, c.netSales, 1e-9));
    const shares = m.rows.reduce((t, r) => t + (r.cells[c.key]?.share ?? 0), 0);
    check(`model: ${c.key} shares sum to 100 %`, close(shares, 1, 1e-9));
  }
  check("model: total share sums to 100 %", close(m.rows.reduce((t, r) => t + (r.total.share ?? 0), 0), 1, 1e-9));
  const p00 = m.rows.find((r) => r.product === "P00")!;
  check("model: ASP = net / units", close(p00.cells.CZ.asp, 100));
  check("model: home in base only (CZK = base)", m.markets[0].localCurrency === null && m.markets[0].localWhy === null);
  check("model: SK local price in EUR", m.markets[1].localCurrency === "EUR" && close(p00.cells.SK.aspLocal, 100 / 25 / 3));
  check("model: PL local coverage under the bar is n/a", m.markets[2].localCurrency === null && /33 %/.test(m.markets[2].localWhy ?? ""), m.markets[2].localWhy ?? "");
  check("model: Other has no local price", m.markets[3].localCurrency === null && /several/.test(m.markets[3].localWhy ?? ""));
  check("model: SK mix map", "points" in m.mix.SK && m.mix.SK.points.length === 20);
  check(`model: PL under ${MIN_MARKET_UNITS} units is n/a`, "na" in m.mix.PL);
  check("model: no mix for home or Other", !("CZ" in m.mix) && !("OTHER" in m.mix) && !("CZ" in m.entry));
  check("model: PL without first orders says so", "na" in m.entry.PL && /No first orders in PL/.test(m.entry.PL.na), JSON.stringify(m.entry.PL));
  check("model: no first-order data says so", Object.values(buildProductsModel({ ...raw, newOrders: {} }).entry).every((e) => "na" in e && /not available/.test(e.na)));
  check("model: unknown units stay null", buildProductsModel({ ...raw, current: [row("CZ", "A", 10, null)] }).rows[0].cells.CZ.asp === null);
  const noRate = buildProductsModel({ ...raw, current: [row("CZ", "A", 10), row("SK", "A", 10, 1)] });
  check("model: no rate on local orders says so", /exchange rate/.test(noRate.markets[1].localWhy ?? ""), noRate.markets[1].localWhy ?? "");
  const noHome = buildProductsModel({ ...raw, homeMarket: "DE" });
  check("model: home without sales makes the mix n/a", Object.values(noHome.mix).every((d) => "na" in d));
  check("local coverage bar", LOCAL_COVERAGE === 0.95);
  check("share steps", shareStep(null) === -1 && shareStep(0) === -1 && shareStep(0.01) === 0 && shareStep(0.05) === 2 && shareStep(0.5) === 4);
}

// ── Takeaways ──────────────────────────────────────────────────────────────
{
  const plain = (t: string | null) => (t === null ? null : t.replace(/ /g, " "));
  const pts = (xs: [string, number, number, number, number, boolean?][]) =>
    xs.map(([product, units, homeUnits, share, homeShare, low]) => ({ product, units, homeUnits, share, homeShare, index: homeShare > 0 ? share / homeShare : null, low: !!low }));
  const sameMix = mixTakeaway(
    { units: 1000, homeUnits: 1000, excluded: [], points: pts([["Omega", 236, 230, 0.236, 0.23], ["GutSense", 209, 168, 0.209, 0.168], ["SoulFood", 112, 116, 0.112, 0.116], ["GreenMin", 105, 81, 0.105, 0.081], ["MitoBoost", 140, 102, 0.052, 0.038], ["Omega H+", 140, 230, 0.04, 0.06], ["FleaHex", 26, 121, 0.005, 0.013, true]]) },
    "CA",
    "US"
  );
  check(
    "takeaway mix: same mix, more and less named, low left out",
    sameMix === "By units, CA buys the US mix: the top 4 products are all within 4.1 pts. It buys more of MitoBoost (137), GreenMin (130) and GutSense (124), and less of Omega H+ (67).",
    sameMix ?? "null"
  );
  const diff = mixTakeaway({ units: 1, homeUnits: 1, excluded: [], points: pts([["A", 1, 1, 0.2, 0.6], ["B", 1, 1, 0.5, 0.3], ["C", 1, 1, 0.3, 0.1]]) }, "CA", "US");
  check("takeaway mix: different mix names the widest gap", diff === "By units, CA buys a different mix: A is 20.0% of units against 60.0% in US. It buys more of C (300) and B (167), and less of A (33).", diff ?? "null");
  const flat = mixTakeaway({ units: 1, homeUnits: 1, excluded: [], points: pts([["A", 1, 1, 0.5, 0.5], ["B", 1, 1, 0.5, 0.5]]) }, "CA", "US");
  check("takeaway mix: nothing outside the band says so", flat === "By units, CA buys the US mix: the top 2 products are all within 0.0 pts. No product with 100 or more units sits outside 15 % of US.", flat ?? "null");
  check("takeaway mix: n/a, no sentence", mixTakeaway({ na: "x" }, "CA", "US") === null);
  const lead = entryTakeaway(
    { newOrders: 245, homeNewOrders: 662, items: [{ product: "Omega", orders: 104, homeOrders: 255, share: 0.424, homeShare: 0.385, index: 1.1, low: false, homeLow: false }, { product: "GutSense", orders: 108, homeOrders: 172, share: 0.441, homeShare: 0.26, index: 1.7, low: false, homeLow: false }] },
    "CA",
    "US"
  );
  check("takeaway entry: the clear lead", lead === "GutSense is in 44.1% of CA first orders against 26.0% in US: the CA entry product.", lead ?? "null");
  const plainEntry = entryTakeaway({ newOrders: 10, homeNewOrders: 10, items: [{ product: "A", orders: 5, homeOrders: 5, share: 0.5, homeShare: 0.5, index: 1, low: true, homeLow: true }] }, "CA", "US");
  check("takeaway entry: no clear lead names the top opener", plainEntry === "A opens the most CA first orders, 50.0% against 50.0% in US.", plainEntry ?? "null");

  const raw = (current: ProductSalesRow[], previous: ProductSalesRow[] | null = null): ProductsRaw => ({
    source: "demo",
    baseCurrency: "CZK",
    homeMarket: "CZ",
    localCurrencyOf: { CZ: "CZK", SK: "EUR" },
    range: { from: "2026-07-01", to: "2026-09-30" },
    compareRange: previous ? { from: "2026-04-01", to: "2026-06-30" } : null,
    current,
    previous,
    newOrders: {},
  });
  const cur = [row("CZ", "A", 50, 10), row("CZ", "B", 30, 10), row("CZ", "C", 20, 10), row("SK", "A", 20, 10), row("SK", "B", 20, 10), row("SK", "C", 10, 10), row("SK", "D", 50, 10)];
  const m = buildProductsModel(raw(cur));
  const share = plain(matrixTakeaway(m, "share"));
  check("takeaway matrix: top-3 concentration and its range", share === "The top 3 products make 85.0% of net sales: from 80.0% in CZ to 90.0% in SK.", share ?? "null");
  const even = buildProductsModel(raw([row("CZ", "A", 50), row("CZ", "B", 50), row("SK", "A", 50), row("SK", "B", 50)]));
  check("takeaway matrix: the same everywhere says so", matrixTakeaway(even, "share") === "The top 2 products make 100.0% of net sales, about the same in every market.", matrixTakeaway(even, "share") ?? "null");
  const price = plain(matrixTakeaway(m, "price"));
  check("takeaway matrix: widest price gap vs home", price === `Widest price gap vs CZ: A sells for CZK 2 in SK against CZK 5 in CZ (${MINUS}60 %).`, price ?? "null");
  const thin = buildProductsModel(raw(cur.map((r) => ({ ...r, units: 5 }))));
  check(`takeaway matrix: under ${10} units in a market, no price gap`, matrixTakeaway(thin, "price") === null);
  check("takeaway matrix: one product, no concentration", matrixTakeaway(buildProductsModel(raw([row("CZ", "A", 50)])), "share") === null);

  const top = topTakeaway(m);
  check("takeaway top: leaders differ", top === "The top seller differs: A in CZ (50.0%) and D in SK (50.0%).", top ?? "null");
  const same = topTakeaway(buildProductsModel(raw([row("CZ", "A", 60), row("CZ", "B", 40), row("SK", "A", 70), row("SK", "B", 30), row("OTHER", "B", 10)])));
  check("takeaway top: one leader everywhere (Other aside)", same === "A leads in every market, from 60.0% in CZ to 70.0% in SK.", same ?? "null");
  const prev = [row("CZ", "A", 40), row("CZ", "B", 30), row("CZ", "C", 30), row("SK", "A", 20), row("SK", "B", 20), row("SK", "C", 10), row("SK", "D", 50)];
  const shift = topTakeaway(buildProductsModel(raw(cur, prev)));
  check("takeaway top: biggest shift against the comparison", shift === "The top seller differs: A in CZ (50.0%) and D in SK (50.0%). Biggest shift against the comparison: A in CZ, +10.0 pp.", shift ?? "null");
  const newMarket = topTakeaway(buildProductsModel(raw(cur, [row("CZ", "A", 50), row("CZ", "B", 30), row("CZ", "C", 20)])));
  check("takeaway top: a market new since the comparison is no shift", newMarket === "The top seller differs: A in CZ (50.0%) and D in SK (50.0%).", newMarket ?? "null");
  check("takeaway top: nothing sold, no sentence", topTakeaway({ markets: [], top: {}, hasCompare: false }) === null);

  // On the demo.
  const demo = buildProductsModel(demoMarketsProducts("na", { from: "2026-07-16", to: "2026-10-13" }, null));
  const dd = mixTakeaway(demo.mix.CA, "CA", "US") ?? "";
  check("demo takeaway: mix reads CA by units", dd.startsWith("By units, CA buys "), dd);
  const de = entryTakeaway(demo.entry.CA, "CA", "US") ?? "";
  check("demo takeaway: entry names the calm capsules", de.startsWith("Calm Balance Capsules "), de);
  for (const t of [sameMix, diff, lead, share, price, top, shift, dd, de, matrixTakeaway(demo, "price"), topTakeaway(demo)]) check("takeaway has no em dash", !(t ?? "").includes(EM_DASH));
}

// ── Demo ───────────────────────────────────────────────────────────────────
const RANGE = { from: "2026-07-16", to: "2026-10-13" };
const PREV = { from: "2026-04-17", to: "2026-07-15" };
for (const region of ["na", "eu"] as const) {
  const raw = demoMarketsProducts(region, RANGE, PREV);
  const m = buildProductsModel(raw);
  const mk = demoMarkets(region, RANGE, null);
  for (const c of m.markets) {
    const main = mk.current.find((r) => r.market === c.key)!.sums.netSales;
    check(`demo ${region}: ${c.key} net sales match the Markets page`, close(c.netSales, main, 1e-9), `${c.netSales} vs ${main}`);
  }
  check(`demo ${region}: home first`, m.markets[0].key === raw.homeMarket);
  check(`demo ${region}: pooled row`, m.rows.at(-1)!.pooled);
  // A market with no sales in the comparison (eu PL started 70 days ago) has no comparison share.
  const prevMarkets = new Set(raw.previous!.filter((r) => r.netSales > 0).map((r) => r.market));
  check(`demo ${region}: compare filled where the market sold`, m.hasCompare && m.rows.every((r) => Object.entries(r.cells).every(([k, c]) => (c.prevShare !== null) === prevMarkets.has(k))));
  const away = region === "na" ? "CA" : "SK";
  const mxa = m.mix[away];
  check(`demo ${region}: ${away} mix map`, !!mxa && "points" in mxa && mxa.points.length >= 15 && mxa.excluded.includes("Gift Card"), JSON.stringify(mxa && "excluded" in mxa ? mxa.excluded : mxa));
  if (mxa && "points" in mxa) {
    const tilted = region === "na" ? ["Calm Balance Capsules", "Deep Sleep Tincture", "Immunity Blend Powder"] : ["Starter Ritual Set", "Overnight Repair Mask"];
    check(`demo ${region}: ${away} buys more of a written tilt`, tilted.some((p) => (mxa.points.find((x) => x.product === p)?.index ?? 0) >= 1.15));
  }
  const ena = m.entry[away];
  check(`demo ${region}: ${away} entry products`, !!ena && "items" in ena && ena.items.length === 8 && ena.items.every((i) => i.share <= 1));
  const awayCol = m.markets.find((c) => c.key === away)!;
  check(`demo ${region}: ${away} local price`, awayCol.localCurrency === (region === "na" ? "CAD" : "EUR"));
  const serum = m.rows.find((r) => r.product === "Radiance Serum 30ml")!;
  check(`demo ${region}: ${away} local price is base times the rate`, (serum.cells[away].aspLocal ?? 0) > (region === "na" ? serum.cells[away].asp! : 0));

  // Renders.
  const matrix = renderToStaticMarkup(createElement(ProductMatrix, { model: m, metric: "share", periodLabel: "x" }));
  check(`render ${region}: matrix shares`, matrix.includes("All markets") && matrix.includes(OTHER_PRODUCTS) && matrix.includes("%"));
  const price = renderToStaticMarkup(createElement(ProductMatrix, { model: m, metric: "price", periodLabel: "x" }));
  check(`render ${region}: matrix prices show the local currency`, price.includes(region === "na" ? "USD / CAD" : "CZK / EUR"));
  const diffs = mxa && "points" in mxa ? renderToStaticMarkup(createElement(MixMap, { points: mxa.points, market: away, home: raw.homeMarket })) : "";
  check(`render ${region}: mix map`, diffs.includes("<circle") && diffs.includes("buys more") && (diffs.match(/<circle/g) ?? []).length === (mxa && "points" in mxa ? mxa.points.length : -1));
  const entries = ena && "items" in ena ? renderToStaticMarkup(createElement(EntryProducts, { items: ena.items, market: away, home: raw.homeMarket })) : "";
  check(`render ${region}: entry products`, (entries.match(/<li/g) ?? []).length === 8);
  const top = renderToStaticMarkup(createElement(TopByMarket, { model: m, compareLabel: "vs prev period" }));
  check(`render ${region}: top lists`, (top.match(/<ol/g) ?? []).length === m.markets.length);
  for (const html of [matrix, price, diffs, entries, top]) check(`render ${region}: no em dash`, !html.includes(EM_DASH));
}

// ── No em dash in any source of this page ──────────────────────────────────
{
  const ROOT = join(__dirname, "..");
  const dirs = ["components/markets/products", "app/(app)/markets/products", "app/dev/markets-products"].map((d) => join(ROOT, d));
  const files = [
    ...dirs.flatMap((d) => readdirSync(d).map((f) => join(d, f))),
    join(ROOT, "lib/markets/products.ts"),
    join(ROOT, "lib/queries/marketsProducts.ts"),
    join(ROOT, "lib/demo/marketsProducts.ts"),
    join(ROOT, "scripts/check-markets-products.ts"),
  ].filter((f) => statSync(f).isFile());
  for (const f of files) check(`no em dash in ${f.slice(ROOT.length + 1)}`, !readFileSync(f, "utf8").includes(EM_DASH));
}

console.log(`check:markets-products ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
