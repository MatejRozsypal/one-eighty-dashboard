# 30. GA4 sessions in the warehouse

Feeds the Paid redesign: the GA4 columns on the Paid Overview and the whole `/paid/ga4` tab.
Source of truth for the SQL is `infra/bigquery/243_ga4_sessions.sql`, checks are in
`infra/bigquery/qa/243_checks.sql`.

**Status: built and tested in `mart_qa` (prefix `pa3_`). Nothing below has been run in prod.**
Every command in this file is documentation until the owner approves the deploy.

## What exists

| Object (prod name) | Kind | Role |
|---|---|---|
| `ref.ga4_properties` | table | Registry: client, property, export dataset, hostname pattern, valid dates |
| `stg.ga4_sessions` | table, partition `date`, cluster `client_id` | Derived. One row per session, no PII |
| `ops.sp_load_ga4_sessions_for(client, from, to)` | procedure | Worker. Delete + insert per property in one transaction |
| `ops.sp_load_ga4_sessions(days)` | procedure | Daily entry point: last `days` complete days, every property |
| `mart.mart_ga4_sessions_daily` | view | What the dashboard reads. Client currency, bounded to 25 months |

The table is derived, so it is written only by the procedures. n8n does not touch it and nobody
edits it by hand. A wrong row is fixed by reloading its dates.

## Things that are not obvious (verified 2026-10-04)

1. **Consent mode (manami).** About 80 % of `session_start` events and a third of the purchase
   revenue arrive with no `ga_session_id` (cookieless pings, no session channel). They cannot
   become sessions. Sessions only count events that carry a session id, and a purchase without one
   is stored as its own row, `session_kind = 'purchase_no_session'`, `platform = 'unattributed'`.
   It adds purchases and revenue (so tracking coverage against the shop is honest) and never adds
   sessions. Dobias has no such traffic (cookieless share 0).
   The GA4 UI shows modelled sessions for these users, the export does not, so for manami the
   table is expected to sit below the UI.
2. **Platform rules** (in the INSERT, in this order): Google Ads campaign id present -> `google`;
   medium that starts with a Meta placement (`Facebook_Mobile_Feed`, `Instagram_Reels`) -> `meta`
   (manami and dobias have ads with swapped UTM source and medium that GA4 files as Organic Social
   or Mobile Push); paid channel group with source facebook, fb, instagram, ig, meta, an or msg ->
   `meta`; source google or youtube with medium cpc or ppc -> `google`; any other paid channel
   group -> `other_paid` (for example Seznam); everything else `non_paid`.
   Paid channel groups: Paid Search, Paid Social, Paid Shopping, Paid Video, Paid Other, Display,
   Cross-network. Meta traffic with no UTM at all (referral from facebook.com) is Organic Social
   and stays `non_paid`: it cannot be recovered from GA4. Check 2b lists the biggest such sources.
3. **Currency.** `purchase_revenue` is in the event currency. Dobias purchases arrive in USD, CAD
   and GBP, manami in CZK and EUR, venev in EUR. The table keeps the native amount, GA4's own USD
   value and the currency. The mart view converts to client currency: same currency as is, client
   currency USD uses `purchase_revenue_in_usd`, anything else uses `ref.fx_rates` for the month.
   A missing rate gives NULL revenue, never a wrong number, and `sessions_fx_missing` counts the
   affected purchase sessions. `ref.fx_rates` currently ends 2026-09-01, so October EUR orders for
   manami show up in `sessions_fx_missing` until runbook 23 is done.
4. **Export lag.** Properties are not all current at the same hour. On 2026-10-04 dobias was one
   day behind manami. The dashboard stale state (`MAX(date) < today - 3`) already allows for this.
5. **Midnight.** A session belongs to the day of its first event. The loader reads one extra day
   before the window and drops sessions that started earlier, so reloading any window never
   double counts a session that straddles the start of the window (tested, see checks).
6. **Hostname pattern** is an unanchored RE2 match on `device.web_info.hostname`. It keeps the
   shop and its checkout and drops other streams. Venev's `venevcz.myshopify.com` is deliberately
   not matched.

## Deploy (order, not executed)

