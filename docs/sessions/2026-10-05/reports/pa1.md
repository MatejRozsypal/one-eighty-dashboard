# PA1: Warehouse Meta marts for the Paid redesign

Branch `pa1-meta-marts`, commit 44e6d6e. Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/pa1-meta-marts`.

## Files
- `infra/bigquery/240_paid_meta_marts.sql` (migration, prod names, deploy order top to bottom, idempotent)
- `infra/bigquery/qa/240_regression.sql` (the regression and sanity queries, run against the mart_qa candidates)

## What the migration does (in order)
1. `CREATE TABLE IF NOT EXISTS ref.naming_rules` (spec DDL, clustered by client_id)
2. `CREATE TABLE IF NOT EXISTS ref.campaign_overrides` (client_id, platform, campaign_id, funnel_stage, brand_class, market, note, updated_at)
3. Seed `ref.naming_rules` with 4 global meta/campaign rules, inserted only if the (client, platform, entity, dimension, pattern) row is absent, so a re-run never overwrites manual edits. Re-run tested: still 4 rows.
4. `CREATE OR REPLACE VIEW mart.mart_meta_campaign_dim` (grain client_id, campaign_id: latest name, first_date, last_date, funnel_stage, market, classified_by, plus market_classified_by which I added because stage and market can be classified from different sources).
5. `CREATE OR REPLACE VIEW mart.mart_meta_campaign_perf`: live definition untouched, additive columns appended: view_content, add_payment_info, funnel_stage, market, spend_client_ccy, revenue_client_ccy, client_currency.
6. `CREATE OR REPLACE VIEW mart.mart_meta_ad_perf`: live definition untouched, additive columns appended: outbound_clicks, unique_outbound_clicks, video_p25/50/75/95/100_watched, video_30s_watched, view_content, add_payment_info. (adset_id was already there.)

Based on live view definitions read 2026-10-04 (not the repo DDL). No other view depends on the two perf views (INFORMATION_SCHEMA check). The dashboard (`paid.ts`) selects explicit columns, so additive columns are safe.

## Owner decisions applied
- Seed has NO packs/cbo/asc token. Only explicit retargeting (rt, rmk, retarget*, remarketing, warm, bof, mof), retention (retention, existing, loyal*, repeat) and prospecting (prospect*, broad, tof, acq*, cold, lal, lookalike) words, plus the market rule. Precedence: override > client rule > global rule > unclassified; lower priority number wins within a tier.
- Money columns stay in ad-account currency; `*_client_ccy` is additive, FX by row month from `ref.fx_rates`, factor 1 when meta_currency = client currency, NULL when no rate (same pattern as mart_daily_kpis).

## Raw field verification (important)
| Field | Exists in raw schema | Has data | Decision |
|---|---|---|---|
| view_content (actions JSON `omni_view_content`) | yes, campaign and ad level | yes, all 4 Meta clients | kept (INT64, NULL when Meta reported no such action in the row) |
| add_payment_info (actions JSON `add_payment_info`) | yes | yes | kept |
| outbound_clicks, unique_outbound_clicks | column exists in `raw_meta_ad_insights` | **100 percent NULL since 2025-01 (1.85M rows)**, also absent from payload_json | kept in the view (NULL), see below |
| video_p25/p50/p75/p95/p100_watched, video_30s_watched | column exists | **100 percent NULL**, absent from payload_json | kept (NULL) |
| video_play_actions, video_thruplays | already in the view | populated | unchanged |
Nothing was dropped because every field exists as a column or in the actions JSON. But eight ad-level fields are empty: the n8n ad-insights call never requests outbound_clicks or the video quartile/30s fields. The view will light up without a second deploy once ingest fills them. Until then the dashboard must treat NULL as "not ingested" and hide the column (Outbound CTR on the Meta tab cannot render today). `actions` is a JSON string, so the pivot uses `JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))` (BigQuery does not allow the `SAFE.` prefix on JSON_QUERY_ARRAY directly; this was caught by the first run and fixed).

## Verification (all against live prod, `date < CURRENT_DATE()`, 2026-10-04)
1. Campaign perf, existing columns, EXCEPT DISTINCT both directions on TO_JSON_STRING: prod 2855 rows, candidate 2855 rows, 2855 distinct each, prod_minus_cand = 0, cand_minus_prod = 0 (all clients, all days).
2. Ad perf, existing columns: prod 12,547 rows, candidate 12,547, diff 0 both ways.
3. Dim grain: 64 campaigns, 0 duplicate (client_id, campaign_id) keys.
4. Client-ccy spend and revenue vs `mart_daily_kpis` meta_spend / meta_revenue, per client and month, 2026-05 to 2026-10: diff 0.0000 for every client-month with FX (dobias USD, ethia, manami CZK, venev CZK->EUR for Aug and Sep, e.g. Sep venev 50,573.52 CZK = 2,085.16 EUR on both sides). Venev 2026-10: NULL on both sides (fx_rates ends 2026-09-01), 3 rows with NULL client-ccy by design.
5. Funnel magnitudes, 90 days (link_clicks / LPV / view_content / ATC / IC / add_payment_info / purchases):
   dobias 77,381 / 62,024 / 31,000 / 3,976 / 1,811 / 314 / 886;
   ethia 5,380 / 4,283 / 3,761 / 658 / 354 / 120 / 163;
   manami 22,066 / 11,566 / 15,514 / 1,395 / 1,059 / 648 / 504;
   venev 2,408 / 844 / 912 / 49 / 23 / 6 / 6.
   view_content is always well above ATC. Versus LPV it is 0.5x to 1.35x (below LPV for dobias and ethia, above for manami and venev): pixel ViewContent and landing_page_view are different events, so it is "same magnitude", not strictly between LPV and ATC. The Funnel UI should not assume LPV >= View content.
6. Ad level view_content, add_payment_info, add_to_cart, landing_page_views and spend equal the campaign-level totals exactly for every client.
7. Override and rule precedence tested with temporary rows in the mart_qa tables (then deleted, tables back to the 4 seed rules and 0 overrides): latest override wins, override with only market keeps rule stage (classified_by rule, market_classified_by override), a google override is ignored for meta, a client rule beats a global rule, a rule with NULL value upper-cases capture group 1.

## Classification coverage, 90 days (share of Meta spend, ad-account currency per client)
Stage:
- dobias: unclassified 61.6 percent (29,344), prospecting 38.4 percent (18,307). Total 47,651 USD.
- ethia: unclassified 100 percent (88,971 CZK).
- manami: unclassified 66.7 percent (166,513), prospecting 33.3 percent (83,224). Total 249,737 CZK.
- venev: unclassified 100 percent (81,110 CZK).
- No retargeting or retention spend in any client over 90 days (no such token in the live names).
Market:
- dobias: US 57.9 percent, CA 42.1 percent. manami: CZ 88.3 percent, SK 11.7 percent. venev: CZ 100 percent. ethia: unknown 100 percent (no market token in "CBO - Sales - Hlavní kampaň").
Notes:
- All PACKS / CBO campaigns stay unclassified, as decided. Exception by explicit token: dobias "CA I PACKS CBO I Broad I 2026-06" (5.7k USD) is prospecting because it contains the word Broad.
- "US & CA I ..." names resolve to US only (first token), so dobias US share is slightly overstated.
- Older Czech names (akvizice, nabor, REM, Retarget katalog) are outside the 90 days; "Retarget katalog" and "retargeting ke kampani 2" do classify as retargeting. Czech words like "akvizice" are not caught by `acq\w*`: add per-client rules in `ref.naming_rules` if wanted.

## mart_qa objects created (prefix pa1_)
`pa1_naming_rules` (4 rows), `pa1_campaign_overrides` (0 rows), views `pa1_mart_meta_campaign_dim`, `pa1_mart_meta_campaign_perf`, `pa1_mart_meta_ad_perf`. No prod object was touched.

## Cost note
mart_meta_campaign_perf now joins the dim, which scans stg_meta_campaign_insights for names (about 16 MB, about 60 s slot time over 60 months). A 30-day dashboard query went from 7 MB / 1 s slots to 22 MB / 66 s slots. Billed bytes stay small (10 to 52 MB). If slot time matters on a reservation, materialise the dim as a table later; not needed now.

## Ready for prod deploy
Run `infra/bigquery/240_paid_meta_marts.sql` once, top to bottom (6 statement groups, order matters: tables, seed, dim, campaign_perf, ad_perf). Then re-run section 3, 4, 5 of `qa/240_regression.sql` against the prod views. Rollback: re-create the two perf views from the live definitions quoted in the migration history (the views are additive, so rollback is only needed if a consumer breaks); `DROP VIEW mart.mart_meta_campaign_dim` only after the perf view is rolled back.

## Open issues
- Eight ad-level raw fields are never ingested (above).
- ref.fx_rates ends 2026-09-01: October Venev `*_client_ccy` is NULL until FX is refreshed (same limitation as mart_daily_kpis).
- market is NULL (not the string "Unknown") when unmatched; the dashboard should label NULL as Unknown.
- Meta currency for rawbark is NULL in ref.clients (has_meta false), so it has no rows here.

## Requests to orchestrator
1. n8n Meta ad-insights workflow: request `outbound_clicks`, `unique_outbound_clicks` (or outbound click actions), `video_p25/p50/p75/p95/p100_watched_actions` and `video_30_sec_watched_actions`, and write them to `raw_meta_ad_insights`. Needed for Outbound CTR and any quartile/hold curve on the Meta tab.
2. Refresh `ref.fx_rates` for 2026-10 (Venev client-ccy columns and mart_daily_kpis meta_spend are NULL for October).
3. Dashboard (owner of paid.ts): treat NULL additive columns as not ingested; display Meta money in `metaCurrency` (existing columns) or use `*_client_ccy` with `client_currency` for blended views.
