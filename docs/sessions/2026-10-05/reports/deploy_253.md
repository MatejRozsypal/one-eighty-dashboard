# deploy_253: migration 253 on PROD BigQuery (oneeighty-warehouse, EU)

Deployed 2026-10-05 (about 09:41 UTC). Owner approved today. Statement 0 (GRANT to sa-n8n-writer) was NOT run.
The n8n workflow was not activated. Dashboard code and the registry switch were not touched. No other prod object was changed.

## What was run (in order)
1. Preflight (read only): no `rpt_kpis_daily*` table, no `sp_refresh_rpt_kpis` routine in `mart`; view `mart.mart_daily_kpis` md5 `9a5405191e68a9be6d52f8f6b5e8cfdc` = the recorded one.
2. Statement 1: `CREATE OR REPLACE PROCEDURE mart.sp_refresh_rpt_kpis()` (text copied from 253; the file body equals `live/mart.sp_refresh_rpt_kpis.sql`, diff empty). Job `job_jSptRJgG76c9ZV7-t5hz6pPiB3Ho`.
3. Statement 2: `CALL mart.sp_refresh_rpt_kpis()`. Succeeded, job `job_ZmmtjIA5afBZK5dAP1dEUx316fIc`, 451.3 MB processed, 462.4 MB billed, one scan of the view.

## Post-deploy checks (section P of qa/253_regression.sql)
| Check | Expected | Result |
|---|---|---|
| P1 objects | `rpt_kpis_daily` only, no `__next` | table `rpt_kpis_daily`, 5,371 rows, 1,593,019 bytes. No `__next`. |
| P1 freshness | `refreshed_at` set, recent | MIN = MAX = 2026-10-05 09:41:42 UTC (epoch 1791193302), 0 NULLs, `MAX(date)` 2026-10-05 |
| P2 table DDL md5 | `c8c7144fed6bdbb678f02043b0e92e67` | equal |
| P2 routine DDL | equals live file | equal (same body; BigQuery only normalises the header line) |
| R3 schema | same_cols true, 35 cols, 61 partitions | true, 35, 61 |
| Partitioning | monthly on `date`, clustered `client_id, date` | `PARTITION BY DATE_TRUNC(date, MONTH)`, cluster client_id#1, date#2 |
| P3 regression (R4 vs prod table) | 0 and 0 | `view_minus_tbl` 0, `tbl_minus_view` 0 (`date < CURRENT_DATE()`, whole row via TO_JSON_STRING, `refreshed_at` excluded, 3 FLOAT64 `google_*` columns rounded to 6 decimals) |
| Rows per client, view = table | equal | dobias 1,825, ethia 517, manami 834, rawbark 1,464, venev 728 (both sides) |
| Widget dry run | under 1 MB | **46,866 bytes processed** (0.045 MB), 0 billed on dry run |

Widget shape: compile.ts layout (fx CTEs, mart CTE with date predicate, `ref.clients` join, two fx joins, ISO-week grain), 5 clients, 2026-07-06 to 2026-10-03, CZK, revenue, CM3, paid spend, COGS, orders, impressions, clicks. Run for real once: 34,777 bytes processed, 31.5 MB billed (BigQuery 10 MB minimum per table read), 7.9 slot s. All 5 clients return rows (dobias, ethia, manami, rawbark 13 weeks; venev 8 weeks, 48 days, as its data starts later), `fx_missing` 0 for all. Dobias revenue 13,028,626.25 CZK equals QF3's value. CM3 and spend differ from QF3's recorded numbers by 0.87 CZK (9,464,597.62 vs 9,464,598.49; 1,002,913.75 vs 1,002,912.88): QF3 ran earlier and used its own compiled SQL, and the table-vs-view check (P3) is the equality proof, so this is not a regression signal. The widget SQL used here is a hand-built equivalent, saved at `.../scratchpad/deploy253_widget.sql` (table placeholder `__KPIS_TABLE__`).

## Scheduled query text for the owner (BigQuery console)
Console: BigQuery, Scheduled queries, Create scheduled query. Run it under the owner's own account (the default: scheduled queries run as the user who creates them).

- Name: `rpt_refresh_hourly`
- Location: EU (multi-region, same as `oneeighty-warehouse.mart`)
- Repeats: Custom, `every 1 hours`. The console has no "minute" field: set the start time to a time at :10 (for example today 10:10) so the hourly runs land on :10.
- Destination table: none (leave "Set a destination table" unchecked)
- Query text, paste exactly:

```sql
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`();
-- CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();
```

When migration 254 is deployed, remove the leading `-- ` on the second line. A failure in the first CALL stops the script before the second one runs.

After saving, use "Run now" once and check `SELECT MAX(refreshed_at) FROM mart.rpt_kpis_daily` advanced.
P4 (after about 24 h) needs a change for this setup: the refresh jobs now come from the owner's account, not `sa-n8n-writer`. Drop or change the `user_email` expectation; the `feature = rpt-kpis-refresh` label filter still works.

## Cost
About 450 MB per run, 24 runs a day, about USD 2 per month, as designed.

## Open issues and requests to orchestrator
- 253 header, `live/README.md` ("Pending deploy" section) and the n8n export still describe n8n as the scheduler and statement 0 as part of the deploy. They should be updated to say: procedure and table deployed 2026-10-05, scheduler is the owner's scheduled query `rpt_refresh_hourly`, statement 0 not applied, n8n workflow `BnRCbPqaYSO0zwIS` stays inactive (or gets archived). I did not edit them (instructed to touch only PROJECT_LOG).
- The procedure description string mentions the n8n workflow. Cosmetic, can be fixed with a later `CREATE OR REPLACE PROCEDURE`.
- Until the owner creates the scheduled query, `mart.rpt_kpis_daily` is a one-time snapshot from 09:41 UTC. Do not do the QF1 registry switch before the first scheduled run is confirmed.
- Cleanup of `mart_qa.qf3_sp_refresh` and `mart_qa.qf3_rpt_kpis_daily` is still pending (QF3 note).
- Rollback, if needed: revert QF1 commit 4 (not applied), delete the scheduled query, then `DROP TABLE mart.rpt_kpis_daily; DROP TABLE IF EXISTS mart.rpt_kpis_daily__next; DROP PROCEDURE mart.sp_refresh_rpt_kpis;`. No grant exists to revoke.
