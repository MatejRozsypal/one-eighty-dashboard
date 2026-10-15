/**
 * Markets, Products gates.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-markets-products.ts
 *
 * Pure checks, no warehouse, no server. Pins:
 *
 *   - shares: per market they add up to 100 %, a zero market has none;
 *   - differs-most: points, sign, order by absolute gap, the noise floor, a
 *     product sold in only one of the two markets, ties by name;
 *   - top per market: order, share, comparison share and rank;
 *   - the model: home first and Other last, the pooled row, the market's
 *     products adding up to the market's net sales on the main Markets page,
 *     local price only with enough local-currency coverage, n/a reasons;
 *   - the demo: both regions build, CA and SK buy differently from home,
 *     Compare fills every comparison field;
 *   - the views render (static markup) and no source holds an em dash.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildProductsModel,
  differsMost,
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
import { DiffersMost, formatPp } from "@/components/markets/products/DiffersMost";
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

  // ── Differs most ─────────────────────────────────────────────────────────
  const d = differsMost(s.get("US")!, s.get("CA")!);
  check("differs: largest gap first (A -40 pp, B +30, D +20, C -10)", d.map((i) => i.product).join() === "A,B,D,C", d.map((i) => i.product).join());
  check("differs: points are share minus home share", close(d[0].diff, -0.4) && close(d[1].diff, 0.3));
  check("differs: product only in market (D) keeps home 0", d.find((i) => i.product === "D")!.homeShare === 0);
  check("differs: product only at home (C) keeps market 0", d.find((i) => i.product === "C")!.share === 0);
  check("differs: limit", differsMost(s.get("US")!, s.get("CA")!, { limit: 2 }).length === 2);

  const noise = differsMost(new Map([["A", 0.995], ["N", 0.005]]), new Map([["A", 0.992], ["N", 0.008]]));
  check("differs: under 1 % in both markets is left out", !noise.some((i) => i.product === "N"), noise.map((i) => i.product).join());
  const tie = differsMost(new Map([["B", 0.5], ["A", 0.5]]), new Map([["B", 0.6], ["A", 0.4]]));
  check("differs: ties by name", tie.map((i) => i.product).join() === "A,B", tie.map((i) => i.product).join());
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
  check("model: SK differs list", "items" in m.differs.SK && m.differs.SK.items.length > 0);
  check(`model: PL under ${MIN_MARKET_UNITS} units is n/a`, "na" in m.differs.PL);
  check("model: no differs for home or Other", !("CZ" in m.differs) && !("OTHER" in m.differs));
  check("model: unknown units stay null", buildProductsModel({ ...raw, current: [row("CZ", "A", 10, null)] }).rows[0].cells.CZ.asp === null);
  const noRate = buildProductsModel({ ...raw, current: [row("CZ", "A", 10), row("SK", "A", 10, 1)] });
  check("model: no rate on local orders says so", /exchange rate/.test(noRate.markets[1].localWhy ?? ""), noRate.markets[1].localWhy ?? "");
  const noHome = buildProductsModel({ ...raw, homeMarket: "DE" });
  check("model: home without sales makes differs n/a", Object.values(noHome.differs).every((d) => "na" in d));
  check("local coverage bar", LOCAL_COVERAGE === 0.95);
  check("share steps", shareStep(null) === -1 && shareStep(0) === -1 && shareStep(0.01) === 0 && shareStep(0.05) === 2 && shareStep(0.5) === 4);
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
  const d = m.differs[away];
  check(`demo ${region}: ${away} differs list`, !!d && "items" in d && d.items.length === 5);
  if (d && "items" in d) {
    const top = d.items[0];
    const expect = region === "na" ? ["Radiance Serum 30ml", "Deep Sleep Tincture", "Calm Balance Capsules", "Immunity Blend Powder", "Starter Ritual Set"] : ["Starter Ritual Set", "Overnight Repair Mask", "Deep Sleep Tincture", "Radiance Serum 30ml"];
    check(`demo ${region}: ${away} top gap is a written tilt`, expect.includes(top.product) && Math.abs(top.diff) >= 0.02, `${top.product} ${top.diff}`);
  }
  const awayCol = m.markets.find((c) => c.key === away)!;
  check(`demo ${region}: ${away} local price`, awayCol.localCurrency === (region === "na" ? "CAD" : "EUR"));
  const serum = m.rows.find((r) => r.product === "Radiance Serum 30ml")!;
  check(`demo ${region}: ${away} local price is base times the rate`, (serum.cells[away].aspLocal ?? 0) > (region === "na" ? serum.cells[away].asp! : 0));

  // Renders.
  const matrix = renderToStaticMarkup(createElement(ProductMatrix, { model: m, metric: "share", periodLabel: "x" }));
  check(`render ${region}: matrix shares`, matrix.includes("All markets") && matrix.includes(OTHER_PRODUCTS) && matrix.includes("%"));
  const price = renderToStaticMarkup(createElement(ProductMatrix, { model: m, metric: "price", periodLabel: "x" }));
  check(`render ${region}: matrix prices show the local currency`, price.includes(region === "na" ? "USD / CAD" : "CZK / EUR"));
  const diffs = renderToStaticMarkup(createElement(DiffersMost, { model: m }));
  check(`render ${region}: differs`, diffs.includes(" pp") && diffs.includes("aria-hidden"));
  const top = renderToStaticMarkup(createElement(TopByMarket, { model: m, compareLabel: "vs prev period" }));
  check(`render ${region}: top lists`, (top.match(/<ol/g) ?? []).length === m.markets.length);
  for (const html of [matrix, price, diffs, top]) check(`render ${region}: no em dash`, !html.includes(EM_DASH));
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
