# FX fix: stale and missing rates in ref.fx_rates

Date: 2026-10-15. Branch: mk0-markets-spec. Status: prepared, NOT applied to prod, nothing committed.
BigQuery `oneeighty-warehouse`, read-only queries only (INFORMATION_SCHEMA, ref, stg, mart). No `mart_qa.fx1_*` objects were needed: the effect of the fix is simulated inline with the new rates as a CTE.

Files in this change set (all uncommitted in the worktree):

| File | What |
|---|---|
| `infra/bigquery/302_fx_rates_backfill.sql` | Two MERGE statements: A (new pairs and months, inserts only), B (October CNB refresh, optional). Verification queries at the bottom. |
| `infra/fx_rates_refresh.py` | Generator for the MERGE from public sources (CNB, Bank of Canada, ECB). Prints SQL, never touches BigQuery. This is also the standing refresh. |
| `runbooks/23_fx_rates_refresh.md` | Corrected: the "CAD is not urgent" claim was wrong, new pairs and sources, generic provisional check, data-driven gap check. |
| this file | Findings, numbers, approvals. |

## 1. How ref.fx_rates is refreshed today, and why CAD stopped

**There is no automation.** Every write to `ref.fx_rates` in the last 180 days (INFORMATION_SCHEMA.JOBS) is a hand-run MERGE or UPDATE by matej@oneeighty.cz through the BigQuery MCP:

| UTC | What |
|---|---|
| 2026-06-01 17:53 | migration 012: CAD to USD seed, 2022-06 to 2026-05, source tag `manual_entry_2026-05-25` |
| 2026-07-31 09:55 | USD to CZK (013 style) |
| 2026-08-03 14:40, 14:41 | EUR/CZK pairs (014 style) and a USD to CZK July UPDATE |
| 2026-09-21 21:20 | runbook 23 refresh (August final) |
| 2026-10-04 17:24 | migration 232 (September final, October provisional) |

No scheduled query, no stored procedure and no n8n workflow touches the table (n8n search for "fx" and "rate": 0 workflows; `infra/n8n/` has none; runbook 23 calls the n8n option "not built yet").

**Why CAD stopped in May.** CAD to USD was seeded once, with data to 2026-05, and was never part of the monthly routine, which only covers the CNB pairs (USD/CZK, EUR/CZK, CZK/EUR). Runbook 23 said it was "not currently urgent: no CAD-presentment order has landed since 2026-03". That was wrong. Dobias moved to the US store in 2026-03 and Shopify Markets presents Canadian customers in CAD, so `presentment_currency = 'CAD'` orders arrive daily (booked in USD shop money, so `stg_shopify_orders.fx_rate` is 1 and revenue never broke; only the local currency did). Nothing alerted because `ops.v_pipeline_alerts` (migration 233) derives the required pairs from `ref.clients` (client currency, Meta and Google currencies), and Dobias is USD everywhere. The CAD need lives only in `mart.market_orders.currency_local`, which no check watches.

Also checked: CNB rows in the table match the CNB site (USD and EUR, 2026-03 to 2026-09, compared value by value). EUR/CZK 2026-06 and 2026-07 are both 24.210 in the CNB file itself, not a copy error.

## 2. Which pairs the warehouse needs, and what is missing

Scan of currencies (all stg orders, `market_orders`, `ref.clients`):

| Source | Currencies |
|---|---|
| Shopify Dobias (base USD) | shop money USD; presentment CAD, EUR, GBP, CZK. Historic Matrixify shop money CAD |
| Shopify Venev (base EUR) | shop EUR; presentment CZK, GBP |
| Woo RawBark, Ethia (base CZK) | CZK, EUR |
| Shoptet Manami (base CZK) | CZK, EUR |
| Meta account currency | dobias USD, venev CZK, ethia CZK, rawbark CZK, manami n/a (null) |
| Google Ads currency | rawbark CZK, manami CZK |

`market_orders.fx_local_to_base` looks up local to base, else 1 / (base to local). Pairs needed and their state:

