/**
 * Runs every Creative Engine query against the real warehouse.
 *
 *     npm run check:queries              # manami
 *     npm run check:queries -- dobias
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `check:creative` proves the arithmetic; `tsc` proves the types; neither one
 * touches BigQuery. Two of the defects that reached production on these screens
 * were invisible to both — a `HAVING SUM(spend)` that BigQuery resolves against
 * a SELECT alias into `SUM(SUM(spend))`, and a correlated `UNNEST` join it
 * refuses outright. Both are valid TypeScript producing invalid SQL, and the
 * first request to the screen is where they surfaced.
 *
 * So this issues each query for real, across a spread of ranges, and asserts
 * the results are coherent with each other: a narrower range cannot return more
 * spend than a wider one containing it, a comparison period cannot be the
 * current period, an ad cannot appear twice.
 *
 * ── Credentials ────────────────────────────────────────────────────────────
 * Application Default Credentials — `gcloud auth application-default login`.
 * The service-account key is a production concern and is not needed here; this
 * only reads `mart`.
 *
 * Exits non-zero on a mismatch.
 */

import {
  getAdBreakdowns,
  getAdsetLaunchDates,
  getConcepts,
  getCreativeAds,
  getCreativeAssets,
  getCreativeTotals,
  getPersonas,
  getTagCoverage,
  getUnmapped,
} from "@/lib/queries/creative";
import { comparisonRange, daysInRange, presetRange, type DateRange } from "@/lib/period";

process.env.GCP_PROJECT_ID ??= "oneeighty-warehouse";

const clientId = process.argv[2] ?? "manami";

let fails = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "ok  " : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};
const kc = (v: number) => Math.round(v).toLocaleString("en-US");
const label = (r: DateRange) => `${r.from} → ${r.to}`;

