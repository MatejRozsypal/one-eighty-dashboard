# WP2 report: warehouse repo sync, ops, registry, FX prep

Branch `wp2-warehouse-sync`, commit `c83aa5b` (worktree `oe-dash-wt/wp2-warehouse-sync`). Nothing was executed against prod.
Only write: view `mart_qa.wp2_v_pipeline_alerts`. No DTS run, no n8n execution, no DML.

## 1. What changed (files)

| Path | What |
|---|---|
| `infra/bigquery/live/` | 92 files: 31 `stg.*`, 39 `mart.*`, 3 `ops.v_*` views as `CREATE OR REPLACE VIEW`; DDL for 14 `ref.*` and 5 `ops.*` tables; `scheduled_query.refresh_feed_freshness.sql`; `README.md` (snapshot 2026-10-04, regeneration queries, normalisation); `scheduled_queries.md` |
| `infra/n8n/wf_woocommerce_to_bigquery.json` | `wf_woocommerce` (id `sPavCKXZHiXqXCvK`, 14 nodes, version `9ee92345`), credential id and name only (`GllXD8PCRtfTuXbu`, "BQ Service Account"). Secret grep: no tokens/keys; only Secret Manager secret NAMES appear in URLs |
| `infra/bigquery/230_feed_sla_woo.sql` | 2 rows into `ref.feed_sla` (`woocommerce_orders`, `woocommerce_order_items`, 12h, critical), `WHERE NOT EXISTS` |
| `infra/bigquery/230b_scheduled_query_feed_freshness.sql` | live hourly scheduled query plus 3 added lines (has_woocommerce flag branch, 2 raw_woo actual branches) |
| `infra/bigquery/231_registry_hygiene_2026_10.sql` | RawBark `taxes_included=FALSE`; `has_woocommerce=FALSE` where NULL; `has_ga4=TRUE` dobias+manami; commented RawBark `has_meta`+`meta_currency` in one UPDATE |
| `infra/bigquery/232_fx_rates_2026_09_10.sql` | MERGE: Sept 2026 final, Oct 2026 provisional |
| `infra/bigquery/233_ops_alerts_fx_gads.sql` | `ops.v_pipeline_alerts` + FX coverage + non-ok `v_gads_coverage` |
| `_clients/rawbark/warehouse/rawbark-cogs-template.csv` | outside the repo, not committed |

Note on the live export: three SQL comments contained an em dash; replaced by `-` (documented in `live/README.md`, so a re-export with the same step gives no diff). `bq` and `gcloud` are NOT installed here, so the export ran through the BigQuery MCP with the exact queries in the README. The n8n JSON was transcribed from the n8n MCP `get_workflow_details` output via a script (JS code in raw strings); it was not byte-compared to a native export, so diff it once against an `n8n export:workflow` if you want certainty.

## 2. Findings that change the plan

1. **The live `ops.feed_freshness` writer cannot see Woo.** It is scheduled query `6a928d0e-0000-2e90-a9a8-f4f5e80cace4` (hourly, runs as `sa-n8n-writer`, 963 runs since 2026-08-25). Its `client_flags` has no `has_woocommerce` branch and `actual` has no `raw_woo_*` branch. It does use `MAX(ingested_at)`, and both raw_woo tables have `ingested_at`. So inserting the 230 rows alone monitors nothing: **230b must be pasted into the scheduled query** (not the schedule, only the text). The repo does not contain this query (`401_refresh_feed_freshness.sql` is missing); the live text is now in `live/`.
2. There is a second, one-run config `6ac7063a-0000-2634-9786-f403043874e0` (2026-09-08, the commented 401 text). Probably a leftover, confirm in the console.
3. `ref.fx_rates`: the September rows are still provisional (`cnb_mtd_avg@2026-09-21`), not final. 232 replaces them. Effect on deploy: Sept USD amounts +0.61 % (20.962 to 21.090), EUR +0.16 % (24.254 to 24.292); the September CZK->EUR row also changes (0.041230313 to 0.041165816).
4. `wf_woocommerce` hardcodes `ingest_source: 'backfill'` in the cron path (cosmetic, already noted in the audit) and runs `0 */3 * * *`. It reads `has_woocommerce = TRUE`, so setting NULL to FALSE in 231 does not change its client list.

