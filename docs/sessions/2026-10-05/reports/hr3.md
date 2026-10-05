# HR3 report: hit rate, winners, ads launched in Reports

Branch `hr3-reports` (worktree oe-dash-wt/hr3-reports), one commit `823fb9e`. Not pushed. No BigQuery writes, no mart_qa objects, no Postgres writes.

## What changed
- `lib/reports/registry/types.ts`: `SEMANTIC_VERSION` 6 to 7. `MartId` + `ad_launch`. `MartDef.entity?: { key, classifier: "creative_hit", exclude[] }`. `ComponentDef.classified?: { needsThresholds, lowerBound }`. `ReportClient.creativeThresholds?` (merged per request, like `costRates`). `MetricBase.reference?: { value, label }`. Caveat ids `cohort_maturing`, `lifetime_to_date`.
- `registry/components.ts`: mart `ad_launch` (`mart.rpt_ad_launch`, dateColumn `first_date`, no currency, grains day/week/month, entity key `ad_id`, exclude `is_preexisting`, `is_relaunch`). Inputs `purchases, spend, revenue, age_days, prior_roas`; classified outputs `launched, winners, open`. Load-time validation for both.
- `registry/metrics.ts`: `hit_rate` (winners / launched, percent 1 dp, up, not benchmarkable, reference ~5% = `HIT_RATE_REFERENCE` from hitRate.ts), `winners`, `ads_launched` (neutral). Group `meta` (see requests). Metrics may not read entity inputs (validated). Removed alias "hit rate" from `meta_hook_rate` so the phrase finds the new metric.
- `registry/caveats.ts`: `cohort_maturing` (data-driven, "Launches under 60 days old still open"), `lifetime_to_date` (always).
- `compile.ts`: entity CTE groups by client, period, bucket, `entity_key` (ad_id); inputs as ANY_VALUE + NULL counts; `exclude` columns as `IS NOT TRUE` in WHERE; never emits classified outputs. When an entity mart is in a widget, every CTE gets `entity_key` ('' for other marts) and joins `USING (client_id, period, bucket, entity_key)` so entity rows never duplicate other sums. Widgets without an entity mart compile to identical SQL (all old snapshots pass).
- `evaluate.ts`: `classifyEntityRows` (exported) maps each entity row through `launchStatus()` of `lib/creative/hitRate.ts` (the Creative tile's function) into 0/1 counts before summing; does not mutate cached rows. Missing thresholds: not_measured "No thresholds" (`NO_THRESHOLDS`) for metrics that need them; ads launched works without. Series caveat `cohort_maturing` when a current total has open > 0. Delta null for lower-bound metrics when current open > 0 and comparison open = 0 (client and rollups, over the kept clients).
- Design deviation: classification happens in evaluate.ts, not normaliseRows (run.ts is not owned and its output is the cached payload; classifying there would put thresholds into the cache).
- `app/api/reports/query/route.ts`: `creativeThresholds()` reads `getCreativeSettings` + `toThresholds` per query client only when a component needs thresholds, in parallel with run/benchmarks/rates, merged after compile. Failed read: logged, every client "No thresholds".
- Widgets (reference line only): KPI adds the reference label to the hover lines; Line draws a dashed `ReferenceLine` y; Bar draws it x (total) or y (buckets), not on stacked bars. Read via `(metric as { reference? }).reference`.
- `scripts/check-reports.ts`, `scripts/check-reports-eval.ts`: counts 44 to 47, live column list for ad_launch, classified components skipped in the live column check, new HR3 sections.
- Docs: `lib/reports/README.md` (entity marts), `METRICS.md` amendment 25 + registry rows.
- Also edited, not in the HR3 row: `lib/reports/registry/ids.ts` (append-only: `hit_rate`, `winners`, `ads_launched`). The metrics cannot exist without it.

## Verification
- `tsc --noEmit` clean, `npm run build` ok.
- check:reports 340/340, reports-eval 406/406, reports-authz 37, reports-store 315, reports-url 193, reports-widgets 684, reports-canvas 98, capabilities 350, paid 211, creative ok, check-creative-hitrate all pass. **reports-pages 214/216**: its two asserts hard-code 44 picker metrics (file not owned, see requests). BigQuery steps of check:reports skip locally (no GCP credentials, as before).
- New assertions (all pass): classifier equals launchStatus() on a 145-row grid; rows not mutated; no prior never a winner; no thresholds writes only launched; per-client values; n < N never a winner; "No thresholds" not_measured, ads launched still ok; combined = 3/7 sum over sum (not mean of rates), coverage 2 of 3, excluded "No thresholds"; stricter target changes the evaluation; maturing caveat only on the open series; delta suppressed (cur maturing, cmp settled), kept when both settled or both maturing, kept for ads launched; combined delta suppressed; month buckets with a gap month; mixed widget revenue not multiplied; Reports = hitRate() on 150 random launches. SQL: inputs only, ANY_VALUE, GROUP BY 4, exclusions, no FX, date predicate asserted and tamper rejected, SQL and key byte-identical for thresholds 2.25/15, 3.00/25 and null, no threshold value in SQL or params, hit_rate/winners/ads_launched share one SQL and key, mixed widget joins on entity_key, plain widgets unchanged, normaliseRows of an entity row.
- Widget SSR (throwaway, copy in `scratchpad/hr3/_hr3_widgets.tsx`): Line and Bar (buckets and total) draw "Reference ~5%" dashed; KPI shows 7.4% with the reference and maturing note on hover; no line without the field.
- Live parity (throwaway harness, copies in `scratchpad/hr3/`: `_hr3_live_sql.ts`, `_hr3_live_eval.ts`, `sql_month.sql`, `rows_month.json`, `eval_out.txt`): compiled month widget, 4 clients, 2025-10-01..2026-09-30, previous period, params inlined, run via MCP, 376 rows, normaliseRows + evaluateWidget with thresholds Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15, Venev 2.10/10 and prior_roas from the table:
  - Dobias **6 of 35** (17.1%), Ethia **7 of 156** (4.5%), Manami **9 of 122** (7.4%), Venev 0 of 9 (all 9 open). Creative tile `hitRate()` on the same rows: identical (open 6, 5, 14, 9).
  - Monthly points equal design table 1.4 (e.g. Manami Oct 25 15.4%, Mar 26 28.6%; Dobias Jun/Jul/Aug 0 / 38.5 / 8.3%).
  - Combined 22 of 322 = 6.8%. With Venev thresholds removed: 7.0%, coverage 3 of 4, excluded "venev: No thresholds"; ads launched still 322 (4 of 4).
  - Ethia and Manami prev period values 4.5% / 6.3% with delta null (current maturing, previous settled), as specified.
- Dry run: 46,360 bytes processed for both total and month variants (limit 10 MB; 10 MB billed minimum). A mixed entity + kpis join was run live on Ethia and Manami: 0 ad rows matched a kpis row and vice versa, revenue unchanged.
- No em or en dash in the diff.

## Ready for prod
Frontend only; needs HR1's `mart.rpt_ad_launch` (live) and the refresh scheduled query (HR1 open item). The SEMANTIC_VERSION bump clears Reports caches at deploy.

## Open issues
- KPI sub line "W of n" (design 3) is not shown: `MetricCell` has no field for it and widget edits were kept to the reference line. Hover shows coverage, caveats and the reference.
- Maturing is flagged per series (any open launch in the current total), not per bucket marker.
- Ethia has no `mart_creative_asset` rows, so its relaunch exclusion is inactive (HR1/HR2 known gap); Reports and the tile agree on it anyway.
- A no-thresholds client with no launches in a period reads "No data", not "No thresholds" (there are no rows to judge).

## Requests to orchestrator
1. `scripts/check-reports-pages.ts` (not owned), lines 44 and 48: 44 picker metrics becomes 47.
2. `lib/reports/pageData.ts` and `components/reports/widgets/types.ts` (not owned): pass `reference` through (`WidgetMetric` Pick + `widgetMetrics[m.id].reference = m.reference`). Until then the reference line code is inert in the app (verified only with a metric that carries the field).
3. Optional: a "Creative" picker group (`MetricGroup` + `METRIC_GROUP_ORDER` in registry/types.ts and `GROUP_LABEL` in `components/reports/pickers/MetricPicker.tsx`); the three metrics sit in "Meta" for now.
4. Acknowledge the append to `registry/ids.ts` (outside the HR3 row, required).
5. Merge with CMP1: my widget edits are small inserts next to the benchmark ReferenceLines (Line, Bar) and the notes line (KPI).
