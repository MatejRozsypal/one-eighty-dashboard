/**
 * What the Meta numbers are measured on, said once.
 *
 * Every Meta purchase and purchase value the dashboard decides on is the
 * standard basis: 7-day click + 1-day view (`purchases_7dc_1dv` and
 * `revenue_7dc_1dv` in `mart.mart_meta_ad_perf`, `mart.mart_creative_perf` and
 * `mart.rpt_ad_launch`; migration 256, ME2). The ingest stores the split per
 * window and the mart adds 7d_click and 1d_view. Engaged-view (`1d_ev`) is
 * stored but is not part of the basis.
 *
 * Before ME5 the figures were whatever Meta returned by default for each ad
 * set's own setting (the same numbers, except that ads in ad sets set to
 * 7-day click only did not get their view-through purchases).
 *
 * This constant is the only place an attribution window is printed. A check
 * scans components, app and lib for the retired claims.
 */
export const ATTRIBUTION_LABEL = "7-day click + 1-day view";

/**
 * SQL for the basis, on rows of `mart_meta_ad_perf` or `mart_creative_perf`.
 *
 * `COALESCE` onto the stored (default attribution) figure covers a day whose
 * window split is not ingested yet. Live that never fires for a day with
 * purchases (checked 2026-10-05: zero such rows), and the two figures are equal
 * wherever both exist except for ads in 7d_click-only ad sets, so a late split
 * moves a day by the view-through purchases at most, never to zero.
 */
export function basisPurchasesSql(alias?: string): string {
  const p = alias ? `${alias}.` : "";
  return `COALESCE(${p}purchases_7dc_1dv, ${p}purchases)`;
}

export function basisRevenueSql(alias?: string): string {
  const p = alias ? `${alias}.` : "";
  return `COALESCE(${p}revenue_7dc_1dv, ${p}revenue)`;
}