## 3. Verification (all read-only except one mart_qa view)

- **230 / 230b**: focused test of the added logic (flag branch + both actual branches, 230 rows inlined for feed_sla): 4 rows, all `ok`: ethia and rawbark each for `woocommerce_orders` and `woocommerce_order_items`, staleness 0.9h, rows_last_24h 9/27 (ethia), 152/351 (rawbark).
- **231**: the WHERE clause of each UPDATE selects exactly: u1 rawbark; u2 dobias, venev, manami; u3 dobias, manami; commented u4 rawbark. No view reads `has_ga4`/`has_woocommerce` or (for Woo) `taxes_included`; dashboard `lib/clients.ts` only maps `has_ga4 === true` and nothing branches on it. Zero mart change expected.
- **232**: SELECT part run against live: 6 rows = 3 UPDATE (Sept) + 3 INSERT (Oct), values as in the file. CNB source (fetched 2026-10-04 16:53 UTC, first table only, header third column asserted `leden`; the second cumulative table was detected and ignored):
  - Sept 2026 monthly: USD 21,090, EUR 24,292. Cross-check: mean of the 21 September daily fixings is identical.
  - Oct 2026 (2 fixings, 10-01 and 10-02): USD 21,655 and 21,795 (mean 21.725), EUR 24,465 and 24,465.
  - URLs: `https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/prumerne_mena.txt?mena=USD` (and `=EUR`), `.../rok.txt?rok=2026`.
- **233 (regression protocol, simplified for a monitor view)**: candidate `mart_qa.wp2_v_pipeline_alerts`. Prod 8 rows, candidate 11 rows. `prod EXCEPT DISTINCT candidate` on `TO_JSON_STRING` = **0 rows**. Candidate minus prod = exactly 3 rows, the FX alert firing today:
  - `fx_rates CZK->EUR has no row for 2026-10 (last month with a rate: 2026-09). Refresh per runbook 23`
  - same for `USD->CZK` and `EUR->CZK` (severity critical, status `fx_missing`, client `*`).
  - Google Ads branch adds 0 rows today (both `v_gads_coverage` rows are ok); its expressions were tested on synthetic STALE / UNMAPPED / CLIENT_WITHOUT_ACCOUNT rows and produce critical/warning rows with the right text.
  - After 232 runs the 3 FX rows disappear (fx last month becomes 2026-10).
  - No dashboard or mart code reads `v_pipeline_alerts` (grep of `dashboard/app`, `lib`, `components`).
  - Limit: `v_gads_coverage` checks transfer recency, not a single missing day, so the 2026-09-17 hole would still not alert. A per-day gap check was not added (days with zero activity legitimately have no DTS row, so it would false-alarm without more design).

## 4. Google Ads 2026-09-17 backfill (DO NOT RUN without owner OK)

Confirmed read-only: `p_ads_AccountBasicStats_9406261058` still has 09-14, 09-15, 09-16, 09-18, 09-19, 09-20 and no 09-17.

Transfer config for account 9406261058 (RawBark), found through DTS job labels in `INFORMATION_SCHEMA.JOBS_BY_PROJECT`: **`6ab8705e-0000-24eb-a759-fc41166c6421`**, project number `557841360185` (from the DTS service agent). Manami's config is `6a444df9-0000-2a2c-92b4-001a114cbe98`, not to be touched.

```bash
bq mk --transfer_run \
  --start_time=2026-09-17T00:00:00Z --end_time=2026-09-18T00:00:00Z \
  projects/557841360185/locations/eu/transferConfigs/6ab8705e-0000-24eb-a759-fc41166c6421
```

Check the resource name with `bq ls --transfer_config --transfer_location=eu --project_id=oneeighty-warehouse` first (the `bq` CLI was not available to me, so the number and id come from job metadata, not from `bq ls`). The run reloads about 50 `p_ads_*_9406261058` tables for that one date (low volume). Verify afterwards:

