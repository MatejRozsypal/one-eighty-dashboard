/**
 * Markets Scouting gates (production QA, 2026-10-16).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/check-markets-scouting.ts
 *
 * Pure checks, no warehouse, no server. Pins the rules lib/markets/opportunity.ts
 * added after the prod review; the index math itself stays in check-markets.ts.
 *
 *   - cost to reach is n/a whenever either Meta CPM is missing, and the CPM
 *     pair the table prints is the one the index used (Ethia SK: CZ and SK
 *     from one source, so the table can no longer say n/a beside 100 of 100);
 *   - a regional benchmark row (CEE, GLOBAL) never stands in for a country;
 *   - GA4 under 28 of 90 days is n/a with the reason, never a measured zero
 *     (Venev: 2 of 90 days scored unpaid interest 0 of 100);
 *   - proven pull is labelled as new customers over the last 365 days;
 *   - counts read "1 order", "2 orders", "1 day";
 *   - no em dash in the files this script guards.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GA4_MIN_DAYS,
  SIGNALS,
  candidateSignals,
  cpmPair,
  cpmRatio,
  ga4Coverage,
  opportunityIndex,
} from "@/lib/markets/opportunity";
import { plural } from "@/lib/markets/analysis";
import type { CpmBenchmark, ScoutSignalRow, ScoutingSignalsRaw } from "@/lib/markets/types";

const ROOT = join(__dirname, "..");

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed += 1;
  else failures.push(detail ? `${name}: ${detail}` : name);
}
const close = (a: number | null | undefined, b: number, tol = 1e-9) => typeof a === "number" && Math.abs(a - b) <= tol;

const bm = (iso: string, value: number, source: string, currency: string | null = "USD", vertical = "all_ecommerce"): CpmBenchmark => ({
  iso,
  vertical,
  value,
  currency,
  source,
  asOf: "2026-10-15",
});

function row(iso: string, p: Partial<ScoutSignalRow> = {}): ScoutSignalRow {
  return {
    iso, orders365: 0, newCustomers365: 0, netRevenue365: 0, aovNew365: null, ga4Days90: null, sessions90: null,
    engagedSessions90: null, unpaidEngagedSessions90: null, addToCartSessions90: null, ga4Purchases90: null,
    searchVolumeCore: null, searchTermsCore: null, searchAsOf: null, ...p,
  };
}

// The prod benchmark table as of 2026-10-15 (ref.industry_benchmarks, meta_cpm).
const PROD_CPM: CpmBenchmark[] = [
  ...[["AT", 9.5], ["CA", 13.4], ["CZ", 6.2], ["DE", 10.05], ["GB", 10.31], ["IE", 10.8], ["PL", 5.5], ["US", 23]].map(([i, v]) => bm(i as string, v as number, "AdAmigo")),
  ...[["CA", 12.75], ["CZ", 4.25], ["DE", 9.5], ["GB", 11.5], ["PL", 4.5], ["US", 18.5]].map(([i, v]) => bm(i as string, v as number, "Adligator")),
  ...[["AT", 8.63], ["CA", 11.47], ["CZ", 5.7], ["DE", 9.05], ["GB", 11.81], ["HU", 5.24], ["IE", 8.26], ["PL", 5.55], ["SK", 5.12], ["US", 16.08]].map(([i, v]) => bm(i as string, v as number, "Lebesgue")),
  bm("US", 15.06, "Triple Whale"),
];

// ── Cost to reach and the CPM the table prints ──────────────────────────────
{
  // Ethia (home CZ): SK only exists in Lebesgue, so the pair is Lebesgue CZ + SK.
  const sk = cpmPair("SK", "CZ", PROD_CPM, null);
  check("Ethia SK: a CPM pair exists", !("na" in sk), JSON.stringify(sk));
  if (!("na" in sk)) {
    check("Ethia SK: country CPM is SK's own benchmark", sk.country.iso === "SK" && close(sk.country.value, 5.12));
    check("Ethia SK: home CPM from the same source", sk.home.iso === "CZ" && sk.home.source === sk.country.source && close(sk.home.value, 5.7));
    check("cpmRatio is the pair's ratio", close((cpmRatio("SK", "CZ", PROD_CPM, null) as { v: number }).v, 5.7 / 5.12));
  }

  const signals: ScoutingSignalsRaw = {
    rows: [row("SK", { newCustomers365: 40 }), row("RS", { newCustomers365: 3 }), row("CH", { newCustomers365: 2 }), row("PL", { newCustomers365: 10 })],
    ga4Days90: null,
    vertical: null,
    cpm: PROD_CPM,
  };
  const opp = opportunityIndex(candidateSignals({ candidates: ["SK", "RS", "CH", "PL"], home: "CZ", signals }));
  const by = (iso: string) => opp.find((o) => o.iso === iso)!;
  // The invariant the table relies on: cost scored <=> a pair to print.
  for (const o of opp) {
    check(`${o.iso}: cost scored exactly when a CPM pair is printed`, (o.signals.cost.score !== null) === (o.cpm !== null), JSON.stringify({ score: o.signals.cost.score, cpm: o.cpm }));
  }
  check("SK: cost to reach scored from the pair", by("SK").signals.cost.score !== null && by("SK").cpm?.country.iso === "SK");
  check("RS (Dobias case): no benchmark, cost n/a", by("RS").signals.cost.score === null && by("RS").cpm === null);
  check("RS: n/a names the missing country", "na" in by("RS").signals.cost.raw && (by("RS").signals.cost.raw as { na: string }).na === "No Meta CPM benchmark for RS");
  check("CH (Manami case): no benchmark, cost n/a", by("CH").signals.cost.score === null && by("CH").cpm === null);

  // Missing home CPM: n/a even when the country has one.
  const noHome = cpmPair("SK", "RO", PROD_CPM, null);
  check("missing home CPM: n/a", "na" in noHome && noHome.na.includes("home market (RO)"));
  const noHomeOpp = opportunityIndex(candidateSignals({ candidates: ["SK"], home: "RO", signals }));
  check("missing home CPM: cost n/a and no pair", noHomeOpp[0].signals.cost.score === null && noHomeOpp[0].cpm === null);

  // Regional rows never stand in for a country, even if a query let them through.
  const withRegional = [...PROD_CPM, bm("CEE", 4, "Adligator"), bm("GLOBAL", 7, "Lebesgue")];
  check("CEE row does not give RS a CPM", "na" in cpmPair("RS", "CZ", withRegional, null));
  check("a regional home is not a country", "na" in cpmPair("SK", "CEE", withRegional, null));

  // Source pairing: one source for both; a country only in a narrow source still pairs there.
  const two = [bm("CZ", 6, "Wide"), bm("DE", 10, "Wide"), bm("PL", 5, "Wide"), bm("CZ", 4, "Narrow"), bm("SK", 5, "Narrow")];
  const p = cpmPair("SK", "CZ", two, null);
  check("pair falls to the source that has both", !("na" in p) && p.home.source === "Narrow" && close(p.home.value, 4));
  check("never one CPM from each source", "na" in cpmPair("SK", "CZ", [bm("CZ", 6, "A"), bm("SK", 5, "B")], null));
  check("currency mismatch: n/a", "na" in cpmPair("SK", "CZ", [bm("CZ", 6, "A", "USD"), bm("SK", 5, "A", "EUR")], null));
  check("benchmarks not loaded: n/a", "na" in cpmPair("SK", "CZ", null, null));
}

// ── GA4 coverage: under 28 of 90 days is n/a, not a zero ────────────────────
{
  check("GA4_MIN_DAYS is 28", GA4_MIN_DAYS === 28);
  check("not connected: n/a", !ga4Coverage(null).ok);
  const two = ga4Coverage(2);
  check("2 of 90 days: n/a with the reason", !two.ok && two.na.includes("2 of the last 90 days") && two.na.includes("28"), JSON.stringify(two));
  check("27 days: n/a", !ga4Coverage(27).ok);
  check("28 days: read", ga4Coverage(28).ok);
  check("73 days: read", ga4Coverage(73).ok);

  // Venev: GA4 on 2 of 90 days used to score unpaid interest 0 of 100 as a signal.
  const venev: ScoutingSignalsRaw = {
    rows: [row("GB", { newCustomers365: 6, ga4Days90: 2, engagedSessions90: 1, unpaidEngagedSessions90: 0 }), row("DE", { newCustomers365: 1, ga4Days90: 2, engagedSessions90: 0, unpaidEngagedSessions90: 0 })],
    ga4Days90: 2,
    vertical: null,
    cpm: PROD_CPM,
  };
  const opp = opportunityIndex(candidateSignals({ candidates: ["GB", "DE"], home: "CZ", signals: venev }));
  const gb = opp.find((o) => o.iso === "GB")!;
  check("Venev GB: unpaid interest n/a", gb.signals.unpaid.score === null && "na" in gb.signals.unpaid.raw);
  check("Venev GB: the reason names the coverage", "na" in gb.signals.unpaid.raw && (gb.signals.unpaid.raw as { na: string }).na.includes("2 of the last 90 days"));
  // GB has pull and cost; with 2 GA4 days unpaid is not a third signal.
  check("Venev GB: 2 of 4 signals, unpaid not counted", gb.coverage === 2, String(gb.coverage));
  const full = candidateSignals({ candidates: ["GB"], home: "CZ", signals: { ...venev, ga4Days90: 60 } });
  check("60 days: unpaid is a measured value", "v" in full[0].unpaid && full[0].unpaid.v === 0);
  check("60 days: unpaid counts as a signal", opportunityIndex(full)[0].coverage === 3);
}

// ── Proven pull is labelled with its window ─────────────────────────────────
{
  const pull = SIGNALS.find((s) => s.key === "pull")!;
  check("pull basis: new customers, last 365 days", pull.basis === "new customers, last 365 days");
  check("pull short label names 365 d", pull.short.includes("365"));
  check("unpaid basis names 90 days", SIGNALS.find((s) => s.key === "unpaid")!.basis.includes("90 days"));
  const src = readFileSync(join(ROOT, "components/markets/ScoutingView.tsx"), "utf8");
  check("table column: New customers, 365 d", src.includes('label: "New customers, 365 d"'));
  check("table column: Orders, this range", src.includes('label: "Orders, this range"'));
  check("table CPM cell reads the index pair, not the research string", src.includes("o?.cpm") && !src.includes("ref?.cpm"));
  check("table: no truncated cells", !/truncate/.test(src.slice(src.indexOf("function CandidatesTable"), src.indexOf("export function ScoutingView"))));
  check("map labels pluralise orders", src.includes('plural(s.orders, "order")') && !src.includes("${s.orders} orders"));
}

// ── Pluralisation ───────────────────────────────────────────────────────────
{
  check("1 order", plural(1, "order") === "1 order");
  check("2 orders", plural(2, "order") === "2 orders");
  check("0 orders", plural(0, "order") === "0 orders");
  check("1 day", plural(1, "day") === "1 day");
  check("1,204 orders", plural(1204, "order") === "1,204 orders");
  check("irregular plural", plural(3, "country", "countries") === "3 countries");
}

// ── No em dash ──────────────────────────────────────────────────────────────
{
  for (const f of ["components/markets/ScoutingView.tsx", "lib/markets/opportunity.ts", "lib/markets/scouting.ts", "scripts/check-markets-scouting.ts"]) {
    check(`no em dash in ${f}`, !readFileSync(join(ROOT, f), "utf8").includes(String.fromCharCode(0x2014)));
  }
}

console.log(`check:markets-scouting ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
