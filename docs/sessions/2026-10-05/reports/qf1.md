# QF1: Reports semantic layer (CM3 parity, hook rate, shared queries, table switch)

Branch `qf1-reports-semantic` (worktree `oe-dash-wt/qf1-reports-semantic`), based on `main` @ `92ac505`. Not pushed, not merged. No BigQuery writes and no `mart_qa` objects. Every query was read-only through MCP.

| commit | content | merge |
|---|---|---|
| `9d0f6c9` | Parts 1 to 3: CM3 parity, hook rate, shared KPI queries, `SEMANTIC_VERSION` 5 to 6, checks, docs | any time |
| `7a571b7` | Part 4, the **last commit**: `MARTS.kpis.table = "mart.rpt_kpis_daily"` | only after migration 253 is deployed and the n8n refresh is active |

Parts 1 to 3 are in one commit because the same files carry all three changes and interactive staging is not available. Part 4 is separate, as required.

## Findings covered
- **C-01**: Reports CM3, CM3 % and CM1 % now subtract the per-order costs stated in Settings, exactly like Snapshot.
- **C-03, query side**: KPI widgets share one query. For the Portfolio overview, 7 widgets compile to 2 distinct queries instead of 6. Commit 4 adds the table switch.
- **B-09, Reports side**: the hook rate numerator is `video_views`, and video ads are decided per ad over the whole period.

## What changed (files)
- `lib/reports/registry/types.ts`
  - `SEMANTIC_VERSION` 6.
  - `ReportClient.costRates?` (additive, optional).
  - `CostRateKey`.
  - `ComponentDef.perClientRate?` and `filterScope?`.
  - `MartDef.selectAll?`.
- `lib/reports/registry/components.ts`
  - New components `kpis.fulfilment_stated` and `kpis.other_cm1_stated`: column `orders`, money, `nullMeans: "zero"`, `perClientRate`.
  - The column-override rule is relaxed only for `perClientRate`, with validation.
  - New component `meta_ad.video_views`.
  - `video_views`, `video_thruplays` and `video_impressions` carry `onlyWhenPositive: video_play_actions` with `filterScope: { key: "ad_id" }`.
  - `kpis` is `selectAll`.
  - Commit 4: table `mart.rpt_kpis_daily`.
- `lib/reports/registry/metrics.ts`
  - `CM3_TERMS` gains both stated components (sign -1, nullAs zero).
  - `cm1_pct` subtracts `other_cm1_stated`.
  - Hook rate = `video_views / video_impressions`.
  - Descriptions updated.
- `lib/reports/compile.ts`
  - Scope pre-CTE `meta_ad__scope_video_play_actions_ad_id`: LOGICAL_OR(plays > 0) per client, period and ad_id, with the same date predicate and period tagging.
  - The ad mart CTE LEFT JOINs the scope pre-CTE and filters on `COALESCE(s1.scope_flag, FALSE)`.
  - `assertDatePredicates` also checks every `<mart>__scope_*` CTE.
  - `selectAll` expands to every component of the mart, and `CompiledQuery.components` is that superset.
- `lib/reports/evaluate.ts`: `readComponent` multiplies a `perClientRate` component by `client.costRates[rate] ?? 0`. Each client uses its own rate, rollups included.
- `app/api/reports/query/route.ts`
  - Calls `listClientSettings()` only when a widget component needs a rate, in parallel with run and benchmarks.
  - Merges the rates into `widget.clients` after compile, so they never reach SQL or a cache key.
  - A failed Postgres read logs a warning and leaves every rate unstated (0), the same fallback as Snapshot's `optional(getClientSettings)`.
- `scripts/check-reports-eval.ts`
  - New sections 4.14 (stated rates) and 4.15 (superset vs subset).
  - Updated assertions for the registry, CM3 terms and hook rate.
  - Live columns now include `ad_id` and `video_views` (checked live through MCP).
- `scripts/check-reports.ts`: SQL assertions for:
  - the scope CTE: predicate, period tagging, join, the variant without a comparison, and rejection of a tampered scope CTE;
  - shared SQL: byte-identical SQL and key for different KPI metrics, 24 components, Meta marts keep their own subset;
  - stated-rate SQL;
  - commit 4: the real-registry binding reads `rpt_kpis_daily`.
