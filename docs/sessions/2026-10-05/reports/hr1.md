# HR1 report: mart.rpt_ad_launch (migration 254)

Branch `hr1-ad-launch` (worktree oe-dash-wt/hr1-ad-launch), one commit. Not pushed.

## Files (all under infra/bigquery)
- `254_rpt_ad_launch.sql` (header, procedure, first CALL, scheduled query text)
- `qa/254_rpt_ad_launch_regression.sql` (all queries and results)
- `live/mart.sp_refresh_rpt_ad_launch.sql` (procedure, identical to the deployed one)
- `live/mart.rpt_ad_launch.sql` (table DDL taken from prod)

Differences from the design sketch: ad_name, campaign_id, adset_id are the latest value of the ad (deterministic) instead of ANY_VALUE; creative_id is NULLIF'd to ''; is_relaunch is never NULL; CLUSTER BY client_id only. No n8n node and no GRANT (owner uses a scheduled query, which runs as the owner).

## Check results (mart_qa hr1_ first, then prod; identical)
| Check | Result |
|---|---|
| EXCEPT DISTINCT vs lifetime sums from mart_meta_ad_perf, both directions | 0 and 0, 459 rows each side (mart_qa and prod). Source sums need IFNULL like the procedure, otherwise 329 ads differ only in video_plays NULL vs 0 |
| Same ad set and lifetimes as scratch table hr_ad_life2 | 0 differences |
| Pre-existing | Dobias 6, Ethia 1, Manami 3, Venev 7 |
| prior_roas | 2.8422, 2.2832, 2.0287, 0.1078 |
| Relaunches in the 12 launch months (first_date >= 2025-10-01) | Dobias 23, Manami 39, Ethia 0, Venev 0 (Manami 43 all time) |
| Launched (not pre-existing, not relaunch) / ad grain | Dobias 35 / 58, Ethia 156 / 156, Manami 122 / 161, Venev 9 / 9 (equals design table 1.4) |
| CALL time | mart_qa 14.1 s and 12.3 s, prod 9.95 s (limit 30 s); 299 MB processed, 309 MB billed |
| App query | 68,834 bytes processed (limit 1 MB), 10 MB billed minimum |
| Duplicates, __next left, bad values | 0, 0, 0; 28 columns |
| ASSERT failure keeps live table | 659 fake rows: CALL failed with "below 90 %", table unchanged at 1,118 rows, DELETE removed exactly 659, next CALL ok |
| sa-frontend-reader | has roles/bigquery.dataViewer on dataset mart (dataset level, inherited by the new table). Not impersonated, so the read is inferred from the grant, not exercised |
| Files equal deployed objects | table ddl md5 27c2bb8d03f101ff6dbe52c8b7b918f6; procedure body md5 99a2871c0482e3ab60b7040a94848801, both equal |

## Deployed to prod (after the mart_qa checks passed, owner approval for 254 only)
1. CREATE OR REPLACE PROCEDURE mart.sp_refresh_rpt_ad_launch
2. CALL mart.sp_refresh_rpt_ad_launch (created mart.rpt_ad_launch, 459 rows, 119,657 bytes, no __next left)
Nothing else in prod was touched.

mart_qa objects (prefix hr1_, delete when done): hr1_sp_refresh_rpt_ad_launch, hr1_rpt_ad_launch.

## Open issues
- Ethia has 0 rows in mart_creative_asset, so no relaunch detection for Ethia (known gap).
- Not scheduled yet: the owner must create the scheduled query (text at the end of 254). Until then the table is a snapshot of 2026-10-05; the app should show `refreshed_at` or not rely on freshness.
- Maturity: age_days uses `through` (latest loaded day, 2026-10-04), per client.

## Requests to orchestrator
- `infra/bigquery/live/README.md`: add rows for `mart.rpt_ad_launch.sql` and `mart.sp_refresh_rpt_ad_launch.sql` (deployed, md5 above); I do not own that file.
- Owner: create the daily scheduled query `CALL mart.sp_refresh_rpt_ad_launch();` (EU).
- The n8n workflow file was intentionally not edited.
