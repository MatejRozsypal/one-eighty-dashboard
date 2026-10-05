# RS1 report: Reporting Suite semantic layer (design WP1)

Branch `rs1-semantic`, worktree `oe-dash-wt/rs1-semantic`, one commit `4e01bd0` on top of `d727748` (Merge rs0-contracts). Frontend/library only. BigQuery: read-only queries, no `mart_qa` objects, nothing to deploy.

## What changed

| File | Content |
|---|---|
| `lib/reports/registry/components.ts` | `MARTS` (kpis phase 1; meta_campaign, email_campaign phase 2), `COMPONENTS` (22 kpis + 7 phase 2) via `defineComponents()` (identifier regex, mart and guard checks at load, frozen). Adds `kpis.fulfillment_cost` (money, shop). Helpers `isComponentId`, `getComponent`, `componentsOfMart`, `COMPONENT_REGISTRY`. |
| `lib/reports/registry/metrics.ts` | All 35 metrics (30 phase 1, 5 phase 2) from design 2.4 with one-line descriptions and existing `METRIC_DEFINITIONS` keys. `defineMetrics()` checks every id against `ids.ts` (phase must match), term components exist, marts' phase and grains fit, and derives `meta` (sorted components, fxMode, requires via `allOf`). Every money-based metric gets `foreign_currency_rows` appended to its caveats so the hover can show it. Helpers `METRIC_LIST` (picker order), `getMetric`, `findMetricId` (id, label, alias), `componentsFor` (formula + COGS guard + low-volume components), `usesMoney`. |
| `lib/reports/registry/caveats.ts` | `CAVEATS` per design 2.5; `woo_fees_not_netted` never applies (228 live) and is no longer listed on any metric; `foreign_currency_rows` is data-driven (rule false, the evaluator sets it). `google_only_paid` text aligned with the closed notice list ("Paid spend is Google only"). Helpers `clientCaveats`, `orderCaveats`, `visibleCaveats`, `CAVEAT_ORDER`. |
| `lib/reports/registry/capabilities.ts` | `toReportCapabilities`, `evalCapExpr`, `missingCapabilities` (conform to `CapabilitiesModule`), plus `CAPABILITIES`, `CAPABILITY_LABEL`, `allOf`, `notConnectedReason` ("Meta not connected"). |
| `lib/reports/resolve.ts` | `mergeFilters`, `resolveWidget` (conform to `ResolveModule`). Clients all/list/vertical (`unassigned` selects clients without a vertical), unknown ids dropped, sorted. Presets via `presetRange`; custom ranges clamped into `[yesterday - 60 months, yesterday]` with `range_clamped`. Comparison via `comparisonRange` (364 days for previous year). Native currency: shared currency, else CZK + `currency_coerced`. Limits: span per grain (days / ISO weeks / calendar months), buckets x series <= 1500, metrics <= 8, with suggestions ("Use week grain", "Use month grain", "Shorten the range", "Select fewer clients"). Availability per (client, metric); `queryClientIds` drops clients with every metric not connected. Exports bucket helpers (`buildBuckets`, `bucketOf`, `bucketEnd`, `partialBucketIndexes`, `isoWeekStart`, `addMonths`, `shiftMonthsKeepDay`, `verticalKey`). |
| `lib/reports/evaluate.ts` | `evaluateWidget` (conforms to `EvaluateModule`), `evaluateFormula`, `fxReason`. Rules below. |
| `lib/reports/benchmarkMatch.ts` | `matchBenchmarks` (conforms to `BenchmarkMatchModule`), `pickBenchmark`, `regionPreference`, `fxFactor`. Rules below. |
| `scripts/check-reports-eval.ts` | 228 fixture assertions, pure (no BigQuery). |