- `lib/reports/README.md`, `METRICS.md` (amendment 24).

## Verification
- `tsc` is clean after both commits. `npm run build` exits 0 after both commits.
- Check results:

| check | after `9d0f6c9` | after `7a571b7` |
|---|---|---|
| check:reports | 327/327 | 327/327 |
| reports-eval | 359/359 | 359/359 |
| reports-widgets | 655 | 655 |
| reports-pages | 201 | **200/201**, see Requests |
| reports-canvas | 98 | 98 |
| reports-authz | 37 | 37 |
| reports-store | 286 | 286 |
| reports-url | 193 | 193 |
| capabilities | 329 | 329 |
| paid | 190 | not re-run |
| creative | ok | not re-run |

- The BigQuery steps of check:reports skip locally because there are no GCP credentials. This was already the case before this package.
- No em or en dash in the diff.
- New eval assertions, all pass:
  - A stated rate multiplies only that client.
  - Null rates equal mart CM3.
  - A rollup uses each client's own rate.
  - CM1 % subtracts only the other CM1 rate.
  - CZK display of a USD client converts the stated cost per month: total and per month bucket.
  - The per-client CM3 % of a USD client reads native sums.
  - A widget evaluated from superset rows equals the same widget from subset rows, deep-equal, for split client and combined at grains total and week, with rates injected.
  - Ad-level video classification excludes zero-play ads but keeps the zero-play days of video ads. This is asserted on the compiled SQL and on live data (see below).

### Live (throwaway harness, deleted; copy in `scratchpad/qf1/_qf1_live.ts`)
Steps: compile, inline params, run through MCP `execute_sql_readonly`, then `normaliseRows` and `evaluateWidget` with injected rates. Rows, SQL and outputs are in `scratchpad/qf1/`.

1. **Dobias CM3, 2026-07-06..2026-10-03, CZK.** Superset query, 443 MB.
   - Reports with no rate: CM3 **9,464,598.49**, 72.6 %. This equals the old Reports value in QA.
   - Snapshot-equivalent independent MCP query: `SUM(cm3 x fx) = 9,464,598.48891` and `SUM(orders x fx) = 87,833.725`.
   - QA's Snapshot fulfilment of CZK 1,800,591 implies a rate of 1,800,591 / 87,833.725 = **20.50 USD per order**.
   - With rate 20.5 injected, Reports CM3 = **7,664,007.13**, CM3 % **58.82 %**. Snapshot SQL with the same rate gives 9,464,598.48891 - 20.5 x 87,833.725 = 7,664,007.13, so the two match exactly.
   - The QA screenshot reference is 7,664,008, 0.87 CZK away. That gap is either rounding or a rate not exactly 20.5, which is why item 1 under "Needs a prod check" stays open.
   - **DATABASE_URL is not available locally**: there is no `.env` with a DB URL and nothing in the shell env. So no settings script was written and the real stated rate was not read.
2. **Manami and Ethia unchanged:**
   - Manami CM3 251,328.12, 32.87 % (QA Snapshot 251,328 / 32.9 %).
   - Ethia 121,416.85, 43.58 % (QA 121,417 / 43.6 %).
3. **Hook rate Sep 2026**: compiled scope SQL, previous period, 130 MB.