| Pair | Needed for | In table | Months with orders and no rate | Orders (with money) | Net sales (base) |
|---|---|---|---|---|---|
| CAD to USD | Dobias CA local currency | 2022-06 to 2026-05 | 2026-06, 07, 08, 09, 10 | 1,902 | USD 263,888.57 |
| EUR to USD | Dobias EUR presentment (OTHER market) | none | 2026-03 to 2026-10 (8) | 68 | USD 9,688.20 |
| GBP to USD | Dobias GBP presentment (31 OTHER, 1 CA) | none | 2026-04 to 2026-10 (7) | 32 | USD 6,527.61 |
| GBP to EUR | Venev GBP orders (OTHER) | none | 2025-05 to 2026-04 (4) | 4 | EUR 309.61 |
| USD to CZK, EUR to CZK, CZK to EUR | everything CZK | 2022-06 to 2026-10 | none; 2026-10 is provisional on 2 fixings from 2026-10-04 | | |
| CZK to USD (Dobias, 5 orders) | | covered by the inverse of USD to CZK | none | | |

CAD per month (Dobias CA, `market_orders`, money present, fx NULL):

| Month | Orders | Net sales USD |
|---|---|---|
| 2026-06 | 319 | 46,067.26 |
| 2026-07 | 386 | 49,194.55 |
| 2026-08 | 486 | 66,246.99 |
| 2026-09 | 414 | 59,250.47 |
| 2026-10 (to 15th) | 297 | 43,129.30 |
| Total | 1,902 | 263,888.57 |

The brief says 1,336 CAD orders; PRODUCTS.md says the same on the QA copy. Prod `mart.market_orders` was rebuilt today (max order date 2026-10-15) and holds 1,902 for 2026-06-01 to 2026-10-15. I could not reproduce 1,336 and use 1,902. All 1,902 are market CA.

Not in scope but found: **CAD to USD before 2022-06.** The migrated Canadian history has no rate, so 34,325 stg orders (2013-12 to 2022-05, CA$5.28M subtotal) have NULL USD amounts, of which 3,017 are visible in `mart.mart_orders` (2021-10-15 to 2022-05-31, all Dobias, `revenue` NULL). See section D.

## 3. The fix

### Sources and method (nothing invented)

| Pair | Source | Method |
|---|---|---|
| CAD to USD | Bank of Canada Valet, series FXCADUSD (USD per CAD), daily | Mean of the month's daily rates, 4 dp. Same source and method as the 012 seed. Check: it reproduces 46 of the 48 seeded months exactly; 2023-09 (0.7389 seeded, 0.7388) and 2025-03 (0.6964, 0.6965) differ by 0.0001. |
| EUR to USD | ECB euro foreign exchange reference rates, `eurofxref-hist` (units per EUR) | Mean of the month's daily rates, 6 dp |
| GBP to USD | same file | Mean of daily USD per EUR divided by GBP per EUR |
| GBP to EUR | same file | Mean of daily 1 / (GBP per EUR) |
| USD/EUR to CZK, CZK to EUR | CNB, unchanged runbook method | published monthly average (first table only), current month mean of daily fixings |

Why Bank of Canada and not ECB for CAD: continuity. The existing series is Bank of Canada and a source switch would put a step into the CAD history. The ECB cross (CAD per EUR over USD per EUR) is within 0.08 % of it for every month 2026-01 to 2026-10, so ECB for CAD would also be defensible; that is an owner choice.

Independent cross-check against Shopify's own conversion (payload presentment amount over shop-money amount, Dobias, by month):

| Month | CAD to USD (Shopify implied / new rate) | EUR to USD | GBP to USD |
|---|---|---|---|
| 2026-06 | 0.7112 / 0.7123 | 1.1505 / 1.1518 | 1.3271 / 1.3335 |
| 2026-07 | 0.7075 / 0.7089 | 1.1414 / 1.1417 | 1.3349 / 1.3371 |
| 2026-08 | 0.7207 / 0.7195 | 1.1603 / 1.1593 | 1.3515 / 1.3542 |
| 2026-09 | 0.7146 / 0.7163 | 1.1496 / 1.1513 | 1.3420 / 1.3417 |
| 2026-10 | 0.7018 / 0.7021 | 1.1204 / 1.1212 | 1.3224 / 1.3233 |

