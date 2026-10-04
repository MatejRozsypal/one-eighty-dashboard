/**
 * Asserts the Paid foundation: ratio math, low volume, impression share,
 * time buckets, links, nav gating and the new metric definitions.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-paid-math.ts
 *
 * Pure modules only: no BigQuery, no session. Exits non-zero on a mismatch.
 */

import {
  ratio, sumOf, ratioOfSums, perThousand, relativeChange, pointChange,
  isLowVolume, unlessLowVolume, LOW_VOLUME_MIN_PURCHASES,
  searchImpressionShare, lostBudgetShare, lostRankShare, topImpressionShare, absTopImpressionShare,
  brandShare, nonBrandRoas, brandLeakage, overClaim, trackingCoverage,
  bucketGrain, bucketStart, funnelShare,
} from "@/lib/paid/math";
import { tabHref, creativeHref } from "@/lib/paid/links";
import { navFor, PAID_TABS, activeNavHref, pageTitle } from "@/lib/nav";
import { pageAvailability } from "@/lib/capabilities";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import type { ClientCapabilities } from "@/lib/clients";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Funnel } from "@/components/dashboard/Funnel";
import { funnelSteps, hookRate, sumVideo, type MetaSums } from "@/components/paid/meta/aggregate";

let failures = 0;
let checks = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}
/** Close enough for floating point. */
function near(label: string, actual: number | null, expected: number, eps = 1e-9) {
  checks++;
  if (actual === null || Math.abs(actual - expected) > eps) {
    failures++;
    console.error(`FAIL ${label}: got ${actual}, want ${expected}`);
  }
}

// ── ratio, sumOf, ratioOfSums ───────────────────────────────────────────────
eq("ratio basic", ratio(10, 4), 2.5);
eq("ratio zero denominator", ratio(10, 0), null);
eq("ratio null numerator", ratio(null, 4), null);
eq("ratio null denominator", ratio(4, null), null);
eq("ratio undefined", ratio(undefined, 4), null);
eq("ratio zero numerator is zero, not null", ratio(0, 4), 0);
eq("sumOf nothing", sumOf([] as { v: number | null }[], (r) => r.v), null);
eq("sumOf all null", sumOf([{ v: null }, { v: null }], (r) => r.v), null);
eq("sumOf skips null", sumOf([{ v: 1 }, { v: null }, { v: 2 }], (r) => r.v), 3);

// The reason the rule exists: a big day and a tiny day.
const days = [
  { clicks: 100, impressions: 10_000 },
  { clicks: 1, impressions: 100 },
];
const avgOfRatios = (0.01 + 0.01) / 2;
const sumRatio = ratioOfSums(days, (r) => r.clicks, (r) => r.impressions);
near("ratioOfSums is sum/sum", sumRatio, 101 / 10_100);
eq("ratioOfSums differs from the mean of ratios here", Math.abs((sumRatio ?? 0) - avgOfRatios) < 1e-12, true);
const uneven = [
  { clicks: 90, impressions: 1_000 },
  { clicks: 1, impressions: 1_000 },
  { clicks: 9, impressions: 8_000 },
];
near("ratioOfSums uneven", ratioOfSums(uneven, (r) => r.clicks, (r) => r.impressions), 100 / 10_000);
eq("mean of ratios is not the answer", Math.abs((0.09 + 0.001 + 0.001125) / 3 - 0.01) > 0.01, true);
eq(
  "ratioOfSums where",
  ratioOfSums(
    [{ p: 50, i: 100 }, { p: 0, i: 900 }],
    (r) => r.p, (r) => r.i, (r) => r.p > 0
  ),
  0.5
);
eq("ratioOfSums empty", ratioOfSums([] as { a: number }[], (r) => r.a, (r) => r.a), null);
near("perThousand", perThousand(50, 10_000), 5);
eq("perThousand null", perThousand(null, 10_000), null);
near("relativeChange up", relativeChange(120, 100), 0.2);
near("relativeChange down", relativeChange(80, 100), -0.2);
eq("relativeChange zero previous", relativeChange(10, 0), null);
eq("relativeChange null previous", relativeChange(10, null), null);
near("pointChange", pointChange(0.35, 0.3), 0.05);
eq("pointChange null", pointChange(null, 0.3), null);