```sql
SELECT segments_date, COUNT(*) FROM `oneeighty-warehouse.raw_google_ads.p_ads_AccountBasicStats_9406261058`
WHERE segments_date = DATE '2026-09-17' GROUP BY 1;   -- expect > 0 (CampaignBasicStats too)
SELECT date, google_spend FROM `oneeighty-warehouse.mart.mart_daily_kpis`
WHERE client_id = 'rawbark' AND date = DATE '2026-09-17';   -- google_spend not NULL
```

## 5. RawBark COGS template

`/Users/matej/Documents/_One Eighty/OE Second Brain/_clients/rawbark/warehouse/rawbark-cogs-template.csv` (UTF-8 with BOM for Excel). 47 rows = product_id + variation_id sold in the last 24 months (order_date >= 2024-10-04), from `stg.stg_woo_order_items` (revenue-bearing orders only, so cancelled/failed excluded). Columns: product_id, variation_id, product_name, variation_attributes, sku, units_sold_24m, revenue_24m_czk, last_sold, then empty `unit_cost_czk_ex_vat` and `effective_from`. Sorted by revenue; 97,220 units, 53.04 M CZK ex VAT (CZK-converted; 46 lines of October EUR orders have NULL revenue until 232 runs, so the October revenue is slightly understated). Things the owner needs to know before filling it in:
- Variation attributes only exist for the 12 "Granule na miru" products (53 to 60, 61094, 61095, 61200, 61201): `dog_meal_type` (one meal per product, except 61200 which has beef and lamb) and `pack_kg` taken from the whitelisted line meta. **`pack_kg` varies per order inside one product (e.g. product 58 has 12 sizes from 10 to 120)**, and the product name ("4 Kg" or "10 Kg") does NOT match it. These 12 products are about 47.7 M of the 53 M CZK. A single cost per row cannot be right for them: they need a cost per kg (or per `pack_kg`) per meal type. WP3's `ref.product_costs` join is keyed on product/variation/sku, so a per-kg cost for these needs a design decision first. Flag to orchestrator.
- Only 12 of 47 rows have an SKU (exactly the 12 granule products, SKU 27 to 39); the other 35 are blank.
- The broth bites (65583, 62972, 65578) have variations 1 ks / 10 ks (names carry the pack size). Vouchers (1928, 1332) are not goods: leave the cost empty or 0 on purpose.

## 6. Triage of stale feeds (P1-14), read-only

Live state, n8n via MCP and BigQuery freshness (`ops.v_feed_health`, `ops.pipeline_log`, `raw_*` max ingested_at):

