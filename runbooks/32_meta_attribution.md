# 32. Meta attribution windows (7-day click and 1-day view per row)

Package ME2, owner decision D3 (2026-10-05): store both `7d_click` and `1d_view` per row, decide on 7-day click, the dashboard label states the window it shows.

Files: `infra/bigquery/256_meta_attribution_windows.sql`, `infra/bigquery/qa/256_regression.sql`, `infra/n8n/wf_meta_ads_to_bigquery.json` (windows branch), `infra/n8n/wf_meta_attribution_windows_backfill.json`.

## 1. How Meta reports purchases today

- The live ingest (`wf_meta_ads_to_bigquery`, n8n id `AnfdTVrS83ioPsd3`) calls `/act_<id>/insights` at ad level with `time_increment=1` and no `action_attribution_windows`.
- Since Meta made unified attribution mandatory in the Insights API (2025), such a request returns each ad set on its **own** attribution setting, exactly as Ads Manager shows it. `use_unified_attribution_setting` is ignored.
- Verified 2026-10-05: Meta Ads MCP figures and `stg.stg_meta_ad_insights` agree to the cent on all 17 Manami ad sets for 2026-07-07 to 2026-10-04, across all three settings in use.
- Settings in use (Meta Ads MCP, `mart_qa.me2_adset_attribution`): `7d_click`, `1d_view_7d_click`, `1d_view_7d_click_1d_ev` (engaged video view). So `purchases` and `revenue` mix windows inside one account.
- Share of 90-day purchases in ad sets with a view window: Dobias 94 %, Ethia 100 %, Manami 69 %, Venev 100 %.

## 2. How the split is requested

Add `action_attribution_windows=["7d_click","1d_view","1d_ev"]` to an ad-level insights request. Every entry of `actions` and `action_values` then carries one key per window next to `value`:

```json
{"action_type": "omni_purchase", "value": "3", "7d_click": "2", "1d_view": "1"}
```

- `7d_click`, `1d_view` and `1d_ev` are separate windows. The ad set's legacy figure equals the sum of the windows in its setting, so the legacy columns can be reconciled (check C of `qa/256_regression.sql`).
- A window key can be missing on an entry. The transform stores 0 then. A missing purchase entry stores NULL, as the legacy `purchases` does.
- `1d_ev` is requested in addition to the two D3 windows so that reconciliation is exact for ad sets with engaged view.
- 7-day and 28-day view windows were removed by Meta on 2026-01-12. `7d_click`, `1d_view` and `1d_ev` remain.
- The Meta Ads MCP cannot request windows: `ads_get_ad_entities` rejects `action_attribution_windows` as a breakdown, and no field carries a single window. Only the Graph API call can do it, which is why the exact view share is measured by the backfill (step 2 below) and not in stage 1.

The legacy request is left unchanged. The windows come from a **second** request in the same loop iteration, written to a **separate** table:

```
... -> BQ: insert ad insights -> Fetch ad attribution windows (executeOnce)
    -> Transform ad attribution windows -> BQ: insert ad attribution windows -> Loop over plan
```

Why a separate table and request:

- The legacy insert uses `autoMapInputData`. A column mismatch would fail the node, and with `onError=continueRegularOutput` it would silently drop all ad rows.
- A backfill of the windows does not rewrite legacy rows.
- Rollback means: stop writing and drop the join.

## 3. Warehouse objects (migration 256)

| Object | Change |
|---|---|
| `raw.raw_meta_ad_attribution_windows` | new table. Append-only, partitioned by `date_start`, `require_partition_filter`. |
| `stg.stg_meta_ad_attribution_windows` | new view: latest ingest per client, ad and day. |
| `mart.mart_meta_ad_perf` | adds 7 columns at the end: `attribution_windows`, `purchases_7d_click`, `revenue_7d_click`, `purchases_1d_view`, `revenue_1d_view`, `purchases_1d_ev`, `revenue_1d_ev`. |
| `mart.mart_creative_perf` | adds the same 7 columns after `currency`. |
| `mart.rpt_ad_launch` (procedure) | adds 10 columns after `is_new_adset`: `attribution_split_days`, `attribution_split_complete`, the six lifetime window sums, `prior_roas_7d_click` and `prior_split_coverage`. |

- Existing columns keep the ad set setting semantics, and no value changes. Regression results: 0/0 on 12,631 rows (both views) and on 459 rows (rpt).
- Lifetime window sums are NULL unless every delivery day of the ad has the split. `prior_roas_7d_click` is NULL unless every delivery day of the trailing 365 days has it. A half-backfilled history therefore never reads as "7-day click".

## 4. Stage 2 deploy plan (needs orchestrator and owner approval)

Do the steps in this order.

**Step 1. Raw table and stg view** (statements 1 and 2 of 256)
- Harmless: nothing reads them yet.

**Step 2. Backfill and measurement**
1. Import `wf_meta_attribution_windows_backfill.json` as a new, inactive workflow.
2. Attach the same credentials as the live workflow: BQ Service Account on the BigQuery and Secret Manager nodes.
3. Optionally set `CLIENTS` in "Plan execution" to the four audit clients first.
4. Run it manually. It sends 12-day chunks from each client's first ad-insights day to yesterday, one Graph call per chunk with a 3 s pause. That is about 50 chunks for Ethia and Manami and fewer for the others: about 150 to 200 calls, 15 to 25 minutes.
5. It writes to `raw.raw_meta_ad_attribution_windows` with `ingest_source='backfill_me2'`.
6. Measure before any prod view changes:
   1. Re-create the candidate `mart_qa.me2_mart_meta_ad_perf` with its windows join pointing at the prod `stg.stg_meta_ad_attribution_windows`. This is the 256 statement 3 text with only the view name mapped.
   2. `CALL mart_qa.me2_sp_refresh_rpt_ad_launch()`.
   3. Run section D of `qa/256_regression.sql` with `mart.` replaced by `mart_qa.me2_`.

   D gives the exact 1-day view share per client and how many winners change on 7-day click.
