/**
 * Asserts the Paid section follows the delta display mode ("% | 123"): every
 * tile and table delta renders through `change` in both modes, rates read in
 * percentage points in both, low volume and missing comparisons stay n/a,
 * delta columns sort by the key of the mode on screen, and the local point
 * chips are gone.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-delta-paid.ts
 *
 * Static renders and source pins only: no BigQuery, no router.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeltaModeStatic } from "@/components/ui/DeltaMode";
import { deltaSortKey, type DeltaMode } from "@/lib/format";
import { sortKeyFor } from "@/components/ui/DataTable";
import { PaidTile } from "@/components/paid/overview/PaidTile";
import { CampaignsAcross } from "@/components/paid/overview/CampaignsAcross";
import type { CampaignAgg as OverviewCampaign } from "@/components/paid/overview/model";
import { MetaKpis } from "@/components/paid/meta/MetaKpis";
import { MetaCampaigns } from "@/components/paid/meta/MetaCampaigns";
import { MetaTrend } from "@/components/paid/meta/MetaTrend";
import { DeltaCell } from "@/components/paid/meta/cells";
import type { CampaignAgg as MetaCampaign, MetaRow, MetaSums, VideoSums } from "@/components/paid/meta/aggregate";
import { GoogleKpis } from "@/components/paid/google/GoogleKpis";
import { BrandSplit } from "@/components/paid/google/BrandSplit";
import { GoogleCampaigns } from "@/components/paid/google/GoogleCampaigns";
import type { GadsCampaignAgg, GadsMetrics } from "@/lib/queries/paidGoogle";
import { Ga4Kpis } from "@/components/paid/ga4/Ga4Kpis";
import type { Ga4Totals } from "@/lib/queries/paidGa4";

// InfoTip (inside DataTable headers and Google tiles) uses useLayoutEffect, which warns in a static render.
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("useLayoutEffect")) return;
  realError(...args);
};

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
const html = (el: ReactElement, mode?: DeltaMode) =>
  renderToStaticMarkup(mode ? createElement(DeltaModeStatic, { mode, children: el }) : el).replace(NBSP, " ");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const OWNED = [...walk("components/paid"), ...walk("app/(app)/paid")];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const meta = (over: Partial<MetaSums> = {}): MetaSums => ({
  spend: 12_000,
  revenue: 48_000,
  purchases: 40,
  impressions: 400_000,
  reach: 150_000,
  addToCart: 900,
  initiateCheckout: 500,
  landingPageViews: 6_000,
  linkClicks: 8_000,
  viewContent: 5_000,
  addPaymentInfo: 300,
  ...over,
});
const video = (over: Partial<VideoSums> = {}): VideoSums => ({ plays: 40_000, thruplays: 8_000, impressions: 200_000, ...over });

// ---------------------------------------------------------------------------
// PaidTile
// ---------------------------------------------------------------------------
const tile = (change: Parameters<typeof PaidTile>[0]["change"], label = "Paid spend") =>
  createElement(PaidTile, { label, value: "CZK 100", change, goodWhen: "neutral", comparisonLabel: "vs prev period" });

const spendChange = { current: 112_345, previous: 100_000, kind: "money" as const, currency: "CZK" };
check("PaidTile pct", html(tile(spendChange), "pct").includes("12.3%"), html(tile(spendChange), "pct"));
check(
  "PaidTile abs money",
  html(tile(spendChange), "abs").includes("CZK 12,345") && !html(tile(spendChange), "abs").includes("%"),
  html(tile(spendChange), "abs")
);
check("PaidTile label follows the chip", html(tile(spendChange), "abs").includes("vs prev period"));
check("PaidTile no chip, no label when null", !html(tile(null), "abs").includes("vs prev period"));
check("PaidTile undefined holds the space", html(tile(undefined), "abs").includes("h-3"));
const ratioChange = { current: 4.51, previous: 4.2, kind: "ratio" as const, currency: "CZK" };
check("PaidTile ratio abs", html(tile(ratioChange, "aMER"), "abs").includes("0.31×"), html(tile(ratioChange, "aMER"), "abs"));
check("PaidTile ratio pct", html(tile(ratioChange, "aMER"), "pct").includes("7.4%"));
const countChange = { current: 1_123, previous: 1_000, kind: "count" as const };
check("PaidTile count abs", html(tile(countChange, "New customers"), "abs").includes("+123") || html(tile(countChange, "New customers"), "abs").includes(">123<"));
check("PaidTile from zero: pct n/a", !html(tile({ current: 5, previous: 0, kind: "money", currency: "CZK" }), "pct").includes("%"));
check("PaidTile from zero: abs shown", html(tile({ current: 5, previous: 0, kind: "money", currency: "CZK" }), "abs").includes("CZK 5"));

// ---------------------------------------------------------------------------
// Overview campaigns table
// ---------------------------------------------------------------------------
const campaign = (over: Partial<OverviewCampaign>): OverviewCampaign => ({
  platform: "meta",
  id: "1",
  name: "Alpha",
  kind: "prospecting",
  brandClass: null,
  spend: 50_000,
  value: 200_000,
  purchases: 40,
  prevSpend: 40_000,
  prevValue: 120_000,
  prevPurchases: 30,
  ...over,
});
const overview = (rows: OverviewCampaign[], mode: DeltaMode) =>
  html(
    createElement(CampaignsAcross, {
      rows,
      totalSpend: 100_000,
      currency: "CZK",
      comparing: true,
      hrefFor: () => "/x",
    }),
    mode
  );
const aRows = [campaign({}), campaign({ id: "2", name: "Tiny", spend: 100, value: 300, purchases: 1, prevSpend: 80, prevValue: 100, prevPurchases: 1 })];
const ovPct = overview(aRows, "pct");
const ovAbs = overview(aRows, "abs");
check("overview table pct: spend delta in percent", ovPct.includes("25.0%"), ovPct.slice(0, 400));
check("overview table abs: compact money delta", ovAbs.includes("CZK 10K") && !ovAbs.includes("25.0%"), ovAbs.slice(0, 400));
check("overview table abs: ROAS delta in ratio units", ovAbs.includes("1.00×") || ovAbs.includes("×"), ovAbs.slice(0, 400));
check("overview table: low volume ROAS delta is n/a in both modes", (ovPct.match(/>n\/a</g) ?? []).length >= 1 && (ovAbs.match(/>n\/a</g) ?? []).length >= 1);

// ---------------------------------------------------------------------------
// Meta tab
// ---------------------------------------------------------------------------
const metaKpis = (compare: boolean, mode: DeltaMode) =>
  html(
    createElement(MetaKpis, {
      current: meta(),
      previous: compare ? meta({ spend: 10_000, revenue: 30_000, purchases: 30, linkClicks: 6_000 }) : null,
      video: video(),
      previousVideo: compare ? video({ plays: 20_000 }) : null,
      currency: "CZK",
    }),
    mode
  );
const mkPct = metaKpis(true, "pct");
const mkAbs = metaKpis(true, "abs");
check("MetaKpis pct: spend +20.0%", mkPct.includes("20.0%"), mkPct.slice(0, 300));
check("MetaKpis abs: spend CZK 2,000", mkAbs.includes("CZK 2,000"), mkAbs.slice(0, 300));
check("MetaKpis abs: purchases +10", mkAbs.includes(">10<"), "");
check("MetaKpis rates are points in both modes", (mkPct.match(/ pp</g) ?? []).length === (mkAbs.match(/ pp</g) ?? []).length && (mkAbs.match(/ pp</g) ?? []).length >= 3, `${(mkPct.match(/ pp</g) ?? []).length} vs ${(mkAbs.match(/ pp</g) ?? []).length}`);
check("MetaKpis: hook rate chip is a point change", mkAbs.includes("10.0 pp"), mkAbs);
const mkOff = metaKpis(false, "abs");
check("MetaKpis no comparison: no chips", !mkOff.includes("▲") && !mkOff.includes("▼") && !mkOff.includes("→"));

const metaRow = (period: "current" | "comparison", date: string, over: Partial<MetaSums> = {}): MetaRow =>
  ({ ...meta(over), date, period, campaignId: "c", campaignName: "Alpha", adsetId: "a", adId: "ad" }) as unknown as MetaRow;
const trendRows: MetaRow[] = [
  metaRow("current", "2026-09-10"),
  metaRow("current", "2026-09-11"),
  metaRow("comparison", "2026-08-10", { spend: 10_000, revenue: 30_000 }),
  metaRow("comparison", "2026-08-11", { spend: 10_000, revenue: 30_000 }),
];
try {
  const trend = (mode: DeltaMode) =>
    html(
      createElement(MetaTrend, {
        rows: trendRows,
        range: { from: "2026-09-10", to: "2026-09-11" },
        comparison: { from: "2026-08-10", to: "2026-08-11" },
        currency: "CZK",
      }),
      mode
    );
  const tPct = trend("pct");
  const tAbs = trend("abs");
  check("MetaTrend pct has percent chips", tPct.includes("%"), tPct.slice(0, 300));
  check("MetaTrend abs has ratio and money chips", tAbs.includes("×") && tAbs.includes("CZK"), tAbs.slice(0, 300));
  check("MetaTrend Link CTR chip is points in both modes", tPct.includes(" pp") && tAbs.includes(" pp"));
} catch (e) {
  failures.push(`MetaTrend render threw: ${e instanceof Error ? e.message : String(e)}`);
}

const metaCampaign = (id: string, name: string, cur: Partial<MetaSums>, prev: Partial<MetaSums> | null): MetaCampaign => ({
  campaignId: id,
  name,
  funnelStage: "prospecting" as MetaCampaign["funnelStage"],
  market: null,
  current: meta(cur),
  previous: prev ? meta(prev) : null,
});
const mcRows: MetaCampaign[] = [
  metaCampaign("1", "Alpha", {}, { spend: 10_000, revenue: 30_000, purchases: 30 }),
  metaCampaign("2", "Tiny", { spend: 80, revenue: 100, purchases: 1 }, { spend: 60, revenue: 60, purchases: 1 }),
  metaCampaign("3", "NoPrev", {}, null),
];
const mcSearch = {} as never;
const mcView = { range: { from: "2026-09-10", to: "2026-09-11" } } as never;
try {
  const mc = (mode: DeltaMode) =>
    html(
      createElement(MetaCampaigns, {
        campaigns: mcRows,
        videoByCampaign: new Map(),
        currency: "CZK",
        hasComparison: true,
        cols: "outcome",
        stage: "all",
        market: "all",
        stageOptions: [],
        marketOptions: [],
        search: mcSearch,
        view: mcView,
      }),
      mode
    );
  const cPct = mc("pct");
  const cAbs = mc("abs");
  check("MetaCampaigns pct: spend delta percent", cPct.includes("20.0%"), cPct.slice(0, 500));
  check("MetaCampaigns abs: compact spend delta", cAbs.includes("CZK 2K") && !cAbs.includes("20.0%"), cAbs.slice(0, 500));
  check("MetaCampaigns: no previous row is n/a", (cPct.match(/>n\/a</g) ?? []).length >= 2 && (cAbs.match(/>n\/a</g) ?? []).length >= 2);
} catch (e) {
  failures.push(`MetaCampaigns render threw: ${e instanceof Error ? e.message : String(e)}`);
}

const cellPct = html(createElement("div", null, DeltaCell({ change: { current: 1.2, previous: 1.0, kind: "ratio" } })), "pct");
const cellAbs = html(createElement("div", null, DeltaCell({ change: { current: 1.2, previous: 1.0, kind: "ratio" } })), "abs");
const cellNone = html(createElement("div", null, DeltaCell({ change: null })), "abs");
check("DeltaCell pct", cellPct.includes("20.0%"), cellPct);
check("DeltaCell abs", cellAbs.includes("0.20×"), cellAbs);
check("DeltaCell missing is n/a", cellNone.includes("n/a"), cellNone);

// ---------------------------------------------------------------------------
// Google tab
// ---------------------------------------------------------------------------
const gm = (over: Partial<GadsMetrics> = {}): GadsMetrics => ({
  spend: 20_000,
  impressions: 500_000,
  clicks: 10_000,
  conversions: 100,
  value: 100_000,
  daysWithDelivery: 30,
  isImpressions: 300_000,
  eligibleImpressions: 400_000,
  lostBudgetImpressions: 40_000,
  lostRankImpressions: 60_000,
  topImpressions: null,
  topEligibleImpressions: null,
  absTopImpressions: null,
  clickShareClicks: null,
  eligibleClicks: null,
  ...over,
});
const gc = (id: string, name: string, cls: GadsCampaignAgg["brandClass"], cur: Partial<GadsMetrics>, prev: Partial<GadsMetrics> | null): GadsCampaignAgg => ({
  campaignId: id,
  campaignName: name,
  channelType: "SEARCH",
  brandClass: cls,
  status: "ENABLED",
  biddingStrategyType: null,
  targetRoas: null,
  budgetPerDay: 1_000,
  budgetShared: false,
  current: gm(cur),
  previous: prev ? gm(prev) : null,
});
const gRows = [
  gc("1", "Brand", "brand", {}, { spend: 16_000, value: 64_000, conversions: 80, isImpressions: 280_000 }),
  gc("2", "Generic", "non_brand", { spend: 10_000, value: 5_000, conversions: 20 }, { spend: 12_000, value: 6_000, conversions: 25 }),
];
const leakage = { current: { brandSpend: 500, totalSpend: 10_000 }, previous: { brandSpend: 300, totalSpend: 10_000 } };
const gk = (mode: DeltaMode) => html(createElement(GoogleKpis, { campaigns: gRows, leakage, currency: "CZK", compare: true }), mode);
const gkPct = gk("pct");
const gkAbs = gk("abs");
check("GoogleKpis pct has percent", gkPct.includes("%"));
check("GoogleKpis abs: spend in money", gkAbs.includes("CZK 2,000"), gkAbs.slice(0, 400));
check("GoogleKpis abs: conversions count change (120 vs 105)", gkAbs.includes("▲15<") || gkAbs.includes(">15<"), gkAbs.slice(0, 600));
check("GoogleKpis rates are points in both modes", (gkPct.match(/ pp</g) ?? []).length === (gkAbs.match(/ pp</g) ?? []).length && (gkAbs.match(/ pp</g) ?? []).length >= 4, `${(gkPct.match(/ pp</g) ?? []).length} vs ${(gkAbs.match(/ pp</g) ?? []).length}`);
check("GoogleKpis no old 'pp' without a space", !/\d\.\dpp/.test(gkPct + gkAbs));
const gkOff = html(createElement(GoogleKpis, { campaigns: gRows, leakage, currency: "CZK", compare: false }), "abs");
check("GoogleKpis compare off: no chips", !gkOff.includes("▲") && !gkOff.includes("▼") && !gkOff.includes("→"));

const bs = (mode: DeltaMode) => html(createElement(BrandSplit, { campaigns: gRows, currency: "CZK", compare: true }), mode);
check("BrandSplit pct has percent", bs("pct").includes("%"));
check("BrandSplit abs: money and points", bs("abs").includes("CZK 4,000") && bs("abs").includes(" pp"), bs("abs").slice(0, 400));

try {
  const gcamp = (mode: DeltaMode) =>
    html(
      createElement(GoogleCampaigns, {
        campaigns: gRows,
        currency: "CZK",
        compare: true,
        cols: "outcome",
        cls: "all",
        selectedId: null,
        hrefFor: () => "/x",
      }),
      mode
    );
  const gcPct = gcamp("pct");
  const gcAbs = gcamp("abs");
  check("GoogleCampaigns pct: spend delta percent", gcPct.includes("25.0%"), gcPct.slice(0, 500));
  check("GoogleCampaigns abs: compact spend delta", gcAbs.includes("CZK 4K") && !gcAbs.includes("25.0%"), gcAbs.slice(0, 500));
} catch (e) {
  failures.push(`GoogleCampaigns render threw: ${e instanceof Error ? e.message : String(e)}`);
}

// ---------------------------------------------------------------------------
// GA4 tab
// ---------------------------------------------------------------------------
const gt = (over: Partial<Ga4Totals>): Ga4Totals => ({
  rows: 30,
  sessions: 10_000,
  sessionsPurchase: 300,
  purchases: 320,
  revenue: 400_000,
  allRevenue: 800_000,
  unattributedRevenue: 0,
  fxMissing: 0,
  ...over,
});
const g4 = (mode: DeltaMode, previous: Ga4Totals | null) =>
  html(createElement(Ga4Kpis, { kpis: { current: gt({}), previous }, currency: "CZK" }), mode);
const prevT = gt({ sessions: 8_000, sessionsPurchase: 200, purchases: 250, revenue: 300_000, allRevenue: 750_000 });
const g4Pct = g4("pct", prevT);
const g4Abs = g4("abs", prevT);
check("Ga4Kpis pct: sessions +25.0%", g4Pct.includes("25.0%"), g4Pct.slice(0, 300));
check("Ga4Kpis abs: sessions +2,000 and revenue CZK 100,000", g4Abs.includes("2,000") && g4Abs.includes("CZK 100,000"), g4Abs.slice(0, 400));
check("Ga4Kpis rates are points (CVR 3.00% vs 2.50%: 0.5 pp), both modes", g4Pct.includes("0.5 pp") && g4Abs.includes("0.5 pp"), g4Pct);
check("Ga4Kpis no comparison: no chips", !g4("abs", null).includes("▲") && !g4("abs", null).includes("▼"));

// ---------------------------------------------------------------------------
// Sort keys follow the mode on screen
// ---------------------------------------------------------------------------
{
  // Tiny base, big relative move vs big base, small relative move: the two modes order them differently.
  const a = { current: 150, previous: 100, kind: "money" as const, currency: "CZK" }; // +50%, +50
  const b = { current: 1_010_000, previous: 1_000_000, kind: "money" as const, currency: "CZK" }; // +1%, +10,000
  const ka = sortKeyFor(deltaSortKey(a), "pct") as number;
  const kb = sortKeyFor(deltaSortKey(b), "pct") as number;
  const ka2 = sortKeyFor(deltaSortKey(a), "abs") as number;
  const kb2 = sortKeyFor(deltaSortKey(b), "abs") as number;
  check("sort: pct orders by relative change", ka > kb);
  check("sort: abs orders by difference", kb2 > ka2);
}

// ---------------------------------------------------------------------------
// Source pins
// ---------------------------------------------------------------------------
for (const f of OWNED) {
  const s = read(f);
  check(`no em dash: ${f}`, !s.includes(EM_DASH));
  check(`no PpChip left: ${f}`, !/PpChip/.test(s));
  check(`no legacy delta prop on a chip: ${f}`, !/<(DeltaChip|KpiTile|MetricCard|PaidTile)[^>]*\sdelta=/.test(s.replace(/\n/g, " ")));
}
check("cells.tsx has no local point chip", !/export function PpChip/.test(read("components/paid/meta/cells.tsx")));
check("google parts.tsx has no local point chip", !/export function PpChip/.test(read("components/paid/google/parts.tsx")));
for (const f of [
  "components/paid/meta/MetaKpis.tsx",
  "components/paid/meta/MetaTrend.tsx",
  "components/paid/meta/MetaCampaigns.tsx",
  "components/paid/google/GoogleKpis.tsx",
  "components/paid/google/BrandSplit.tsx",
  "components/paid/google/GoogleCampaigns.tsx",
  "components/paid/ga4/Ga4Kpis.tsx",
  "components/paid/overview/CampaignsAcross.tsx",
  "app/(app)/paid/page.tsx",
]) {
  const s = read(f);
  check(`no relativeChange or pointChange: ${f}`, !/\b(relativeChange|pointChange)\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, "")));
}
for (const f of [
  "components/paid/meta/MetaCampaigns.tsx",
  "components/paid/google/GoogleCampaigns.tsx",
  "components/paid/overview/CampaignsAcross.tsx",
]) {
  check(`delta columns sort with deltaSortKey: ${f}`, /deltaSortKey\(/.test(read(f)));
}
check("compact money in narrow delta cells: Meta", /compact: true/.test(read("components/paid/meta/MetaCampaigns.tsx")));
check("compact money in narrow delta cells: Google", /compact: true/.test(read("components/paid/google/GoogleCampaigns.tsx")));
check("compact money in narrow delta cells: Overview", /compact: true/.test(read("components/paid/overview/CampaignsAcross.tsx")));
check("overview page passes change, not delta", /change=\{change\(/.test(read("app/(app)/paid/page.tsx")) && !/\sdelta=\{/.test(read("app/(app)/paid/page.tsx")));
check("hit rate tile survives", /HitRateTile/.test(read("app/(app)/paid/meta/page.tsx")));

console.log(`check:delta-paid ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
