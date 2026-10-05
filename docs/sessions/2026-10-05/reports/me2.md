# ME2 report: attribution windows (stage 1 done, stage 2 awaiting approval)

Branch `me2-attribution`, worktree `oe-dash-wt/me2-attribution`. Not pushed. Nothing in prod was changed: no prod DDL, no n8n edit or execution, no Meta write.

## Commits

- `ec7c75e` ME2: syncs `infra/n8n/wf_meta_ads_to_bigquery.json` to the live workflow (version `2b8fb345-b8ec-4aa1-83bf-b45ffe1b8ae9`).
  - The repo copy had drifted: yesterday-only pull, no pagination, loop wired to output 0.
  - No behaviour change.
- `77d527a` ME2 stage 1. It adds:
  - `infra/bigquery/256_meta_attribution_windows.sql`
  - `infra/bigquery/qa/256_regression.sql`
  - the windows branch in `infra/n8n/wf_meta_ads_to_bigquery.json`
  - the new file `infra/n8n/wf_meta_attribution_windows_backfill.json`
  - `runbooks/32_meta_attribution.md`

## (a) What Meta returns, verified

1. **The live ingest is on unified attribution.** The live request sends no window, so since the 2025 API change each ad set is reported on its own setting.
   - Meta Ads MCP equals `stg.stg_meta_ad_insights` to the cent on all 17 Manami ad sets (2026-07-07 to 10-04), including the 7d_click-only sets.
   - The audit's "not pinned" is therefore confirmed and made precise: the warehouse mixes three settings: `7d_click`, `1d_view_7d_click` and `1d_view_7d_click_1d_ev`.
   - The third one, engaged video view, was not in the audit.
2. **How the split is encoded.** With `action_attribution_windows=["7d_click","1d_view","1d_ev"]`, `actions` and `action_values` entries carry one key per window next to `value`. The same applies to `purchase_roas` and `cost_per_action_type`.
   - Sources: Graph API docs for ads-action-stats (fields `7d_click`, `1d_view`, `1d_ev`, `value`) and the insights reference.
   - Meta removed 7d_view and 28d_view on 2026-01-12. 7d_click, 1d_view and 1d_ev remain.
3. **The Meta Ads MCP cannot request windows.**
   - `ads_get_ad_entities` rejects the breakdowns `action_attribution_windows` and `attribution_window`.
   - The 122-field catalog has no per-window purchase field.
   - So the exact 7d_click / 1d_view split could NOT be pulled read-only in stage 1.

## (b) Quantification (what was measurable without the split)

### Where purchases sit, last 90 days

Ad set settings come from the Meta Ads MCP (`mart_qa.me2_adset_attribution`). Purchases are the warehouse figures.

| client | 7d_click-only sets | 1d_view_7d_click | 1d_view_7d_click_1d_ev | in view-window sets |
|---|---|---|---|---|
| dobias | 52 | 496 | 341 | 94 % (value 95 %) |
| ethia | 0 | 0 | 164 | 100 % |
| manami | 157 | 61 | 283 | 69 % (value 71 %) |
| venev | 0 | 0 | 6 | 100 % |

Ad sets missing from the MCP list (deleted or archived): Ethia, 10 ad sets, 12 purchases lifetime, none in the last 90 days.

### Current dashboard winners

Source: `mart.rpt_ad_launch` with the given thresholds and the stored `prior_roas`, plus a sensitivity table (`mart_qa.me2_winner_sensitivity`). Assumption: a share f of the purchases and value in view-window ad sets is view or engaged-view.

| client | winners now | only in 7d_click sets | still winners at f=10 % | f=20 % | f=30 % | f=50 % |
|---|---|---|---|---|---|---|
| dobias | 9 | 0 | 7 | 6 | 3 | 0 |
| ethia | 8 | 0 | 4 | 3 | 2 | 0 |
| manami | 15 | 2 | 13 | 9 | 5 | 2 |
| venev | 0 | 0 | 0 | 0 | 0 | 0 |
| **total** | **32** | **2** | **24** | **18** | **10** | **2** |