// ── Low volume ──────────────────────────────────────────────────────────────
eq("low volume constant", LOW_VOLUME_MIN_PURCHASES, 3);
eq("low volume: tiny spend share", isLowVolume({ spend: 5, purchases: 50 }, 1000), true);
eq("low volume: exactly 1% is not low", isLowVolume({ spend: 10, purchases: 50 }, 1000), false);
eq("low volume: 2 purchases", isLowVolume({ spend: 500, purchases: 2 }, 1000), true);
eq("low volume: 3 purchases is enough", isLowVolume({ spend: 500, purchases: 3 }, 1000), false);
eq("low volume: null purchases is not low", isLowVolume({ spend: 500, purchases: null }, 1000), false);
eq("low volume: null spend is not low", isLowVolume({ spend: null, purchases: 10 }, 1000), false);
eq("low volume: null total", isLowVolume({ spend: 5, purchases: 10 }, null), false);
eq("low volume: zero purchases", isLowVolume({ spend: 500, purchases: 0 }, 1000), true);
eq("unlessLowVolume low", unlessLowVolume(3.2, true), null);
eq("unlessLowVolume ok", unlessLowVolume(3.2, false), 3.2);

// ── Impression share: re-aggregation from components ────────────────────────
// Row A: 1,000 impressions at 50% IS (eligible 2,000). Row B: 100 at 10% (eligible 1,000).
const isRows = [
  { isImpressions: 1000, eligibleImpressions: 2000, lostBudgetImpressions: 400, lostRankImpressions: 600, topImpressions: 1200, topEligibleImpressions: 2000, absTopImpressions: 500 },
  { isImpressions: 100, eligibleImpressions: 1000, lostBudgetImpressions: 500, lostRankImpressions: 400, topImpressions: 100, topEligibleImpressions: 1000, absTopImpressions: 50 },
  // Not reported: nulls in every component, must not drag anything to zero.
  { isImpressions: null, eligibleImpressions: null, lostBudgetImpressions: null, lostRankImpressions: null, topImpressions: null, topEligibleImpressions: null, absTopImpressions: null },
];
near("search IS", searchImpressionShare(isRows), 1100 / 3000);
eq("search IS is not the mean of shares", Math.abs((searchImpressionShare(isRows) ?? 0) - 0.3) > 0.06, true);
near("lost budget", lostBudgetShare(isRows), 900 / 3000);
near("lost rank", lostRankShare(isRows), 1000 / 3000);
near("top IS", topImpressionShare(isRows), 1300 / 3000);
near("abs top IS", absTopImpressionShare(isRows), 550 / 3000);
near("IS components sum to one", (searchImpressionShare(isRows) ?? 0) + (lostBudgetShare(isRows) ?? 0) + (lostRankShare(isRows) ?? 0), 1);
eq("IS none reported", searchImpressionShare([isRows[2]]), null);
eq("IS no rows", searchImpressionShare([]), null);

// ── Google brand metrics ────────────────────────────────────────────────────
const camps = [
  { spend: 100, value: 900, brandClass: "brand" as const },
  { spend: 300, value: 600, brandClass: "non_brand" as const },
  { spend: 400, value: 1200, brandClass: "shopping_pmax" as const },
  { spend: 200, value: 0, brandClass: "other" as const },
];
near("brand share", brandShare(camps), 0.1);
near("non-brand ROAS", nonBrandRoas(camps), 1800 / 700);
eq("brand share no spend", brandShare([{ spend: null, brandClass: "brand" }]), null);
eq("brand share without brand rows is 0", brandShare([{ spend: 10, brandClass: "non_brand" }]), 0);
eq("non-brand ROAS no rows", nonBrandRoas([{ spend: 5, value: 5, brandClass: "brand" }]), null);
const terms = [
  { spend: 40, isBrand: true, campaignBrandClass: "non_brand" as const },
  { spend: 160, isBrand: false, campaignBrandClass: "non_brand" as const },
  { spend: 500, isBrand: true, campaignBrandClass: "brand" as const },
];
near("brand leakage", brandLeakage(terms), 0.2);
eq("brand leakage without non-brand campaigns", brandLeakage([terms[2]]), null);
near("over-claim", overClaim(1500, 1000), 1.5);
eq("over-claim no GA4", overClaim(1500, 0), null);
near("tracking coverage", trackingCoverage(850, 1000), 0.85);

