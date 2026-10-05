# QF5 report: Snapshot and Goals data honesty

Branch `qf5-snapshot-goals` (worktree oe-dash-wt/qf5-snapshot-goals), one commit on top of main 92ac505. Not pushed.

## Findings covered
- A-04: `PnlTotals.spendFrom` + `leadingSpendGap` (lib/queries/pnl.ts, `aggregate` now exported with an optional context `{range, paidCapable}`; `getPnlSnapshot` gets a last param `paidCapable`, default false so check-warehouse is unchanged). Gap true when paid-capable and range.from < first non-null paid spend day (or no spend at all). Then mer/amer/cac null; AcquisitionEconomics shows state "Missing days" on MER, aMER, CAC, Ad spend share. Snapshot page: one Notice "Ad spend from Apr 20, 2026." (earliest spendFrom of current/previous), paid spend delta null when current or comparison has the gap. Interior NULL days untouched.
- A-03: `rollUp` per metric over targeted months only (target, actual and elapsed), `Attainment.coverage {targeted, of}`; Goals page shows "Target covers N of M months" once in the period header when all targeted metrics agree, else per tile. Untargeted metric: target null, actual = plain total. Counts unabbreviated (money stays compact).
- A-05/A-07/A-06: RevenueMix takes `range` and `partialLast`. Every day of the range plotted at its date, NULL day = zero day, weekly buckets over 120 days, monthly over 730 (bucket plots revenue per day, so short edge buckets do not dip; the partial day is excluded from the last bucket average). Ticks evenly spaced by date (years shown over 180 days). Shading and "Shaded day is partial." only when `includesToday(range)`.
- A-09: "No cost data" when LTGP 30d is null (CAC unknown only otherwise); LTGP 30d/90d tiles say "No cost data".
- A-10 (part): BottomLine labels the payback block, LTV and LTGP "in USD" (native code) when the P&L is converted.
- A-11: new components/growth/stats.ts `growthStats`: cumulative = newest/oldest closed month with revenue, average = compound monthly rate over the same months, so they cannot disagree in sign. Partial month MoM cells render n/a (and sort null).
- A-17: Growth loading skeleton = chart + table.

## Verification
- `tsc --noEmit` clean; `npm run build` OK; `check:loading` 203/203, `check:capabilities` 329/329.
- Scratch tsx assertions (deleted, not committed), all passed: aggregate leading NULL days give MER null, all spend days give MER identical to the no-context result, interior NULL day unchanged, no spend + paid-capable gap, not paid-capable no gap, range before spend gap; rollUp Manami-like fixture (1 targeted month: target 540K, actual only that month, ratio 300/540, coverage 1 of 12, closed), untargeted metric target null, full coverage unchanged; growthStats compound/cumulative consistency; RevenueMix model: sparse Venev-like Sep gives 30 daily points with Sep 6 at index 5 and zeros elsewhere, monthly grain for 5 years (61 buckets), weekly for 9 months. Static render: path x evenly spaced (24.8 step), ticks Sep 1 / 8 / 16 / 23 / 30, rect and caption absent when partialLast false, present when true.
- MCP (read-only): Dobias `mart_daily_kpis` first non-null paid_spend = 2026-04-20 (spine has a row for every day from 2021-10-04, so a range starting earlier is a leading gap). Venev Sep has 24 NULL-revenue rows of 30 (zero days now plotted).

## Not done / notes
- A-10 discounts "USD only" instead of "n/a": needs a change in `components/dashboard/RevenueComposition.tsx` (not owned). Request below.
- No Notice when a paid-capable client has no spend at all (copy only exists for the dated case); cards still show "Missing days".
- "Avg monthly growth" is now a compound rate; METRIC_DEFINITIONS.Growth note ("Averages cover closed months...") is still accurate, but its formula text is in lib/metrics.ts (not owned).
- No BigQuery writes. No harness routes left behind.

## Requests to orchestrator
1. RevenueComposition: accept e.g. `discountsNote` or render "USD only" when the snapshot page passes null in converted view (page currently passes `discounts = null` when display != native).
2. Optional: lib/metrics.ts Growth definition could say "compound monthly rate over the closed months shown".