- **6 winners flip at a view share of 5 % or less:**
  - Ethia `brand-discount` (1 %) and `testimonials-konsolidovany` (1 %): both sit exactly at N=10.
  - Dobias `GutSense VSL 11AUG` (3 %).
  - Ethia `Niacinamid 3 kroky` (3 %).
  - Manami `Něžná - 13MAR - OE` (4 %).
  - Manami `Testovaci sada MOF 14AUG` (5 %).
- **Robust winners** (flip only above 40 %): Dobias `12 Essentials Principles` (44 %), Ethia `Recenze zákaznic niacinamid` (43 %), Manami `reels 1 23OCT` (40 %).
- **Unaffected by construction:** 2 Manami winners whose ad sets are on 7d_click only (`NicheScentLover - Testovaci sada`, `Testovací sada 20off SK`).
- The flips are a lower bound. The stored prior (mixed window) is kept, as instructed, and a 7d_click prior would be lower and pull shrunk ROAS down further.
- **The exact count needs the split.** Stage 2 step 2 (backfill) plus section D of `qa/256_regression.sql` gives the exact count. Both queries are written and dry-run compiled.

## (c) Design (migration 256 + n8n, not deployed)

- **New table `raw.raw_meta_ad_attribution_windows`.**
  - Purchases and value per window (7d_click, 1d_view, 1d_ev), Meta's `value`, and raw arrays. Append-only and partitioned.
  - Fed by a **second** ad-level request (`executeOnce`, `onError` continue) added after the legacy insert. The legacy request and insert are untouched.
  - A separate table rather than new columns on `raw_meta_ad_insights`, because the autoMap insert plus `continueRegularOutput` would silently drop all ad rows on a schema mismatch. It also keeps backfill and rollback clean.
- **New stg view `stg.stg_meta_ad_attribution_windows`** (latest ingest).
- **`mart_meta_ad_perf` and `mart_creative_perf`** get 7 appended columns:
  - `attribution_windows` (NULL means not ingested)
  - `purchases_7d_click`, `revenue_7d_click`
  - `purchases_1d_view`, `revenue_1d_view`
  - `purchases_1d_ev`, `revenue_1d_ev`
- **`rpt_ad_launch` (procedure, rebased on the live 255 body)** gets 10 appended columns (41 total):
  - `attribution_split_days`, `attribution_split_complete`
  - the six lifetime window sums, NULL unless the split covers every delivery day
  - `prior_roas_7d_click`, NULL unless the whole 365-day window is covered
  - `prior_split_coverage`
- **Backfill workflow** (manual, inactive): 12-day chunks from each client's first day, 3 s pause, `ingest_source='backfill_me2'`.

## Verification done (mart_qa, prefix `me2_`)

- **Candidate views.** The MD5 of the live view text equals the file text for all 3.
- **`mart_meta_ad_perf`, old columns vs prod:** EXCEPT DISTINCT both ways 0 / 0, 12,631 = 12,631 rows.
- **`mart_creative_perf`, same check:** 0 / 0, 12,631 rows.
- **`rpt_ad_launch` candidate vs the live 255 logic built in the same script:** 0 / 0, 459 = 459 rows, 41 columns.
- **Synthetic plumbing test** (Manami split rows = legacy, plus a stale older ingest that must lose):
  - 200 of 200 complete
  - `purchases_7d_click = purchases` and `revenue_7d_click = revenue` for all
  - `prior_roas_7d_click = prior_roas` = 2.0287, coverage 1
  - other clients NULL
  - synthetic rows deleted afterwards
- **n8n transform and plan code** unit-tested with node against mock Graph responses (window keys, missing keys, purchase fallback, error item) and chunk ranges.
- **Sections C and D** dry-run compile.
- **BigQuery spend for all of the above:** about 4 GB scanned.

## mart_qa objects created (all prefix `me2_`)

