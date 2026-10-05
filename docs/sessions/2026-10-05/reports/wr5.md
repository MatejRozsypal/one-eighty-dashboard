# WR5 report: retention metrics in Reports

Branch `wr5-reports-retention` (worktree oe-dash-wt/wr5-reports-retention), one commit `8f110b1` on top of main (`1d2fdf2`). Not pushed. No BigQuery writes, no mart_qa objects, no Postgres writes. BigQuery was read only (INFORMATION_SCHEMA and two compiled widget queries).

## What changed

| File | Change |
|---|---|
| `lib/reports/registry/types.ts` | `SEMANTIC_VERSION` 7 to 8. `MartId` + `customer_entry`. `MartDef.rowFilter?: { excludeTrue }`. `ComponentDef.bool?: true` (BOOL column, summed as COUNTIF). Caveat ids `low_n`, `cohort_partial`. `MetricBase.cohort?: MetricCohort { population, minN, lowN, needsClasses? }` |
| `registry/components.ts` | Mart `customer_entry` (`mart.rpt_customer_entry`, dateColumn `first_order_date`, no currency, selectAll, rowFilter `is_early`). 16 count components, `requires: "shop"`, `nullMeans: "zero"`: n_customer, is_discovery, has_second, classes_configured (bool), m/r 90, 180, 365, m23_180, r23_180, dm/du 90, 180. `CLASSES_COMPONENT` export. Load-time validation for bool components and row filter identifiers |
| `registry/ids.ts` | 7 ids appended (54 queryable) |
| `registry/metrics.ts` | `repeat_rate_90/180/365`, `third_order_rate_180`, `discovery_upgrade_90/180`, `discovery_entry_share` (group retention, percent, not benchmarkable, `showCounts` customers, caveats `low_n` + `cohort_partial`; entry share neutral and `low_n` only). Cohort validation at load. `componentsFor` adds the population and the classes flag |
| `registry/caveats.ts` | `low_n` "Fewer than 100 customers", `cohort_partial` "Recent customers not yet counted" (both data-driven) |
| `lib/reports/compile.ts` | `rowFilterPredicates()`: `AND t.is_early IS NOT TRUE` in every CTE of the mart (plain, scope and entity CTEs); `assertDatePredicates` now also requires the row filter. BOOL components emit `COUNTIF(t.col)`. Widgets without the mart compile byte-identically (all existing snapshots pass) |
| `lib/reports/evaluate.ts` | Cohort rules in `outcome()`: 1 needsClasses and sum classes_configured 0: not_measured "Products not classified"; 2 denominator 0 with population > 0: "Not mature yet"; 3 denominator < 30: "Too few customers". Rules 2 and 3 run on pooled counts only (rollup members are checked with `pooled = false`), so small clients are pooled, not dropped. Series caveats `low_n` (denominator < 100) and `cohort_partial` (population > denominator) on the current total. Deltas pp (percent unit) |
| `scripts/check-reports.ts` | Count 54; fixture mart; 16 WR5 SQL asserts; live column check now skips classified components (HR3 bug: `winners` is no column) and includes row filter columns; dry run leaves out marts that lack a grain |
| `scripts/check-reports-eval.ts` | Counts 54, live column list of `rpt_customer_entry` (54 columns, BOOL list), selectAll assert, section 4.17 (33 asserts) |
| `scripts/check-reports-pages.ts` | 47 to 54 |
| `lib/reports/README.md`, `METRICS.md` | Cohort retention note; registry rows, caveat rows, status row, changelog amendment 26 |

**Design deviation (please confirm): day grain allowed.** The design says grains [week, month]. Neither `resolve.ts` nor the builder checks a metric's grains, so a day widget would throw in the compiler. The mart and metrics therefore allow day. Daily cohorts are mostly under 30, so their points read "Too few customers".

**Orchestrator note on `is_early`.** It is BOOLEAN. It appears only in the row filter (`IS NOT TRUE`), never as a component (asserted). `classes_configured` is BOOLEAN as well and is summed with `COUNTIF` (asserted).

## Verification
- `tsc --noEmit` clean, `npm run build` ok.
- Checks: reports 355/355 (BigQuery steps skip locally), reports-eval 478/478, reports-authz 37, reports-store 315, reports-url 193, reports-widgets 699, reports-canvas 98, reports-pages 221, capabilities 350, paid 211, creative ok, hitrate ok, loading 260, delta 177, delta-shop 65, delta-paid 184, delta-cmpc 72.
- No em or en dash in the diff.

