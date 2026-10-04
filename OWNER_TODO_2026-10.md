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

## D. Reports QA on prod

Prerequisites: migrations 250 and 251 applied (they are). Nothing here has been clicked through on prod yet: the Postgres store has never run against a real database, so the first prod use is the smoke test.

**Access**
- [ ] Client-role account: `/reports` redirects to `/snapshot`, no rail icon, `POST /api/reports/query` answers 404 with an empty body, `/reports/<id>` redirects.
- [ ] Agency account on `@oneeighty.cz`: has Reports. Agency or admin on another domain: 404 on the route, redirect on pages.
- [ ] A private report of another user: opening its URL is a 404 page, same as a random uuid.

**Real Postgres smoke test** (the first run creates the tables lazily)
- [ ] New report from each template; reload; it persists.
- [ ] Add a widget, drag it, reload: position and config are saved. Remove it, Undo, reload: it is back with the same config.
- [ ] Stale save: open the same report in two tabs, edit in one, then in the other: "Updated by XX, reloaded".
- [ ] Rename, pin, duplicate, change visibility (owner), a team member sees it; delete, Undo from the toast, restore works.

**Data**
- [ ] Combined MER for a period equals a hand-written SQL check.
- [ ] RawBark: MER shows the `^` with "Paid spend is Google only"; CM3 and CM3 % show "No cost data".
- [ ] Dobias (USD) in a CZK report converts; switch to Native with mixed clients: disabled "Mixed currencies".
- [ ] Manami revenue shows the VAT caveat on hover.
- [ ] FX: rates reach 2026-10, so "No FX Oct 2026" will not reproduce; to see the state pick a month beyond the table or a currency pair without a rate.
- [ ] A KPI tile shows its weekly sparkline; a KPI over All time shows no sparkline (total only).
- [ ] Industry switch with the empty table: nothing drawn. After inserting one benchmark row: hover shows source and as-of date.
- [ ] Too wide a request (Day grain, All time): the widget shows "Too much data" plus the suggestion, the other widgets still load.
- [ ] Gaps: Dobias MER for April 2026 and for a 12-month range shows "Missing days", not a number.

**UI**
- [ ] 375 px: filter chip opens the sheet, stack order, KPI 2-up, charts show tooltips on tap, no edit controls.
- [ ] 1000 px: six-column display only. 1440 px: edit with mouse and with keyboard only (`/`, arrows, Shift+arrows, Enter, Cmd/Ctrl+D, Delete, Cmd/Ctrl+Z, `?`, Cmd/Ctrl+K, `E`, Cmd/Ctrl+S).
- [ ] Filter change: figures pulse and old numbers stay until new ones arrive; "Save default" saves and clears the URL params; Copy link reproduces the view.
- [ ] Refresh button refetches (rate limited server side to one per minute).
- [ ] Series colours: the same client has the same colour in every widget; view the line chart with a colour-blindness simulation.
- [ ] Speed: first load of an 8-widget report under about 1.5 s warm.

## E. Open questions and review items

- [ ] **RawBark Google Ads pauses:** were Google Ads paused 2025-12-23 to 2025-12-31 and on 2026-06-01? (Also 2026-09-17, which is the missing-ingestion day behind the backfill in B4.) If yes, those days become 0 instead of gaps and RawBark MER for Dec 2025 and Jun 2026 shows a value again. If it was missing ingestion, the gap is right.
- [ ] **Review open: F3 per-user query limit, F4 Postgres load** (from the Reports security review; summary in PROJECT_LOG 2026-10-04/05). F3: per-email in-flight limit in `/api/reports/query` plus a BigQuery per-user daily quota on the dashboard service account. F4: memoise the access lookup per request and batch the audit insert. Both low risk, can follow.
- [ ] Run the tenancy black-box test (`TENANCY_ISOLATION_ASSESSMENT.md`, Addendum A) once.
- [ ] Say go for: dropping the `mart_qa` candidates and baselines, deploying 252, running 230b (item B3).