// ── Time buckets ────────────────────────────────────────────────────────────
const span = (n: number) => ({ from: "2026-01-01", to: new Date(Date.UTC(2026, 0, n)).toISOString().slice(0, 10) });
eq("grain 1 day", bucketGrain(span(1)), "day");
eq("grain 45 days", bucketGrain(span(45)), "day");
eq("grain 46 days", bucketGrain(span(46)), "week");
eq("grain 180 days", bucketGrain(span(180)), "week");
eq("grain 181 days", bucketGrain(span(181)), "month");
eq("grain 30d preset length", bucketGrain({ from: "2026-09-04", to: "2026-10-03" }), "day");
eq("bucketStart day", bucketStart("2026-10-04", "day"), "2026-10-04");
eq("bucketStart week from Sunday", bucketStart("2026-10-04", "week"), "2026-09-28");
eq("bucketStart week from Monday", bucketStart("2026-10-05", "week"), "2026-10-05");
eq("bucketStart week from Wednesday", bucketStart("2026-10-07", "week"), "2026-10-05");
eq("bucketStart week crosses month", bucketStart("2026-03-01", "week"), "2026-02-23");
eq("bucketStart month", bucketStart("2026-10-31", "month"), "2026-10-01");

// ── Links ───────────────────────────────────────────────────────────────────
eq("tabHref overview, no query", tabHref("overview"), "/paid");
eq("tabHref keeps the query", tabHref("meta", "client=a&preset=30d&compare=none"), "/paid/meta?client=a&preset=30d&compare=none");
eq("tabHref accepts a leading ?", tabHref("google", "?client=a"), "/paid/google?client=a");
eq("tabHref accepts URLSearchParams", tabHref("ga4", new URLSearchParams("client=a&from=2026-09-01&to=2026-09-30&preset=custom")),
  "/paid/ga4?client=a&from=2026-09-01&to=2026-09-30&preset=custom");
eq("tabHref drop", tabHref("meta", "client=a&campaign=9", { drop: ["campaign"] }), "/paid/meta?client=a");
eq("tabHref empty query", tabHref("meta", ""), "/paid/meta");
const view = { clientId: "a", presetKey: "30d" as const, range: { from: "2026-09-04", to: "2026-10-03" }, comparisonMode: "previous_year" as const };
eq("creativeHref preset", creativeHref(view), "/creative?client=a&preset=30d&compare=previous_year");
eq("creativeHref custom range", creativeHref({ ...view, presetKey: "custom" }),
  "/creative?client=a&preset=custom&from=2026-09-04&to=2026-10-03&compare=previous_year");
eq("creativeHref ad focus", creativeHref(view, { field: "adId", value: "123" }),
  "/creative?client=a&preset=30d&compare=previous_year&focus=adId&is=123");
eq("creativeHref campaign focus is by ID", creativeHref(view, { field: "campaignId", value: "120246928041830098" }),
  "/creative?client=a&preset=30d&compare=previous_year&focus=campaignId&is=120246928041830098");
eq("creativeHref focus value is encoded", creativeHref(view, { field: "adId", value: "a b&c" }),
  "/creative?client=a&preset=30d&compare=previous_year&focus=adId&is=a+b%26c");
eq("creativeHref no client", creativeHref({ ...view, clientId: undefined }), "/creative?preset=30d&compare=previous_year");

// ── Funnel shares above 100 percent are n/a ─────────────────────────────────
eq("funnelShare below 1", funnelShare(50, 100), 0.5);
eq("funnelShare exactly 1", funnelShare(100, 100), 1);
eq("funnelShare above 1 is null", funnelShare(345, 129), null);
eq("funnelShare zero base is null", funnelShare(5, 0), null);
eq("funnelShare null value is null", funnelShare(null, 5), null);

// Dobias-shaped fixture: 129 payment-info events, then 345 purchases (267.4 percent of previous).
const fx: MetaSums = {
  spend: 1000, revenue: 4000, purchases: 345, impressions: 100000, reach: 50000, addToCart: 800,
  initiateCheckout: 400, landingPageViews: 3000, linkClicks: 3500, viewContent: 3600, addPaymentInfo: 129,
};
const steps = funnelSteps(fx).map((s) => ({ label: s.label, value: s.value }));
const html = renderToStaticMarkup(createElement(Funnel, { steps, nonSequential: true }));
eq("Meta funnel: purchases step shows no 267.4%", html.includes("267.4%"), false);
eq("Meta funnel: View content (above LPV) shows n/a of previous", html.includes("n/a of previous"), true);
eq("Meta funnel: a normal step still shows its rate", html.includes("50.0% of previous"), true);
const plain = renderToStaticMarkup(createElement(Funnel, { steps }));
eq("default funnel is unchanged (sequential)", plain.includes("267.4% of previous"), true);