New SQL asserts:
- The CTE has the date predicate, the period tagging and `is_early IS NOT TRUE`, also without a comparison and in day grain.
- A tampered query without `is_early` is rejected ("row filter"), and so is one without the date predicate.
- `COUNTIF(t.classes_configured)`; no SUM of a BOOL; `is_early` is never a component.
- No FX and no displayCurrency. Params are clients and dates only; no 30, 100, client id or date literal in the SQL.
- All seven metrics share one SQL and key.
- Mixed with kpis: joins USING (client_id, period, bucket), the filter stays in its own CTE, no entity_key, asserted for both marts.
- Widgets without the mart never mention it.
- normaliseRows of a customer entry row.

New evaluation asserts:
- Formulas, populations, group, grains, caveats, needsClasses on discovery only, aliases.
- Combined 56 of 488 with coverage 1 of 2 ("Products not classified"), monthly points.
- Repeat rate pools both clients.
- An all-unclassified rollup reads 0 of 1.
- "Too few customers" for one client, while two clients of 20 pool to 40 with low_n and cohort_partial.
- "Not mature yet"; no customers is no_data.
- low_n without partial.
- Immature months n/a with cohort_partial on the total.
- pp deltas, no delta against a too-small comparison, combined like-for-like delta, mixed widget with orders.

### Live parity (MCP, compiled widget SQL with params inlined)
Harness copies in `scratchpad/wr5/`: `_wr5_live_sql.ts`, `_wr5_live_eval.ts`, `sql_*.sql`, `csv_*.sql`, `rows_*.csv`, `eval_*.txt`.
- Columns: `INFORMATION_SCHEMA.COLUMNS` of `mart.rpt_customer_entry` holds all 16 component columns and `is_early`. `is_early` and `classes_configured` are BOOL; the rest are INT64.
- **Run 1.** Manami + Dobias, month grain, 2026-01-01 to 2026-06-30, previous period, run through `normaliseRows` + `evaluateWidget`. 24 rows, all NULL counts 0, 6.0 MB processed, 10 MB billed.

  | Metric | Manami | Dobias | Combined |
  |---|---|---|---|
  | `discovery_upgrade_90` | **56 of 488 = 11.5%** (the page tile and WR1 U_90); monthly 11.1 / 11.5 / 7.3 / 16.9 / 10.8 / 11.0%; previous period 8.0%, delta +3.5 pp | not_measured "Products not classified" | 11.5%, **coverage 1 of 2**, "dobias: Products not classified" |
  | `repeat_rate_90` | 10.4% (86 of 823) | 21.1% (318 of 1,504) | 17.4% (404 of 2,327) |
  | `repeat_rate_365` | "Not mature yet" | "Not mature yet" | |
  | `third_order_rate_180` | "Too few customers" (pooled 44 of 89 = 49.4%) | | |

- **Run 2.** 2025-01-01 to 2025-12-31, month grain, no comparison.
  - **`repeat_rate_365`:** Manami 16.1% (88 of 545) and Dobias 40.3% (1,102 of 2,733). **Both carry `cohort_partial`.**
  - Oct 2025 is n/a ("Too few": 4 and 9 mature), and Nov and Dec are n/a ("Not mature yet").
  - Manami 2025 discovery U_90 is 8.3% (44 of 531).

## Ready for prod
Frontend only. The deploy needs WR1's `mart.rpt_customer_entry` (live) and nothing else. The SEMANTIC_VERSION bump clears the Reports caches. The table cut-off does not move until the owner creates `rpt_refresh_hourly` (WR1 open item).

## Open issues
- Caveats are per series (contract): in a widget with `repeat_rate_90` and `repeat_rate_365`, `cohort_partial` earned by 365 also shows on the 90 hover. A per-cell caveat field would need `lib/reports/types.ts` (not owned).
- Partially mature months show a value (customer-level rule, design section 0). Only the series caveat marks it; there is no per-point "Matures {date}" marker.
- No CI per cell, KM curves or other entry classes (design phase 2).
- Dobias, RawBark, Venev and Ethia stay "Products not classified" for the discovery metrics until `ref.product_classes` is seeded.

## Requests to orchestrator
1. Confirm the day-grain deviation, or add metric-grain validation in `resolve.ts` and the builder (not owned). Then the mart can go back to [week, month].
2. Optional: a per-cell caveats field on `MetricCell` (`lib/reports/types.ts`), so cohort caveats attach to the metric that earned them.
3. `package.json` needs no change; no new scripts.