### Evaluation rules as implemented
- Buckets built in TS from the range; missing bucket = null point. Partial first/last week or month flagged. Comparison buckets aligned by position (extra positions null).
- Totals sum components across all rows of the period, then evaluate. Ratios are `SUM(num)/SUM(den)*scale`; null or zero denominator gives null.
- Per-client series: non-money units read native sums, money units read display sums. Rollups (combined, vertical) read display sums for every client.
- FX: a display read in a bucket with `fxMissingRows > 0` is null (never a partial SUM), status `fx_missing`, reason "No FX Oct 2026", months in `fxMonths` and in one `fx_missing` warning. Exact shortcut: when the client trades in the display currency and the row group has no foreign rows, the native sum is used (identical number, no rate needed). So a USD client in a USD report never shows "No FX".
- COGS guard: guarded component (COGS) summing to 0 or NULL while revenue > 0 is `not_measured` ("No cost data"). Covers Woo NULL COGS (RawBark) and a forced 0. Applied per client per row group; a period total is `not_measured` if any of its buckets is (strict: no total silently covers uncosted days). Rollups: any included client not measured nulls the rollup bucket/total.
- Rollups: not_connected clients excluded, `coverage {included, of}`; all excluded gives a `not_connected` rollup with the union of missing capabilities.
- Status precedence not_connected > fx_missing > not_measured > no_data > ok. Non-ok cells: total, compareTotal, delta null; points kept for unaffected buckets; not_connected and grain total have no points.
- Deltas: percent units in pp (fraction), everything else `delta()` from `lib/period.ts` (null on zero baseline).
- Low volume: `minVolume` component (display currency) below `shareOfMax` of the largest series, only with 2+ series, only on ok cells.
- Series caveats: registry rules for the client(s) plus `foreign_currency_rows` when any of their rows is in another currency.

### Benchmark matching as implemented
Vertical first (client vertical, then `all_ecommerce`; no vertical = fallback only), then region (client market, EU, GLOBAL; other regions never apply), then time (most overlap days; else latest period_end within 18 months before the range; future rows ignored), then latest as_of, stat median > mean > p75 > p25, id. Only benchmarkable metrics, only clients for which the metric is connected; unknown metric ids skipped. Same row for several clients merges into one match with `appliesTo`. Money rows converted from `currency` at the period_end month, triangulated through CZK (direct, two-hop such as CAD to USD to CZK, CZK identity); no rate or no currency gives `no_fx` with null values. as_of older than 12 months gives `stale`.

## CM3 and live column verification

Live `mart.mart_daily_kpis` (INFORMATION_SCHEMA.COLUMNS and VIEWS, 2026-10-04): all 22 kpis component columns exist, plus `cm1_other_costs` (constant `CAST(0 AS NUMERIC)`) and `fulfillment_cost` (`COALESCE(s.fulfillment_cost, 0)`; Woo `SUM(fulfillment_variable)`, 0 for Shopify and Shoptet). Mart row definition: `cm3 = revenue - cogs - 0 - COALESCE(fulfillment_cost,0) - COALESCE(paid_spend,0)`. Registry: `cm3 = revenue (gap) - cogs (gap) - fulfillment_cost (zero) - paid_spend (zero)`; `cm3_pct` uses the same numerator. Phase 2 columns (`link_clicks`, `add_to_cart`, `sent`, `delivered`, `unique_opens`, `unique_clicks`, `revenue`, `send_date`, `currency`) also exist live.

Proof query (read-only):
```sql
SELECT MIN(date), MAX(date), COUNT(*),
  SUM(cm3) AS mart_sum_cm3,
  SUM(revenue) - SUM(cogs) - COALESCE(SUM(fulfillment_cost),0) - COALESCE(SUM(paid_spend),0) AS component_cm3,
  SUM(cm3) - (SUM(revenue) - SUM(cogs) - COALESCE(SUM(fulfillment_cost),0) - COALESCE(SUM(paid_spend),0)) AS diff,
  COUNTIF(cm3 IS DISTINCT FROM (revenue - cogs - COALESCE(fulfillment_cost,0) - COALESCE(paid_spend,0))) AS row_mismatches
FROM `oneeighty-warehouse.mart.mart_daily_kpis`
WHERE client_id = 'manami' AND date BETWEEN DATE '2026-07-06' AND DATE '2026-10-03'
```
Result: 90 rows, mart_sum_cm3 = component_cm3 = 251049.928669, diff 0, row_mismatches 0.

Same comparison for all clients, same 90 days (finding, see open issues):

