# Deploy 243 (GA4 sessions), prod BigQuery `oneeighty-warehouse` (EU)

Run 2026-10-04 (BigQuery `CURRENT_DATE()` = 2026-10-04) by the deploy agent through the BigQuery MCP (`execute_sql`). Owner approved 243 only; the mart_qa-only rule was lifted for this migration. Nothing else was touched: no `ref.clients` change (has_ga4 already TRUE for dobias and manami from 231), no IAM, no dataset ACL, no scheduled query, no DTS, no n8n.

## 1. What was executed (file order, each succeeded on the first attempt)

| # | Statement from `infra/bigquery/243_ga4_sessions.sql` | Result |
|---|---|---|
| 1 | `CREATE TABLE IF NOT EXISTS ref.ga4_properties` | ok |
| 2 | `MERGE ref.ga4_properties` seed (dobias 314809580, manami 343337695, venev 324879665) | 3 rows inserted |
| 3 | `CREATE TABLE IF NOT EXISTS stg.ga4_sessions` (partition `date`, cluster `client_id`) | ok |
| 4 | `CREATE OR REPLACE PROCEDURE ops.sp_load_ga4_sessions_for` | ok, MD5 of body eb90a041... equals the file |
| 5 | `CREATE OR REPLACE PROCEDURE ops.sp_load_ga4_sessions` | ok, MD5 dec2c0c3... equals the file |
| 6 | `CREATE OR REPLACE VIEW mart.mart_ga4_sessions_daily` | ok, MD5 5a146f8a... equals the file |

Preflight (read-only): none of the 5 objects existed. Rollback if ever needed: `DROP VIEW mart.mart_ga4_sessions_daily; DROP PROCEDURE ops.sp_load_ga4_sessions; DROP PROCEDURE ops.sp_load_ga4_sessions_for; DROP TABLE stg.ga4_sessions; DROP TABLE ref.ga4_properties;` (all new, nothing else depends on them yet).

## 2. Backfill

`CALL ops.sp_load_ga4_sessions(70)` finished in one call, no timeout, no chunks needed.
- **Bytes processed: 1,261,383,412 (1.26 GB), billed 1,293,942,784.** Matches the runbook estimate of about 1 GB.
- Loaded 2026-08-03 to 2026-10-03 (BQ today is 10-04, so yesterday is the last day):
  dobias 208,964 rows (all sessions), manami 8,369 rows (8,166 sessions + 203 `purchase_no_session`), venev 3 rows (2026-08-12 to 08-19, stalled export, STALE by design).
- Dobias export is no longer a day behind: last_date 2026-10-03 for both live properties, days_behind 0.

## 3. Verification (qa/243_checks.sql against prod names)

