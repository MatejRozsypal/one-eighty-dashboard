# HR4 report: hit rate glue after HR3 and CMP1

Branch `hr4-glue` (worktree oe-dash-wt/hr4-glue), one commit on top of main. Not pushed. No BigQuery, no Postgres, no mart_qa.

## What changed
1. `scripts/check-reports-pages.ts`: 44 to 47 (two asserts). Also `check-reports-eval.ts`: HR3 group assert Meta to Creative, FX4 Meta group count 24 to 21 (the three moved out).
2. Reference through: `lib/reports/pageData.ts` (the file is under lib/reports, not components/reports as in the request) adds `reference` to `widgetMetrics`; `components/reports/widgets/types.ts` adds `reference` to the `WidgetMetric` Pick. KPI hover, Line and Bar read it as before and now get it in the app. Only hit rate carries one (asserted).
3. Creative picker group: `MetricGroup` + `METRIC_GROUP_ORDER` (after meta, before google) in registry/types.ts, label in MetricPicker.tsx, `hit_rate`, `winners`, `ads_launched` set to group `creative` in registry/metrics.ts.
   Decision: hook rate and hold rate STAY in Meta. They come from the Meta ad mart, are benchmarkable against Meta industry benchmarks, sit in Paid's Meta tab and FX4 documents them as Meta soft metrics. The Creative group holds the launch-cohort metrics (lifetime to date, maturing), which behave differently from period delivery rates. Moving them is one word each in metrics.ts if wanted.
4. KPI sub line "W of n": new optional `MetricBase.showCounts: { noun }` (ratio of two single positive terms, validated at load; set on hit_rate with "ads"). The evaluator sums numerator and denominator over the members of the current total (the clients actually summed, so excluded no-threshold clients are out) into new `MetricCell.counts`. KpiWidget draws "22 of 322 ads" under the value. Winners and ads launched have no counts.
5. Delta toggle: kinds were already right (hit rate maps to `rate`, pp in both modes; winners and ads launched map to `count`, relative in %, count difference in 123). One real bug found: the evaluator withholds the hit rate and winners delta for a maturing cohort against a settled one, but `CellDelta` in 123 mode rebuilds the change from the two totals, so the withheld delta came back. Fix: `MetricCell.deltaSuppressed` (set by the evaluator, also for rollups), `CellDelta` has a `suppressed` prop, passed from KPI, Table and Ranked; KPI also skips the chip.

Files: components/reports/pickers/MetricPicker.tsx, widgets/{CellStatus,KpiWidget,RankedWidget,TableWidget,types}.ts(x), lib/reports/{evaluate,pageData,types}.ts, registry/{metrics,types}.ts, scripts/check-reports-{eval,pages,widgets}.ts.

## Verification
tsc clean, `npm run build` ok. Checks: reports 340/340 (BigQuery steps skip locally, no credentials), reports-eval 411, reports-authz 37, reports-store 315, reports-url 193, reports-widgets 699, reports-canvas 98, reports-pages 221, capabilities 350, paid 211, creative ok, delta 177, delta-shop 65, delta-paid 184, delta-cmpc 72, hitrate ok, loading 260.
New assertions: counts per client and combined (3 of 7, kept clients only), counts absent on winners and ads launched; deltaSuppressed set on maturing vs settled (client and combined), absent when kept; rate kind pp / counts relative; KPI sub line text; hit rate delta pp in both modes; winners and ads launched delta relative vs count difference by mode; withheld delta draws nothing in KPI, Table and Ranked in both modes; zero baseline still shows the count difference in 123 mode; picker Creative group membership and order, hook and hold in Meta, GROUP_LABEL entry; reference reaches widgetMetrics for hit rate only. No em or en dash in the diff.

## Notes / requests
- SEMANTIC_VERSION not bumped (stays 7 from HR3): evaluation runs per request on the cached rows, and the new fields are additive.
- Persisted layouts store metric ids, not groups, so the group move changes the picker only.
- Not browser-tested (no login); widgets verified by static render.
