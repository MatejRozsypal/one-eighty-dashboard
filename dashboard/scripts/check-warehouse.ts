/**
 * Issues every page's warehouse queries, for real, and reports what came back.
 *
 *     npm run check:warehouse            # manami
 *     npm run check:warehouse -- dobias
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `tsc` proves the types. `next build` proves it compiles. Neither executes a
 * single query, and every defect that has actually reached production on this
 * dashboard lived in that gap:
 *
 *   · `HAVING SUM(spend)` where the query also aliased `SUM(spend) AS spend`,
 *     which BigQuery expands to `SUM(SUM(spend))` and rejects;
 *   · a correlated `UNNEST` join BigQuery refuses outright;
 *   · `mart_creative_adset_perf` returning zero rows for every client, for
 *     months, because the table under it was never populated — no error, just
 *     four features silently dead.
 *
 * All three are valid TypeScript producing SQL that is wrong. The first
 * request to the page is where they surfaced, and on 9 Sep that request came
 * from a user.
 *
 * ── What it asserts, and what it deliberately does not ─────────────────────
 * A THROW is a failure: invalid SQL, a missing object, a bad parameter type.
 * An EMPTY result is not — a client with no email platform legitimately has no
 * campaigns, and failing on that would train everyone to ignore the output.
 * Empties are printed instead, so a screen that has quietly gone dark is
 * visible to a person reading the list.
 *
 * That distinction is the whole design. A check that cries wolf gets muted,
 * and a muted check is worse than none.
 *
 * ── Credentials ────────────────────────────────────────────────────────────
 * Application Default Credentials — `gcloud auth application-default login`.
 * Read-only on `mart`; the production service-account key is not needed.
 *
 * Exits non-zero if any query throws.
 */

import { getClients } from "@/lib/clients";
import { presetRange, resolvePeriod } from "@/lib/period";

import { getCohortGrid } from "@/lib/queries/cohortGrid";
import { getCohorts } from "@/lib/queries/cohorts";
import { getDataThrough, getDiscounts, getExcludedCurrencies } from "@/lib/queries/context";
import { getEmailSummary, getFlows } from "@/lib/queries/email";
import { getGapStats } from "@/lib/queries/gaps";
import { getGoalActuals, getGoals } from "@/lib/queries/goals";
import { getGrowth } from "@/lib/queries/growth";
import { getPipelineRuns, getSourceFreshness } from "@/lib/queries/health";
import { getInventory } from "@/lib/queries/inventory";
import { getFirstProductRepeat, getProductJourney } from "@/lib/queries/journey";
import { getLifetimeSummary, getPayback, getTopCustomers } from "@/lib/queries/lifetime";
import { getOrdersSummary, getRecentOrders } from "@/lib/queries/orders";
import { getChannelTotals, getMetaTotals, getTopAds } from "@/lib/queries/paid";
import { getPnlSnapshot } from "@/lib/queries/pnl";
import { getProducts } from "@/lib/queries/products";
import { getRepeatTiming } from "@/lib/queries/repeatTiming";
import { getUnitEconomics } from "@/lib/queries/unitEconomics";
import { getYearOverYear } from "@/lib/queries/yoy";

process.env.GCP_PROJECT_ID ??= "oneeighty-warehouse";

const wanted = process.argv[2] ?? "manami";
const range = presetRange("30d");
const period = resolvePeriod(range, "previous_period");

let failures = 0;
let empties = 0;

/** How much came back, in one line, whatever shape the query returns. */
function describe(value: unknown): { text: string; empty: boolean } {
  if (value === null || value === undefined) return { text: "null", empty: true };
  if (Array.isArray(value)) {
    return { text: `${value.length} rows`, empty: value.length === 0 };
  }
  if (value instanceof Map) return { text: `${value.size} keys`, empty: value.size === 0 };
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // Summary objects: report the arrays inside them, and whether every
    // numeric field is zero or null — the shape a dead view actually takes.
    const arrays = Object.entries(o).filter(([, v]) => Array.isArray(v));
    const numbers = Object.values(o).filter((v) => typeof v === "number") as number[];
    const parts: string[] = [];
    if (arrays.length) parts.push(arrays.map(([k, v]) => `${k}=${(v as unknown[]).length}`).join(" "));
    if (numbers.length) parts.push(`${numbers.filter((n) => n !== 0).length}/${numbers.length} nonzero`);
    const allDead =
      (numbers.length > 0 && numbers.every((n) => n === 0)) &&
      arrays.every(([, v]) => (v as unknown[]).length === 0);
    return { text: parts.join("  ") || "object", empty: allDead };
  }
  return { text: String(value), empty: false };
}

