# WR4 report: Customers and Cohorts fixes

Branch `wr4-customers-cohorts`, one commit (not pushed). Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/wr4-customers-cohorts`.

## Files changed (all owned)
- `dashboard/lib/queries/lifetime.ts`: AOV = SUM(lifetime_revenue)/SUM(total_orders); new `getRepeat365(clientId)` (pooled SUM(r365)/SUM(m365) over `NOT is_early` from `mart.rpt_customer_entry`, n < 30 gives rate null, window start = GREATEST(data_start_date, today - 60 months)); `LifetimeSummary` gets `repeat365`, `windowStart`; header comment 36 -> 60 months; missing table returns null (tile shows n/a).
- `dashboard/app/(app)/customers/page.tsx`: tiles AOV (tooltip), Repeat rate 365 days (accent, sub-line "k of n", ", low n" under 100), Repeat rate to date (new tooltip); LTV vs LTGP tooltip "Per customer, all orders since {Mon YYYY}. Ignores the date range. Customers who bought before then count as new."; old "36-month" text removed.
- `dashboard/lib/queries/cohorts.ts`: `weightedY1()`, weights = Y1-complete customers per cohort (the only customers a Y1 figure exists for).
- `dashboard/lib/queries/cohortGrid.ts`: query excludes offsets in the current month (condition inline, live view untouched); elapsed offsets come from the calendar, not from "has activity", so a blank elapsed offset is 0 (per-order metrics AOV and orders per active stay n/a); "all cohorts" denominator = cohorts whose month is over.
- `dashboard/app/(app)/cohorts/page.tsx`: tile "Repeat rate, 365 days" via `getRepeat365` (same code path as Customers), Y1 LTV/LTGP weighted, grid tooltip fixed ("full data window" gone, stale "holds 36" comment now 60), range labels "12 months" / "24 months" (current month no longer shown) and maxOffset = months - 1.
- `dashboard/lib/demo/customers.ts`: demo `repeat365`, `windowStart`, grid excludes the current month.

## Verification against independent SQL (Manami, prod, 2026-10-05)
| Item | App formula | Independent | Result |
|---|---|---|---|
| AOV | 1,025.40 (old tile 961.28) | SUM(rev)/SUM(orders) on mart_customer_lifetime | 1,026 within +-5 |
| To date | 14.25% (2,940 customers) | recount | 14.3%, unchanged |
| 365 days | 111 of 709 = 15.66% | rpt_customer_entry non-early | 15.7% |
| Window start | 2024-05-06 | data_start_date | "May 2024" |
| Y1 LTV / LTGP (13 mature cohorts, 775 Y1-complete customers) | 1,255.29 / 800.69 | per-customer SUM(y1)/COUNT from mart_customer_lifetime: 1,255.29 / 800.69 | match. Old unweighted means were 1,288.52 / 827.24 |
| Grid "all cohorts" retention, 12 months, offsets 0..11 | ran `getCohortGrid` on the exact rows (85 rows) fed through a mocked query, compared to an SQL recompute from `stg_customer_orders` with current month excluded and blanks as 0 | | identical to 4 decimals: 1.0000 .0387 .0227 .0145 .0130 .0115 .0076 .0111 .0113 .0085 .0000 .0095 |

The Cohorts tile equals the Customers tile by construction (same function).

## Gates
tsc 0 errors; `next build` ok; check:capabilities 350/350; check:loading 260/260; grep gates on owned files: em/en dash 0, border-dashed 0, hex 0, toLocaleString() 0, "36-month" 0, dev vocabulary in JSX 0. The only client-name hits are two comments that were there before (lifetime.ts, cohorts.ts). `npm run lint` is not configured (interactive prompt), not run.

## Findings and requests
1. **WR1 report is wrong on one type:** `rpt_customer_entry.is_early` is BOOLEAN, not INT64 (`is_early = 0` errors). WR3 and WR5 should use `NOT is_early`. Everything else (m/r/u) is INT64.
2. The 365-day rate has no currency filter (the entry table has none), the other Customers tiles filter by the client currency. Identical for Manami; only matters for a multi-currency client.
3. Not owned, still says 36-month: `METRICS.md` lines 81, 155, 533, 682, 733 to 738 (data window docs). Orchestrator to decide.
4. Y1 weights use Y1-complete customers, not the whole cohort size as the design text says, because Y1 figures exist only for them (dividing by all customers would bias low).
5. Changing the grid ranges from "13 months" to "12 months" is a small extension of the design, a consequence of dropping the current month.
