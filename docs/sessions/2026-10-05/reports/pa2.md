# PA2 report: Warehouse Google Ads marts + brand terms (WP-A2)

Branch `pa2-gads-marts`, worktree `oe-dash-wt/pa2-gads-marts`, commit `e8aa059`. Nothing executed in prod. All BigQuery writes were in `mart_qa` with prefix `pa2_`.

## What changed (files)

- `infra/bigquery/241_ref_client_brand_terms.sql`: `ref.client_brand_terms` (CREATE IF NOT EXISTS, cluster by client_id) + idempotent seed (manami: `manami`; rawbark: `rawbark`, `raw bark`, match_type contains, applies_to all).
- `infra/bigquery/242_gads_marts.sql`: idempotent seed of one Google market rule into `ref.naming_rules` (PA1 table), then 7 views in `mart`: `mart_gads_campaign_dim`, `mart_gads_campaign_daily` (campaign x date x network), `mart_gads_campaign_device_daily`, `mart_gads_adgroup_daily`, `mart_gads_search_terms_daily`, `mart_gads_keywords_daily`, `mart_gads_products_daily`. Header has purpose, basis, affected clients, regression, deploy order, and the DTS traps.
- `infra/bigquery/qa/242_regression.sql`: R1 to R9 (prod names; header has the sed map for pre-deploy runs against mart_qa).
- `runbooks/17_google_ads_to_bigquery.md`: new section "Paid marts and brand terms" with the INSERT helper, rules, brand class rule, how to override a campaign.
- `mart_daily_kpis` and `stg_google_ads_campaign_insights` untouched.

## DTS schema facts verified live (affect the SQL)

- Tables are per account (`p_ads_*_<customer_id>`), read via wildcard like the existing stg view. Names used: BasicStats `metrics_cost_micros`, `segments_ad_network_type`, `segments_device`; CrossDevice `metrics_search_impression_share`, `..._budget_lost_...`, `..._rank_lost_...`, `..._top_...`, `..._absolute_top_...`, `metrics_search_click_share`; ConversionStats `segments_conversion_action_category`; `Campaign` carries budget (`campaign_budget_amount_micros`, `_period`, `_explicitly_shared`) so no Budget join is needed.
- IS value 0.0 means "not reported" (Search partners, PMax, Shopping top IS), not zero. Treated as NULL.
- **KeywordStats impressions are inflated by the click_type segment** (51,743 vs 28,663 true for rawbark Sep 2026). Only click_type `URL_CLICKS` rows carry true impressions. The keyword view takes impressions from those rows only. Spend, clicks, value reconcile when summed.
- Shopping campaigns report top IS as 0 while absolute-top IS is set. Added column `top_eligible_impressions` (spec had no such column): Top IS = SUM(top_impressions)/SUM(top_eligible_impressions).
- Partition date equals segments_date (0 mismatches in 60 days, both CampaignBasicStats and SearchQueryStats).

## Verification (candidates run in mart_qa against live data, 2026-10-04)

| Check | Result |
|---|---|
| R1 per client x month, campaign_daily vs `mart_daily_kpis` (spend, spend_client_ccy, conversions_value vs google_revenue, conversions vs google_purchases, impressions, clicks) | 27 of 27 months OK, diff 0.0 (manami 2025-10..2026-10, rawbark 2025-09..2026-10). Example: rawbark 2026-09 85,883.44 CZK both sides, manami 2026-06 19,901.47 |
| R2 device view vs campaign view (spend, impr, clicks, conv, value) | 27 of 27 OK, max diff 0.0 |
| R2 ad group view vs campaign view | equals non-PMax campaign spend and clicks exactly in all 27 months. It does NOT equal total campaign spend: PMax has asset groups, no ad groups (diff = PMax spend). Check was corrected to compare against non-PMax |
| R3 impression share sanity | bad_rows = 0 for both clients in all 12 months; all shares in 0..1. Caveat: about 60 percent of rawbark rows have a component at the "<10%" floor 0.0999, so lost-share numbers are upper bounds (rows_at_floor column shows it) |
| R4 coverage, 30d to 2026-10-03 | rawbark search terms 62.7 percent of Search spend (22,764.58 of 36,283.68); rawbark Shopping products 100.0; rawbark PMax products 0.0 (39,660.78 spend); manami PMax products 25.8 (3,440.01 of 13,318.12). Matches the spec |
| R5 brand share (seed terms only) | rawbark: brand 9.8 percent of Google spend (8,324.18 of 85,136.35), non-brand 32.8, shopping_pmax 55.0, other 2.4; brand search terms are 34.4 percent of rawbark term spend; brand leakage 0.5 percent. manami: 100 percent shopping_pmax (no Search spend, no brand campaign) |
| R6 grain uniqueness | 0 duplicate keys in all 6 stats views and the dim |
| R7 completeness | missing dim name 0, missing FX 0, partition vs segments_date 0 |
| R8 keywords vs Search campaigns (rawbark, 30d) | spend 36,283.68 = 36,283.68, clicks 1735 = 1735, impressions 27,045 = 27,045 |
| Matcher test (temporary rows, deleted) | contains, word (with diacritics stripping), exact, regex, exclusion beats brand, campaign-scope term, invalid regex does not break the view. Seed re-run adds 0 rows |
| Drift check | MD5 of the 7 live mart_qa view definitions equals the committed 242 text (comments stripped) |
| Cost | rawbark R1 over 24 months scans about 196 MB (month-level scans of the DTS tables); dashboard-style 30 day query on campaign_daily dry-runs at about 1 MB |