1. Run `infra/bigquery/243_ga4_sessions.sql` top to bottom. It is idempotent
   (`CREATE IF NOT EXISTS`, `CREATE OR REPLACE`, seed by `MERGE`). Creates the three seed rows:
   dobias 314809580, manami 343337695, venev 324879665 (stalled, loads nothing).
2. Grant the loader its permissions (next section).
3. Backfill, once:
   ```sql
   CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(70);
   ```
   Covers yesterday back to 70 days ago, clamped by each property's `valid_from` (exports start
   2026-08-03, so about 62 days actually load). Measured in the test copy: about 16 MB scanned
   per day loaded across dobias and manami, so the backfill is about 1 GB, the daily run
   (3 days) about 50 MB.
4. Run `infra/bigquery/qa/243_checks.sql` (all checks, in order). Do not enable the schedule until
   checks 0, 2b, 3a, 5 and 5b are clean.
5. Create the scheduled query (below).
6. `ref.clients.has_ga4` is set by the registry package, not here. The dashboard capability reads
   that flag, so GA4 stays hidden in the UI until it is set, regardless of the data being there.

## Scheduled query (documentation only, do not create until approved)

Statement:

```sql
CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(3);
```

Settings: daily at 07:00 UTC, location EU, no destination table (the procedure writes), notify on
failure. 3 days because GA4 revises the last days of an export, and each run is idempotent. If the
export for a property is a day late the next run picks it up.

CLI form:

```bash
bq mk --transfer_config \
  --project_id=oneeighty-warehouse --location=EU \
  --data_source=scheduled_query \
  --display_name="ga4_sessions_daily" \
  --schedule="every day 07:00" \
  --params='{"query":"CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions`(3);"}' \
  --service_account_name=<loader service account email>
```

## Permissions

The procedures run with the caller's rights (BigQuery has no definer rights), so the identity that
runs the scheduled query and the backfill needs all of these.

| Identity | Grant | Why |
|---|---|---|
| loader (scheduled query run-as) | `roles/bigquery.dataViewer` on each `analytics_<property_id>` dataset, 3 today | read `events_*` |
| loader | `roles/bigquery.dataEditor` on `stg` | delete and insert in `stg.ga4_sessions` |
| loader | `roles/bigquery.dataViewer` on `ref` and on `ops` | read the registry, execute the procedures |
| loader | `roles/bigquery.jobUser` on the project | run query jobs |
| loader | `roles/iam.serviceAccountUser` for whoever creates the scheduled query | needed to create a transfer as a service account |
| `sa-frontend-reader` | **no new grant** | it reads `mart` only |

Whether the loader is a new service account or an existing one is the owner's decision.
`sa-n8n-writer` already has editor on `ops` and viewer on `ref`, so reusing it would add only the
`stg` editor, the three `analytics_*` viewer grants and `jobUser`. Do not widen the dashboard
account.

```bash
# per export dataset, repeat for each property
bq add-iam-policy-binding \
  --member="serviceAccount:<loader>" \
  --role="roles/bigquery.dataViewer" \
  oneeighty-warehouse:analytics_314809580

bq add-iam-policy-binding \
  --member="serviceAccount:<loader>" \
  --role="roles/bigquery.dataEditor" \
  oneeighty-warehouse:stg