// ── Hook rate: 3-second plays over video-ad impressions ─────────────────────
near("hook rate", hookRate({ plays: 170, thruplays: 40, impressions: 1000 }), 0.17);
eq("hook rate without video ads", hookRate({ plays: null, thruplays: null, impressions: null }), null);
near("hook rate sums components, not rates", hookRate(sumVideo([
  { plays: 100, thruplays: 20, impressions: 1000 },
  { plays: 10, thruplays: 2, impressions: 9000 },
])), 0.011);

// ── Nav: Paid is internal only; tabs and titles ─────────────────────────────
const caps = (on: Partial<ClientCapabilities>) => ({
  capabilities: {
    shopify: false, shoptet: false, woocommerce: false, klaviyo: false, ecomail: false,
    meta: false, googleAds: false, ga4: false, instagram: false, ...on,
  } as ClientCapabilities,
});
const manami = caps({ shoptet: true, meta: true, googleAds: true });
const hrefsOf = (groups: ReturnType<typeof navFor>) => groups.flatMap((g) => g.items.map((i) => i.href));
eq("client role: no Paid", hrefsOf(navFor(false, manami)).includes("/paid"), false);
eq("client role: no Paid (no client)", hrefsOf(navFor(false)).includes("/paid"), false);
eq("agency: Paid", hrefsOf(navFor(false, manami, true)).includes("/paid"), true);
eq("admin: Paid (isInternal defaults to isAdmin)", hrefsOf(navFor(true, manami)).includes("/paid"), true);
eq("Marketing keeps Email for the client role", hrefsOf(navFor(false, caps({ shopify: true, klaviyo: true }))).includes("/email"), true);
eq("tab keys", PAID_TABS.map((t) => t.key), ["overview", "meta", "google", "ga4"]);
eq("tab labels", PAID_TABS.map((t) => t.label), ["Overview", "Meta", "Google", "GA4"]);
eq("tab hrefs", PAID_TABS.map((t) => t.href), ["/paid", "/paid/meta", "/paid/google", "/paid/ga4"]);
eq("tab availability, Google-only client", PAID_TABS.map((t) => pageAvailability(caps({ googleAds: true }), t.href)),
  ["available", "not-connected", "available", "not-connected"]);
eq("tab availability, Meta + GA4", PAID_TABS.map((t) => pageAvailability(caps({ meta: true, ga4: true }), t.href)),
  ["available", "available", "not-connected", "available"]);
eq("active /paid/ga4", activeNavHref("/paid/ga4"), "/paid");
eq("title /paid/meta", pageTitle("/paid/meta"), "Paid");

// ── Metric definitions ──────────────────────────────────────────────────────
const NEW_KEYS = [
  "nCAC", "CAC (blended)", "Link CTR", "Cost / LPV", "Cost / ATC", "ATC to purchase", "Hook rate",
  "Hold rate", "Avg daily frequency", "Search IS", "Lost IS (budget)", "Lost IS (rank)", "Brand share",
  "Brand leakage", "Over-claim", "Tracking coverage", "Non-brand ROAS",
];
// Built from code points so this file itself carries no dash character.
const DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
for (const key of NEW_KEYS) {
  const d = METRIC_DEFINITIONS[key];
  eq(`definition exists: ${key}`, d !== undefined, true);
  if (!d) continue;
  const all = [d.title, d.formula, d.source, d.note ?? "", d.limitation ?? ""].join(" ");
  eq(`${key} is 40 words or fewer`, words(all) <= 40, true);
  eq(`${key} has no em or en dash`, DASHES.test(all), false);
  eq(`${key} has no snake_case`, /[a-z]+_[a-z]+/.test(all), false);
  eq(`${key} names no client`, /dobias|manami|venev|ethia|rawbark/i.test(all), false);
  eq(`${key} has a note or a limitation`, Boolean(d.note || d.limitation), true);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
