# Scheduled queries and transfer configs (snapshot 2026-10-04)

The `bq` CLI is **not installed** on the workstation that produced this snapshot (`which bq` and `which gcloud` both
return nothing), so `bq ls --transfer_config --transfer_location=eu --project_id=oneeighty-warehouse` could not be run.
The list below is reconstructed read-only from `INFORMATION_SCHEMA.JOBS_BY_PROJECT`: every job that
BigQuery Data Transfer Service ran carries the labels `dts_config_id` and `data_source_id` (`scheduled_query` or
`google_ads`). Window: 180 days. Config display names, schedules and any scheduled query that did not run in 180 days
cannot be seen this way; run the command below to complete the list.

```bash
bq ls --transfer_config --transfer_location=eu --project_id=oneeighty-warehouse
bq show --format=prettyjson --transfer_config projects/557841360185/locations/eu/transferConfigs/<id>
```

Project number `557841360185` comes from the DTS service agent
`service-557841360185@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com`.

## 1. Scheduled queries (data_source_id = scheduled_query)

| Transfer config id | Runs as | Writes | Cadence seen | Runs | First seen | Last seen |
|---|---|---|---|---|---|---|
| `6a928d0e-0000-2e90-a9a8-f4f5e80cace4` | `sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com` | `INSERT INTO ops.feed_freshness` | hourly (720 runs in the last 30 days, 963 since creation) | 963 | 2026-08-25 14:21 UTC | 2026-10-04 16:21 UTC |
| `6ac7063a-0000-2634-9786-f403043874e0` | same | `INSERT INTO ops.feed_freshness` | one run only, the commented 401 version of the same query | 1 | 2026-09-08 19:07 UTC | 2026-09-08 19:07 UTC |

- **The writer of `ops.feed_freshness` is config `6a928d0e-...`.** Its SQL is stored verbatim in
  [`scheduled_query.refresh_feed_freshness.sql`](scheduled_query.refresh_feed_freshness.sql).
- Its `client_flags` CTE lists `has_shopify, has_shoptet, has_meta, has_klaviyo, has_ecomail, has_instagram`. It does
  **not** handle `has_woocommerce` and its `actual` CTE has no `raw_woo_*` branch, so inserting `woocommerce_*` rows into
  `ref.feed_sla` alone monitors nothing. The change is prepared in `../230b_scheduled_query_feed_freshness.sql`.
- It does handle `ingested_at`: every `actual` branch reads `MAX(ingested_at)`; `raw_woo_orders` and `raw_woo_order_items`
  both have that column (TIMESTAMP, NOT NULL) and `order_date` as the partition column.
- `6ac7063a-...` has a single run on 2026-09-08 and looks like a one-off "run now" of
  `infra/bigquery/401_refresh_feed_freshness.sql` (the original, commented version of the query; that file is not in the
  repo either). It is probably a leftover config: confirm in the console and delete it if so.

## 2. Google Ads transfers (data_source_id = google_ads)

| Transfer config id | Google Ads account | Client | Notes |
|---|---|---|---|
| `6ab8705e-0000-24eb-a759-fc41166c6421` | 9406261058 ("Raw bark") | rawbark | daily; loads ~50 `p_ads_*_9406261058` tables per run. **Backfill target for 2026-09-17**, see the WP2 report. |
| `6a444df9-0000-2a2c-92b4-001a114cbe98` | 5865960448 ("MANAMI") | manami | daily |

Full resource names: `projects/557841360185/locations/eu/transferConfigs/<id>`. Destination dataset `raw_google_ads`,
tables partitioned as `p_ads_<Report>_<customer_id>$YYYYMMDD`.

## 3. Not scheduled queries

n8n workflows (`wf_woocommerce`, `wf_shopify_to_bigquery`, `wf_meta_ads_to_bigquery`, ...) write `ops.pipeline_log` as
`sa-n8n-writer` but run in n8n, not in BigQuery. The n8n definition of the Woo workflow is in `../../n8n/`.
Looker Studio and the dashboard (`sa-frontend-reader`) only read.
