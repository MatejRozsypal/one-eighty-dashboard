# QF3: materialise the KPI mart for Reports (C-03, server side)

Branch `qf3-rpt-kpis`, worktree `oe-dash-wt/qf3-rpt-kpis`, commit `099e270` (on `main` 92ac505). Not pushed, not merged.
Nothing was created or changed in prod BigQuery. The n8n workflow exists but is **inactive** and has never run.

## Findings covered
- C-03 (server side): `mart.mart_daily_kpis` is a view that cannot prune. A compiled 90-day, 5-client widget costs
  419.5 MB, 1,644 slot seconds and 3.0 s. The same SQL on the materialised table costs 34.5 KB, 8 slot seconds
  and 0.5 s, with identical per-client results.

## What changed (files)
- `infra/bigquery/253_rpt_kpis_daily.sql`: header (design, measurements, IAM, deploy order, rollback, scheduled
  query fallback), statement 0 GRANT, statement 1 procedure, statement 2 first CALL.
- `infra/bigquery/qa/253_regression.sql`: R1 to R6 with recorded results, section P for after the deploy.
- `infra/bigquery/live/mart.rpt_kpis_daily.sql`: expected table DDL. md5 equals the `mart_qa` candidate DDL with the name mapped back.
- `infra/bigquery/live/mart.sp_refresh_rpt_kpis.sql`: the procedure, byte-equal to statement 1 of 253.
- `infra/bigquery/live/README.md`: rows for the two files, plus a "Pending deploy" section.
- `infra/n8n/wf_rpt_kpis_refresh.json`: export of n8n workflow `BnRCbPqaYSO0zwIS`.
- `PROJECT_LOG.md`: 2026-10-05 entry, marked prepared and not deployed.

## Design
- Table `mart.rpt_kpis_daily`: the 34 view columns (same names, order and types) plus `refreshed_at`.
- Procedure `mart.sp_refresh_rpt_kpis()`:
  1. Builds `rpt_kpis_daily__next` from the view.
  2. ASSERTs that rows > 0, rows >= 90 % of the live table (skipped when the table is absent), no duplicate (client_id, date), and `MAX(date) >= CURRENT_DATE()-2`.
  3. Swaps the new table in with `CREATE OR REPLACE TABLE ... COPY` and drops `__next`.
  4. Labels every child job `feature=rpt-kpis-refresh`.
- **Deviation from the plan: monthly partitions** (`PARTITION BY DATE_TRUNC(date, MONTH) CLUSTER BY client_id, date`) instead of daily.
  - Daily: 1,827 partitions of about 3 rows each. CALL took 70 to 88 s, of which the COPY was 38 to 52 s.
  - Monthly: 61 partitions. CALL takes 12 to 13 s, of which the COPY is 1.7 s.
  - Widget bytes are the same order with either layout (36 KB vs 35 KB).
  - Monthly also stays far from the 4,000 partitions-per-job limit.

## Verification (mart_qa, prefix qf3_)
- Objects left in `mart_qa` for the orchestrator's cleanup: procedure `qf3_sp_refresh` and table `qf3_rpt_kpis_daily`. Scratch tables `qf3_m_*` were dropped.
- **Regression**, view vs table, `date < CURRENT_DATE()`, whole row via `TO_JSON_STRING` with `refreshed_at` excluded:
  - With the three FLOAT64 `google_*` columns rounded to 6 decimals: 0 rows in each direction. Row counts per client are equal.
  - Unrounded: 249 to 257 rows differ, all RawBark. This is the known FLOAT64 summation noise from 235, and the count changes between runs.
- **Schema:** same 34 columns plus `refreshed_at`, 61 partitions.
- **First run and replace:** both work, `refreshed_at` advances on every run, and `__next` is dropped after success.
- **Failure paths:** in both cases the live table stays unchanged.
  - Ratio ASSERT failure: proven by the DELETE afterwards removing exactly the 1,373 injected rows.
  - Partition-spec change error: rows and `refreshed_at` were unchanged afterwards.
- **Widget acceptance (< 25 MB):**
  - Processed: 0.03 MB on the table vs 419.5 MB on the view.
  - Billed: 31.5 MB, which is BigQuery's 10 MB minimum for each of the 3 tables read.
  - Duration: 518 ms vs 2,975 ms (from `INFORMATION_SCHEMA.JOBS`).
- **Cost:** about 450 MB per run, about 325 GB per month, about USD 2.
- **n8n:** followed the server steps (SDK reference, scheduling best practices, search_nodes, get_node_types, list_credentials) and validated, then created the workflow.
  - Read back: `active: false`, `activeVersionId: null`.
  - Workflow: hourly at :10, one BigQuery node `CALL mart.sp_refresh_rpt_kpis()`, location EU, credential "BQ Service Account".
  - Settings: retry 2x, error workflow "Error workflow", timezone Europe/Prague.
  - Personal project. Not executed, not published.

## Blocker found: IAM
`sa-n8n-writer` runs the n8n BigQuery jobs. It has dataEditor on `raw`, `ref` and `ops`, and **nothing on `mart`**. In the last 60 days it never touched `mart`. A procedure runs with the caller's rights, so the hourly CALL would fail. 253 statement 0 grants it `roles/bigquery.dataEditor` on `mart`.
- Side effect: that account could also replace `mart` views. This needs owner OK.
- Alternative without any IAM change: run the same CALL as a scheduled query owned by the owner, and leave the n8n workflow inactive.
- Project-level IAM was not visible to my read-only checks.
- The GRANT syntax parsed in a dry run. Its dataset resolution failed only because the MCP dry run does not run in the EU location, so run it in EU.

## Deploy steps (exact order, after owner OK)
1. In the BigQuery console (location EU), run 253 statement 0 (GRANT). Or pick the scheduled-query alternative and skip step 5.
2. Run 253 statement 1 (CREATE OR REPLACE PROCEDURE), then statement 2 (`CALL`, about 13 s).
3. Run `qa/253_regression.sql` section P1 to P3:
   - Rows and `refreshed_at` look right, and no `__next` is left.
   - The DDL md5 is `c8c7144fed6bdbb678f02043b0e92e67`.
   - The R4 compare against `mart.rpt_kpis_daily` gives 0 and 0.
4. In n8n, open "BQ: refresh rpt_kpis_daily", execute it once manually, and confirm success and that `refreshed_at` advanced.
5. Publish (activate) the workflow.
6. Merge QF1 commit 4 (`MARTS.kpis.table = "mart.rpt_kpis_daily"`), deploy the dashboard, and re-run QF1's harness against prod.
7. After 24 h, run P4: 24 successful hourly refreshes run by `sa-n8n-writer`.
8. Remove the "Pending deploy" section from `live/README.md`.
9. Rollback, in this order: revert QF1 commit 4, deactivate the workflow, DROP the table, `__next` and the procedure, then REVOKE the grant.

## Requests to orchestrator
- Owner decision: GRANT dataEditor on `mart` to `sa-n8n-writer`, or use the scheduled-query alternative.
- Note for QF1 commit 4: the table lags the view by up to 1 h.