R9 (classification review, 90d spend): rawbark `CZ - S: Brand` and `SK - S: Brand` = brand; `CZ/SK - S: Granule` = non_brand; PMax and PLA = shopping_pmax; Demand Gen RMK = other (no country token, market NULL). Manami PMAX market NULL (no token).

## mart_qa objects created

`pa2_client_brand_terms` (3 seed rows), `pa2_naming_rules` (stub with the PA1 schema from spec 2.3, 1 Google market row), `pa2_campaign_overrides` (stub, empty), views `pa2_mart_gads_campaign_dim`, `pa2_mart_gads_campaign_daily`, `pa2_mart_gads_campaign_device_daily`, `pa2_mart_gads_adgroup_daily`, `pa2_mart_gads_search_terms_daily`, `pa2_mart_gads_keywords_daily`, `pa2_mart_gads_products_daily`. QA text is generated from the prod files with `scratchpad/pa2/qa_xform.sh`.

## Ready for prod deploy (not executed), in order

1. PA1 migration (creates `ref.naming_rules`, `ref.campaign_overrides`). Hard dependency of 242.
2. `infra/bigquery/241_ref_client_brand_terms.sql`
3. `infra/bigquery/242_gads_marts.sql`
4. `infra/bigquery/qa/242_regression.sql` as is: R1, R2, R3 (bad_rows), R6, R7, R8 must be OK / 0; R4, R5, R9 are review tables.
Owner follow-up: add more brand terms with the runbook INSERT helper (misspellings, product-line brand names), then re-run R5 and R9.

## Deviations from the spec (all small, all documented in the file headers)

- Entity tables (Campaign, AdGroup, Keyword) use the same 25 month window as the stats instead of 400 days, so a removed campaign keeps its name for every day with spend.
- Brand token in campaign names is `brand` or `brd` split on any non letter or digit, not `\bbrand\b`. Reason: live names like `PER_BRD_KW_CZ~Brand CPC` (underscore is a word character, so `\b` would miss `BRD_`).
- Extra columns: `top_eligible_impressions`, `click_share_clicks`, `eligible_clicks`, `market` on the daily view, `classified_by` on the dim, `ad_group_status`, `term_status`, `keyword_criterion`, `view_through_conversions`, device view has `*_client_ccy`.
- Ids are STRING in all views (as in stg). Search terms grain also includes term_status and keyword_criterion (device and network summed away). Search term and product views do not add up to campaign spend by design (coverage chip).
- Google market rule seeded by 242 into PA1's `ref.naming_rules` (platform 'google'), because PA1 seeds Meta rules only and the Google market would be NULL otherwise. Pattern: country token with any non-alphanumeric separator (so `PER_SEA_KW_CZ~Nejlepsi` gives CZ).

## Open issues

- `campaign_maximize_conversion_value_target_roas` is 0 for TARGET_ROAS strategy campaigns (the DTS Campaign table has no target_roas column for that strategy), so `target_roas` is NULL for e.g. `CZ - PLA`. The Budget tab can show bid strategy type but not the target for those.
- Market is NULL for campaigns without a country token (Demand Gen RMK, manami PMax). Fix with `ref.campaign_overrides` or a client naming rule.
- `ref.fx_rates` ends 2026-09-01: no effect today (both accounts CZK in CZK), but a non-CZK Google account would get NULL `*_client_ccy` from October.
- Brand share is only as good as the term list: only seed terms exist.

## Requests to orchestrator

- Deploy PA1 before PA2 (242 reads `ref.naming_rules` and `ref.campaign_overrides`, and writes one seed row into `ref.naming_rules`). If PA1 changes `campaign_overrides.campaign_id` to a non-STRING type, 242 still works (it casts both sides).
- Dashboard package: use `purchases`/`purchase_value` for the default Google tab metrics, `conversions`/`conversions_value` stay available; use the component formulas from the runbook section for IS (never average the shares).
- No change needed in files I do not own.
