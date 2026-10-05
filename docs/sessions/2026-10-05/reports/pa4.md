# PA4 report: Paid Overview tab

Branch `pa4-overview`, worktree `oe-dash-wt/pa4-overview`, one commit `f17683c` on top of `7b139f1` (paid-redesign with PA0). Frontend only. No warehouse objects, no `mart_qa` objects, nothing to deploy.

## What changed
- Rewritten: `dashboard/app/(app)/paid/page.tsx` (fragment of header, control bar, main, as PA0 requires). Controls: `compare` and `currency` on.
- New: `lib/queries/paidOverview.ts` (`getPaidDaily` Q-OV1, `getCampaignsAcross` Q-OV2, `getGa4PlatformTotals` Q-OV3), `lib/demo/paidOverview.ts`.
- New components in `components/paid/overview/`: `model.ts` (pure derivation: sums, efficiency, buckets, chart points, campaign type, spend mix), `PaidTile`, `Section`, `SpendEfficiencyChart` (recharts, client), `PlatformTable`, `SpendMix`, `CampaignsAcross`, `PeriodTable`.
- Deleted: `components/dashboard/ChannelSplit.tsx` (no importers).
- NOT deleted (importer outside my files): `lib/queries/paid.ts` and the Paid functions in `lib/demo/media.ts`. `scripts/check-warehouse.ts` still imports `getMetaTotals/getTopAds/getChannelTotals` from `lib/queries/paid.ts`, and `media.ts` imports types from it. They are now dead app code.

## Page as built (spec 1.3)
- A hero: Paid spend, New-customer revenue, aMER, nCAC (delta, sparkline, "Warehouse" tag whose hover lists the contributing sources). B secondary: MER, CAC (blended), Revenue, New customers. Badge "Meta not connected" on aMER, nCAC, MER, CAC when `googleAds && !meta` (own tile `PaidTile`, because `MetricCard` lost its badge slot in WP1).
- C chart: stacked Meta/Google bars, line aMER|MER|nCAC (local toggle, all three series sent), dotted comparison line aligned by bucket index, hidden under 400px. Grain from `bucketGrain` (day to 45 days, ISO week to 180, month beyond); ratios per bucket from summed components.
- D platform table (own grid, so "Not connected" can span the row); Total row is the shop (value = revenue, ROAS = MER, CPA = blended CAC). GA4 columns only when `capabilities.ga4` and the sessions query succeeds.
- E period table, newest first, same buckets as the chart.
- F spend mix: Meta by funnel stage (PACKS/CBO/ASC stay `unclassified`), Google by brand class; label inside a segment only above 15%; hover/focus text has spend, share, ROAS; segment links to `/paid/meta?stage=` and `/paid/google?class=` with the query string kept.
- G campaigns: top 15 by spend, both platforms in display currency, `Δ Spend` and `Δ ROAS` only when comparing, low-volume rows muted with a marker and null sort key, name links to `/paid/<tab>?campaign=<id>`.
- Excluded-currency Notice ("{n} {CUR} orders excluded from totals.") in native mode, derived from the same daily query (native mode fetches all currencies and splits in TS, so it is still one read).

## Decisions worth knowing
- **One `mart_daily_kpis` read per render** (scan bounds, current plus comparison in one query). Campaign marts: one UNION query, ~25 MB scan, feeds table and mix. `getSpendMix` of the spec is derived from that result (`spendMix` in `model.ts`) rather than a third query.
- **FX gap rule.** `paid_spend` in the mart treats a platform with NULL converted spend as zero, so it silently understates. A day with platform delivery (impressions) but NULL spend is flagged; any sum containing it returns null spend and null MER/aMER/nCAC/CAC (shop figures stay), and a comparison period with such a day gives no delta. Campaign spend likewise is null for a range containing an unconverted day. Today no client has a gap (checked: 0 flagged days for all five clients, 30 days).
- **Google value = conversions value (primary conversions)**, the same definition as `mart_daily_kpis.google_revenue`, so the platform table and the campaign table agree. Spec Q3 (switch to purchase-category) still open; both accounts count only purchases today.
- Currency: daily and campaign queries use `fxSql` (rate per month, before summing). Meta/Google money on this tab is client currency (`*_client_ccy`), never ad-account currency.
- Tile labels `Paid spend`, `aMER`, `nCAC`, `MER`, `CAC (blended)`, `Revenue` pick up the existing `METRIC_DEFINITIONS` tooltips; `New-customer revenue` and `New customers` have none (`lib/metrics.ts` is not mine).