All within about 0.5 %.

### What 302 does

- **A. New pairs and months** (inserts only, 164 rows): CAD to USD 2026-06 to 2026-10 (5), EUR to USD, GBP to USD, GBP to EUR 2022-06 to 2026-10 (53 each, the same floor as the other pairs, so no future gap for older orders). 2026-10 rows are provisional (`boc_mtd_avg@2026-10-15`, `ecb_mtd_avg@2026-10-15`).
- **B. October CNB refresh** (optional, updates the 3 provisional October rows): USD to CZK 21.725 to 21.766, EUR to CZK 24.465 to 24.405, CZK to EUR 0.040874719 to 0.04097521, now on 11 daily fixings instead of 2. Effect on live CZK figures: October EUR orders move -0.25 %, about -371 CZK RawBark and -45 CZK Manami to date.
- The MERGE only updates rows whose source matches `%mtd_avg%`. No final row can change; verified with a read-only join of the generated keys against the table (all CAD, EUR/USD, GBP rows are new keys; the 3 CNB rows are the existing provisional ones).
- No "latest rate" fallback was added anywhere. A missing rate stays NULL (plan P0-5).
- Readers of the new pairs: `sp_refresh_market_orders` (290) only. `stg_shopify_orders` and the 213 ad-spend joins use other pairs (shop currency to client currency, ad currency to client currency), so their output is unchanged. Regression surface: `mart.market_orders` and `mart.market_order_lines` rows with a non-NULL `fx_local_to_base` today are unchanged (their pairs and months are not touched by A).

### How market_orders picks it up

`mart.market_orders` is a snapshot table rebuilt by `mart.sp_refresh_market_orders()`, which left-joins `ref.fx_rates` per order month. Today the tables were built by hand (created 2026-10-15) and the scheduled query `markets_refresh_daily` (ROLLOUT step 7) does not exist yet: no `sp_refresh_market*` CALL job in the last 4 days. So after A runs:

1. `CALL oneeighty-warehouse.mart.sp_refresh_markets();` (about 4.7 GB, about 70 s in QA). This rebuilds `market_orders` and then `market_order_lines` (299 hooked it into the entry point), plus spend, daily, cohorts and forecast. A cheaper variant is `CALL mart.sp_refresh_market_orders(); CALL mart.sp_refresh_market_order_lines();`.
2. From then on the daily 05:30 UTC scheduled query keeps it current, once the owner creates it.
3. Run Verify 3 and 4 at the bottom of 302.

A new month needs a new rate row before the first order of that month lands, or its orders have NULL `fx_local_to_base` until the next refresh. With the provisional-row design the October row already exists; the November row must be inserted on 1 November (section C automates this).

## 4. Impact once fixed (simulated read-only on today's prod data)

| What | Before | After |
|---|---|---|
| Dobias CA orders with local currency (CAD) | 0 of 1,902 since June | 1,902 of 1,902 |
| Dobias CA net sales in local currency | none | CA$370,289.61 (from USD 263,888.57) |
| Dobias CA product lines with CAD prices (Products page) | 0 of 4,896 | 4,896 lines, 27 products |
| Other orders gaining a rate | | Dobias EUR 68 orders (USD 9,688.20, EUR 8,379.26), Dobias GBP 32 (USD 6,527.61, GBP 4,877.81), Venev GBP 4 (EUR 309.61, GBP 264.63) |
| Total | | 2,006 orders, USD 280,104.38 plus EUR 309.61, 5,153 product lines |

Rates are fixed after A: orders with money and no rate afterwards are 0 (the 34,325 Dobias CAD orders still without a rate are the pre-2022-06 history with NULL money, nothing to convert).

