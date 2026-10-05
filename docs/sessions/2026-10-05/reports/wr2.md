# WR2 report: Repurchase and item fixes (259, 260)

Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/wr2-repurchase-fixes`, branch `wr2-repurchase-fixes`, commit `f635d9f` (not pushed). Renumbered per brief: design 257 -> 259, design 258 -> 260.

## Files changed
- `infra/bigquery/259_stg_customer_items_shoptet_label.sql` (new)
- `infra/bigquery/260_stg_shoptet_items_status.sql` (new)
- `infra/bigquery/qa/259_regression.sql`, `qa/260_regression.sql` (new, queries and results)
- `infra/bigquery/live/stg.stg_customer_order_items.sql`, `live/stg.stg_shoptet_order_items.sql` (now the deployed text, md5 equal to live)
- `dashboard/app/(app)/repurchase/page.tsx`

## 259 (deployed to prod 2026-10-05)
- Based on the live definition (md5 `a7693fd7...` verified against the file before starting). Shoptet branch only: `product_key = COALESCE(NULLIF(item_code,''), item_name)`, `product_name` = latest `item_name` per (client_id, base item code, i.e. text before `/`) by `order_date DESC, order_code DESC, item_key DESC`, fallback `item_name`. `item_name` itself is unchanged.
- Candidates in mart_qa: `wr2_stg_customer_order_items`, `wr2_mart_customer_product_steps`, `wr2_mart_first_product_repeat`, `wr2_mart_product_journey`.
- Non-Shoptet clients: 0 and 0 in all four views. Caveats: `mart_first_product_repeat` differs for every client only in the last float digits of `avg_lifetime_orders` (AVG summation order), 0 and 0 once rounded or excluded. One run also showed Dobias rows differing both ways in steps/journey (equal counts); it vanished on three reruns including a Dobias-only compare (80,234 rows both sides, 0 and 0), so it is raw data loading between the two evaluations, not the change.
- Manami: only `product_key` and `product_name` differ (7,029 stg rows, 3,495 step rows; with those columns nulled the compare is 0 and 0, step counts unchanged).
- SKU 153: one row "Testovací sada všech parfémů", **974 customers, 149 repeaters** now (audit: 325 + 466 + 57 + 126 = 974, same total; repeaters 62 + 65 + 7 + 15 = 149). Latest first order 2026-04-07 (180 day maturity).
- Side effects of grouping by base code (label only): Manami "Tester" lines become "Vzorek parfému" (base 75), "Dárkové balení parfému" becomes "Dárkové balení" (base 78). Parfém NĚŽNÁ and the other perfumes keep their name; sizes of one base code share a label.
- Prod check after deploy: live md5 `a53af0b2c4187f5c207055e686b771fa` equals the file body; prod vs candidate 0 and 0.

## 260 (deployed to prod after 259)
- Based on the live definition (md5 `e1a2e2ef...`). Only the status filter changed to `NOT LIKE '%storno%' AND NOT IN ('cancelled','zrušeno')`, same as `stg_shoptet_orders`.
- Candidate chain `wr2b_*` in mart_qa: the changed view plus all 19 downstream views (3 stg, 16 mart), each repointed from live definitions; verified none still references a prod closure member.
- **Exactly 128 orders / 227 lines leave** (all manami, 7,040 -> 6,813 lines, statuses "Stornována" and "2. připomínka -> storno", CZK 130,297.98, 2024-05-06 to 2026-09-27). 0 lines added, 0 changed.
- `stg_shoptet_orders` (3,515 rows) and `stg_customer_orders` (139,389) are 0 and 0. Customer marts, KPI marts, `mart_orders`, `mart_order_gaps`: 0 and 0 (float-only noise in monthly_kpis, customer_cohorts, first_product_repeat, which also appears for non-Shoptet clients; 0 and 0 with float columns excluded).
- Deltas (Manami): Products and SKU lose 231 units, CZK 130,297.98 revenue, CZK 88,828.29 margin (product rows 4,362 -> 4,250, SKU rows 5,378 -> 5,246). Largest product drops: sample set -25,800, Parfém NĚŽNÁ -18,525, Pleťový olej Krásná -9,555. **Unit economics: no change** (7,004 units, 3,395,965.37 net sales), because that mart already inner joins `stg_shoptet_orders`; the design expected a delta, there is none.
- Prod check after deploy: live md5 `5508e5a8df5d6665335c3ab700c0ed27` equals the file body; 6,813 Manami lines; 0 lines with a storno status; 0 item orders missing from the order view; SKU 153 still 974 / 149.

## Repurchase page
- Removed the "X% of customers came back, lifetime" line and its `blendedRate` calculation. The green highlight on the repeat rate cell compared against that blended rate, so it is removed too (all rates now use the strong text colour). This is the one thing beyond the literal request; reversible if you want the highlight back against some other benchmark.
- "First product" tooltip now: "Customers whose first order is at least 180 days old. Repeat counts any later order. Grouped by product code." (180 from `MATURITY_DAYS`). It replaces the old text including the "fewer than 30 customers are left out" note (the `minCustomers = 30` rule in `lib/queries/journey.ts` is untouched).
- Copy gates on the page folder: 0 for em/en dash, border-dashed, bg-[#, dev vocabulary, client names, toLocaleString(), eyebrow=. `npx tsc --noEmit` exit 0, `npm run build` exit 0.

## mart_qa objects (left in place, prefix wr2_ and wr2b_)
- wr2_: `stg_customer_order_items`, `mart_customer_product_steps`, `mart_first_product_repeat`, `mart_product_journey`
- wr2b_: `stg_shoptet_order_items`, `stg_customer_order_items`, `stg_shoptet_orders`, `stg_customer_orders`, `mart_product_perf`, `mart_sku_perf`, `mart_unit_economics`, `mart_customer_product_steps`, `mart_daily_kpis`, `mart_orders`, `mart_customer_cohort_grid`, `mart_customer_daily`, `mart_customer_lifetime`, `mart_customer_market_daily`, `mart_customer_payback`, `mart_first_product_repeat`, `mart_monthly_kpis`, `mart_order_gaps`, `mart_product_journey`, `mart_customer_cohorts`
- All views, no storage. They can be dropped once the work is merged.

## Rollback
Previous live text, saved to `.../scratchpad/rollback/`:
- `stg.stg_customer_order_items.pre259.sql`
- `stg.stg_shoptet_order_items.pre260.sql`
Each is a complete `CREATE OR REPLACE VIEW`. Rolling back 259 only changes labels back; rolling back 260 puts the 128 orders back at item level.

## Open issues and requests to orchestrator
- The pending-deploy section of `live/README.md` does not mention 259/260 (not owned by WR2). The two live files are already the deployed text and the md5 equals live.
- Orchestrator checks: Repurchase page for Manami in a browser (the table should show one "Testovací sada všech parfémů" row), and Products / SKU for Manami will read CZK 130k lower than before today.
- The transient Dobias differences above suggest `stg_shopify_order_items` or its dedupe has non-deterministic ties on live data. Not investigated, outside WR2.