```

**Dashboard access.** `mart.mart_ga4_sessions_daily` reads `stg.ga4_sessions`, `ref.clients` and
`ref.fx_rates`. `sa-frontend-reader` already reads `mart` through authorized datasets
(`stg -> mart` and `ref -> mart`, runbook 22), so the new view works with no change. If the view
403s with `Access Denied: Table ... stg.ga4_sessions`, re-run the `auth_ds stg mart` and
`auth_ds ref mart` lines from runbook 22. The `analytics_*` datasets are only touched by the
loader, never by a view, so they must NOT be authorized to `mart` and the dashboard account gets
no access to them (they hold raw user pseudo ids).

## Adding a GA4 property (new client, or a second stream)

1. In GA4 Admin, link the property to BigQuery (daily export, same project, location EU). Wait for
   the first `events_YYYYMMDD` table. Note the property id, the dataset is `analytics_<id>`.
2. Grant the loader `dataViewer` on the new dataset (command above).
3. Find the shop hostname:
   ```sql
   SELECT device.web_info.hostname AS host, COUNT(*) AS n,
          COUNTIF(event_name = 'purchase') AS purchases
   FROM `oneeighty-warehouse.analytics_<id>.events_*`
   WHERE _TABLE_SUFFIX = FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY))
   GROUP BY host ORDER BY n DESC;
   ```
   Pick a pattern that keeps the shop and its checkout (the host that has `purchase` events) and
   drops anything else. Check the purchase currency while there
   (`event_params` key `currency`) and that `ref.clients.currency` plus `ref.fx_rates` can convert
   it (runbook 23).
4. Register it:
   ```sql
   INSERT INTO `oneeighty-warehouse.ref.ga4_properties`
     (client_id, property_id, dataset_id, hostname_pattern, is_primary, valid_from, valid_to, note, updated_at)
   VALUES ('<client_id>', '<id>', 'analytics_<id>', r'<shop\.example\.com>', TRUE,
           DATE '<first export day>', NULL, '<note>', CURRENT_TIMESTAMP());
   ```
   `dataset_id` must match `analytics_<digits>`, the procedure refuses anything else.
5. Backfill only that client, from the first export day:
   ```sql
   CALL `oneeighty-warehouse.ops.sp_load_ga4_sessions_for`('<client_id>', DATE '<first export day>', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY));
   ```
   The daily schedule picks the property up on its own from then on.
6. Run `qa/243_checks.sql`. Checks 3a and 5b hard-code the property per UNION branch, add one
   branch for the new property. Then set `ref.clients.has_ga4` (registry package).

If a hostname pattern or the platform rules change, reload the affected dates with
`sp_load_ga4_sessions_for`. The table is derived, so a reload fully replaces the rows.

## Operating

- **Freshness.** Check 0 of the QA file, or `SELECT client_id, MAX(date) FROM stg.ga4_sessions GROUP BY 1`.
  More than 3 days behind means the export itself is late or stopped (venev has been stalled since
  2026-08-19): look at the `analytics_<id>` dataset, not at the procedure.
- **Failure.** The procedure raises `sp_load_ga4_sessions_for failed for <client> (<property>): ...`
  and rolls back that property's delete and insert, so a failed run leaves the previous rows
  intact. Properties after the failing one are skipped until the cause is fixed, then rerun.
- **Rerun.** Always safe. `CALL ...sp_load_ga4_sessions(7)` reproduces the same rows except
  `loaded_at` (tested, check 4).
- **Cost.** About 50 MB per daily run. The mart view is clustered and partitioned, a 7 day
  dashboard query scans about 2 MB.

## Test copy

The same SQL was run in `mart_qa` with a `pa3_` prefix, names mapped like this:

| Prod | Test |
|---|---|
| `ref.ga4_properties` | `mart_qa.pa3_ga4_properties` |
| `stg.ga4_sessions` | `mart_qa.pa3_ga4_sessions` |
| `ops.sp_load_ga4_sessions_for` | `mart_qa.pa3_sp_load_ga4_sessions_for` |
| `ops.sp_load_ga4_sessions` | `mart_qa.pa3_sp_load_ga4_sessions` |
| `mart.mart_ga4_sessions_daily` | `mart_qa.pa3_mart_ga4_sessions_daily` |

To rerun the checks against the test copy:

```bash
perl -pe 's/\.ref\.ga4_properties`/.mart_qa.pa3_ga4_properties`/g; s/\.stg\.ga4_sessions`/.mart_qa.pa3_ga4_sessions`/g; s/\.ops\.sp_load_ga4_sessions`/.mart_qa.pa3_sp_load_ga4_sessions`/g; s/\.mart\.mart_ga4_sessions_daily`/.mart_qa.pa3_mart_ga4_sessions_daily`/g' \
  infra/bigquery/qa/243_checks.sql
```

## Known limits

- Sessions are the GA4 export's sessions, so consent-denied traffic is missing (manami).
  Revenue from such purchases is kept as `unattributed`, never given a channel.
- Last-click here is GA4's `session_traffic_source_last_click`, session scoped. It is not the
  platform's attribution window, which is the point of the cross-check on the GA4 tab.
- Meta traffic without UTM tags cannot be told apart from organic Facebook traffic.
- A purchase transaction re-fired in a later session after the window it first appeared in would
  be counted twice (de-duplication is per scanned window). Not seen in the data checked.