Limit to know: local amounts are base divided by the monthly mean rate, so a CAD price is about 0.1 to 0.5 % away from what the customer was actually shown (Shopify Markets uses its own rate and rounding). The exact CAD amount exists in `payload_json` (`total_price_set.presentment_money`) for 100 % of orders in 2026-09 and 2026-10, 99 % in June, 85 % in July, 59 % in August, and almost none before. If exact CAD list prices matter for the Products page, the follow-up is to read the payload first and fall back to the rate (SPEC F8).

## 5. Sections the owner can accept or reject separately

### C. Automation (n8n, recommended, not built)

Goal: nobody has to remember. Model on `wf_klaviyo_to_bigquery`'s BigQuery branch.

1. **Schedule Trigger**: daily 07:00 UTC (daily, not monthly, so provisional rows keep moving and the first of the month is never missed; cost is negligible).
2. **HTTP Request x5** (no keys, plain GET): CNB `prumerne_mena.txt?mena=USD`, same with `EUR`, CNB `rok.txt?rok={{$now.year}}`, Bank of Canada `FXCADUSD/json?start_date={{first of month - 2}}`, ECB `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.csv` (CSV, no unzip; the script uses the zip, which works too).
3. **Code node**: port of `infra/fx_rates_refresh.py` (the parse and mean functions are 1:1; it only has to return the MERGE text). Assert the CNB header's third column is `leden` and stop at the blank line (the two-table trap). Fail the run on any assertion.
4. **BigQuery node** (Execute Query): the MERGE. Window: `--from` = two months back, so a missed run self-heals. The MERGE never touches a final row.
5. **Error path**: the existing failure notification pattern of the other `wf_*` workflows.
6. Needs: a service account with `bigquery.dataEditor` on dataset `ref` and `bigquery.jobUser`. `sa-n8n-writer` is known to lack stg read and mart write (ROLLOUT step 0); `ref` write has to be checked.
7. Add a data-driven alert so this class of hole cannot hide again: an `ops.v_pipeline_alerts` row per `(currency_local, currency_base)` pair in `mart.market_orders` with `net_sales` present and `fx_local_to_base` NULL in the last 35 days. The SQL is the check in runbook 23 (CAD section). Not written as a migration yet.

### D. CAD to USD before 2022-06 (separate decision, recommend not now)

Extending the CAD series back with Bank of Canada would turn NULL into revenue for Dobias history: 3,017 orders in `mart.mart_orders` (2021-10-15 to 2022-05-31, CA$530,665 subtotal, roughly USD 0.4M) and 31,146 older stg orders (2013-12 to 2021-09, CA$4.75M). That restates Dobias revenue, cohorts and LTV for years of published history, so it should be an explicit opt-in with a before/after diff, not a side effect of an FX fix. Markets is not blocked by it (those orders carry no money today and are kept as customer history only).

## 6. What needs owner approval

1. **Run 302 A** on prod: inserts 164 rows into `ref.fx_rates` (CAD to USD 2026-06 to 2026-10; EUR to USD, GBP to USD, GBP to EUR 2022-06 to 2026-10). Unlocks Dobias CA local currency and CAD prices for 1,902 orders and 4,896 lines.
2. **Run 302 B or skip it**: refreshes the October CNB provisional rows (small live move: about -0.25 % on October EUR to CZK).
3. **Source choice for CAD to USD**: Bank of Canada (recommended, matches the seed) or ECB cross.
4. **Trigger `CALL mart.sp_refresh_markets()`** after A, or create the `markets_refresh_daily` scheduled query (ROLLOUT step 7), which does it every day.
5. **Build the n8n refresh and alert (C)**, including the service account grant on `ref`.
6. **D**: leave CAD before 2022-06 empty (recommended) or approve a separate restate of Dobias history.
7. Commit of the four files above (runbook 23, `fx_rates_refresh.py`, 302, this document); nothing has been committed or pushed.
