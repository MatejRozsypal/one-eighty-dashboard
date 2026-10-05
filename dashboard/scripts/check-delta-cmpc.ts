/**
 * CMP-C: Compare and the "% | 123" delta on Orders, Email and Creative.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-delta-cmpc.ts
 *
 * Pure modules, static renders and source pins. No BigQuery, no router. The
 * demo client stands in for the warehouse where a summary is needed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeltaModeStatic } from "@/components/ui/DeltaMode";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Scorecard, rateChange, type Tile } from "@/components/creative/primitives";
import { deltaParts, type DeltaMode } from "@/lib/format";
import { getOrdersSummary } from "@/lib/queries/orders";
import { getEmailSummary } from "@/lib/queries/email";
import { DEMO_CLIENT_ID } from "@/lib/demo/client";
import { hitRate, inRange, type LaunchRow } from "@/lib/creative/hitRate";
import { parseViewParams } from "@/lib/params";

const ROOT = join(__dirname, "..");
const EM_DASH = String.fromCharCode(0x2014);
const NBSP = new RegExp(String.fromCharCode(0xa0), "g");
let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const html = (el: ReactElement, mode: DeltaMode) =>
  renderToStaticMarkup(createElement(DeltaModeStatic, { mode, children: el })).replace(NBSP, " ");

const ORDERS = "app/(app)/orders/page.tsx";
const EMAIL = "app/(app)/email/page.tsx";
const CREATIVE = "app/(app)/creative/page.tsx";
const PRIMS = "components/creative/primitives.tsx";

async function main() {
  // ── rateChange: the Hit rate tile's change ───────────────────────────────
  check("rateChange: none when the comparison period launched nothing", rateChange(0.1, null, 0) === null);
  check("rateChange: none when launched is 0 even with a rate", rateChange(0.1, 0, 0) === null);
  check("rateChange: none when the current rate is missing", rateChange(null, 0.05, 6) === null);
  check("rateChange: none when the comparison rate is missing", rateChange(0.1, null, 6) === null);
  const rc = rateChange(0.12, 0.05, 6);
  check("rateChange: rate kind with both sides", rc !== null && rc.kind === "rate" && rc.current === 0.12 && rc.previous === 0.05);
  check("rateChange: a 0% comparison rate with launches still draws", rateChange(0.1, 0, 4) !== null);
  check("rateChange: pp in pct mode", deltaParts(0.12, 0.05, { kind: "rate", mode: "pct" })?.text === "+7.0 pp");
  check("rateChange: pp in abs mode", deltaParts(0.12, 0.05, { kind: "rate", mode: "abs" })?.text === "+7.0 pp");

  // The tile's inputs: a comparison period with no launches yields no change.
  const launch = (id: string, firstDate: string, extra: Partial<LaunchRow> = {}): LaunchRow => ({
    adId: id, adName: id, firstDate, ageDays: 100, spend: 1000, revenue: 4000, purchases: 20,
    isVideo: true, isRelaunch: false, isPreexisting: false, conceptId: null, conceptName: null, priorRoas: 2,
    ...extra,
  });
  const thresholds = {
    targetRoas: 2.5, targetCpa: 300, killRoas: 1, readPurchases: 15, directionalPurchases: 8,
  } as unknown as Parameters<typeof hitRate>[1];
  const rows = [launch("a", "2026-09-05"), launch("b", "2026-09-10", { priorRoas: null })];
  const cur = hitRate(inRange(rows, { from: "2026-09-01", to: "2026-09-30" }), thresholds);
  const prevEmpty = hitRate(inRange(rows, { from: "2026-08-01", to: "2026-08-31" }), thresholds);
  check("hit rate: current period has launches", cur.launched === 2);
  check("hit rate: empty comparison period has 0 launched and a null rate", prevEmpty.launched === 0 && prevEmpty.rate === null);
  check("hit rate: empty comparison period gives no change", rateChange(cur.rate, prevEmpty.rate, prevEmpty.launched) === null);
  const withPrev = [...rows, launch("c", "2026-08-12"), launch("d", "2026-08-20", { priorRoas: null })];
  const prevFull = hitRate(inRange(withPrev, { from: "2026-08-01", to: "2026-08-31" }), thresholds);
  check("hit rate: comparison period with launches gives a change", prevFull.launched === 2 && rateChange(cur.rate, prevFull.rate, prevFull.launched) !== null);

  // ── Scorecard tiles follow the toggle ────────────────────────────────────
  const tiles: Tile[] = [
    { label: "Spend", value: "CZK 120,000", change: { current: 120000, previous: 100000, kind: "money", currency: "CZK" }, goodWhen: "neutral" },
    { label: "Blended ROAS", value: "2.60×", change: { current: 2.6, previous: 2.2, kind: "ratio" } },
    { label: "CPA", value: "CZK 310.00", change: { current: 310, previous: 280, kind: "money", currency: "CZK" }, goodWhen: "down" },
    { label: "Purchases", value: "387", change: { current: 387, previous: 357, kind: "count" } },
    { label: "Winners", value: "3" },
    { label: "Carriers", value: "4" },
    { label: "Losers", value: "5" },
    { label: "Hit rate", value: "12.0%", change: rc, goodWhen: "up" },
  ];
  const pctHtml = html(createElement(Scorecard, { tiles }), "pct");
  const absHtml = html(createElement(Scorecard, { tiles }), "abs");
  check("scorecard pct: spend", pctHtml.includes("20.0%"));
  check("scorecard pct: purchases", pctHtml.includes("8.4%"));
  check("scorecard pct: hit rate is pp", pctHtml.includes("7.0 pp"));
  check("scorecard abs: spend", absHtml.includes("CZK 20,000"));
  check("scorecard abs: ROAS", absHtml.includes("0.40×"));
  check("scorecard abs: CPA", absHtml.includes("CZK 30.00"));
  check("scorecard abs: purchases", absHtml.includes(">30<") || absHtml.includes("30</span>"));
  check("scorecard abs: hit rate is still pp", absHtml.includes("7.0 pp"));
  check("scorecard abs: no percent chip left", !/>\s*\d+(\.\d+)?%<\/span>/.test(absHtml.replace(/12\.0%/g, "")) );
  check("scorecard: CPA up is bad (red)", /text-negative[^>]*>[^<]*<span[^>]*>▲<\/span>CZK 30\.00/.test(absHtml));
  check("scorecard: spend up is neutral (muted)", /text-content-muted[^>]*><span[^>]*>▲<\/span>CZK 20,000/.test(absHtml));
  const noChip = html(createElement(Scorecard, { tiles: [{ label: "Spend", value: "CZK 1", change: null }] }), "pct");
  check("scorecard: null change draws no chip", !noChip.includes("▲") && !noChip.includes("▼") && !noChip.includes("→"));
  const unsafe = html(createElement(Scorecard, { tiles: [{ label: "Spend", value: "CZK 1", change: { current: 5, previous: 0, kind: "money", currency: "CZK" } }] }), "pct");
  check("scorecard: zero baseline in pct mode draws no chip", !unsafe.includes("▲"));
  const unsafeAbs = html(createElement(Scorecard, { tiles: [{ label: "Spend", value: "CZK 1", change: { current: 5, previous: 0, kind: "money", currency: "CZK" } }] }), "abs");
  check("scorecard: zero baseline in abs mode shows the absolute change", unsafeAbs.includes("▲"));
  const legacy = html(createElement(Scorecard, { tiles: [{ label: "Spend", value: "CZK 1", delta: 0.25 }] }), "abs");
  check("scorecard: legacy delta still renders as a percent", legacy.includes("25.0%"));

  // ── Demo clients: summaries take a comparison range ──────────────────────
  const range = { from: "2026-08-01", to: "2026-08-30" };
  const before = { from: "2026-07-02", to: "2026-07-31" };
  const o = await getOrdersSummary(DEMO_CLIENT_ID, range);
  const op = await getOrdersSummary(DEMO_CLIENT_ID, before);
  check("orders: demo summary for both periods", !!o && !!op);
  if (o && op) {
    const card = (mode: DeltaMode) =>
      html(
        createElement(MetricCard, {
          label: "Revenue",
          value: "CZK x",
          source: "Shopify",
          comparisonLabel: "vs prev period",
          change: { current: o.revenue, previous: op.revenue, kind: "money", currency: "CZK" },
        }),
        mode
      );
    check("orders: revenue card shows a percent chip", /\d%/.test(card("pct")) && card("pct").includes("vs prev period"));
    check("orders: revenue card shows an absolute chip", card("abs").includes("CZK") && !/\d%<\/span>/.test(card("abs").replace("CZK x", "")));
    const ret = html(
      createElement(MetricCard, {
        label: "Returning", value: "30%", source: "Shopify", goodWhen: "neutral",
        change: { current: o.returningShare, previous: op.returningShare, kind: "rate" },
      }),
      "pct"
    );
    check("orders: returning share is pp", ret.includes(" pp"));
    const none = html(
      createElement(MetricCard, { label: "Revenue", value: "CZK x", source: "Shopify", change: null }),
      "pct"
    );
    check("orders: no comparison summary (null change) holds the row with no chip", !none.includes("▲") && !none.includes("▼"));
  }
  const e = await getEmailSummary(DEMO_CLIENT_ID, range, 30, null);
  const ep = await getEmailSummary(DEMO_CLIENT_ID, before, 1, null);
  check("email: demo summary for both periods (limit 1 for the comparison)", !!e && !!ep);
  if (e && ep) {
    check("email: comparison totals do not depend on the row limit", ep.totalRevenue !== null && ep.campaigns.length <= 1);
    const click = deltaParts(e.avgClickRate, ep.avgClickRate, { kind: "rate", mode: "abs", decimals: 2 });
    check("email: click rate change in pp at two decimals", !!click && / pp$/.test(click.text) && /\.\d\d pp$/.test(click.text));
  }

  // ── Orders page source ───────────────────────────────────────────────────
  const orders = read(ORDERS);
  check("orders: Compare on", /<PageControls client=\{client\} params=\{params\} compare \/>/.test(orders));
  check("orders: comparison summary in the same Promise.all", /Promise\.all\(\[\s*getOrdersSummary\(client\.clientId, params\.range\),\s*comparison \? getOrdersSummary\(client\.clientId, comparison\)/.test(orders));
  check("orders: skipped when comparison is null", /comparison \? getOrdersSummary\(client\.clientId, comparison\) : Promise\.resolve\(null\)/.test(orders));
  check("orders: recent orders list not compared", /getRecentOrders\(client\.clientId, params\.range, 50\)/.test(orders));
  check("orders: six cards carry change", (orders.match(/change=\{chg\(/g) ?? []).length === 6);
  check("orders: returning share is a rate, neutral", /chg\(\(s\) => s\.returningShare, "rate"\)\}\s*goodWhen="neutral"/.test(orders));
  check("orders: money cards use the client currency", orders.includes("currency: client.currency"));
  check("orders: no legacy delta", !/\bdelta=/.test(orders));
  check("orders: comparison label on the cards", (orders.match(/comparisonLabel=\{compareLabel\}/g) ?? []).length === 6);

  // ── Email page source ────────────────────────────────────────────────────
  const email = read(EMAIL);
  check("email: Compare on", /<PageControls client=\{client\} params=\{params\} compare \/>/.test(email));
  check("email: comparison summary in the same Promise.all", /Promise\.all\(\[\s*getEmailSummary\(client\.clientId, params\.range, 30, client\.emailPlatform\),\s*comparison\s*\? getEmailSummary\(client\.clientId, comparison, 1, client\.emailPlatform\)\s*: Promise\.resolve\(null\)/.test(email));
  check("email: five headline tiles carry change", (email.match(/change: chg\(/g) ?? []).length === 5);
  check("email: open and click rate are rates", /chg\(\(s\) => s\.avgOpenRate, "rate"\)/.test(email) && /chg\(\(s\) => s\.avgClickRate, "rate", \{ decimals: 2 \}\)/.test(email));
  check("email: revenue and revenue per recipient are money", /chg\(\(s\) => s\.totalRevenue, "money"\)/.test(email) && /chg\(\(s\) => s\.revenuePerRecipient, "money"\)/.test(email));
  check("email: emails sent is a neutral count", /chg\(\(s\) => s\.totalSent, "count"\),\s*goodWhen: "neutral"/.test(email));
  check("email: flows (cumulative) carry no change", !/flows[^;]*chg\(/.test(email));
  check("email: no legacy delta", !/\bdelta=/.test(email));

  // ── Creative page source ─────────────────────────────────────────────────
  const creative = read(CREATIVE);
  check("creative: Compare stays on the overview", /loadCreative\(searchParams, \{ compare: true \}\)/.test(creative) && /<PageControls client=\{client\} params=\{ctx\.params\} compare \/>/.test(creative));
  check("creative: four delivery tiles use change", ["Spend", "Blended ROAS", "CPA", "Purchases"].every((l) => new RegExp(`label: "${l}"[\\s\\S]*?change:`).test(creative)));
  check("creative: kinds money, ratio, money, count", /kind: "money" as const, currency \}/.test(creative) && /kind: "ratio" as const/.test(creative) && /kind: "count" as const/.test(creative));
  check("creative: legacy delta() no longer used", !/\bdelta\(/.test(creative) && !/from "@\/lib\/period"/.test(creative));
  check("creative: Hit rate tile has a rate change from rateChange()", /label: "Hit rate"[\s\S]*?change:\s*prevHit && hit && !deltaWithheld\(hit, prevHit\)\s*\?\s*rateChange\(hit\.rate, prevHit\.rate, prevHit\.launched\)\s*:\s*null/.test(creative));
  check("creative: comparison hit rate needs thresholds and a comparison (and is withheld while the cohort matures)", /launched && comparison && hitThresholds/.test(creative));
  check("creative: launches read reaches back to the comparison start", /comparison\.from < ctx\.params\.range\.from/.test(creative) && /getLaunches\(client\.clientId, launchRange\)/.test(creative));
  check("creative: winners, carriers, losers carry no change", !/label: "(Winners|Carriers|Losers)"[\s\S]{0,200}?change:/.test(creative));
  check("creative: hit rate trend still reads the page range", /launchMonths\(launched\.rows, thresholds, launched\.through, ctx\.params\.range, format\)/.test(creative));
  for (const sub of ["breakdown", "concepts", "velocity", "production"]) {
    const src = read(`app/(app)/creative/${sub}/page.tsx`);
    check(`creative/${sub}: no Compare`, !/<PageControls[^>]*\bcompare\b/.test(src) && !/compare: true/.test(src));
  }
  check("primitives: Tile.change typed as DeltaInput", /change\?: DeltaInput \| null/.test(read(PRIMS)));

  // ── Window widening is only for the read, never for the displayed range ──
  const p = parseViewParams({ range: "last_30_days", compare: "previous_year" });
  check("params: previous_year comparison starts before the range", !!p.period.comparison && p.period.comparison.from < p.range.from);

  // ── Owned files carry no em dash ─────────────────────────────────────────
  for (const f of [ORDERS, EMAIL, CREATIVE, PRIMS, "scripts/check-delta-cmpc.ts"]) {
    check(`no em dash: ${f}`, !read(f).includes(EM_DASH));
  }

  if (failures.length) {
    console.error(`check-delta-cmpc: ${failures.length} failed, ${passed} passed`);
    for (const f of failures) console.error(`  FAIL ${f}`);
    process.exit(1);
  }
  console.log(`check-delta-cmpc: ${passed}/${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