## Verification
- `npx tsc --noEmit` exit 0; `npm run build` exit 0 (`scratchpad/pa4_build.log`; `/paid` 107 kB page, 209 kB first load because of recharts); `check:capabilities` 318/318; `check:paid` 190/190.
- Grep gates on page, `components/paid/overview`, both lib files: em/en dash 0, `border-dashed` 0, `bg-[#` 0, `toLocaleString()` 0, `pageEyebrow(` 0, dev vocabulary in components/page 0, client names 0.
- Warehouse: 240 and 242 are deployed; column names verified through INFORMATION_SCHEMA (`mart_meta_campaign_perf`: `funnel_stage, market, spend_client_ccy, revenue_client_ccy, client_currency`; `mart_gads_campaign_daily`: `brand_class, channel_type, spend_client_ccy, conversions_value_client_ccy, ...`). I generated the exact SQL the module issues (stubbing the BigQuery client) and ran it read-only, 30 days to 2026-10-03:
  - manami native, with comparison: daily query valid. Paid spend 92,917.97 = SUM(paid_spend) = Meta 79,599.85 + Google 13,318.12. MER 274,530.63 / 92,917.97 = 2.95, aMER 184,341.68 / 92,917.97 = 1.98, nCAC 455.5 (204 new customers), CAC blended 358.8 (259 orders), all recomputed from sums. Campaign query: Meta campaigns sum to 79,600 spend / 156,483 value / 169 purchases, Google PMax 13,318 / 57,677 / 60.7: equal to the daily mart's platform columns.
  - dobias, currency CZK: daily 416,073.57 CZK (19,672.79 USD x month rate, 0 days without a rate); campaign query 5 campaigns, 416,074 CZK, 345 purchases.
  - rawbark: paid spend 85,136.35 = Google only (Meta null), revenue 1,696,885.33, MER 19.93, aMER 1.36, nCAC 818.6; campaign mart 85,136.35 spend / 231,911.34 value / 266.2 conversions, 9 campaigns, classes brand / non_brand / shopping_pmax / other. The "Meta not connected" badge applies.
  - Pure model checked with a throwaway script (sums, gap nulls, week/month buckets, comparison alignment, mix shares, demo campaigns sum to demo platform totals) and a server render smoke test of every component with demo data. Both scripts were deleted.
- Not done: visual check (no login). To check on the dev server: tiles at 375px (hero one per row, secondary two-up), chart toggle and dotted line, "Not connected" row spanning for a one-platform client, GA4 columns absent today, mix label threshold, campaign links keep client and range, sticky control bar under the tabs.

## GA4 (platform table columns)
`mart_ga4_sessions_daily` is NOT deployed (243 not run; BigQuery answers "Not found: Table ... mart_ga4_sessions_daily"). `getGa4PlatformTotals` runs only when `capabilities.ga4` is true (false for every client today, so it does not run at all). When the flag is on and the table is missing, the "not found" error (`isMissingObject`) returns null and the two GA4 columns are hidden; any other error is thrown. When it exists, revenue is null for the whole set if any purchase session lacked an FX rate (`sessions_fx_missing`). The column names used (`platform`, `revenue`, `sessions_fx_missing`, `date`, `client_id`, `currency`) come from `243_ga4_sessions.sql`; re-check once 243 is deployed: `platform` values 'meta', 'google', 'other_paid' feed Meta, Google and the total.

## Open issues
1. Campaign names in the spend mix: Meta mostly "Unclassified" for manami and dobias, as expected (owner decision).
2. Chart tooltips and grids use CSS variables (`--meta`, `--google`, `--border`, `--text-muted`, `--ink-900`), no hex.
3. Hero tiles show a daily-ratio sparkline (that day's own sums); figures themselves are range-sum ratios.
4. DataTable has no row-click: the campaign name is the link (not the whole row).

## Requests to orchestrator
1. After PA5 to PA7 merge: switch `scripts/check-warehouse.ts` (lines 55, 137 to 141) off `lib/queries/paid.ts`, then delete `lib/queries/paid.ts` and the Paid functions plus the `lib/queries/paid` type import in `lib/demo/media.ts` (keep its email functions, `lib/queries/email.ts` uses them). PA5 (Meta tab) may also want `MetaTotals`/`getTopAds` logic before it goes.
2. Optional: add METRIC_DEFINITIONS entries "New-customer revenue" and "New customers" to `lib/metrics.ts` (tooltips on the two tiles without one).
3. Spec Q3 (Google purchase-only vs primary conversions) decides what Google "value" means on Overview and in `mart_daily_kpis`.
