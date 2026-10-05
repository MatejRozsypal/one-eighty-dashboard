# WR3 report: Repeat rate page (`/repeat-rate`)

Branch `wr3-repeat-page`, commit `3deb739` (not pushed). Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/wr3-repeat-page`. Frontend only, no BigQuery writes, nothing deployed.

## What was built

| Area | Files |
|---|---|
| Page | `app/(app)/repeat-rate/{page,loading}.tsx` (capability guard, `RangeNote`, ignores the date range) |
| Queries | `lib/queries/retention.ts`: cohort view read, curve read (customer table, grouped by group, event, entry class and day), settings read for the headline horizon (a failed settings read falls back to 90, never an empty page) |
| Pure logic | `lib/retention/stats.ts` (`wilson`, `newcombe`, `kaplanMeier` with Greenwood and the 30-at-risk stop, `kmAt`), `lib/retention/model.ts` (`monthMature`, `lastMatureWindow`, `compareWindow`, `poolRows`, tiles, cohort table, trend with quarters, entry table, controls) |
| Components | `components/retention/{RetentionTiles,CohortRateTable,CohortTrendChart,RepeatCurveChart,EntryClassTable,RateDiff}.tsx`, plus `RateCell.tsx` and `RepeatRateBody.tsx` (the layout shared by the page and the check script; added inside the owned directory) |
| Demo | `lib/demo/retention.ts`: customers, not totals; cohort and curve rows are aggregated like the warehouse does it |
| Additions | `lib/nav.ts` (Repeat rate, second after Customers), `lib/capabilities.ts` (`/repeat-rate`, Shop), `lib/metrics.ts` (`RETENTION_TIPS`, all tooltips of at most 40 words) |
| Check | `scripts/check-retention.ts`, 272 checks. The orchestrator adds `"check:retention"` to `package.json` (not touched) |

## Deviations (please confirm)

1. **Plain SVG charts, not Recharts via `next/dynamic`.** The whisker, quarter band, bar strip and Greenwood step bands share one coordinate system, and the existing page charts (Repeat timing) are SVG too. Route size is 5.5 kB.
2. **`scripts/check-capabilities.ts` edited** (not on my list): `/repeat-rate` added to the shop page list, nav counts 16 to 17 and 15 to 16. Without it the check fails on the new item.
3. **"All mature" row is customer level** (sum of `m_H`), not month level, so its 365d cell is the same pooled figure as the Customers and Cohorts tile: Manami all customers 111 of 709 = 15.7% (the "All customers" row of Entry products shows the same). "Last 6", the tiles and the trend use the month rule from design 1.5.
4. **Mixed month** (customers on both sides of the guard, Manami Nov 2024: 1 early customer): the row uses its non-early customers, marked with `*` and a hover "1 customers ... left out". A month made only of early customers is an Early row with its own values.
5. Entry options use `m90 >= 30`, so Gift set (exactly 30) and Mixed (44) are offered for Manami. Entry products "Customers" and "Share" are non-early (2,567 of 2,936; Discovery 59.7% instead of the design's 59.2%), with a footnote naming the early customers left out.

## Verification

Prod BigQuery table cut-off is 2026-10-01 (the hourly schedule is not yet created, so it does not move).

**Manami, every figure recomputed from `mart.rpt_customer_entry` with separate SQL (MCP, read only), 539 comparisons, 0 differences** (`scratchpad/wr3/verify_manami.ts` plus the fixtures next to it):
- Tiles, Discovery set, Year earlier (k of n):

  | Tile | Current | Previous | Window |
  |---|---|---|---|
  | R 90d | 59 of 488 = 12.1% | 19 of 202 | Jan to Jun 2026 |
  | U 90d | 56 of 488 = 11.5% | 18 of 202 | Jan to Jun 2026 |
  | R 180d | 37 of 387 = 9.6% | 18 of 174 | Oct 2025 to Mar 2026 |
  | U 180d | 33 of 387 = 8.5% | 17 of 174 | Oct 2025 to Mar 2026 |

  The brief's production references all match. The R 90d chip reads +2.7 pp, CI -2.8 to +7.3, n 488 vs 202, "No clear change" (grey). Entry All and Prior 6 months also match (for example R 90d 86 of 823 against 43 of 559).
- Maturing: 443 (Discovery), 667 (All).
- Cohort table, 24 Discovery months: entrants and k for 30, 60, 90, 180, 365 and U90 per month, mature or n/a per cell. Early rows May to Oct 2024 (Oct 2024 reads 34, 11.8%, 17.6%, 23.5%, as in the wireframe). Last 6 row: 7.0, 9.2, 12.1, 9.6, 16.3% (365d: 35 of 215). All mature 365d 14.6% (57 of 391). Entry products table: all 7 rows, all 5 columns.
- Trend quarters: Q1 2025 11 of 117, Q4 2025 11 of 199, Q2 2026 38 of 300; Q4 2024 and Q3 2026 correctly absent.
- Kaplan-Meier, All and Discovery, recent and older, days 30, 90, 180 and 365: at risk, cumulative share and Greenwood band agree to 1e-5 with a window-function SQL (customer level at-risk and `LN(1 - d/n)`). Curve stops: All recent day 171, All older 365, Discovery full recent 166.
- Exact page SQL run on prod: Manami 158 cohort rows (sum 2,936), 1,830 curve rows.

**Dobias (no classes), same method:** tiles R 90d 318 of 1,504 = 21.1%, R 180d 426 of 1,452 = 29.3%, previous 399 of 1,960 and 776 of 2,313, Maturing 949, All mature 365d 7,901 of 18,396 = 42.9%. Entry and Event controls, full-size tiles and the Entry products table are absent.

**Browser** (throwaway route with fixtures, deleted before the commit; real `(app)` shell needs a login): Manami, Dobias, demo (classes and without), "%" and "123" toggle (entrants +147% become +264 in absolute mode; rates stay pp), Event Full size, 13/25/All, hover on the curve and trend, phone width 375 px (no horizontal page scroll; charts scroll inside their card).

**Gates:** `tsc` 0 errors; `npm run build` exit 0, 0 warnings; `check:capabilities` 362/362; `check:loading` 265/265; `check:delta` 177/177 (shop 65, paid 184, cmpc 72 also green); `check-retention` 272/272 (Wilson and Newcombe vectors, KM no-censoring, 5-customer hand example, stop at 30 at risk, Aug 2026 mature for 30 only from 2026-09-30, early rows out of both summary rows, entry rules, demo recount from customers and every state, renders in both delta modes, copy gates, source pins).

## Things to know

- **Dobias first-order months 2024-05 and 2024-06 hold 453 and 815 customers** against 40 to 300 in the other months. Probably a migration artefact (old-store customers whose first order is re-dated); the page shows it as is. Worth a look before Dobias is shown.
- The page reads `ref.retention_settings` for the headline horizon; if the frontend service account cannot read `ref`, it silently uses 90.
- `ops.v_unclassified_products` is not read by the page (WR1 note 4).
- Until `rpt_refresh_hourly` exists the page's maturity does not move.