| Feed | Last ingest | Likely cause | Evidence | Fix (needs owner OK) |
|---|---|---|---|---|
| **dobias Klaviyo** (`klaviyo_campaigns`, `klaviyo_flow_series`, `klaviyo_conversion_daily`, 337h) | 2026-09-20 13:40 UTC | `wf_klaviyo_to_bigquery` (`hdHdtEz8v0IPUPmE`) is **inactive**; n8n keeps no executions for it. The last ingest (13:40:09 to 13:40:19) does not fall on the `20 */6 * * *` slots (04:20/10:20/16:20/22:20 UTC), so it looks like a manual run, after which nothing fired. Why it was switched off is not in the system (history shows 1 version, saved 2026-09-08 by Matej). Also `wf_instagram_to_bigquery` and `wf_ecomail_to_bigquery` are inactive | workflow list: `active:false`; execution search returns 0 | Owner re-publishes the workflow in the UI. Do NOT edit the schedule (RESTORE_klaviyo_live.md incident). If it was switched off on purpose, the SLA rows for Klaviyo should be disabled instead of alerting forever |
| **manami Ecomail** (`ecomail_campaigns`, 60h vs 30h) | 2026-10-02 04:00:36 UTC | Two causes. (a) Since at least 2026-08-03, **every run errors in the `BQ: insert campaigns` node**: execution 24436 (and the 13 other 6-hourly runs 09-29 to 10-02) fail with "Row 201 failed with error: Invalid NUMERIC value: 6554.2000000000007" (a float with 13 decimals into a NUMERIC column; `Transform campaigns1` does `Number(v)` with no rounding). n8n inserts in chunks, so the chunk with the bad row is lost (nothing inserted for items 200 to 226) while earlier chunks land, which is why `ingested_at` kept moving. The error stops the execution, so the **lists and automations branches never run**: `raw_ecomail_lists` and `raw_ecomail_automations` last ingested 2026-08-03 16:00 UTC. (b) After 2026-10-02 04:00 the workflow stopped firing: it is now `active:false`, `activeVersionId:null`, so someone unpublished it between 04:00 and 10:00 UTC on 10-02 (or the platform did) | `get_workflow_execution(includeData)` on 24436: only 4 nodes ran, last node error as quoted; raw max ingested_at per table | Round numbers in `Transform campaigns1` (and the other Transform nodes) to 6 decimals like `wf_woocommerce`'s `num()`, then re-publish. This is the live v1 workflow (hardcoded `CLIENT_ID='manami'`, shared "Ecomail" credential), not the v2 registry workflow from runbook 24 (not present in n8n) |
| **dobias `shopify_products`** (3,317h) | 2026-05-19 | Structural: **no feed exists**. Live `wf_shopify_to_bigquery` (`B9qDhp4BLChKGVbi`, 14 nodes, `0 */3 * * *`, orders only, healthy: 211 successful runs in 60 days) has **no products and no customers branch**. `raw_shopify_products` was filled by the one-off Bulk Operations backfill (runbook 13). `wf_shopify.md` describes a products branch that was never deployed (same drift as the customers feed). The SLA row is `critical` at 48h, so it can never be green. Cost of goods for dobias is frozen at the 2026-05-19 products snapshot | live node list; runbook 13 ("One-off"); pipeline_log has only orders runs | Either build a products branch (or a scheduled Bulk Operations job reusing `infra/shopify_products_transform.py`) or re-run the backfill by hand and accept a manual SLA. Decision needed |
| **venev `shopify_products`** (1,489h) | 2026-08-03 15:42 | Same structural cause. The last load is the day Venev costs were written into Shopify (one-off) | same | Same decision. `ref.product_costs` notes Shopify's `InventoryItem.cost` is authoritative for venev |

Related staleness seen in the same view (not in the P1-14 list): dobias Instagram 621h (last 2026-09-08), manami Instagram 338h (09-20): `wf_instagram_to_bigquery` is also inactive.

## 7. Ready for prod deploy (needs owner OK), exact order

1. `232_fx_rates_2026_09_10.sql` (MERGE; run first so the new FX alert does not fire on day one). Verify: runbook 23 coverage query, `last_month = 2026-10-01` for all 3 pairs; RawBark `mart_orders` revenue NULL count for October = 0.
2. `230_feed_sla_woo.sql`, then paste `230b_scheduled_query_feed_freshness.sql` into scheduled query `6a928d0e-...` (text only, schedule untouched), wait one hourly run, verify 4 Woo rows in `ops.v_feed_health`.
3. `233_ops_alerts_fx_gads.sql` (CREATE OR REPLACE VIEW `ops.v_pipeline_alerts`).
4. `231_registry_hygiene_2026_10.sql` (any time). The RawBark Meta block stays commented until the ad account exists.
5. DTS backfill for 2026-09-17 (command in section 4).

## 8. mart_qa objects created

`mart_qa.wp2_v_pipeline_alerts` (view). No other objects.

## 9. Open issues and requests to orchestrator

- Decision needed on RawBark granule costing (cost per kg by `pack_kg`, section 5) before WP3's `ref.product_costs` ALTER is final: the planned key `(product_id, variation_id, sku)` cannot express it.
- Decision on the Shopify products feed (build vs manual, section 6). If manual, set a longer SLA or `is_active=FALSE` for `shopify_products`, otherwise two critical alerts stay forever.
- Klaviyo, Instagram and Ecomail n8n workflows are inactive: owner decides whether to re-publish (and fix the Ecomail NUMERIC rounding first). No n8n change was made by me.
- Confirm in the DTS console whether `6ac7063a-...` is a leftover and delete it if so.
- I did not touch `METRICS.md`, runbooks or the dashboard. Suggest updating `runbooks/23_fx_rates_refresh.md` to say September rows must be replaced on the 1st, and adding `live/` to the migration SOP.
