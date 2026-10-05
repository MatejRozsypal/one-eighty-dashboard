# HR2 report: hit rate engine, Creative tile and trend, Paid tile

Branch `hr2-hitrate-ui`, commit 399df2d (not pushed). App `dashboard/`.

## What changed
New: `lib/creative/hitRate.ts` (pure), `lib/queries/creativeLaunch.ts`, `components/creative/HitRateTrend.tsx`, `components/paid/meta/HitRateTile.tsx`, `scripts/check-creative-hitrate.ts`.
Edited: `lib/demo/creative.ts` (+`demoLaunches`), `app/(app)/creative/page.tsx`, `app/(app)/paid/meta/page.tsx`. No shared component touched (MetricCard, KpiTile, DeltaChip untouched; Paid tile uses its own markup because KpiTile has no sub line).

- Definition (design 2.2): launched = first delivery in range, not pre-existing, not relaunch (D1). Winner = existing `classify()` on lifetime components against the row's stored `prior_roas`, thresholds from the creative settings store (never in SQL). Open = not winner and age < 60 days. Rate = winners / launched, pooled.
- Creative tile "Hit rate": `7.4%`, sub `9 of 122 launched · 18 open`, info with the client's own bar. No thresholds: n/a, `122 launched`, "Set thresholds in Settings." Not ready: n/a, "Not ready". Winners tile info now says "with delivery in the period".
- Section "Hit rate by launch month" (hand-written SVG, between scorecard and "Every creative"): 12 bars, `W/n` labels, dash for empty months, hatched maturing months with `n open`, dashed REF. ~5% line, in-range months highlighted, All/Video/Static as URL links (`hrfmt`), concept table only when 50%+ of launches in range are tagged.
- Paid > Meta: tile after the KPI rows, same text function as Creative, links to `/creative` with the same view, or to `/settings` without thresholds (sub "Set thresholds").
- `getLaunches`: one query on `mart.rpt_ad_launch` returning the trend window and page range together plus the client's `through` and row count. Missing table, or table with no rows for the client, = `not-ready`. Any other error (403, timeout) is re-thrown per the repo rule.

## Verification
- `tsc --noEmit`, `npm run build`: pass. `check:creative` (all assertions match), `check:paid` 211/211, `check:loading` 260/260: pass.
- `scripts/check-creative-hitrate.ts` (run: `npx tsx --tsconfig scripts/tsconfig.json scripts/check-creative-hitrate.ts`): 90+ assertions, all pass. Covers: n < N never winner, boundary shrink 2.25 exactly, identity with `classify()` on a 240-cell grid, relaunch and pre-existing excluded from both sides, open/settled at 59/60 days, missing thresholds, not-ready tile/trend/Paid tile, month pooling and year boundary, format filter, concept split threshold, SVG output (hatch, labels, dash, reference), demo path, SQL shape (no thresholds, DATE() casts), BigQuery stub: 404 and empty client read as not-ready, 403 is thrown.
- Live (HR1 table exists: 459 rows; Dobias 64/pre 6/relaunch 23, Ethia 179/1/0, Manami 200/3/43, Venev 16/7/0, prior ROAS 2.842/2.283/2.029/0.108). No local BigQuery credentials, so rows came via MCP and ran through the real TS engine (harness kept in scratchpad `hr2/live_harness.ts`, deleted from repo). Proposed thresholds (Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15, Venev 2.10/10). 207 comparisons match an independent SQL (shrinkage written in SQL) per client and month, and the design table 1.4: 12 months Dobias 6 of 35 (17.1%), Ethia 7 of 156 (4.5%), Manami 9 of 122 (7.4%), Venev 0 of 9 all open; ad grain Dobias 58/8, Manami 161/9; open counts Aug/Sep match (Manami 6 and 8, Dobias 6, Ethia 2 and 3).
- The exact page SQL was run live for Venev: valid, 68 KB processed (10 MB billed minimum).

## Notes and open points
1. Trend window: per design 2.1 SQL it ends at the month of `through` (2026-10 today) and starts 11 months earlier, so Oct 2025 drops off and the current month is mostly empty (a dash). The design's 1.4 table instead shows 2025-10 to 2026-09. Say if you want the last bar to be the last complete month.
2. `is_video` (video plays > 0 lifetime) is true for Venev ads named `STAT`, and Dobias video split differs slightly from the design's ad-grain split. This is HR1's flag; worth a look, it only affects the Video/Static toggle.
3. Ethia has no `mart_creative_asset` rows, so `is_relaunch` is 0 for all 179 Ethia ads; its hit rate is at ad grain until that ingest gap is fixed.
4. Paid tile uses `params.range`, Creative uses its own default (all time). Same numbers when the same range is selected (the tile link carries it).
5. Not browser-verified (login-gated); SSR markup is asserted in the fixtures.

## Requests to orchestrator
- Add to `package.json` (not owned): `"check:hitrate": "tsx --tsconfig scripts/tsconfig.json scripts/check-creative-hitrate.ts"`.
- Enter the thresholds in Settings; until then both tiles read n/a "Set thresholds".
- Prod deploy needs nothing beyond HR1's table; no migrations in this package.
