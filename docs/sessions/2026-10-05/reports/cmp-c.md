# CMP-C report: Orders, Email, Creative compare + delta toggle

Branch `cmp-c-orders-email-creative`, one commit on top of main (`1e78a31`, includes CMP1 and the hit-rate tile). Frontend only, no BigQuery objects, not pushed.

## What changed
| File | Change |
|---|---|
| `app/(app)/orders/page.tsx` | Compare on. `getOrdersSummary(id, comparison)` runs in the same `Promise.all`, skipped when comparison is null. All 6 cards carry `change` + `comparisonLabel`: Orders (count), Revenue / AOV net / AOV incl. shipping / Gross profit (money, client currency), Returning (rate, pp, neutral). Null on either side (no orders in comparison, no cost data) drops that chip only. Recent orders list stays uncompared. |
| `app/(app)/email/page.tsx` | Compare on. `getEmailSummary(id, comparison, 1, platform)` in the same `Promise.all` (totals have no LIMIT, 1 row is enough). 5 tiles: Campaign revenue and Revenue / recipient (money), Emails sent (count, neutral), Open rate (rate), Click rate (rate, 2 decimals). Tiles became a typed array; a fixed-height chip row keeps the strip aligned. Flows block is lifetime counters, so it has no comparison (comment in code). |
| `app/(app)/creative/page.tsx` | 4 delivery tiles use `change` (spend money neutral, ROAS ratio, CPA money good-when-down, purchases count). Legacy `delta()` import removed. Hit rate tile gets a `rate` (pp) change only when comparison launches exist (`rateChange`, needs thresholds, a comparison and `launched > 0` with a non-null rate on both sides); winners, carriers, losers untouched. `getLaunches` reads from `min(range.from, comparison.from)` so previous-year launches are loaded (they sit outside the 12-month trend window); the trend itself still uses the page range. |
| `components/creative/primitives.tsx` | `Tile.change` (DeltaInput, wins over legacy `delta`), Scorecard renders it, new pure `rateChange()`. |
| `scripts/check-delta-cmpc.ts` | 72 assertions (see below). Not added to package.json (orchestrator). |

Breakdown, concepts, velocity, production: untouched, still no Compare (pinned by the check).

## Verification
- `tsc --noEmit`: 0 errors. `npm run build`: exit 0, 0 warnings (`scratchpad/cmp-c_build.log`).
- `check:delta` 177/177, `check:creative` all match, `check:loading` 260/260, `check-creative-hitrate` all pass, `check-delta-cmpc` 72/72.
- check-delta-cmpc covers: `rateChange` (no comparison launches, missing rates, 0% rate with launches), hit rate period logic, Scorecard in pct and abs (money, ratio, count, pp in both modes, sentiment, zero baseline, null change, legacy delta), demo Orders and Email summaries for current and comparison, MetricCard in both modes with a null comparison summary, source pins for Orders, Email and Creative (Compare flags, parallel fetch, skip when null, kinds, currency, label, no `delta=`, hit rate widening, other Creative screens without Compare), no em dash.
- BigQuery read-only, 2026-09-05..10-04 vs prev period 08-06..09-04 and prev year:
  - Orders (mart_orders): comparison rows exist for dobias, ethia, manami, rawbark, venev in both modes (prev year venev only 1 order, so its pct chip is large, expected). rawbark margin is NULL in all periods, so its Gross profit card is not rendered (existing rule).
  - Email: manami (Ecomail) has campaigns in all three periods; dobias (Klaviyo) has them for prev period (22 vs 18 campaigns) but none for prev year, so no chips there (summary null), correct.
  - Hit rate (rpt_ad_launch): comparison launches exist for dobias (prev period 7 eligible), ethia (2 / 8), manami (11 / 5), venev (4); dobias current period has 0 launches so no chip regardless. Ethia prev year launches (8) start before the trend window, which confirms the widened read is needed.
- Not verified: a browser run of the real `(app)` shell (login), phone width of the Email chip row.

## Notes and requests
1. Click rate pp uses 2 decimals, open rate 1; adjust if the owner prefers consistent precision.
2. Returning share is neutral-coloured (higher is not clearly good). Easy to flip to "up".
3. Add `"check:delta-cmpc": "tsx --tsconfig scripts/tsconfig.json scripts/check-delta-cmpc.ts"` to package.json.
