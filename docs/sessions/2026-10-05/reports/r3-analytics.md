# r3-analytics report

Branch `r3-analytics` (worktree oe-dash-wt/r3-analytics), one commit on top of b5868b1. Not pushed.

## Findings covered
- A-10: RevenueComposition takes `discountsNativeOnly` (client native code). Converted view row reads "USD only" (muted) instead of "n/a". Snapshot page passes it.
- A-20: `lib/format.ts` single `tidySign`: U+2212 for every negative money, percentage, count and ratio; a negative that rounds to zero is unsigned ("-EUR 0", "-0.0%", "-0.00x" never shown). Hand-built signs removed: RevenueComposition and Orders discounts now use `formatMoney(-x)` (fixes "−€0").
- N-01: new `paidSpendDelta(snapshot)` / `hasSpendGap(snapshot)` in `lib/queries/pnl.ts`; Paid spend tile and margin stack Paid spend row both use it. CM3 and CM3 % deltas untouched (same on tile and stack); request: decide if CM3 delta should also be withheld when the comparison has a leading gap.
- N-02: rule kept (leading gap blanks MER/aMER/CAC/share). New `spendGapNotice(snapshot)`: date is always `current.spendFrom` (first spend day inside the CURRENT range), so it no longer changes with the compare toggle. If only the comparison has a gap, the line reads "Comparison ad spend from <date>." (delta withheld).
- N-03: Buying plan with snapshot over 30 days: one extra Notice "Re-sync the products feed in Data health." with AppLink to /health. Shown only to internal roles (Data health is internal-only, a client account would hit a redirect).
- N-04: `tickLabels` in RevenueMix: one tick per day when days <= 5, otherwise 5 de-duplicated ticks.
- N-05: new `components/dashboard/MarketChips.tsx` (optimistic selection, same pattern as SegmentedControl: local state until shared `isPending` drops). Cohorts page uses it.

## Files
lib/format.ts, lib/queries/pnl.ts, components/dashboard/{RevenueComposition,RevenueMix,MarginStack,MarketChips}.tsx, app/(app)/{snapshot,orders,cohorts,inventory/buying}/page.tsx, scripts/check-capabilities.ts (new assertions for minus rule, tick labels, spend-gap notice/delta incl. compare toggle).

## Verification
- tsc --noEmit clean; `npm run build` OK.
- check:capabilities 350/350 (new assertions included), check:loading 248/248, check:paid 203/203, check:creative OK, check:reports* all pass (reports: BigQuery steps skipped, no credentials).
- check:queries and check:warehouse could not run (no GCP credentials). BigQuery MCP returned "Not connected", so the Ethia first-spend date (Oct 7, 2025 per QA) was not re-read; the gap logic is covered by the pure unit assertions instead.
- Not verified in a browser (no login).

## Requests to orchestrator / r3-perf
- `components/controls/MarketFilter.tsx` (r3-perf area) is now unused; I did not touch it because I do not own it. It is still listed in `scripts/check-loading-pulse.ts` (owned list), so delete both together, or leave it. If r3-perf prefers, move my optimistic change into it and revert the cohorts import.
- No Notice copy was added to the closed list in the sprint plan beyond the two lines above ("Comparison ad spend from {date}.", "Re-sync the products feed in Data health."); needs lead OK per Notice.tsx header.
