/**
 * Caveat rules. Decided per client from registry fields, never from a
 * hardcoded client id. The value gets a marker; the hover lists the caveats
 * that apply to that client AND appear in the metric's `caveats`.
 *
 * Pure module, safe for the browser bundle.
 *
 * Design: 11_reporting_suite_design.md section 2.5. Owner: WP1 (RS1).
 */

import type { CaveatId, CaveatRegistry, ReportClient } from "./types";

export const CAVEATS: CaveatRegistry = {
  revenue_incl_vat: { short: "Revenue incl. VAT", applies: (c) => c.shopPlatform === "shoptet" },
  returns_not_netted: { short: "Refunds not netted", applies: (c) => c.shopPlatform === "shopify" },
  /** Obsolete: migration 228 nets Woo fee lines. Id kept (append only); never applies. */
  woo_fees_not_netted: { short: "Fee lines not netted", applies: () => false },
  google_only_paid: { short: "Paid spend is Google only", applies: (c) => !c.capabilities.meta && c.capabilities.googleAds },
  google_all_conversions: { short: "All Google conversion actions", applies: (c) => c.capabilities.googleAds },
  platform_attributed: { short: "Platform-attributed", applies: () => true },
  new_flag_window: { short: "New vs returning within history window", applies: () => true },
  period_share_not_rcr: { short: "Order share, not cohort repeat rate", applies: () => true },
  /** Data-driven: the evaluator adds it when a client has rows in another currency. Never from registry fields. */
  foreign_currency_rows: { short: "Some orders in another currency", applies: () => false },
  /** Data-driven: the evaluator adds it when a current-period launch is under 60 days old and not yet a winner. */
  cohort_maturing: { short: "Launches under 60 days old still open", applies: () => false },
  lifetime_to_date: { short: "Winners judged on lifetime to date", applies: () => true },
};

/** Stable order for output lists. */
export const CAVEAT_ORDER: readonly CaveatId[] = [
  "revenue_incl_vat",
  "returns_not_netted",
  "woo_fees_not_netted",
  "google_only_paid",
  "google_all_conversions",
  "platform_attributed",
  "new_flag_window",
  "period_share_not_rcr",
  "foreign_currency_rows",
  "cohort_maturing",
  "lifetime_to_date",
];

/** Registry-driven caveats of one client, in CAVEAT_ORDER. */
export function clientCaveats(client: ReportClient): CaveatId[] {
  return CAVEAT_ORDER.filter((id) => CAVEATS[id].applies(client));
}

/** Sort and dedupe a caveat list into CAVEAT_ORDER. */
export function orderCaveats(ids: Iterable<CaveatId>): CaveatId[] {
  const set = new Set(ids);
  return CAVEAT_ORDER.filter((id) => set.has(id));
}

/** What the hover shows for one cell: series caveats that the metric declares. */
export function visibleCaveats(seriesCaveats: readonly CaveatId[], metricCaveats: readonly CaveatId[] | undefined): CaveatId[] {
  if (!metricCaveats || metricCaveats.length === 0) return [];
  const m = new Set(metricCaveats);
  return orderCaveats(seriesCaveats.filter((c) => m.has(c)));
}