7. **Decision point:** report the D numbers to the owner before the dashboard switches.

**Step 3. Mart views** (statements 3 and 4)
- The columns appear, filled for backfilled days.

**Step 4. Procedure and CALL** (statement 5 and the CALL)
- `rpt_ad_launch` gets 41 columns.
- Run sections B1 (prod names), C2 and D2.

**Step 5. Live workflow**
- Add the three nodes and rewire `BQ: insert ad insights -> Fetch ad attribution windows ... -> Loop over plan`, as in `wf_meta_ads_to_bigquery.json`.
- Prefer editing the live workflow (three nodes, one connection) to a full import. The repo file was synced from live version `2b8fb345-b8ec-4aa1-83bf-b45ffe1b8ae9`, but credential references are not in the repo.
- Before editing, confirm the live version is still `2b8fb345...`. If it is not, diff first.
- Watch the next two hourly executions:
  - the legacy insert row counts are unchanged;
  - the windows insert succeeds;
  - section C reconciles.

**Step 6. Dashboard (ME3)**
- ME3 switches the winner test to `purchases_7d_click`, `revenue_7d_click` and `prior_roas_7d_click` where `attribution_split_complete` is TRUE.
- The label changes to "7-day click".
- Until then, the label must say what the numbers are, for example "Meta attribution as set per ad set (7-day click, most ad sets also 1-day view)". "Customers excluded" is an ad set audience setting that the warehouse cannot confirm, so it must not be in the label.

Steps 1 to 4 can ship without step 5 (the split is then frozen at the backfill date). Step 5 without step 1 must never happen, because the insert would fail on a missing table.

## 5. Risks

- **Meta rate limits.**
  - The live workflow runs hourly with 3 chunks per client. Step 5 adds one light ad-level call per chunk (5 fields instead of 15), so about 50 % more insights calls.
  - If the account hits throttling (error code 17 or 80004, or `x-business-use-case-usage` near 100), lower the cost by running the windows branch only every N hours. To do that, put an IF node on `new Date().getUTCHours() % N === 0` before "Fetch ad attribution windows".
  - The backfill is about 200 calls, sequential, with a pause.
- **Restatement.**
  - Meta restates up to about 35 days back: Dobias +11.6 % purchases between first and last ingest, Manami 0 %.
  - Both requests share the hourly rolling 35-day window, so the legacy figures and the split restate together. Days older than the window are not re-fetched.
  - The backfill reads old days once, after their restatement is complete.
- **Transient gaps.**
  - If the windows fetch fails in a run, the latest windows row of those days stays from the previous run, or is missing for brand-new days. The next hourly run repairs this.
  - Lifetime figures stay NULL until coverage is complete, so a gap never shows as a worse ad.
- **Thresholds.**
  - The current targets (Dobias 3.00, Ethia 2.50, Manami 2.25, Venev 2.10) and the stored prior were calibrated on mixed-window numbers.
  - On 7-day click, ROAS drops mechanically. Without recalibration the hit rate drops even if no ad got worse.
  - The owner decides whether to rebase targets or anchors (section D2 shows both priors).
- **Cost.**
  - BigQuery: about 20 MB a day of new raw rows (0.6 GB a month of storage) and 6 more numeric columns read by the mart views. The rpt CALL stays at about 300 MB.
  - Regression scans in stage 1 used about 4 GB in total.
  - Meta API: no monetary cost.

## 6. Rollback

- **n8n:** restore workflow version `2b8fb345-b8ec-4aa1-83bf-b45ffe1b8ae9`, or delete the three nodes and reconnect `BQ: insert ad insights -> Loop over plan` (output 0 to input 0). Delete or deactivate the backfill workflow.
- **SQL:**
  - Re-run `infra/bigquery/live/mart.mart_meta_ad_perf.sql` and `live/mart.mart_creative_perf.sql` (the pre-256 text).
  - Re-run statement 1 of 255 and the CALL. `rpt_ad_launch` is back to 31 columns.
  - `raw.raw_meta_ad_attribution_windows` and the stg view can stay unused, or be dropped.
- Nothing in the legacy tables is touched, so rollback loses no data.

## 7. Stage 1 objects in mart_qa (expire or can be dropped)

| Object | Contents |
|---|---|
| `me2_adset_attribution` | ad set attribution setting per ad set for dobias, ethia, manami and venev (Meta Ads MCP, 2026-10-05) |
| `me2_ad_daily_90d` | warehouse ad-days with the setting attached; `in_90d` flags 2026-07-07 to 2026-10-04 |
| `me2_winner_sensitivity` | per ad: winner now, and the share of view-through at which it stops being a winner |
| `me2_raw_meta_ad_attribution_windows`, `me2_stg_meta_ad_attribution_windows`, `me2_mart_meta_ad_perf`, `me2_mart_creative_perf`, `me2_sp_refresh_rpt_ad_launch`, `me2_rpt_ad_launch` | regression candidates |
| `me2base_sp_refresh_rpt_ad_launch`, `me2base_rpt_ad_launch` | regression baseline |
| `me2_probe_attribution_windows` | empty; same schema as the raw table, for a probe run into `mart_qa` if n8n can write there |
