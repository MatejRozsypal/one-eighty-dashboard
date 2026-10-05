# PA3 report: GA4 sessions in the warehouse (WP-A3)

Branch `pa3-ga4`, commit `222b6f9`. Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/pa3-ga4`.
Prod untouched (only `mart_qa.pa3_*` written). No scheduled query registered, no `ref.clients` change.

## Files (only owned files)
- `infra/bigquery/243_ga4_sessions.sql` (registry, derived table, 2 procedures, mart view, with prod names)
- `infra/bigquery/qa/243_checks.sql` (checks 0 to 6, prod names, perl line in the header maps to the test copy)
- `runbooks/30_ga4_sessions.md` (deploy order, scheduled query statement, 70 day backfill, permissions, adding a property, test copy map)

## Step 1: export schema verification (read-only, 7 day suffix ranges)
- `session_traffic_source_last_click.cross_channel_campaign` has `default_channel_group, source, medium, campaign_id, campaign_name`; `google_ads_campaign` has `customer_id, campaign_id, campaign_name`. Populated on every event that carries `ga_session_id` (0 events with null channel group among them).
- `ecommerce.transaction_id`, `purchase_revenue`, `purchase_revenue_in_usd` exist. Currency is NOT in `ecommerce`, it is the `currency` event param.
- Currencies on purchases (7d): dobias USD 142 / CAD 77 / GBP 2 (so GA4 revenue is multi-currency, not just USD), manami CZK 41 / EUR 5, venev EUR (4 sample days).
- Hostnames: dobias `peterdobias.com` (all 221 purchases), `account.peterdobias.com`, a translate.goog host; manami `eshop.manami.cz`; venev `venev.eu`, `venev.cz`, `venevcz.myshopify.com` (pattern `venev\.(eu|cz)` excludes the last).
- `session_engaged` is a string on most events and an int on some. Handled with COALESCE.
- Venev: only events_20260804/10/12/19 exist. Dobias export was 1 day behind manami on 2026-10-04 (no events_20261003 yet).

### Findings that change the design (please read)
1. **Consent mode on manami.** 4,201 `session_start` events in 7d, only 767 carry `ga_session_id` (cookieless share about 0.8 every day). 18 of 46 purchases and 16.4k of 48.1k CZK revenue have no session id. Dobias: share 0. Sessions can only be built from events with a session id. To keep tracking coverage honest, a purchase without a session becomes its own row (`session_kind='purchase_no_session'`, `platform='unattributed'`, sessions 0). **This adds a 5th platform value `unattributed` to the spec's four.** The dashboard must count it in "all channel revenue" and tracking coverage but never in paid, and show something like "x % of GA4 revenue has no channel (consent)" on the GA4 tab for manami.
2. **Swapped UTMs.** Some Meta ads have source and medium swapped (source holds the campaign name, medium `Facebook_Mobile_Feed`, `Instagram_Reels`, `Facebook_Desktop_Feed`). GA4 files them as Mobile Push, Unassigned or Organic Social. Rule added: medium starting with a Meta placement prefix is `meta`. Also `an` (Audience Network) and `msg` as sources count as Meta when the group is paid, and `youtube` / `google` with cpc counts as Google.
3. **Seznam** (Paid Search, seznam/cpc) lands in `other_paid`, not `google`.
4. Dobias `facebook.com / referral` (3,319 sessions in 7d) and `m.facebook.com`, `instagram.com` are Organic Social and stay `non_paid`: untagged Meta traffic cannot be recovered from GA4. Check 2b lists it.

## Step 2: mart_qa objects created
- `mart_qa.pa3_ga4_properties` (3 seed rows), `mart_qa.pa3_ga4_sessions` (partition `date`, cluster `client_id`), `mart_qa.pa3_sp_load_ga4_sessions_for(client, from, to)`, `mart_qa.pa3_sp_load_ga4_sessions(days)`, view `mart_qa.pa3_mart_ga4_sessions_daily`.
- Table columns beyond the spec: `property_id`, `session_kind`, `session_start_ts`, `campaign_id`, `revenue_usd`, `currency`. Mart view adds `sessions_fx_missing`.
- Loaded `CALL pa3_sp_load_ga4_sessions(7)` (2026-09-27 to 2026-10-03): dobias 13,963 rows (to 10-02), manami 787 rows (to 10-03). Venev is registered and loads nothing in that window.
- **Bytes processed:** first load 111.4 MB; reload (7d) 119.5 MB; reload (3d) 53.3 MB. Dry-run of a 7 day dashboard query on the mart view: 1.9 MB. Extra, to test the stalled property: a venev load of August (48 KB scanned), then its 3 rows deleted again.
- Design notes: procedure reads one extra day before the window and drops sessions that started earlier (midnight straddle), so partial reloads never duplicate. Purchases are de-duplicated by transaction id inside the scanned range. dataset_id is validated against `^analytics_[0-9]+$`. Delete + insert are one transaction per property, rollback on error.

## Step 3: check results (test copy, window 2026-09-27 to 2026-10-03)
- **Check 0 freshness:** dobias last_date 10-02 (1 day behind), manami 10-03. ok.
- **Check 1 coverage (GA4 vs `mart_daily_kpis`):**
  - dobias: orders coverage 0.62 to 0.90 per day (about 0.74 over the week), revenue coverage vs shop revenue 0.56 to 0.80.
  - manami: orders coverage 0.67 to 1.17 (one day above 1), revenue coverage 0.58 to 0.98; unattributed share of GA4 revenue 15 to 61 % per day.
  - Dobias GA4 revenue is checkout value (tax and shipping included), shop `revenue` excludes tax, so compare also `coverage_gross`. Both are in the output.
  - manami Oct 3 shows coverage 0.11 only because one EUR purchase has no Oct FX rate (see FX below).
- **Check 2a platform share (7d):** dobias non_paid 88.9 % of sessions / 97.4 % of revenue, meta 10.9 % / 2.6 %, other_paid 16 sessions, google 4. Manami meta 49.5 % / 17.9 % of revenue, google 24.8 % / 5.7 %, non_paid 21.8 % / 42.8 %, other_paid 3.8 %, unattributed 0 sessions / 33.5 % of revenue.
- **Check 2b rule leaks:** 0 paid-group sessions fell into non_paid, 0 unattributed rows with sessions. Informational list as above.
- **Check 3a sessions vs canonical GA4 recipe** (`COUNT(DISTINCT user_pseudo_id, ga_session_id)` from the export): table at or below canonical on all 13 property-days, difference at most 1.4 % (dobias) and 1.0 % (manami), all `ok`. Sessions per day: dobias 2,041 to 2,533, manami 96 to 135.
- **Check 3b GA4 UI magnitude: NOT DONE, owner step.** I cannot read the GA4 UI. The query to compare is in the file. Expect the manami table to be below the UI (modelled sessions), dobias to be about equal.
- **Check 4 determinism:** reload of the same 7 days: 14,750 rows before and after, 0 days differ (per day row count and XOR of FARM_FINGERPRINT of every row except `loaded_at`). Partial reload of 3 days over the 7 day table: 14,750 rows, 0 days differ, 0 duplicate session keys.
- **Check 5 integrity:** all 8 rules 0 failures (duplicate keys, platform values, channel group, currency, revenue, negatives, no-session flags, null landing path).
- **Check 5b purchases vs export:** distinct transaction ids dobias 221 = 221, manami 46 = 46.
- **Check 6 currency:** dobias CAD 13,972.14 -> 9,865.63 USD (0.7061, from GA4's own USD value), GBP 300.10 -> 397.36, USD 1.0; manami CZK 1.0, EUR 5 rows 83.35 EUR with 3 rows in `fx_missing` (October, `ref.fx_rates` ends 2026-09-01).

## Step 4: prod migration (ordered, NOT executed)
1. `infra/bigquery/243_ga4_sessions.sql` (idempotent, whole file): `ref.ga4_properties` + seed, `stg.ga4_sessions`, `ops.sp_load_ga4_sessions_for`, `ops.sp_load_ga4_sessions`, `mart.mart_ga4_sessions_daily`.
2. IAM for the loader (runbook 30 "Permissions"): dataViewer on the 3 `analytics_*` datasets, dataEditor on `stg`, dataViewer on `ref` and `ops`, jobUser. `sa-frontend-reader` needs NO new grant (reads `mart`; `stg -> mart` and `ref -> mart` are already authorized per runbook 22). Do not authorize `analytics_*` to `mart`.
3. `CALL \`oneeighty-warehouse.ops.sp_load_ga4_sessions\`(70);` (about 1 GB scanned).
4. `infra/bigquery/qa/243_checks.sql`, then the scheduled query `CALL \`oneeighty-warehouse.ops.sp_load_ga4_sessions\`(3);` daily 07:00 UTC (CLI form in the runbook). The run-as identity is the owner's choice.
5. `has_ga4 = TRUE` for dobias and manami: other package.

## Open issues
- `ref.fx_rates` ends 2026-09-01. Until runbook 23 is done, October EUR purchases for manami have NULL client-currency revenue (flagged by `sessions_fx_missing`). The GA4 tab should surface it, or tolerate a small revenue gap.
- Dobias GA4 revenue includes tax and shipping while `mart_daily_kpis.revenue` does not, so the headline coverage ratio for dobias is understated. Decide which shop column the tab compares to (I would use `gross_revenue_incl_tax` for Shopify clients and note it).
- Meta ads without UTM tags are invisible to the GA4 platform split.
- The queryable `has_ga4` gating and the stale state work with a property one day behind (dobias).

## Requests to orchestrator
- Dashboard (A3 query modules): treat `platform = 'unattributed'` as all-channel only; sessions in the mart already exclude it (`sessions` = real sessions only, `purchases` and `revenue` include it). `channel_group` for those rows is the literal `Unattributed`.
- Run runbook 23 (FX refresh) before enabling the GA4 tab for manami, or accept the October gap.
- Decide the loader identity (new service account vs `sa-n8n-writer` plus three grants).
- Someone with GA4 access should do check 3b (compare table sessions with GA4 Traffic acquisition for the same dates).
