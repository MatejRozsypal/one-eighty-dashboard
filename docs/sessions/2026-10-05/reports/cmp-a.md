# CMP-A report: Shop and P&L deltas follow the % | 123 toggle

Branch `cmp-a-shop`, worktree `oe-dash-wt/cmp-a-shop`, one commit `9f35177` on `1e78a31` (main incl. CMP1). Frontend only, no BigQuery objects, not pushed.

## What changed
| File | Change |
|---|---|
| `lib/queries/pnl.ts` | New `metricChange(snapshot, pick, kind)` (DeltaInput or null without comparison, money takes the snapshot's display currency) and `paidSpendChange(snapshot)` (null under the same leading-gap rule). `metric()`, `paidSpendDelta` unchanged (check-capabilities still uses them). |
| `app/(app)/snapshot/page.tsx` | 4 cards on `change`: Revenue, CM3 money; CM3 % `rate`; Paid spend via `paidSpendChange` (gap rule kept). |
| `components/dashboard/AcquisitionEconomics.tsx` | MER, aMER `ratio`; CAC, AOV `money`; Ad spend share `rate` (pp); order mix new/returning `count`, label via chip `after`. |
| `components/dashboard/MarginStack.tsx` | Step `delta` became `change` (money); paid spend step through `paidSpendChange`. |
| `app/(app)/products/page.tsx` | 4 cards: Products `count`, Revenue and Margin `money`, Margin % `rate`. |
| `app/(app)/unit-economics/page.tsx` | Row gets a `delta` kind: AUR, Gross per order, True AOV, Paid spend applied money; Orders count; UPT count with 2 decimals; Discount, Return, COGS %, Gross profit %, CM % are `rate`. |
| `app/(app)/growth/page.tsx` | `DeltaModeToggle` right after its own Compare control (both MoM and YoY views); MoM chips use previous-month values, columns sort with `deltaSortKey`, partial month stays n/a. |
| `lib/queries/growth.ts` | `GrowthMonth.previousRevenue`, `previousNewCustomerOrders`: the query reads one month more than the table, takes the predecessor's figures, drops that row. Only set when it is the previous calendar month (same rule as the mart's own MoM, which is null across a gap; verified in BigQuery read-only: 212 rows, revenue and new-order MoM reproduce `LAG` exactly, the single gap row has MoM null). Demo path keeps its row count. |
| `lib/queries/yoy.ts`, `components/dashboard/YearOverYear.tsx` | `YearRow.cappedPrevious` (prior-year capped revenue); "vs prior year" chip money, n/a fallback with its title kept. |
| `scripts/check-delta-shop.ts` | New, 65 assertions. |

No change needed in RevenueMix, RevenueComposition, BottomLine (no deltas), `components/growth/stats.ts` (averages, not chips).

## Behaviour notes
- pct mode keeps the old numbers for money, count and ratio. Rates now read pp in both modes (agreed): Snapshot CM3 %, Ad spend share, Products Margin %, Unit economics % rows. This is the release-note line from CMP1 note 3.
- A baseline of 0 now shows nothing in pct (as before) but shows the absolute change in 123 mode.
- Unit economics rows with `unmeasured` still show no chip.

## Verification
- `npx tsc --noEmit`: 0 errors. `npm run build`: exit 0, 0 warnings (`scratchpad/cmp_a_build.log`).
- `check:delta` 177/177, `check:loading` 260/260, `check:capabilities` 350/350.
- `check-delta-shop` 65/65: metricChange (money/ratio/rate, currency, rollup currency, null without comparison); paidSpendChange withheld under current and comparison gap in lockstep with `paidSpendDelta`; exact chip text of AcquisitionEconomics and MarginStack in both modes on a fixed snapshot (e.g. MER ▲100.0% / ▲5.00×, CAC ▼68.8% / ▼CZK 55.00, ad share ▼10.0 pp in both, margin stack CM3 ▲400.0% / ▲CZK 800); gap renders "Missing days" and withholds the spend chip in both modes; YearOverYear pct and abs and n/a fallback; `getGrowth` demo previous-month values equal the row before, reproduce the mart MoM, oldest shown month has a predecessor, row count unchanged; source pins (no legacy `delta=` in owned page files, kinds per card/row, toggle placement, deltaSortKey on both MoM columns); no em dash in owned files.
- Not verified: real `(app)` shell and the four pages in a browser (no login; BigQuery render of Growth/Products/Unit economics covered by pins and static renders only), `check:warehouse` (needs credentials), phone width of abs money in the Unit economics 90px value columns (long abs values like "CZK 1,234,567" may need the column wider; chip is nowrap).

## Requests to orchestrator
1. Add npm script `check:delta-shop` -> `tsx --tsconfig scripts/tsconfig.json scripts/check-delta-shop.ts`.
2. Release note line about rates now in pp (see above).
3. Browser check after merge: Growth with `view=yoy` and 123, Unit economics abs money width at 375px.