- `me2_adset_attribution`, `me2_ad_daily_90d`, `me2_winner_sensitivity` (expire 2026-11-05)
- `me2_raw_meta_ad_attribution_windows` (empty), `me2_stg_meta_ad_attribution_windows`, `me2_mart_meta_ad_perf`, `me2_mart_creative_perf`
- `me2_sp_refresh_rpt_ad_launch`, `me2_rpt_ad_launch`
- `me2base_sp_refresh_rpt_ad_launch`, `me2base_rpt_ad_launch`
- `me2_probe_attribution_windows` (empty)

## Stage 2 deploy plan (exact order; details in runbooks/32_meta_attribution.md)

1. **256 statements 1 and 2:** raw table and stg view. Harmless.
2. **Backfill and measurement.**
   - Import `wf_meta_attribution_windows_backfill.json` (inactive), attach the BQ Service Account credential, run it manually: about 150 to 200 Graph calls, 15 to 25 min.
   - Point the candidate `mart_qa.me2_mart_meta_ad_perf` at the prod stg view, CALL the candidate procedure, run section D.
   - **Owner decision point:** report the exact view share and the winner changes.
3. **256 statements 3 and 4:** mart views.
4. **256 statement 5 and the CALL.** Then run sections B1 (prod), C2 and D2.
5. **Live n8n.**
   - Add the 3 nodes and rewire `BQ: insert ad insights -> Fetch ad attribution windows -> Transform -> BQ insert windows -> Loop over plan`.
   - Edit the live workflow rather than doing a full import, after confirming the live version is still `2b8fb345`.
   - Watch 2 hourly runs, then section C.
   - **Never do step 5 before step 1.**
6. **ME3** switches the decision columns and the label.

## Risks

- **Meta rate limits.**
  - About 50 % more insights calls hourly (one light call per chunk).
  - Fallback: run the windows branch every N hours with an IF node.
  - The backfill is sequential with a pause.
- **Restatement over about 36 days.**
  - Dobias +11.6 % purchases between first and last ingest.
  - Both requests share the rolling 35-day re-fetch, so the legacy figures and the split restate together.
  - The backfill reads settled days. Lifetime split figures are NULL until coverage is complete, so gaps never read as worse ads.
- **Cost.** About 20 MB a day of raw growth (0.6 GB a month). The rpt CALL stays at about 300 MB. The Meta API has no cost.
- **Calibration.**
  - Targets and priors were set on mixed-window numbers. On 7-day click the hit rate falls mechanically.
  - The owner must decide whether to rebase the targets or the anchor before the dashboard switches.
- **n8n permissions.** The n8n service account's rights on `raw` exist (live inserts). Its rights on `mart_qa` are unknown, so the backfill targets `raw`.

## Rollback

- **n8n:** restore version `2b8fb345-b8ec-4aa1-83bf-b45ffe1b8ae9`, or remove the 3 nodes and reconnect `BQ: insert ad insights -> Loop over plan`.
- **SQL:** re-run `live/mart.mart_meta_ad_perf.sql`, `live/mart.mart_creative_perf.sql`, then 255 statement 1 and the CALL.
- The raw table and stg view can stay unused. No legacy data is touched.

## Requests to orchestrator

1. **ME3, label now.** Replace the "7-day click · customers excluded" literal (`CreativeBar.tsx:42`). Suggested text: "Meta attribution as set per ad set (7-day click; most ad sets also 1-day view)". After stage 2 plus the switch, use "7-day click". "Customers excluded" is not verifiable from data, so drop it.
2. **ME3, contract.** Use `rpt_ad_launch.purchases_7d_click`, `revenue_7d_click` and `prior_roas_7d_click` only when `attribution_split_complete`. Treat missing columns as not ready.
3. **After deploy:** update `infra/bigquery/live/` (the two views, `stg.stg_meta_ad_attribution_windows`, `mart.sp_refresh_rpt_ad_launch`, `mart.rpt_ad_launch`). Not done on this branch, because its `live/` still holds 254 and the deployed 255 is on the ME1 branch. If 255 changes again before 256, rebase statement 5.
4. **Owner decision:** threshold or prior rebase on 7-day click (after section D).
5. **SOP:** E6 in the audit (set 7-day click at ad set creation) is outside this package. Two settings are in use today besides 7d_click.

