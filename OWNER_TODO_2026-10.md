# Owner TODO (dashboard, October 2026)

Things only Matěj can do. Ordered by urgency. Tick them off and tell Claude.

## A. Lost data every day (do first)

- [ ] **GA4 BigQuery link for Ethia and RawBark.** GA4 Admin > Product links > BigQuery links > project `oneeighty-warehouse`, location **EU**, Daily export on. Send the property IDs.
- [ ] **Venev GA4:** export of property `324879665` stalled on 2026-08-19. Check the link, and link the venev.eu property (most orders).

## B. BigQuery console steps (5 minutes)

1. [ ] **Grants for `sa-n8n-writer`** (needed by the GA4 scheduled query). Paste into a BigQuery query tab, location EU:
   ```sql
   GRANT `roles/bigquery.dataEditor` ON SCHEMA `oneeighty-warehouse.stg` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
   GRANT `roles/bigquery.dataViewer` ON SCHEMA `oneeighty-warehouse.analytics_314809580` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
   GRANT `roles/bigquery.dataViewer` ON SCHEMA `oneeighty-warehouse.analytics_343337695` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
   GRANT `roles/bigquery.dataViewer` ON SCHEMA `oneeighty-warehouse.analytics_324879665` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
   ```
2. [ ] **GA4 scheduled query.** BigQuery > Scheduled queries > Create. Name `ga4_sessions_daily`. Query: ``CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(3);``. Daily 07:00 UTC, no destination table, location EU, service account `sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com`, email on failure. Save, then "Run one time transfer - now" and check it succeeds.
3. [ ] **feed_freshness scheduled query** (WooCommerce monitoring). Open the existing hourly query, replace its text with `infra/bigquery/230b_scheduled_query_feed_freshness.sql` from the `INSERT INTO` line on. Do not change the schedule.
4. [ ] **Google Ads backfill 2026-09-17.** BigQuery > Data transfers > RawBark Google Ads transfer > Schedule backfill > 2026-09-17 to 2026-09-17.

## C. Data only the client or we have

- [ ] **RawBark Meta:** System User with `ads_read` on `act_4229772050472158`, then create secrets `meta-rawbark-access-token` and `meta-rawbark-ad-account-id` in Secret Manager yourself. Tell Claude "done" + account currency.
- [ ] **RawBark COGS (per kg):** cost per kg for "Granule na míru" (plus packaging per order if any), cost per piece for the rest. Template will be regenerated in the per-kg shape at `_clients/rawbark/warehouse/`.
- [ ] **Rotate the RawBark WooCommerce API key** (n8n logs show it unredacted), update `woocommerce-rawbark-consumer-key` / `-consumer-secret`.
- [ ] **Brand terms** for Manami and RawBark (misspellings too) for the brand vs non-brand split.
- [ ] **Ethia:** runs Google Ads? If yes, customer ID. Email platform for Ethia and RawBark (Klaviyo / Ecomail / none).
- [ ] **Cost assumptions** (fulfilment and other CM1 cost per order) for Ethia and RawBark in Settings.
- [ ] **Industry benchmarks:** sources + values per vertical for the reporting suite (table starts empty).
- [ ] Optional: rename the Google OAuth consent screen from "Claude Connector" to "One Eighty Dashboard".