| Check | Result |
|---|---|
| 0 freshness | dobias 0 days behind, manami 0, venev 45 (stalled, expected) |
| 3a sessions vs canonical GA4 count (`COUNT(DISTINCT user_pseudo_id, ga_session_id)`), 7 days x 2 properties | 14 of 14 `ok`. Table never above canonical. Max diff 0.14 % dobias, 1.02 % manami (2026-09-30, 97 vs 98). Manami cookieless share 0.77 to 0.86 as documented |
| 5b purchases vs export | Whole backfill range: dobias 2,258 = 2,258, manami 518 = 518. The file's 7-day window shows dobias 254 vs 253 (diff -1): a session that started before 2026-09-27 and bought on the 27th is stored on its start day. Not a loss (range total is exact). manami 46 = 46 |
| 4 idempotent reload | `CALL sp_load_ga4_sessions(3)` between two fingerprints (BIT_XOR of FARM_FINGERPRINT of every column except `loaded_at`) of the last 7 days: 14 days before and after, 16,785 rows before and after, **0 days differ**. Run with 3 days as requested (the file uses 7), script total 64.8 MB |
| 5 integrity (widened to the 70 day backfill window) | all 8 rules 0 failures (duplicate keys, platform values, null channel group, currency, revenue, negatives, no-session flags, null landing path) |
| 2a platform share, 7 days | dobias sessions: non_paid 88.9 %, meta 10.9 %, other_paid 18, google 4; revenue non_paid 97.6 %, meta 2.4 %. manami sessions: meta 49.5 %, google 24.8 %, non_paid 21.8 %, other_paid 3.8 %, unattributed 0 sessions but 33.8 % of revenue (16,940 CZK, consent mode) |
| 2b rule leaks | 0 rows for `paid_group_but_non_paid` and `unattributed_with_sessions`. Informational only: dobias facebook.com / m.facebook.com / instagram.com referrals (3,767 / 1,038 / 899 sessions) stay non_paid, as designed |
| 6 currency / FX (70 days) | **fx_missing = 0 on every row.** dobias: USD 1.0, CAD 0.7167, EUR 1.1576, GBP 1.3373 (GA4's own USD value); manami: CZK 1.0, EUR 24.2368 (ref.fx_rates, October rate now present); venev EUR 1.0 |
| 1 coverage vs `mart_daily_kpis` | dobias orders 0.62 to 0.90 per day, revenue vs gross 0.54 to 0.84. manami orders 0.67 to 1.17, revenue 0.58 to 0.98, unattributed share 0 to 65 % per day. In line with the PA3 report |
| 3b GA4 UI magnitude | NOT DONE, needs a person with GA4 access. See section 6 |

### sa-frontend-reader can read the new view (no gap)
`sa-frontend-reader` is READER on `mart` (dataset ACL). The view reads `stg.ga4_sessions`, `ref.clients`, `ref.fx_rates`. Dataset ACLs read from the API:
- `stg` access list contains the authorized dataset `mart` (targetTypes VIEWS).
- `ref` access list contains the authorized dataset `mart` (targetTypes VIEWS), and `sa-frontend-reader` is also READER on `ref`.
- Existing `mart` views already read `stg` objects (for example `mart_cm3_monthly`, `mart_creative_adset_perf`), and the frontend jobs of the last 7 days that go through `mart` views all read `ref` (765 jobs) and `raw` without errors. Caveat: BigQuery job metadata flattens views to base tables, and no frontend job in the last 30 days referenced a `stg` TABLE directly (the other 33 `stg` objects are views, `ga4_sessions` is the only base table). `stg.ga4_sessions` is the first `stg` table the frontend reaches, so the ACL entry above is the evidence, not a prior successful read.
- The `analytics_*` datasets are not and must not be authorized to `mart`; the view does not touch them.
So no authorized-view step is needed. I could not run a query as `sa-frontend-reader` itself (no impersonation here), so the first real proof is the Paid GA4 tab loading after the frontend deploy. If it ever shows a 403 on `stg.ga4_sessions`, see 5(c).

## 4. Owner steps (a): create the scheduled query

Do the grants in section 5(b) first, then:

1. Google Cloud console > BigQuery > left menu **Scheduled queries** > **Create scheduled query** (project `oneeighty-warehouse`). If the page asks to enable the BigQuery Data Transfer API, it is already enabled (the existing scheduled queries run).
2. Name: `ga4_sessions_daily`.
3. Query text, exactly:
   ```sql
   CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(3);
   ```
4. Schedule options: **Repeats** Daily, **Start time** 07:00, time zone **UTC** (so the schedule string reads "every day 07:00"). Start now, no end date.
5. Destination: leave **Set a destination table** unchecked (the procedure writes `stg.ga4_sessions` itself).
6. **Advanced options** (expand): Data location / processing location **EU** (it must match the datasets), **Service account** `sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com`, notify by email on failure (tick the box, your address).
7. **Save.** The console opens the transfer page. Click **Schedule backfill** > **Run one time transfer - now** once, to prove that the service account has all grants. Open the run, expect "Succeeded". Then run in a query tab: `SELECT client_id, MAX(loaded_at) FROM \`oneeighty-warehouse.stg.ga4_sessions\` GROUP BY 1` and check that dobias and manami `loaded_at` moved to now.

Why this identity: the existing `ops.feed_freshness` scheduled query already runs as exactly this service account (336 runs in the last 14 days, data_source_id `scheduled_query`), so the Service Account User step you did for it applies. The full email was read from the `ref` dataset ACL and from job metadata. Cost per run is about 50 MB. If the console says you may not act as the service account, add yourself under IAM & Admin > Service Accounts > `sa-n8n-writer` > Permissions > Grant access > `matej@oneeighty.cz` > role **Service Account User**.

CLI equivalent, if you ever want it (needs a gcloud shell):
```bash
bq mk --transfer_config --project_id=oneeighty-warehouse --location=EU \
  --data_source=scheduled_query --display_name="ga4_sessions_daily" \
  --schedule="every day 07:00" \
  --params='{"query":"CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(3);"}' \
  --service_account_name=sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com
```

## 5. Owner steps (b) and (c): IAM

### (b) Grants for `sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com`
Read from the dataset ACLs today. It already has WRITER on `ref` and on `ops` (so reading `ref.ga4_properties` and calling the `ops` procedures need nothing), and it already runs query jobs (jobUser is effective). It has no entry on `stg` or on any `analytics_*` dataset and has never run a job touching them in 30 days, so these four are missing:

| Dataset | Role to grant | Why |
|---|---|---|
| `stg` | BigQuery Data Editor | delete and insert in `stg.ga4_sessions` |
| `analytics_314809580` (dobias) | BigQuery Data Viewer | read `events_*` |
| `analytics_343337695` (manami) | BigQuery Data Viewer | read `events_*` |
| `analytics_324879665` (venev) | BigQuery Data Viewer | read `events_*`. Needed now: the loop reads it every night even though the export is stalled, a missing grant would fail the run |

Click path, repeat per row: BigQuery console > **Explorer** > expand `oneeighty-warehouse` > click the dataset name > **Sharing** (top bar) > **Permissions** > **Add principal** > New principals `sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com` > Role: BigQuery Data Editor (for `stg`) or BigQuery Data Viewer (for the three `analytics_*`) > **Save**.

Alternative in one go, paste in a BigQuery query tab (location EU):
```sql
GRANT `roles/bigquery.dataEditor` ON SCHEMA `oneeighty-warehouse.stg` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
GRANT `roles/bigquery.dataViewer` ON SCHEMA `oneeighty-warehouse.analytics_314809580` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
GRANT `roles/bigquery.dataViewer` ON SCHEMA `oneeighty-warehouse.analytics_343337695` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
GRANT `roles/bigquery.dataViewer` ON SCHEMA `oneeighty-warehouse.analytics_324879665` TO "serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com";
```
Do NOT grant anything on `analytics_*` to `sa-frontend-reader` (raw user pseudo ids). A new `analytics_*` dataset for a future client needs the same Data Viewer grant (runbook 30, "Adding a GA4 property").

### (c) Authorized view for `mart` -> `stg`
Not needed, already in place: `stg` and `ref` both list dataset `mart` under authorized datasets (see section 3). Only if the Paid GA4 tab shows `Access Denied: Table ... stg.ga4_sessions`: console > `stg` dataset > **Sharing** > **Authorize datasets** > add `oneeighty-warehouse.mart`; same on `ref`.

## 6. Still open (owner)
- Check 3b: GA4 > Reports > Acquisition > Traffic acquisition, same dates, metric Sessions, compare with `SELECT client_id, date, SUM(sessions) FROM mart.mart_ga4_sessions_daily GROUP BY 1, 2`. Expect dobias about equal, manami below the UI (consent-mode modelled sessions are not in the export).
- Venev export is still stalled (last day 2026-08-19). Nothing to do until the GA4 link resumes.
- Frontend: the Paid GA4 tab shows data once the dashboard is redeployed (the push that carries this log note triggers it) and the capability flag is read; `has_ga4` is already TRUE for dobias and manami.
- FX: October rates exist now, `sessions_fx_missing` is 0. Re-run runbook 23 in early November so the provisional October rates get finalised.
- `mart_qa.pa3_*` test objects were not dropped (owner go pending, same as `wp3_*`).