| client | Reports hook (video_views) | independent per-ad query | hold | with the old numerator (video starts) |
|---|---|---|---|---|
| Dobias | 17.34 % | 17.34 % | 4.17 % | 52.19 % |
| Ethia | 25.91 % | 25.91 % | 8.14 % | 79.92 % |
| Manami | 11.16 % | 11.16 % | 2.59 % | 32.97 % |
| Venev | 18.81 % | 18.81 % | 5.38 % | **55.25 %** (= Paid tab with today's numerator) |

   - The video-ad denominators equal the `getMetaVideoRates` shape (SUM over (campaign, ad) with plays > 0) exactly: Dobias 685,408, Ethia 115,260, Manami 225,788, Venev 101,025.
   - In Sep 2026 there are no `video_views` or ThruPlays on non-video ads and no NULL `ad_id`, so filtering the numerators changes nothing there. It keeps them aligned with the Paid tab.
4. **Superset on live rows**:
   - The per-component SQL expressions of the subset and superset compiles are textually identical.
   - Evaluating the live superset rows with the subset-compiled query gives output identical to the superset evaluation (`cmp`).

### Dry-run bytes, Portfolio overview template
Filters: 5 clients, 2026-07-06..2026-10-03, previous period, CZK. KPI tiles at week grain via `fetchGrain`.

| widget | before (subset, view) | after parts 1-3 (superset, view) | after commit 4 (superset, table candidate `mart_qa.qf3_rpt_kpis_daily`) |
|---|---|---|---|
| KPI revenue + line revenue (already one key) | 415.7 MB | 443.4 MB, **shared key A** | 194 KB, shared key A |
| KPI CM3 | 419.5 MB | key A | key A |
| KPI MER, KPI new customers | about 416 MB each (view, no pruning) | key A | key A |
| bar revenue total, table | about 416 to 420 MB each | 443.4 MB, **shared key B** | about 194 KB, shared key B |

How these were measured:
- **Distinct queries per open went from 6 to 2.** The superset reads about 7 % more of the view, but the view is computed whole anyway.
- On the table, the superset costs 194 KB. A one-column subset costs 23 KB.
- Directly dry-run: the two "before" widgets, and the superset KPI query against the table.
- Measured through a column-equivalent dry run: the superset on the view (it matches the 443.37 MB of the live CM3 run).
- Bar and table were not dry-run separately. Key B differs only in its bucket expression, so it reads the same columns.

## Needs a prod check (owner or orchestrator)
1. **Dobias' real stated rates.** Read `client_settings.fulfilment_per_order` and `other_cm1_per_order` for Dobias in Settings, or with a server script on a machine that has DATABASE_URL. Expected CM3 = 9,464,598.49 - fulfilment x 87,833.725 - other x 87,833.725 (CZK, 90d to 2026-10-03). After deploy, Reports Dobias CM3 must equal Snapshot to the unit at CZK, USD and EUR. The 20.5 rate used here is inferred from QA's Snapshot figure, not read.
2. After commit 4 and the 253 deploy, re-run the harness against prod `mart.rpt_kpis_daily` (QF3 order step 4). Confirm through `INFORMATION_SCHEMA.JOBS` (label `feature=reports`) that per-job bytes fall under 25 MB.
3. qa-data in round 2: CM3 parity for every client with a stated rate (today only Dobias is known to have one).

## Notes and open issues
- **Woo plus stated rate**: a Woo client with a stated fulfilment rate has both the mart Woo `fulfillment_cost` and the stated rate subtracted, on both pages. That is parity. In the 90-day window the mart fulfilment is 0 for Dobias, Ethia and Manami.
- **Snapshot FX quirk reproduced**: orders x rate are converted from the row's currency, as Snapshot's `m("(k.orders * @rate)")` does. A CAD row of Dobias would treat the USD rate as CAD. The 90-day window has 0 foreign rows.
- **A failed Postgres read leaves rates at 0**, like Snapshot. This is silent apart from a server log line.
- **Hook rate swings that remain** (Ethia Aug 5.5 % vs Sep 25.9 %; Manami Aug 22.2 % vs Sep 11.2 %) are in the data (`video_views` per period), not the definition.
- **QF7 must classify video ads on `video_play_actions > 0` per ad** (as now) to stay equal to Reports. If it moves classification to `video_views > 0`, the denominators will differ.
- **`cm1_pct` keeps `definitionKey: "Gross margin"`**. With a stated other CM1 rate it is CM1 %, not pure gross margin. No client currently states one, as far as the data shows.

## Requests to orchestrator
1. **`scripts/check-reports-pages.ts` (QF2-owned), line about 149**: change `q.sql.includes("mart_daily_kpis")` to accept `rpt_kpis_daily`, for example `/mart_daily_kpis|rpt_kpis_daily/.test(q.sql)`. Otherwise check:reports-pages fails 1/201 once commit 4 lands. It passes 201/201 on `9d0f6c9`.
2. Merge `9d0f6c9` any time. Hold `7a571b7` until migration 253 is live and the refresh workflow is active. The `SEMANTIC_VERSION` bump clears Reports caches at deploy.
3. Owner: supply or confirm Dobias' stated rates (item 1 under "Needs a prod check").