async function probe(page: string, name: string, run: () => Promise<unknown>) {
  try {
    const result = await run();
    const { text, empty } = describe(result);
    if (empty) empties++;
    console.log(
      `${empty ? "empty" : "ok   "} ${page.padEnd(16)} ${name.padEnd(24)} ${text}`
    );
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${page.padEnd(16)} ${name.padEnd(24)} ${message.split("\n")[0].slice(0, 140)}`);
  }
}

async function main() {
  const clients = await getClients();
  const client = clients.find((c) => c.clientId === wanted);
  if (!client) {
    console.error(
      `No such client "${wanted}". Known: ${clients.map((c) => c.clientId).join(", ")}`
    );
    process.exit(1);
  }

  const id = client.clientId;
  const cur = client.currency;
  const year = Number(range.to.slice(0, 4));

  console.log(`\nclient ${id} (${cur})   range ${range.from} → ${range.to}`);
  console.log(`comparison ${period.comparison?.from} → ${period.comparison?.to}\n`);

  // Grouped by the screen that breaks if the query does, so a failure names a
  // page rather than a file.
  await probe("snapshot", "getPnlSnapshot", () => getPnlSnapshot(id, cur, period));
  await probe("snapshot", "getDataThrough", () => getDataThrough(id));
  await probe("snapshot", "getDiscounts", () => getDiscounts(id, range));
  await probe("snapshot", "getExcludedCurrencies", () => getExcludedCurrencies(id, cur, range));

  await probe("orders", "getOrdersSummary", () => getOrdersSummary(id, range));
  await probe("orders", "getRecentOrders", () => getRecentOrders(id, range, 25));

  await probe("paid", "getMetaTotals", () => getMetaTotals(id, range));
  await probe("paid", "getTopAds", () => getTopAds(id, range, 10));
  await probe("paid", "getChannelTotals", () =>
    getChannelTotals(id, range, client.capabilities.googleAds)
  );

  await probe("products", "getProducts", () => getProducts(id, range, 40));
  await probe("unit-economics", "getUnitEconomics", () => getUnitEconomics(id, cur, range));

  await probe("email", "getEmailSummary", () => getEmailSummary(id, range, 30));
  await probe("email", "getFlows", () => getFlows(id, cur, range));

  await probe("customers", "getLifetimeSummary", () => getLifetimeSummary(id, cur));
  await probe("customers", "getTopCustomers", () => getTopCustomers(id, cur, 25));
  await probe("customers", "getPayback", () => getPayback(id, cur, 12));

  await probe("cohorts", "getCohorts", () => getCohorts(id, cur, 24));
  await probe("cohorts", "getCohortGrid", () => getCohortGrid(id, cur, {}));

  await probe("growth", "getGrowth", () => getGrowth(id, cur, 12));
  await probe("growth", "getYearOverYear", () => getYearOverYear(id, cur));

  await probe("repurchase", "getRepeatTiming", () => getRepeatTiming(id, 90));
  await probe("repurchase", "getProductJourney", () => getProductJourney(id, 3));
  await probe("repurchase", "getFirstProductRepeat", () => getFirstProductRepeat(id, 15, 30));

  await probe("inventory", "getInventory", () => getInventory(id));
  await probe("gaps", "getGapStats", () => getGapStats(id, cur));
  await probe("goals", "getGoals", () => getGoals(id, year));
  await probe("goals", "getGoalActuals", () => getGoalActuals(id, cur, year));

  await probe("health", "getSourceFreshness", () => getSourceFreshness(clients));
  await probe("health", "getPipelineRuns", () => getPipelineRuns(12));

  console.log(
    `\n${failures === 0 ? "No query failed." : `${failures} QUERY FAILURE(S) — see FAIL above.`}` +
      `  ${empties} came back empty (not a failure; check any you did not expect).`
  );
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("\nharness failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
