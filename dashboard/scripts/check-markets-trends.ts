/**
 * Markets, Trends & analysis gates.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-markets-trends.ts
 *
 * Pure checks, no warehouse, no server. Pins the math of lib/markets/analysis.ts
 * and the demo fixture of the /markets/trends page:
 *
 *   - weeks start on Monday, partial weeks are flagged at both ends;
 *   - weekly sums equal the Overview's period figures (same demo, same code);
 *   - the log fit recovers a known curve, hides below 8 weeks, and the
 *     marginal nCAC is spend / b;
 *   - the reallocation moves at most the giving market's spend, never takes a
 *     fitted week below zero, and says when it extrapolates;
 *   - the bridge steps add up to the change exactly, in the documented order;
 *     no gross sales folds the discount step into AOV; spend gaps and missing
 *     COGS give n/a with a reason;
 *   - the funnel indexes the home market at 100 and pools other countries;
 *   - the free-shipping threshold is the step, not the cliff above it, and
 *     says when there is none;
 *   - portfolio points fall back to first-order GP and say why a market is not drawn;
 *   - every chart's takeaway sentence: the right market, direction and figure,
 *     partial weeks and Other's ratios left out, no sentence without data;
 *   - the nav lists the Markets children; no em dash in any new source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoMarkets } from "@/lib/demo/markets";
import { demoGa4, demoOrderBins, demoResponse, demoTrendWeeks } from "@/lib/demo/marketsTrends";
import { dataThrough } from "@/lib/demo/business";
import { buildModel, isNa } from "@/lib/markets/model";
import type { DailySums } from "@/lib/markets/types";
import {
  bridge,
  bridgeFactors,
  decompose,
  fitLog,
  funnelRows,
  histogram,
  inferThreshold,
  marginalNcac,
  marketColors,
  mondayOf,
  nearThreshold,
  portfolioPoints,
  portfolioTakeaway,
  predict,
  reallocate,
  reallocationTakeaway,
  responseByMarket,
  responseTakeaway,
  thresholdTakeaway,
  trendTakeaway,
  weekSlots,
  weeklyTrends,
  type LogFit,
  type OrderBin,
  type PortfolioPoint,
  type TrendSeries,
} from "@/lib/markets/analysis";
import { NAV, pageTitle, resolveActive } from "@/lib/nav";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const near = (a: number | null | undefined, b: number, tol = 1e-6) => typeof a === "number" && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function sums(p: Partial<DailySums>): DailySums {
  return {
    orders: 0, newCustomers: 0, returningOrders: 0, grossSales: null, discounts: null, refunds: null, netSales: 0,
    netRevenue: 0, newCustomerRevenue: 0, returningRevenue: 0, newCustomerNetSales: null, returningNetSales: null,
    newCustomerGrossProfit: null, newCustomerCostedOrders: null, costedNetSales: null, cogs: null, grossProfit: null,
    costedOrders: 0, discountedOrders: null, codOrders: null, zeroShippingOrders: null, shippingCharged: null, spend: 0,
    ...p,
  };
}

// ── Weeks ───────────────────────────────────────────────────────────────────
{
  check("monday of a Thursday", mondayOf("2026-10-15") === "2026-10-12");
  check("monday of a Sunday", mondayOf("2026-10-18") === "2026-10-12");
  check("monday of a Monday", mondayOf("2026-10-12") === "2026-10-12");
  const s = weekSlots({ from: "2026-09-02", to: "2026-10-14" }, "2026-10-15");
  check("first week starts on its Monday", s[0].start === "2026-08-31" && s[0].from === "2026-09-02" && s[0].days === 5 && s[0].partial);
  check("middle weeks are full", s.slice(1, -1).every((w) => w.days === 7 && !w.partial));
  const last = s[s.length - 1];
  check("current week is partial", last.start === "2026-10-12" && last.to === "2026-10-14" && last.days === 3 && last.partial);
  const cut = weekSlots({ from: "2026-09-07", to: "2026-10-20" }, "2026-10-15");
  check("data end cuts the last week", cut[cut.length - 1].to === "2026-10-15" && cut[cut.length - 1].partial);
}

// ── Weekly trends equal the Overview's period figures (demo) ─────────────────
{
  const last = dataThrough();
  const range = { from: new Date(Date.parse(`${last}T00:00:00Z`) - 86 * 86_400_000).toISOString().slice(0, 10), to: last };
  for (const region of ["na", "eu"] as const) {
    const raw = demoMarkets(region, range, null);
    const model = buildModel(raw);
    const keys = model.markets.filter((m) => m.kind === "sold" || m.kind === "other").map((m) => m.key);
    const t = demoTrendWeeks(region, range, null);
    const series = weeklyTrends({ weeks: t.weeks, compareWeeks: null, range, compareRange: null, lastDay: last, markets: keys, platform: raw.platform, costCards: raw.costCards });
    const rev = series.find((x) => x.metric === "netRevenue")!;
    for (const m of keys) {
      const weekly = rev.points.reduce((acc, p) => acc + (p.values[m] ?? 0), 0);
      const col = model.markets.find((c) => c.key === m)!;
      const period = isNa(col.cur.netRevenue) ? NaN : col.cur.netRevenue.v;
      check(`${region} ${m}: weekly net revenue sums to the period`, near(weekly, period, 1e-6), `${weekly} vs ${period}`);
    }
    const nc = series.find((x) => x.metric === "newCustomers")!;
    const home = model.homeMarket!;
    const ncSum = nc.points.reduce((acc, p) => acc + (p.values[home] ?? 0), 0);
    const homeCol = model.markets.find((c) => c.key === home)!;
    check(`${region}: weekly new customers sum to the period`, !isNa(homeCol.cur.newCustomers) && ncSum === homeCol.cur.newCustomers.v);
    check(`${region}: metrics in order`, series.slice(0, 5).map((x) => x.metric).join() === "netRevenue,newCustomers,nCac,mer,gpAfterAds");
    check(`${region}: CM3 only with cost cards`, series.some((x) => x.metric === "cm3") === (raw.costCards ?? []).length > 0);
    check(`${region}: partial last week flagged`, rev.points[rev.points.length - 1].partial === (weekSlots(range, last).slice(-1)[0].days < 7));
    // Compare aligns week i with week i.
    const prevRange = { from: new Date(Date.parse(`${range.from}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10), to: new Date(Date.parse(`${range.to}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10) };
    const tc = demoTrendWeeks(region, range, prevRange);
    const sc = weeklyTrends({ weeks: tc.weeks, compareWeeks: tc.compareWeeks, range, compareRange: prevRange, lastDay: last, markets: keys, platform: raw.platform });
    const p0 = sc[0].points[1];
    const prevRow = tc.compareWeeks!.find((w) => w.market === home && w.week === weekSlots(prevRange, last)[1].start)!;
    check(`${region}: compare week 2 is the compare range's week 2`, near(p0.compare[home], prevRow.sums.netRevenue));
  }
}

// ── Log fit and marginal nCAC ───────────────────────────────────────────────
{
  const pts = [400, 600, 800, 1000, 1300, 1600, 2000, 2500, 3100].map((x) => ({ x, y: 5 + 3 * Math.log(x) }));
  const f = fitLog(pts)!;
  check("fit recovers a", near(f.a, 5, 1e-9));
  check("fit recovers b", near(f.b, 3, 1e-9));
  check("exact curve has R2 1", near(f.r2, 1, 1e-9));
  check("fit remembers its spend range", f.minX === 400 && f.maxX === 3100 && f.n === 9);
  check("marginal nCAC is spend / b", near(marginalNcac(f, 1500), 500));
  check("predict", near(predict(f, Math.E), 8));
  check("under 8 weeks: no fit", fitLog(pts.slice(0, 7)) === null);
  check("flat spend: no fit", fitLog(Array.from({ length: 10 }, (_, i) => ({ x: 500, y: i }))) === null);
  check("zero spend weeks are ignored", fitLog([...pts, { x: 0, y: 3 }])!.n === 9);
  const noisy = fitLog([[300, 4], [500, 9], [700, 10], [900, 14], [1100, 13], [1300, 15], [1500, 17], [1800, 16], [2100, 18], [2600, 19]].map(([x, y]) => ({ x, y })))!;
  check("noisy fit: 0 < R2 < 1 and b > 0", noisy.r2 > 0.8 && noisy.r2 < 1 && noisy.b > 0);

  // Reallocation.
  const a = { fit: f, spend: 2000, gpPerNew: 40 };
  const b = { fit: { ...f, a: 2, b: 6 }, spend: 800, gpPerNew: 55 };
  const r = reallocate(a, b, 300);
  check("moving spend loses customers in A", r.newFrom < 0);
  check("and wins them in B", r.newTo > 0);
  check("net = from + to", near(r.newTotal, r.newFrom + r.newTo));
  check("GP = customers x first-order GP", near(r.gp, r.newFrom * 40 + r.newTo * 55));
  check("loss in A matches the curve", near(r.newFrom, predict(f, 1700) - predict(f, 2000)));
  const capped = reallocate(a, b, 5000);
  check("move capped at A's spend", capped.move === 2000);
  check("emptying A loses at most its fitted base", near(capped.newFrom, -predict(f, 2000)));
  check("beyond the seen range extrapolates", capped.extrapolates);
  check("small move stays in range", !reallocate({ ...a, spend: 1500 }, { ...b, spend: 1500 }, 100).extrapolates);
  check("GP n/a without first-order GP", reallocate({ ...a, gpPerNew: null }, b, 100).gp === null);
}

// ── Response by market (demo and gates) ─────────────────────────────────────
{
  const last = dataThrough();
  const range = { from: new Date(Date.parse(`${last}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to: last };
  const resp = demoResponse("na", range);
  const rs = responseByMarket({ rows: resp.rows, markets: ["US", "CA"], window: resp.window, range, lastDay: last });
  const us = rs.find((x) => x.market === "US")!;
  check("demo US has a fit over 52 weeks", us.fit !== null && us.fit.n >= 40, us.why ?? "");
  check("demo US: partial weeks are left out", us.points.every((p) => weekSlots(resp.window, last).find((s) => s.start === p.week)?.partial === false));
  check("demo US: marginal nCAC exists", us.marginal !== null && us.marginal > 0);
  check("demo US: current spend is the range's weekly average", us.currentSpend !== null && us.currentSpend > 0);
  const short = responseByMarket({ rows: resp.rows.filter((w) => w.week >= weekSlots(resp.window, last).slice(-6)[0].start), markets: ["US"], window: resp.window, range, lastDay: last })[0];
  check("under 8 weeks: fit hidden with a reason", short.fit === null && /needs 8/.test(short.why ?? ""), short.why ?? "");
  const gap = responseByMarket({ rows: resp.rows.map((w) => ({ ...w, spendGapDays: 1 })), markets: ["US"], window: resp.window, range, lastDay: last })[0];
  check("weeks with spend gaps are left out", gap.points.length === 0 && gap.fit === null);
}

// ── Bridge ──────────────────────────────────────────────────────────────────
{
  const prev = sums({ orders: 100, grossSales: 12000, netSales: 10000, grossProfit: 7000, costedOrders: 100, spend: 2000 });
  const cur = sums({ orders: 130, grossSales: 16900, netSales: 13520, grossProfit: 9060, costedOrders: 130, spend: 3100 });
  const fp = bridgeFactors(prev, "no cogs");
  const fc = bridgeFactors(cur, "no cogs");
  if ("na" in fp || "na" in fc) {
    check("factors exist", false);
  } else {
    check("factors reproduce GP after ads", near(fp.orders * fp.aov * fp.keep * fp.margin - fp.spend, 5000));
    const d = decompose(fp, fc);
    const total = d.steps.reduce((t, s) => t + (s.value ?? 0), 0);
    check("steps add up to the change exactly", near(total, d.after - d.before, 1e-9), `${total} vs ${d.after - d.before}`);
    check("before and after are GP after ads", near(d.before, 5000) && near(d.after, 5960));
    check("steps in the documented order", d.steps.map((s) => s.key).join() === "volume,aov,discount,cogs,spend");
    check("volume effect = new orders at the old order economics", near(d.steps[0].value, 30 * 120 * (10000 / 12000) * 0.7));
    check("spend effect is minus the spend change", near(d.steps[4].value, -1100));
    check("more discount is a negative discount step", (d.steps[2].value ?? 0) < 0);
  }
  // No gross sales (Shoptet): discount folded into AOV.
  const sp = bridgeFactors(sums({ orders: 50, netSales: 5000, grossProfit: 3000, costedOrders: 50, spend: 500 }), "x");
  const sc = bridgeFactors(sums({ orders: 60, netSales: 6600, grossProfit: 3800, costedOrders: 60, spend: 700 }), "x");
  if (!("na" in sp) && !("na" in sc)) {
    const d = decompose(sp, sc);
    check("no gross sales: discount step is n/a with a note", d.steps[2].value === null && !!d.steps[2].note);
    check("no gross sales: still adds up", near(d.steps.reduce((t, s) => t + (s.value ?? 0), 0), d.after - d.before, 1e-9));
  }
  check("no COGS: n/a with the platform reason", "na" in bridgeFactors(sums({ orders: 10, netSales: 100, spend: 5 }), "No COGS: Woo"));
  const markets = bridge({
    current: [{ market: "CZ", sums: cur, extras: null }, { market: "UNALLOCATED", sums: sums({ spend: 300 }), extras: null }],
    previous: [{ market: "CZ", sums: prev, extras: null }, { market: "UNALLOCATED", sums: sums({ spend: 100 }), extras: null }],
    markets: ["CZ", "SK"],
    noGpReason: "No COGS",
    spendGap: null,
  });
  check("bridge lists Unallocated as its own bar", markets.some((m) => m.market === "UNALLOCATED" && near(m.change, -200)));
  check("market with no orders now is n/a with a reason", markets.find((m) => m.market === "SK")?.change === null && !!markets.find((m) => m.market === "SK")?.why);
  check("CZ change = after - before", near(markets.find((m) => m.market === "CZ")?.change, 960));
  const gapped = bridge({ current: [{ market: "CZ", sums: cur, extras: null }], previous: [{ market: "CZ", sums: prev, extras: null }], markets: ["CZ"], noGpReason: "x", spendGap: "gap" });
  check("spend gaps make the bridge n/a", gapped[0].change === null && gapped[0].why === "gap");
}

// ── Funnel ──────────────────────────────────────────────────────────────────
{
  const rows = funnelRows({
    current: [
      { iso: "US", sessions: 10000, engagedSessions: 6000, unpaidEngagedSessions: 2400, addToCartSessions: 700, purchases: 200 },
      { iso: "CA", sessions: 4000, engagedSessions: 2400, unpaidEngagedSessions: 840, addToCartSessions: 240, purchases: 60 },
      { iso: "GB", sessions: 500, engagedSessions: 250, unpaidEngagedSessions: 150, addToCartSessions: 10, purchases: 2 },
      { iso: "DE", sessions: 300, engagedSessions: 150, unpaidEngagedSessions: 90, addToCartSessions: 5, purchases: 1 },
    ],
    previous: null,
    sold: ["US", "CA"],
    home: "US",
  });
  const us = rows.find((r) => r.market === "US")!;
  const ca = rows.find((r) => r.market === "CA")!;
  const other = rows.find((r) => r.market === "OTHER")!;
  check("home indexes at 100", !isNa(us.index.cvr) && us.index.cvr.v === 100);
  check("CVR = purchases / sessions", !isNa(ca.cvr) && near(ca.cvr.v, 0.015));
  check("CVR index vs home", !isNa(ca.index.cvr) && near(ca.index.cvr.v, 75));
  check("unpaid share of engaged", !isNa(ca.unpaidShare) && near(ca.unpaidShare.v, 0.35));
  check("other countries pool into Other", other.sessions === 800 && rows[rows.length - 1].market === "OTHER");
  check("no compare: no previous", us.previous === null);
  check("demo eu: GA4 not connected", demoGa4("eu", { from: "2026-01-01", to: "2026-03-01" }, null).firstDay === null);
  const last = dataThrough();
  const g = demoGa4("na", { from: new Date(Date.parse(`${last}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to: last }, null);
  check("demo na: GA4 covers fewer days than a 90-day range", g.daysCurrent > 60 && g.daysCurrent < 90);
}

// ── Free-shipping threshold ─────────────────────────────────────────────────
{
  // A real shape (US, Q3 2026, 4-unit bins): free shipping starts at 128, and a
  // mass of free orders above it would pull a plain "80 % above" rule down to 112.
  const raw = "0:22/22 12:1/0 16:9/0 20:24/4 24:3/1 28:23/0 32:13/0 36:115/1 40:140/0 44:66/0 48:48/0 52:53/1 56:35/2 60:37/1 64:214/0 68:33/0 72:50/0 76:149/1 80:11/0 84:18/0 88:7/0 92:46/0 96:22/0 100:75/0 104:28/0 108:35/1 112:101/1 116:29/0 120:81/2 124:33/1 128:15/11 132:58/57 136:70/68 140:69/67 144:44/43 148:21/21 152:84/84 156:51/50 160:27/26 164:56/56 168:42/42 172:80/80 176:55/55 180:51/49 184:52/51 188:28/28 192:37/37 196:15/15 200:41/41 204:37/37 208:20/19 212:34/33 216:27/24 220:53/52 224:34/34 228:15/14 232:20/20 236:21/21 240:11/11 244:17/17 248:14/14 252:20/20 256:11/11 260:10/10 300:120/120 400:80/80 484:31/31";
  const bins: OrderBin[] = raw.split(" ").map((t) => {
    const [lo, rest] = t.split(":");
    const [o, z] = rest.split("/");
    return { lo: Number(lo), orders: Number(o), zeroShip: Number(z) };
  });
  const t = inferThreshold(bins, 4);
  check("threshold is the step, not the cliff", "value" in t && t.value === 128, JSON.stringify(t));
  const ca = "0:15/15 12:2/0 16:3/0 20:7/1 28:24/1 32:12/1 40:54/0 44:16/1 60:28/0 64:16/1 72:16/1 80:24/1 84:15/0 88:15/4 92:25/24 96:34/33 100:45/44 104:77/74 108:65/64 112:64/63 116:64/63 120:53/53 124:54/54 128:38/36 132:47/47 140:28/28 160:22/21 200:7/7 300:20/20"
    .split(" ")
    .map((x) => {
      const [lo, rest] = x.split(":");
      const [o, z] = rest.split("/");
      return { lo: Number(lo), orders: Number(o), zeroShip: Number(z) };
    });
  const tca = inferThreshold(ca, 4);
  check("second real shape: threshold at 92", "value" in tca && tca.value === 92, JSON.stringify(tca));
  check("every order free: no threshold", "none" in inferThreshold([{ lo: 0, orders: 50, zeroShip: 50 }, { lo: 10, orders: 50, zeroShip: 49 }], 10));
  check("almost none free: no threshold", "none" in inferThreshold([{ lo: 0, orders: 500, zeroShip: 2 }, { lo: 10, orders: 500, zeroShip: 3 }], 10));
  check("a few big free orders do not set it", "none" in inferThreshold([{ lo: 0, orders: 500, zeroShip: 30 }, { lo: 10, orders: 500, zeroShip: 30 }, { lo: 900, orders: 6, zeroShip: 6 }], 10));
  const h = histogram({ market: "US", width: 4, cap: 484, bins });
  check("histogram keeps every order", h.orders === bins.reduce((s, b) => s + b.orders, 0));
  check("display bars are 5 fine bins wide", h.width === 20 && h.bars.every((b) => b.hi - b.lo === 20));
  check("last bar is open-ended", h.bars[h.bars.length - 1].open);
  check("bars split free and paid", h.bars.every((b) => b.zeroShip + b.paidShip === b.orders));
  // Demo: the threshold lands near the generated one.
  const last = dataThrough();
  const demo = demoOrderBins("na", { from: new Date(Date.parse(`${last}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to: last });
  const dus = histogram(demo.markets!.find((m) => m.market === "US")!);
  check("demo US: threshold inferred", "value" in dus.threshold, JSON.stringify(dus.threshold));
  check("demo US: zero-shipping share near the Overview's 35 %", dus.zeroShipShare !== null && Math.abs(dus.zeroShipShare - 0.35) < 0.08, String(dus.zeroShipShare));
}

// ── Portfolio ───────────────────────────────────────────────────────────────
{
  const last = dataThrough();
  const range = { from: new Date(Date.parse(`${last}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to: last };
  const na = buildModel(demoMarkets("na", range, null));
  const pts = portfolioPoints(na);
  const us = pts.find((p) => p.market === "US")!;
  check("US is drawn on 365 d cohorts", us.x !== null && us.y !== null && us.basis === "ltgp365");
  check("ratio = y / x", near(us.ratio, (us.y as number) / (us.x as number)));
  check("Other without spend is not drawn", !pts.some((p) => p.market === "OTHER"));
  const eu = buildModel(demoMarkets("eu", range, null));
  const pl = portfolioPoints(eu).find((p) => p.market === "PL")!;
  check("young PL falls back to first-order GP", pl.basis === "firstOrder" && pl.y !== null, JSON.stringify(pl));
  const colors = marketColors(["CA", "US", "OTHER"], "US");
  check("home market takes the first series colour", colors.US === "var(--series-1)" && colors.CA === "var(--series-2)" && colors.OTHER === "var(--gray-400)");
}

// ── Takeaways ───────────────────────────────────────────────────────────────
{
  const M = "\u2212";
  // Intl puts a no-break space after an ISO currency code ("CZK 1,000"); compare as plain text.
  const plain = (t: string | null) => (t === null ? null : t.replace(/\u00a0/g, " "));
  // Portfolio.
  const pt = (market: string, x: number | null, y: number | null, basis: PortfolioPoint["basis"] = "ltgp365"): PortfolioPoint => ({
    market, x, y, basis: y === null ? null : basis, size: 1, ratio: x && y !== null ? y / x : null, why: x === null ? "no spend" : null,
  });
  const two = portfolioTakeaway([pt("CA", 98, 166.6), pt("US", 41, 213.2)], "USD");
  check(
    "portfolio: best first, worst needs a cheaper nCAC",
    two === "US pays back 5.2× at 365 days for a $41 nCAC; CA 1.7× for $98. To reach 3:1, CA needs an nCAC under $56 or more GP per customer.",
    two ?? "null"
  );
  const clear = portfolioTakeaway([pt("US", 50, 200), pt("CA", 40, 140)], "USD");
  check("portfolio: every market clears 3:1", clear === "US pays back 4.0× at 365 days for a $50 nCAC; CA 3.5× for $40. Every market clears 3:1.", clear ?? "null");
  const mixed = plain(portfolioTakeaway([pt("CZ", 1000, 2000), pt("PL", 800, 400, "firstOrder")], "CZK"));
  check(
    "portfolio: first-order basis is named, several below list their nCAC bar",
    mixed === "CZ pays back 2.0× at 365 days for a CZK 1,000 nCAC; PL 0.5× on the first order, for CZK 800. For 3:1 at today's GP per customer, nCAC must fall under CZK 133 in PL and CZK 667 in CZ.",
    mixed ?? "null"
  );
  const one = plain(portfolioTakeaway([pt("PL", 800, 400, "firstOrder")], "CZK"));
  check("portfolio: one first-order market asks for a higher first-order GP", one === "PL pays back 0.5× on the first order for a CZK 800 nCAC. To reach 3:1, PL needs an nCAC under CZK 133 or a higher first-order GP.", one ?? "null");
  const four = portfolioTakeaway([pt("A", 10, 60), pt("B", 10, 50), pt("C", 10, 40), pt("D", 10, 35)], "USD") ?? "";
  check("portfolio: four markets name only the best and the worst", four.startsWith("A pays back 6.0× at 365 days for a $10 nCAC; D 3.5× for $10.") && !four.includes("B "), four);
  const loss = portfolioTakeaway([pt("US", 40, 200), pt("SK", 50, -20)], "USD") ?? "";
  check("portfolio: no GP per customer says so", loss.endsWith("SK makes no gross profit per customer yet, so no nCAC pays back there."), loss);
  check("portfolio: nothing drawn, no sentence", portfolioTakeaway([pt("US", null, 100)], "USD") === null);

  // Weekly trends.
  const series = (kind: TrendSeries["kind"], goodWhen: "up" | "down", byMarket: Record<string, Array<number | null>>, partialEnds = true): TrendSeries => {
    const n = Object.values(byMarket)[0].length;
    return {
      metric: kind === "unit" ? "nCac" : "netRevenue",
      label: "x",
      kind,
      goodWhen,
      points: Array.from({ length: n }, (_, i) => ({
        week: `w${i}`,
        label: `w${i}`,
        partial: partialEnds && (i === 0 || i === n - 1),
        values: Object.fromEntries(Object.entries(byMarket).map(([m, vs]) => [m, vs[i]])),
        compare: {},
        reasons: {},
      })),
    };
  };
  // Partial weeks (first and last) are wild on purpose: they must not count.
  const rev = series("money", "up", { US: [5, 100, 100, 120, 140, 9], CA: [1, 50, 50, 40, 40, 900], OTHER: [0, 5, 5, 6, 6, 0] });
  const tr = trendTakeaway(rev, ["US", "CA", "OTHER"], "USD");
  check("trend: totals rank by the size of the move, partial weeks out", tr === "Biggest mover: US, up 30 % from $100 to $130 a week (better).", tr ?? "null");
  const ncac = series("unit", "down", { US: [0, 40, 40, 44, 44, 0], CA: [0, 100, 100, 80, 80, 0], OTHER: [0, 10, 10, 50, 50, 0] });
  const tn = trendTakeaway(ncac, ["US", "CA", "OTHER"], "USD");
  check("trend: ratios rank by percent, Other left out, down is better for nCAC", tn === "Biggest mover: CA, down 20 % from $100 to $80 (better).", tn ?? "null");
  const worse = trendTakeaway(series("unit", "down", { US: [0, 40, 40, 50, 50, 0] }), ["US"], "USD");
  check("trend: a rising nCAC is worse", worse === "Biggest mover: US, up 25 % from $40 to $50 (worse).", worse ?? "null");
  const flat = trendTakeaway(series("ratio", "up", { US: [0, 10, 10, 10.2, 10.1, 0], CA: [0, 8, 8, 8.1, 8, 0] }), ["US", "CA"], "USD");
  check("trend: under 3 % everywhere reads flat", flat === "Flat: no market moved more than 3 % from the first to the last full weeks.", flat ?? "null");
  const fromZero = trendTakeaway(series("count", "up", { PL: [0, 0, 0, 7, 9, 0] }), ["PL"], "USD");
  check("trend: a start at zero gives no percent", fromZero === "Biggest mover: PL, from 0 to 8 a week (better).", fromZero ?? "null");
  check("trend: under four full weeks, no sentence", trendTakeaway(series("money", "up", { US: [1, 2, 3, 4, 5] }), ["US"], "USD") === null);
  check("trend: n/a weeks leave too few values, no sentence", trendTakeaway(series("money", "up", { US: [0, 1, null, null, 2, 0] }), ["US"], "USD") === null);

  // Spend response.
  const fit = (r2: number): LogFit => ({ a: 1, b: 2, r2, n: 20, minX: 1, maxX: 2 });
  const rising = responseTakeaway({ market: "US", fit: fit(0.8), marginal: 62, currentSpend: 2400, avgNcac: 41 }, "USD");
  check(
    "response: marginal above the average reads as a rising price",
    rising === "At $2,400 a week, the next US customer costs about $62, 51 % more than the $41 average: more spend here buys customers at a rising price.",
    rising ?? "null"
  );
  const room = responseTakeaway({ market: "CA", fit: fit(0.22), marginal: 30, currentSpend: 900, avgNcac: 41 }, "USD");
  check(
    "response: below the average means room, and a weak fit says so in words",
    room === "At $900 a week, the next CA customer costs about $30, 27 % less than the $41 average: there is room to spend more here before returns fall. Spend explains only 22 % of the weekly swing, so read this as a direction, not a number.",
    room ?? "null"
  );
  const level = responseTakeaway({ market: "US", fit: fit(0.8), marginal: 45, currentSpend: 1569, avgNcac: 43 }, "USD");
  check("response: within 10 % reads as level", level === "At $1,569 a week, the next US customer costs about $45, close to the $43 average: returns are not falling much yet.", level ?? "null");
  check("response: no fit, no sentence", responseTakeaway({ market: "SK", fit: null, marginal: null, currentSpend: 500, avgNcac: 40 }, "USD") === null);
  check("response: no marginal, no sentence", responseTakeaway({ market: "SK", fit: fit(0.8), marginal: null, currentSpend: 500, avgNcac: 40 }, "USD") === null);
  const noAvg = responseTakeaway({ market: "US", fit: fit(0.8), marginal: 45, currentSpend: 1000, avgNcac: null }, "USD");
  check("response: no average, just the marginal", noAvg === "At $1,000 a week, the next US customer costs about $45.", noAvg ?? "null");

  // Calculator.
  const gain = reallocationTakeaway("US", "CA", { move: 240, newFrom: -3.1, newTo: 4.3, newTotal: 1.2, gp: 80, extrapolates: false }, "USD");
  check("calculator: trade, net and GP", gain === "Moving $240 a week from US to CA trades 3.1 US customers for 4.3 in CA: 1.2 more customers and +$80 GP after ads a week.", gain ?? "null");
  const lossCalc = reallocationTakeaway("US", "CA", { move: 157, newFrom: -3.7, newTo: 1.4, newTotal: -2.3, gp: -214, extrapolates: false }, "USD");
  check("calculator: a loss reads as fewer and minus", lossCalc === `Moving $157 a week from US to CA trades 3.7 US customers for 1.4 in CA: 2.3 fewer customers and ${M}$214 GP after ads a week.`, lossCalc ?? "null");
  const noGp = reallocationTakeaway("US", "OTHER", { move: 100, newFrom: -1, newTo: 1, newTotal: 0, gp: null, extrapolates: false }, "USD");
  check("calculator: no GP, no GP clause", noGp === "Moving $100 a week from US to Other trades 1 US customers for 1 in Other: about the same number of customers a week.", noGp ?? "null");
  check("calculator: nothing moved, no sentence", reallocationTakeaway("US", "CA", { move: 0, newFrom: 0, newTo: 0, newTotal: 0, gp: 0, extrapolates: false }, "USD") === null);

  // Free shipping.
  const fine: OrderBin[] = [{ lo: 100, orders: 5, zeroShip: 0 }, { lo: 112, orders: 10, zeroShip: 0 }, { lo: 116, orders: 5, zeroShip: 0 }, { lo: 120, orders: 5, zeroShip: 0 }, { lo: 124, orders: 10, zeroShip: 1 }, { lo: 128, orders: 45, zeroShip: 44 }];
  const near = nearThreshold(fine, 4, { value: 128, share: 0.98, ordersAbove: 45 });
  check("near threshold: the band starts on the first bin edge inside 10 %", near !== null && near.from === 116 && near.to === 128 && near.orders === 20 && near.share === 0.25, JSON.stringify(near));
  const ship = thresholdTakeaway({ market: "US", threshold: { value: 128, share: 0.98, ordersAbove: 45 }, near }, "USD");
  check("threshold: share of orders just short", ship === "25 % of US orders (20) fell just short of free shipping, at $116 to $128: the easiest orders to lift over the threshold with an add-on.", ship ?? "null");
  const empty = thresholdTakeaway({ market: "CA", threshold: { value: 200, share: 0.9, ordersAbove: 45 }, near: nearThreshold(fine, 4, { value: 200, share: 0.9, ordersAbove: 45 }) }, "USD");
  check("threshold: nobody just short says so", empty === "No CA orders sit within 10 % below the $200 threshold, so it is not holding orders back.", empty ?? "null");
  const tiny = thresholdTakeaway({ market: "US", threshold: { value: 128, share: 0.98, ordersAbove: 45 }, near: { from: 116, to: 128, orders: 1, share: 0.004 } }, "USD") ?? "";
  check("threshold: under 1 % does not read 0 %", tiny.startsWith("Under 1 % of US orders (1)"), tiny);
  check("threshold: no threshold, no band", nearThreshold(fine, 4, { none: "x" }) === null);
  check("threshold: no threshold, no sentence", thresholdTakeaway({ market: "US", threshold: { none: "x" }, near: null }, "USD") === null);

  // On the demo: the page's own data gives a sentence for every chart.
  const last = dataThrough();
  const range = { from: new Date(Date.parse(`${last}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to: last };
  const na = buildModel(demoMarkets("na", range, null));
  const pd = portfolioTakeaway(portfolioPoints(na), na.baseCurrency) ?? "";
  check("demo: portfolio names US first and what CA needs", pd.startsWith("US pays back") && pd.includes("CA needs an nCAC under"), pd);
  const bins = demoOrderBins("na", range);
  const hs = bins.markets!.filter((m) => m.market !== "OTHER").map(histogram);
  check("demo: every sold market has a near-threshold band", hs.every((h) => h.near !== null && h.near.orders > 0), JSON.stringify(hs.map((h) => h.near)));
  const usShip = thresholdTakeaway(hs.find((h) => h.market === "US")!, "USD") ?? "";
  check("demo: free-shipping sentence names the band", /^\d+ % of US orders \(\d[\d,]*\) fell just short of free shipping, at \$\d+ to \$\d+/.test(usShip), usShip);
  const resp = demoResponse("na", range);
  const us = responseByMarket({ rows: resp.rows, markets: ["US"], window: resp.window, range, lastDay: last })[0];
  const rt = responseTakeaway({ ...us, avgNcac: 43 }, "USD") ?? "";
  check("demo: response sentence for US", rt.startsWith("At $") && rt.includes("the next US customer costs about"), rt);
  for (const t of [two, clear, mixed, tr, tn, rising, room, gain, ship, pd, usShip, rt]) check("takeaway has no em dash", !(t ?? "").includes(String.fromCharCode(0x2014)));
}

// ── Nav ─────────────────────────────────────────────────────────────────────
{
  const markets = NAV.flatMap((g) => g.items).find((i) => i.href === "/markets");
  const hrefs = markets?.children?.map((c) => c.href) ?? [];
  check("Markets has Overview, Trends, Products", hrefs.join() === "/markets,/markets/trends,/markets/products");
  const a = resolveActive("/markets/trends");
  check("trends route lights Markets > Trends", a.item?.href === "/markets" && a.child?.href === "/markets/trends");
  check("overview route lights Overview", resolveActive("/markets").child?.href === "/markets");
  check("trends page title", pageTitle("/markets/trends") === "Trends & analysis");
  check("top-level Products is not confused", resolveActive("/products").item?.href === "/products");
}

// ── No em dash in the new sources ───────────────────────────────────────────
{
  const ROOT = join(__dirname, "..");
  const files = [
    "lib/markets/analysis.ts",
    "lib/queries/marketsTrends.ts",
    "lib/demo/marketsTrends.ts",
    "components/markets/trends/bits.tsx",
    "components/markets/trends/TrendsScreen.tsx",
    "components/markets/trends/PortfolioChart.tsx",
    "components/markets/trends/TrendCharts.tsx",
    "components/markets/trends/BridgeView.tsx",
    "components/markets/trends/ResponseView.tsx",
    "components/markets/trends/FunnelTable.tsx",
    "components/markets/trends/AovView.tsx",
    "app/(app)/markets/trends/page.tsx",
    "app/(app)/markets/trends/loading.tsx",
    "app/dev/markets-trends/page.tsx",
    "scripts/check-markets-trends.ts",
  ];
  for (const f of files) check(`no em dash in ${f}`, !readFileSync(join(ROOT, f), "utf8").includes("\u2014"));
}

console.log(`check:markets-trends ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
