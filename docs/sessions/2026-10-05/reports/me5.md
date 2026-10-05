# ME5 report: Meta purchases and revenue on 7-day click + 1-day view

Branch `me5-attr-basis` (worktree `oe-dash-wt/me5-attr-basis`), one commit `57f730b`, not pushed. No warehouse object, n8n workflow or Meta setting was changed.

## Correction to the brief: campaign mart and kpis have no basis columns

Live INFORMATION_SCHEMA (2026-10-05): only `mart_meta_ad_perf`, `mart_creative_perf` (+9 columns each, as ME2 says) and `mart.rpt_ad_launch` carry the basis. `mart_meta_campaign_perf` and `mart_daily_kpis` (`meta_revenue`, `meta_purchases`) have none, and `mart_creative_adset_perf` has none (and is empty for every client).

How the campaign and day reads were handled without touching the warehouse: `lib/queries/metaBasis.ts` builds a CTE from the ad mart summed to campaign and day (Meta currency, or client currency with the month's rate exactly as the marts convert). Verified live: ad mart equals campaign mart on purchases and revenue for every campaign day that has ad rows (Dobias, Ethia, Manami 0 mismatching days; Venev has no ad rows before 2026-08-18, those days keep the stored figure). Day total of the overlay equals the sum of the campaign overlay on every client (Dobias 193,400.12; Ethia 1,059,051.80; Manami 1,038,714.68; Venev 648.50 in client currency since 2026-01-01).

## What changed

- `lib/creative/attribution.ts`: `ATTRIBUTION_LABEL` = "7-day click + 1-day view"; `basisPurchasesSql` / `basisRevenueSql` = `COALESCE(x_7dc_1dv, x)` (a day without a stored split falls back to the stored figure; live, no such day has purchases).
- `lib/queries/creative.ts`: Creative grid and account totals (comparison) sum the basis. `creativeLaunch.ts`: `launchFrom` reads `purchases_7dc_1dv`, `revenue_7dc_1dv`, `prior_roas_7dc_1dv` (older table or stub without the columns reads the stored ones; a NULL basis reads 0 and no prior, so never a winner, same as Reports); anchor reads `prior_roas_7dc_1dv`. Scorecard, verdicts, grid, hit rate, Paid tile all follow because they use these.
- `lib/queries/paidMeta.ts`: campaign rows (overlay), ad set rollup, ads.
- `lib/queries/paidOverview.ts`: Meta row of the platform table (overlay on the daily kpis read, only on rows that carry Meta figures) and the campaign table. Spend and Google untouched.
- `lib/reports/registry/components.ts`: `ad_launch.purchases/revenue/prior_roas` keep their ids and read the 7dc_1dv columns (entity-mart column rename now allowed in `defineComponents`, so `evaluate.ts` needs no edit). `metrics.ts`: hit rate / winners descriptions name the basis; descriptions of the metrics still on the stored figure say "own attribution setting". `types.ts`: SEMANTIC_VERSION 8 to 9.
- `METRICS.md` amendment 27 (+ two table rows), `lib/reports/README.md` note. New file `lib/queries/metaBasis.ts`.
- Checks: `check-creative-hitrate` (22 new assertions: label, SQL shape, launchFrom mapping, NULL basis never a winner, registry columns, SEMANTIC_VERSION, old label gone), `check-reports` and `check-reports-eval` updated for the renamed columns.

## Verification

- tsc clean, `npm run build` ok. All check scripts pass: hitrate, creative, paid 211, reports 356, reports-eval 478, reports-widgets 699, reports-pages 221, reports-authz 37, reports-store 315, reports-url 193, reports-canvas 98, capabilities 362, delta 177, delta-shop 65, delta-paid 184, delta-cmpc 72, loading 265, retention 272. `check:queries` and `check:warehouse` need GCP credentials and cannot run locally (same on base).
- Live winners (`rpt_ad_launch`, same classify formula in SQL, thresholds Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15, Venev 2.10/10): stored columns vs basis columns identical sets, 0 gained, 0 lost. All-time scorecard basis Dobias 9, Ethia 8, Manami 15, Venev 0 (with the 14-day rule Manami 14, same on both). 12-month hit rate (through 2026-10-04): Dobias 6 of 35, Ethia 7 of 156, Manami 8 of 120, Venev 0 of 9. Priors: Dobias 2.842 to 2.984, Ethia 2.283 to 2.304, Manami 2.029 to 2.087.
- Meta ROAS all history, basis vs stored: Dobias 2.984 vs 2.842, Ethia 2.183 vs 2.166, Manami 2.178 vs 2.125, Venev 0.126 on both (campaign grain). Matches me2 (2.98, 2.18, 2.18). Purchases: Dobias 1302 vs 1262, Ethia 1183 vs 1175, Manami 1640 vs 1609.
- The exact SQL of `getMetaCampaignDaily`, `getPaidDaily` (native and EUR) and `getCampaignsAcross` was captured from the TS code and run live (compiles, EUR conversion works). Capture harness deleted.
- Not browser-checked (login gated).

## Follow-ups (needs warehouse change or files outside my list)

1. Add basis columns to `mart_meta_campaign_perf` and `mart_daily_kpis` (`meta_revenue`, `meta_purchases`, same definition as the overlay: ad mart summed per campaign/day, stored figure when no ad rows). Then: Snapshot and MER inputs, Reports `meta_roas`, `meta_cpa`, `meta_atc_to_purchase`, `meta_conversion_rate` (campaign mart `purchases`), and `lib/queries/paidGa4.ts` platform value switch with no overlay. Until then Snapshot / Reports Meta ROAS / Paid > GA4 cross-check differ from Paid tabs (Dobias 2.84 vs 2.98); descriptions of the Reports metrics say so. Overlay cost is one extra ad mart scan per Paid read.
2. Placement and age x gender breakdowns (`mart_creative_breakdown_*`) and `mart_creative_unmapped`: purchases still on the stored figure (slice counts, UI-gated).
3. `mart_creative_adset_perf` (empty): if ingested it needs basis columns; Creative ad set read and the Paid > Meta direct ad set path read it (comments added).
4. `lib/queries/paid.ts` (`getMetaTotals`, `getTopAds`, `getChannelTotals`) is legacy, only referenced by `check-warehouse.ts` and demo types; still stored basis.
5. `lib/metrics.ts` line 200 text "inside the platform's attribution window" is fine, left as is. Settings page labels untouched.
6. Dobias is view-driven (over half of purchases are 1-day view); not a data problem, account lead note from ME2 still stands.