| client | SUM(cm3) | component formula | paid-only rows | paid spend on them |
|---|---|---|---|---|
| dobias | 449529.89 | 449529.89 | 0 | 0 |
| ethia | 126151.35 | 121416.92 | 5 | 4734.43 |
| manami | 251049.93 | 251049.93 | 0 | 0 |
| rawbark | NULL | NULL | 0 | 0 (COGS NULL on all 90 rows: `not_measured`) |
| venev | -285.85 | -2960.17 | 38 | 2674.33 |

## Verification
- `npx tsc --noEmit`: exit 0.
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-eval.ts`: 228/228 passed. Covers: live column list, CM3 terms, registry derivations, caveat rules (woo never, foreign data-driven), capabilities; filter merge, client selection, preset and clamp, native/mixed currency, span and points limits with suggestions, availability and queryClientIds; bucket and partial-bucket building; ratio from summed components (total 1.0 vs bucket mean 1.67); combined across CZK and USD from display sums; FX bucket nulling (bucket, cell, warning, rollup), same-currency shortcut; COGS 0 and NULL guards, real 0 on zero revenue, strict totals, rollup nulling, null fulfilment and paid as 0; not_connected exclusion, coverage 1 of 2 and 0 of 1, reason and missing; precedence (fx over not_measured, not_connected over all), no_data never 0, zero denominator; pp vs relative, zero baseline; comparison alignment; low volume; foreign rows caveat; vertical split order; RS0 `FIXTURE_RESOLVED` + `FIXTURE_ROWS` evaluate to the statuses fixtures.ts describes; all benchmark rules; no em/en dash in the 8 files; registry files pure.
- `npm run check:reports`: 212/212 (RS0 contract checks unaffected). `npm run check:capabilities`: 318/318.
- `npm run build`: exit 0 (log `scratchpad/rs1_build.log`).

## mart_qa objects
None.

## Ready for prod deploy
Nothing warehouse-side. Library code merges with the branch.

## Open issues
1. **SUM(cm3) vs component CM3 differ on days with ad spend but no orders.** The mart's row cm3 is NULL when there is no shop row (revenue NULL), so SUM(cm3) drops that day's paid spend; the component formula subtracts it. Manami and Dobias match exactly; Ethia differs by 4,734.43 CZK (5 days), Venev by 2,674.33 EUR (38 days) over the last 90 days. Existing pages (P&L, YoY, Goals) sum the mart column, so Reports CM3 will be lower than those pages for these clients. I kept the component formula (design 2.3 requires components so the COGS guard applies, and spend on a zero-order day is a real cost). Owner decision needed: accept (and later fix the mart to COALESCE revenue/cogs on paid-only rows) or make Reports match SUM(cm3).
2. **Partial COGS in a row group is invisible to the guard.** If some days in a bucket have NULL COGS and others are costed, SUM(cogs) is positive and the guard cannot fire at that grain. Today no client has mixed rows (last 90 days: RawBark all NULL, others none 0 or NULL). Fix belongs in WP2: emit `COUNTIF(cogs IS NULL AND revenue > 0)` as a guard column; the evaluator can then use it.
3. Strict totals make the COGS guard grain-dependent at the margin: a KPI at grain total checks only the period sum; a weekly line checks each week. Identical for all live clients today.

## Requests to orchestrator
1. Add `"check:reports-eval": "tsx --tsconfig scripts/tsconfig.json scripts/check-reports-eval.ts"` to `dashboard/package.json` (RS0 owns it).
2. WP2: SQL must emit `kpis.fulfillment_cost` like any money component (it is in `componentsFor` output for cm3 / cm3_pct). Consider the null-COGS row count guard (open issue 2); it would need an additive `MartGuards` field (contracts.ts, RS0).
3. WP2/WP3: `widget.components` already includes guard and low-volume components (`kpis.revenue` for `cogs`, `kpis.paid_spend` for `mer`), so compile from `widget.components`, not from the metrics' formula components.
4. WP3: build `ReportClient.capabilities` with `toReportCapabilities()` from `registry/capabilities.ts`; benchmarks call `matchBenchmarks` from `benchmarkMatch.ts`.
5. WP7/WP8: use `visibleCaveats(series.caveats, metric.caveats)` for the hover, `CAVEATS[id].short` for the text, `METRIC_LIST` / `findMetricId` / `evalCapExpr` for pickers and coverage hints.
6. Owner decision on open issue 1 (CM3 on paid-only days).