async function main() {
  console.log(`\nclient: ${clientId}\n`);

  // ── Every preset the picker offers ─────────────────────────────────────
  const presets = ["7d", "30d", "90d", "12m", "all"] as const;
  const results: Array<{ key: string; range: DateRange; ads: number; spend: number; purchases: number }> = [];

  console.log("=== every preset the date picker offers ===");
  for (const key of presets) {
    const range = presetRange(key);
    const data = await getCreativeAds(clientId, range);
    const spend = data.ads.reduce((a, b) => a + b.components.spend, 0);
    const purchases = data.ads.reduce((a, b) => a + b.components.purchases, 0);
    results.push({ key, range, ads: data.ads.length, spend, purchases });

    console.log(
      `   ${key.padEnd(4)} ${label(range)}  ${String(data.ads.length).padStart(4)} ads  ` +
        `${kc(spend).padStart(9)}  ${String(purchases).padStart(5)} purchases  ` +
        `${data.adsets.length} ad sets`
    );
    ok(`${key}: query returns`, data.available, data.missing ?? "");
    ok(
      `${key}: no ad appears twice`,
      new Set(data.ads.map((a) => a.adId)).size === data.ads.length
    );
    ok(
      `${key}: every returned ad actually spent`,
      data.ads.every((a) => a.components.spend > 0)
    );
  }

  // A range contained in another cannot hold more of anything. This is the
  // assertion that would have caught a `WHERE` clause that stopped filtering.
  console.log("\n=== a narrower range is a subset of a wider one ===");
  for (let i = 1; i < results.length; i++) {
    const narrow = results[i - 1];
    const wide = results[i];
    ok(
      `${narrow.key} ⊆ ${wide.key} on spend`,
      narrow.spend <= wide.spend + 1,
      `${kc(narrow.spend)} ≤ ${kc(wide.spend)}`
    );
    ok(
      `${narrow.key} ⊆ ${wide.key} on ads`,
      narrow.ads <= wide.ads,
      `${narrow.ads} ≤ ${wide.ads}`
    );
  }

  // ── A custom range, which is what the picker's calendar produces ────────
  console.log("\n=== a custom range ===");
  const custom: DateRange = { from: "2026-07-01", to: "2026-07-14" };
  const customData = await getCreativeAds(clientId, custom);
  const customSpend = customData.ads.reduce((a, b) => a + b.components.spend, 0);
  console.log(
    `   ${label(custom)}  ${customData.ads.length} ads  ${kc(customSpend)}` +
      (customData.ads.length === 0 ? "   (this client was not running then)" : "")
  );
  // Not "returns rows" — Venev launched in August, so an empty July is the
  // right answer for it and asserting otherwise would make this script pass
  // only for the client it was written against. What must hold for everyone is
  // that the fortnight is contained in the quarter around it.
  ok(
    "a custom range is contained in the 90 days around it",
    customSpend <= (results.find((r) => r.key === "90d")?.spend ?? Infinity) + 1,
    `${kc(customSpend)} ≤ ${kc(results.find((r) => r.key === "90d")?.spend ?? 0)}`
  );

  // ── Both comparison modes ──────────────────────────────────────────────
  console.log("\n=== comparison periods ===");
  const current = presetRange("30d");
  for (const mode of ["previous_period", "previous_year"] as const) {
    const prev = comparisonRange(current, mode)!;
    const totals = await getCreativeTotals(clientId, prev);
    console.log(
      `   ${mode.padEnd(16)} ${label(prev)}  ` +
        (totals
          ? `${kc(totals.spend)}  ${totals.purchases} purchases  ROAS ${(totals.revenue / totals.spend).toFixed(2)}`
          : "no delivery in this period")
    );
    ok(`${mode}: same length as the current range`,
       mode === "previous_year" || daysInRange(prev) === daysInRange(current));
    ok(`${mode}: does not overlap the current range`, prev.to < current.from);
    if (totals) {
      ok(`${mode}: totals are positive`, totals.spend > 0 && totals.impressions > 0);
    }
  }

  // A comparison range before the account existed must come back null, not
  // zero — a delta against zero reads as infinite growth.
  const ancient = await getCreativeTotals(clientId, { from: "2015-01-01", to: "2015-01-31" });
  ok("a period before the account existed returns null, not a zero baseline", ancient === null);

  // ── The range-independent reads, which every screen also issues ─────────
  console.log("\n=== the rest of the screens' queries ===");
  const [assets, unmapped, coverage, personas, concepts, launches] = await Promise.all([
    getCreativeAssets(clientId),
    getUnmapped(clientId),
    getTagCoverage(clientId),
    getPersonas(clientId),
    getConcepts(clientId),
    getAdsetLaunchDates(clientId),
  ]);
  console.log(
    `   assets ${assets.size}   unmapped ${unmapped.ads.length}   personas ${personas.length}   ` +
      `concepts ${concepts.length}   launches ${launches.length}   ` +
      `tagged ${coverage.pctSpendTagged === null ? "—" : `${Math.round(coverage.pctSpendTagged * 100)}%`}`
  );
  ok("assets resolve", assets.size > 0);
  ok("the unmapped queue answers", unmapped.available);
  ok("launch dates are ISO days", launches.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  ok(
    "no concept is captioned with a ClickUp task id",
    concepts.every((c) => c.conceptCode === null || !/^[0-9a-z]{9}$/.test(c.conceptCode))
  );

  // The ad detail panel's own query, on the highest-spend ad.
  const top = results.find((r) => r.key === "all");
  if (top && top.ads > 0) {
    const all = await getCreativeAds(clientId, presetRange("all"));
    const breakdowns = await getAdBreakdowns(clientId, all.ads[0].adId);
    console.log(
      `   breakdowns for ${all.ads[0].adName.slice(0, 40)}: ` +
        `${breakdowns.ages.length} age rows, ${breakdowns.placements.length} placement rows` +
        (breakdowns.femaleShare === null ? "" : `, ${Math.round(breakdowns.femaleShare * 100)}% female`)
    );
    ok("the ad detail breakdown query runs", Array.isArray(breakdowns.ages));
  }

  console.log(
    fails ? `\n${fails} check(s) failed — see above.` : "\nEvery query ran, and the ranges agree."
  );
  if (fails) process.exit(1);
}

main().catch((e) => {
  console.error("\nquery failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