Sources: [Meta Insights API reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/), [AdsActionStats](https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/), [PPC Land on the 2026-01-12 window removal](https://ppc.land/meta-restricts-attribution-windows-and-data-retention-in-ads-insights-api/), [Jon Loomer, Meta attribution 2026](https://www.jonloomer.com/meta-ads-attribution-2026/).

---

# Stage 2 (owner approved 2026-10-05: deploy and measure, no dashboard switch)

Decision basis as amended: **standard = 7d_click + 1d_view**; 1d_ev stored, excluded. Commits `006162d` and `f3019f3` on `me2-attribution` (not pushed).

## What was deployed (prod)

| UTC | Step | Verification |
|---|---|---|
| ~11:13 | `raw.raw_meta_ad_attribution_windows`, `stg.stg_meta_ad_attribution_windows` (256 st. 1, 2) | live MD5 = file |
| 11:14 to 11:27 | Backfill via new inactive n8n workflow `ByGJ1fZkgEAj0EPm` (manual), executions 24948 (venev) and 24951 (dobias, ethia, manami) | 12,634 ad-days; 0 delivery days without the split; no Graph errors or throttling |
| ~11:31 | `mart.mart_meta_ad_perf`, `mart.mart_creative_perf` (+9 columns each) | live MD5 = file; 12,631 rows, unique keys; no dependent view uses `SELECT *` |
| ~11:32 | `mart.sp_refresh_rpt_ad_launch` + CALL (44 columns) | existing 31 columns 0/0 vs the 255 logic rebuilt the same minute (459 rows); 459/459 ads split-complete; prior coverage 1.0 for all clients |
| 11:33 | Live `wf_meta_ads_to_bigquery` (`AnfdTVrS83ioPsd3`): +3 nodes (Fetch / Transform / BQ insert ad attribution windows), published as version `6fbc5931-703e-44d0-b999-dcfd4349420a` | existing nodes byte-identical in the version; existing ad request untouched; cadence hourly (backfill showed no rate pressure) |

- Rollback of n8n: `restore_workflow_version 2b8fb345-b8ec-4aa1-83bf-b45ffe1b8ae9`; file backup `infra/n8n/backup_live_meta_ads_20261005_pre_me2.json`.
- Rollback of SQL: pre-256 view texts are in git history of `infra/bigquery/live/` (commit before `006162d`), procedure = 255 statement 1.

Backfill depth: from each client's first day in `raw.raw_meta_ad_insights` (dobias 2026-04-20, ethia 2025-02-20, manami 2025-05-07, venev 2026-08-18). That is the whole warehouse history and covers the full 365-day prior for every client. Older days have no legacy rows to join; the API would allow 37 months.

## Key finding on how Meta reports today (measured, exact)

The legacy (no-window) figure = `7d_click` + (`1d_view` if the ad set has a view window). **1d_ev is never included**, even for `1d_view_7d_click_1d_ev` ad sets. Reconciliation: 0 mismatch days on every mapped ad set, all four clients. Consequence: the standard basis 7dc+1dv equals today's numbers everywhere except ads in 7d_click-only ad sets, which gain their view-through purchases (22 of 459 ads: dobias 5, ethia 5, manami 12). The audit's "mixed windows" concern is therefore small under the standard basis; it would be large under 7d_click only.

## Share of purchases (value) by window, all history

| client | 7d_click | 1d_view | 1d_ev | ROAS today | ROAS 7dc+1dv | ROAS 7d_click |
|---|---|---|---|---|---|---|
| dobias | 36.7 % (32.7 %) | 51.1 % (55.3 %) | 12.2 % (12.0 %) | 2.84 | 2.98 | 1.11 |
| ethia | 77.1 % (74.3 %) | 17.0 % (19.3 %) | 5.9 % (6.3 %) | 2.17 | 2.18 | 1.73 |
| manami | 79.5 % (77.3 %) | 14.0 % (16.5 %) | 6.6 % (6.2 %) | 2.13 | 2.18 | 1.79 |
| venev | 100 % | 0 % | 0 % | 0.11 | 0.11 | 0.11 |

Last 90 days, purchases 7d_click / 1d_view / 1d_ev: dobias 38 / 48 / 14 %, ethia 45 / 38 / 17 %, manami 77 / 14 / 9 %. Dobias is view-driven: over half its attributed purchases are 1-day view.

## Winners (thresholds Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15, Venev 2.10/10)

| client | (i) mixed, stored prior | (ii) 7dc+1dv, stored prior | (ii) 7dc+1dv, prior on same basis | reference: 7d_click only, own prior |
|---|---|---|---|---|
| dobias | 9 | 9 | 9 (prior 2.98 vs 2.84) | 0 (prior 1.11) |
| ethia | 8 | 8 | 8 (prior 2.30 vs 2.28) | 1 (prior 1.77) |
| manami | 15 | 15 | 15 (prior 2.09 vs 2.03) | 10 (prior 1.71) |
| venev | 0 | 0 | 0 | 0 |
| total | 32 | 32 | 32 | 11 |

**No ad changes winner status between today's numbers and the standard basis**, with either prior. The stage-1 sensitivity table (built on "view share inside view ad sets", i.e. a 7d_click-only reading) is superseded: under 7d_click only, 11 of the 32 would remain winners (own prior).

## Columns available for ME3 (not switched; owner decides)

- `mart.rpt_ad_launch`: `purchases_7dc_1dv`, `revenue_7dc_1dv`, `prior_roas_7dc_1dv` (standard basis), plus `purchases_7d_click`, `revenue_7d_click`, `purchases_1d_view`, `revenue_1d_view`, `purchases_1d_ev`, `revenue_1d_ev`, `prior_roas_7d_click`, `attribution_split_days`, `attribution_split_complete`, `prior_split_coverage`.
- `mart.mart_meta_ad_perf`, `mart.mart_creative_perf`: per ad-day `attribution_windows` (NULL = not ingested) and the same window and standard-basis columns.
- Use the window columns only where `attribution_split_complete`.

## Truthful label (for ME3, now)

Today's numbers are "7-day click + 1-day view (7-day click only on ad sets set that way)". After a switch to the standard basis: "7-day click + 1-day view". Drop "customers excluded" (not verifiable).

## Open items / requests to orchestrator

1. Owner decision: switch the dashboard winner test to the standard-basis columns (no winner changes today, so low risk), and whether to keep 1d_ev out of the headline ROAS (it is 6 to 12 % of purchases).
2. Dobias: over half of attributed purchases are 1-day view and 7-day click ROAS is 1.11. Worth a note to the account lead; not a data problem.
3. `mart_qa.me2_adset_attribution` (ad set settings, used by reconciliation check C) expires 2026-11-05; re-pull from the Meta MCP if needed later.
4. The backfill workflow `ByGJ1fZkgEAj0EPm` stays inactive in n8n (manual only); delete it when no longer needed.
5. Ethia: 10 archived ad sets are not in the MCP list (12 purchases lifetime); reconciliation cannot classify them, harmless.

## Live verification of the windows branch

One production run triggered at 11:35 UTC (equivalent to an hourly run). Legacy and window rows written in lockstep for all 4 clients × 3 chunks (dobias 1,574 / 1,574, ethia 169 / 169, manami 782 / 782, venev 339 / 339). Check C on the fresh data (last 35 days): 0 mismatch days per client, purchases and value identical to the unit. The existing ad request and insert are unaffected. Successful production executions are not retained by n8n, so monitoring relies on the error workflow and check C2.
