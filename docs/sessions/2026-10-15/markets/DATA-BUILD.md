# Markets v1a: data build

Date: 2026-10-15. Data agent, branch `mk0-markets-spec`. Nothing committed, pushed or deployed. BigQuery writes only in `mart_qa` (prefix `mk_`).
Inputs: CONTRACT.md, SPEC.md, research/data-audit.md, research/research-ltgp-prediction.md (sections 2 and 6), migration 284 (commit 03072b7, QA objects `mart_qa.mm1_*`).

## 0. Contract changes (READ FIRST, UI agent)

CONTRACT.md is updated in place; every addition is marked **[+]** there. Summary:

| Object | Change | Kind |
|---|---|---|
| `mk_client_markets` | NEW config table: client_id, market, local_currency, is_home, note, updated_at, forecast_min_age_days. Sold markets, home market, local currency per market. | new |
| `mk_market_orders` | + `country` (ISO-2 before bucketing into OTHER), + `first_order_date`. `market_source` also takes `'billing'` (WooCommerce). | additive |
| `mk_market_spend_daily` | `allocation` also takes **`'none'`** (rows with market `UNALLOCATED`). `'pro_rata'` = the US & CA split. | **enum value added** |
| `mk_market_daily` | + new_customer_net_sales, returning_net_sales, new_customer_gross_profit, new_customer_costed_orders, costed_net_sales, meta_spend, google_spend. Market `UNALLOCATED` rows exist (spend only). `spend_base` NULL = no spend data that day for the client, 0 = no spend in that market. | additive |
| `mk_market_cohorts` | + costed_customers, first_order_revenue, as_of_date. **GP per customer = gp_N / costed_customers** (not / customers). | **semantics** |
| `mk_market_forecast` | + customers. Append-only (one run per run_date, read the latest). Quarterly rows: cohort_month = first month of the quarter. Band = P25..P75 curve + 0.84 SE (not P10..P90). | additive + semantics |

Derivations the UI should use: AOV new = new_customer_net_sales / new_customers; AOV returning = returning_net_sales / returning_orders; first-order GP = new_customer_gross_profit / new_customer_costed_orders; COGS % = cogs / costed_net_sales; nCAC = spend_base / new_customers (exclude market UNALLOCATED from market rows, show it as its own row); discount rate = discounts / gross_sales.

## 1. Objects

### Prod migrations (not deployed; target `mart` and `ref`)

| File | Creates | Pattern |
|---|---|---|
| `infra/bigquery/290_mk_market_orders.sql` | `ref.client_markets` (+ seed), `mart.sp_refresh_market_orders()`, `mart.market_orders` | snapshot table built by procedure (`__next`, checks, COPY swap), CALL at the end |
| `infra/bigquery/291_mk_market_spend.sql` | one new `ref.naming_rules` row (dimension `market_spend`), `mart.sp_refresh_market_spend()`, `mart.market_spend_daily` | same |
| `infra/bigquery/292_mk_market_daily.sql` | `mart.sp_refresh_market_daily()`, `mart.market_daily` | same |
| `infra/bigquery/293_mk_market_cohorts.sql` | `mart.sp_refresh_market_cohorts()`, `mart.market_cohorts` | same |
| `infra/bigquery/294_mk_market_forecast.sql` | `ref.client_markets.forecast_min_age_days`, `mart.sp_refresh_market_forecast()`, `mart.market_forecast` (append-only, partitioned by run_date), `mart.sp_refresh_markets()` (calls all five in order) | same; forecast is DELETE today + INSERT |

Tables, not views: every Markets object depends on `market_orders`, which reads the heavy stg views (Shopify payload JSON, Shoptet raw dedup). Each migration ends with the CALL of its own procedure so the next migration reads a built table (the snapshot trap of 279j/283).

### QA (all exist now in `mart_qa`, built by the generated QA copies)

QA copies: `infra/bigquery/qa/29{0..4}_mk_*_qa.sql`, generated from the prod files by name mapping only (`mart.market_*` to `mart_qa.mk_market_*`, `ref.client_markets` / `ref.naming_rules` to `mart_qa.mk_*`, `stg.stg_customer_orders` / `stg.stg_shoptet_orders` to `mart_qa.mm1_*` of migration 284). Regression: `qa/290_294_regression.sql`. Backtest: `qa/294_backtest.sql`.

| Object | Rows (2026-10-15) |
|---|---:|
| mk_client_markets | 9 |
| mk_naming_rules (copy of ref.naming_rules + the market_spend row) | 6 |
| mk_market_orders | 140,083 |
| mk_market_spend_daily | 6,228 |
| mk_market_daily | 13,006 |
| mk_market_cohorts | 520 |
| mk_market_forecast (1 run) | 89 |
| mk_bt_cohorts, mk_bt_predictions (backtest only) | 1,090 / 1,032 |
| procedures mk_sp_refresh_market_orders / _spend / _daily / _cohorts / _forecast, mk_sp_refresh_markets | 6 |

`CALL mart_qa.mk_sp_refresh_markets()` ran end to end (second build of every table: 90 % guard, swap and same-day forecast replace all exercised): 4.68 GB processed, about 70 s.

## 2. Column and rule notes

**Market (290).** Shopify shipping country; Woo billing country (`market_source = 'billing'`, F12 open); Shoptet per 284 (`delivery_country`/`pickup_postcode` = shipping, `currency`, `storefront_domain` = domain); no country: order currency (Shopify presentment currency) mapped through `mk_client_markets.local_currency`; last fallback `ref.clients.country`. Countries not in `mk_client_markets` are `OTHER`. Dobias home market is set to **US** (ref.clients says CA): owner to confirm.

**Excluded orders.** Non-shippable Shopify orders (no shipping country AND an amount: HairQ test NOSHIP, e-book, payment-only and reshipment draft orders, customs charges, subscription reactivation). Migrated Dobias orders without country and with NULL amounts are kept as history only.

**New customer.** First kept order per lower-cased email; ties resolved by stg's own flag. Differs from stg only where the first stg order was non-shippable (Dobias: CA +8 new customers in L12M).

**Spend (291, F3).** Google: GeoStats country per campaign-day (`geo`), residual vs stg (none today) falls to the name rule. Meta: all market tokens anywhere in the name, `~` added as delimiter; 1 market `campaign_name`; 2+ markets split by that day's new-customer share (`pro_rata`, 28-day share if the day has none, equal split if that is 0); no token: single-market client gets its market (`client_default`, Ethia), else `UNALLOCATED` (`none`). A check asserts the table total equals the stg Meta and Google totals per client (it does, to the crown). The existing `market` naming rule is untouched, so `mart_meta_campaign_dim` and the Paid pages do not change.

**Cohorts (293).** Ages are days since the first order (`order_date < first + N`). A column is NULL until the last customer of the month is N days old. GP sums cover `costed_customers` only (every order within 365 d costed). `cohort_spend` = all market spend in the cohort month; NULL if the client had no spend row that month.

**Forecast (294).** Repeat-only multiplier exactly as the contract: first-order GP actual + repeat GP at N x median(repeat GP365 / repeat GP_N) of the last 12 mature non-Q4 monthly cohorts (min 6); markets with 50 to 99 new customers a month use quarterly cohorts (last 8, min 3); under 50 no forecast; Nov/Dec (Q4 quarter) use the same period one year earlier. Two parameters came from the backtest (section 5): the band (P25..P75 + 0.84 SE) and `forecast_min_age_days` per market. Every young cohort gets a row; `method = 'none'` carries the reason (no COGS, volume, younger than 30 days, before the market's start age, too few references, Q4 without last year).

## 3. Today's forecast run (QA, run_date 2026-10-15)

| Market | Method | Forecast rows | Example |
|---|---|---|---|
| Dobias US | monthly, 12 refs | 2025-10 to 2026-07 (10) | 2026-07 cohort at day 60: actual 118.6, forecast 229.3 USD (band 192.5 to 259.0), m 6.27 |
| Dobias CA | quarterly, from day 180 | 2025Q4 (LY), 2026Q1 | 2026Q1 at day 180: actual 113.6, forecast 143.7 (130.4 to 157.1) |
| Manami CZ | monthly, 12 refs, from day 60 | 2025-10 to 2026-07 (10) | 2026-07 at day 60: actual 661.6, forecast 756.0 CZK (671.4 to 857.3) |
| Ethia CZ | quarterly, 3 refs, untested | 2026Q1, 2026Q2 | 2026Q2 at day 90: actual 848.0, forecast 1,089.8 (951.4 to 1,361.7) |
| RawBark CZ, SK | none | | no COGS (I10) |
| Manami SK, Venev CZ/SK | none | | under 50 new customers per month |

## 4. Regression vs the audit (verified L90 / L12M numbers)

Source: `qa/290_294_regression.sql` R1 to R3 on `mart_qa.mk_*`. "=" means identical to the audit.

| Client x market | Period | Orders | New cust | Net revenue | GP | Spend | nCAC |
|---|---|---|---|---|---|---|---|
| dobias US | L12M | 11,562 (audit 11,604) | 2,550 (2,551) | 1,775,819 (1,781,389) | = 1,374,588 | 44,735 (46,547 incl. US & CA) | n/a (spend from 2026-04-20) |
| dobias US | L90 | 3,006 (3,013) | 662 (663) | 452,218 (455,788) | = 351,156 | 27,390 (29,037) | 41.4 (43.8) |
| dobias CA | L12M | 4,642 (4,659) | 664 (656) | 625,830 (627,389) | = 450,023 | 26,513 (24,701) | n/a |
| dobias CA | L90 | = 1,352 | 245 (242) | = 193,183 | = 141,176 | 23,974 (22,326) | 97.9 (92.3) |
| dobias OTHER | L12M | = 166 | 69 (67) | = 36,263 | = 22,699 | = 0 | n/a |
| rawbark CZ | L12M | = 10,413 | = 1,627 | = 19,306,240 | n/a | 2,158,708 (1,955,451) | 1,326.8 (1,201.9) |
| rawbark CZ | L90 | = 2,288 | = 325 | = 4,245,712 | n/a | = 577,981 | = 1,778.4 |
| rawbark SK | L12M | = 1,912 | = 243 | = 3,520,400 | n/a | 414,958 (396,222) | 1,707.6 (1,630.5) |
| rawbark SK | L90 | = 393 | = 35 | = 721,097 | n/a | = 107,006 | = 3,057.3 |
| rawbark UNALLOCATED | L12M | | | | | 65,088 (287,082) | |
| ethia CZ | L12M / L90 | = 1,422 / 283 | = 908 / 147 | = 1,504,953 / 292,178 | = 1,061,456 / 215,587 | = 565,937 / 94,386 | = 623.3 / 642.1 |
| manami CZ | L12M / L90 | = 1,894 / 662 | = 1,571 / 542 | = 1,927,820 / 684,301 | = 1,262,026 / 444,880 | = 570,836 / 255,961 | = 363.4 / 472.3 |
| manami SK | L12M / L90 | = 347 / 71 | = 309 / 64 | = 339,436 / 71,960 | = 209,500 / 43,000 | = 115,260 / 29,851 | = 373.0 / 466.4 |
| manami UNALLOCATED | L12M | | | | | = 36,893 | |
| venev CZ | L12M / L90 | = 31 / 11 | = 27 / 9 | = 1,382 / 487 | = 967 / 353 | = 3,804 / 3,804 | = 140.9 / 422.7 |
| venev SK | L12M / L90 | = 23 / 8 | = 8 / 6 | = 992 / 317 | = 729 / 204 | = 139 / 139 | = 17.4 / 23.2 |

Gross sales, discounts, first-order GP and AOV new also match the audit wherever orders match (for example rawbark CZ L12M gross 20,280,745, discounts 1,487,331, AOV new 978.4; ethia first-order GP 715.5).

Every difference, explained:
1. **Dobias orders and revenue:** the non-shippable exclusion (audit I3) removes 42 US and 17 CA orders in L12M (7 US in L90, 3,570 USD), all with NULL COGS, so GP is unchanged. CA new customers +8 (L12M) / +3 (L90): customers whose first order was a non-shippable HairQ test now count as new on their first real order.
2. **F3, Dobias:** the US & CA campaigns are split by new-customer share instead of all to US: 1,812 USD (L12M) and 1,648 USD (L90) move from US to CA. L90 nCAC US 43.8 to 41.4 (-5 %), CA 92.3 to 97.9 (+6 %, of which +1,648 spend and +3 new customers).
3. **F3, RawBark:** `~` as a delimiter recovers 221,994 CZK of L12M Meta spend from UNALLOCATED (the 7 legacy `PER_..._CZ~` / `_SK~` campaigns): CZ +203,257 (+10.4 %), SK +18,736 (+4.7 %). L12M nCAC CZ +10.4 %, SK +4.7 %. L90 is unchanged (none of those campaigns ran in L90). Remaining UNALLOCATED 65,088 CZK = `MIX~` remarketing and untagged campaigns (genuinely multi-market, shown not spread).
4. **Manami, Ethia, Venev:** identical. The 284 market rule moves 6 CZK orders to SK, all dated Aug to Sep 2025, before both windows.

Cohorts (R3, audit A3 day windows): Ethia identical (976 / 1,008 / 369 customers; LTGP:CAC 1.54 / 1.94 / 2.72). RawBark identical (customers, repeat rate, revenue per customer). Dobias US 365 d 3,310 customers (3,368), repeat 43.0 % (42.4), GP/cust 215.0 (=); CA 365 d 521 (529), GP/cust 166.9 (161.8): same two causes as above. Manami SK 90 d 322 customers (317) and CZ 1,180 (1,185): the 284 postcode rule reassigns 5 first orders. Cohort CAC in the mart excludes UNALLOCATED (the audit spread it pro rata): Manami CZ 90 d 272.9 (308.1 in the audit). Cohort CAC is only valid where spend covers the whole window: Dobias (spend from 2026-04-20), Manami 180/365 d (spend from 2025-05) and RawBark Google (from 2025-09) produce lower-bound CACs and must show n/a or "lower bound" in the UI.

## 5. Backtest (research-ltgp-prediction.md section 6)

Cohorts Jan 2024 to Sep 2025, checkpoints N = 30/60/90/180, frozen at cohort end + N - 1 (only references whose 365 d window had closed at the freeze date; the target contributes only its day-N actuals). Predicted: GP365 per customer. P = the shipped rule, B0 = naive (GP365 of the most recent mature cohort), coverage = the shipped band. k = number of target cohorts. RawBark has no COGS, so it is backtested on revenue (information for when F7 lands).

| Market (grain) | N | k | P MAPE | P median APE | P bias | B0 MAPE | Band coverage | Band width |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Dobias US (monthly) | 30 | 0 | not testable (US data from 2024-05) | | | | | |
| | 60 | 1 | 15.3 % | 15.3 % | +15.3 % | 46.3 % | 100 % | 29 % |
| | 90 | 3 | 19.1 % | 19.0 % | +19.1 % | 39.9 % | 100 % | 30 % |
| | 180 | 7 | 3.2 % | 2.0 % | +1.0 % | 33.3 % | 100 % | 19 % |
| Dobias CA (quarterly) | 30 | 7 | 22.1 % | 20.8 % | +15.3 % | **7.7 %** | 71 % | 52 % |
| | 60 | 7 | 17.3 % | 12.6 % | +10.5 % | **7.7 %** | 86 % | 38 % |
| | 90 | 7 | 9.3 % | 11.2 % | +4.4 % | **8.0 %** | 100 % | 32 % |
| | 180 | 7 | 2.1 % | 1.2 % | +1.3 % | 7.8 % | 100 % | 27 % |
| Dobias CA (monthly, info) | 30 / 60 / 90 / 180 | 21 | 40.3 / 19.6 / 16.3 / 6.0 % | | +7 / +9 / +5 / +4 % | 22.7 / 19.6 / 18.7 / 18.3 % | | |
| Manami CZ (monthly) | 60 | 1 | 8.7 % | 8.7 % | +8.7 % | 49.6 % | 100 % | 40 % |
| | 90 | 2 | 8.9 % | 6.0 % | -2.9 % | 32.0 % | 100 % | 35 % |
| | 180 | 5 | 5.4 % | 4.7 % | -4.3 % | 19.2 % | 100 % | 35 % |
| Ethia CZ | all | 0 | not testable: shop from 2025-03, no cohort was mature before 2026-03 | | | | | |
| Manami SK, Venev | all | | not run: under 50 new customers per month, no forecast by rule | | | | | |
| RawBark CZ revenue (monthly) | 30 | 18 | 9.4 % | 7.4 % | -0.8 % | 32.0 % | 83 % | 31 % |
| | 60 | 19 | 6.9 % | 6.4 % | +4.1 % | 27.7 % | 74 % | 19 % |
| | 90 | 19 | 6.8 % | 7.3 % | +4.3 % | 25.0 % | 74 % | 20 % |
| | 180 | 21 | 3.0 % | 2.7 % | +2.3 % | 19.2 % | 100 % | 14 % |
| RawBark SK revenue (monthly) | 30 | 13 | 18.6 % | 20.8 % | +8.5 % | 30.7 % | 92 % | 80 % |
| | 60 | 14 | 15.3 % | 10.8 % | +12.2 % | 36.4 % | 86 % | 51 % |
| | 90 | 16 | 13.3 % | 10.5 % | +8.4 % | 30.5 % | 88 % | 45 % |
| | 180 | 20 | 9.5 % | 8.8 % | +0.7 % | 29.1 % | 100 % | 42 % |

Other findings:
- **Variants.** Median of the last 6 (A1) and ratio of sums of the last 12 (A2) land mostly within 1 to 4 pp of the shipped median of 12 at the production grains, no consistent winner; the contract's median stays. Excluding the first 6 months of a market's history from the references changed MAPE by -7 to +7 pp, mixed; not adopted.
- **Q4.** Same-period-last-year beat the pooled multiplier on Q4 cohorts in about 60 % of the cells, but every cell holds only 1 or 2 Q4 cohorts: low evidence, flagged by `n_reference_cohorts = 1`.
- **Bias.** The multiplier over-forecasts slightly at early ages (+4 to +15 %). The naive baseline is biased up much more for Dobias US and Manami (+33 to +50 %) because their first data months count long-time customers as new (I14).
- **Band.** The research draft's band (P10..P90 curve + 1.28 SE) covered 95 to 100 % with widths up to 146 % at day 30: too wide to use. Shipped: P25..P75 + 0.84 SE, 71 to 100 % coverage (pooled about 85 %), widths 14 to 53 % (80 % at day 30 on RawBark SK).

**Verdict per market (decision rule of section 6: forecast from the first N where P beats B0 by at least 5 pp):**

| Market | Verdict | forecast_min_age_days |
|---|---|---:|
| Dobias US | Forecast from day 60. Beats naive by 20 to 30 pp, but only 1 to 7 testable cohorts. Directional. | 60 |
| Dobias CA | Forecast only from day 180. CA cohorts are so stable that the last mature cohort beats the multiplier up to day 90. | 180 |
| Manami CZ | Forecast from day 60. 1 to 5 testable cohorts; 3 of today's 12 references are from the first months of data history (I14). Directional. | 60 |
| Ethia CZ | Not testable. Ships quarterly on 3 references from day 90 (default); label "untested". Owner may prefer to switch it off until 2026Q2 is mature. | 90 (default) |
| RawBark CZ, SK | method 'none' (no COGS). On revenue the method works from day 30 (CZ 9 % vs 32 % naive); turn on when F7 lands. | 30 |
| Manami SK, Venev | method 'none' (volume). | n/a |

## 6. To deploy (each step needs owner OK, in this order)

1. **Migration 284** (`mm1-shoptet-market`, Manami market): prerequisite; 290 reads `stg_customer_orders.country_source`.
2. **290**: creates `ref.client_markets` (new ref table; confirm Dobias home = US) and `mart.market_orders`.
3. **291**: inserts ONE row into `ref.naming_rules` (dimension `market_spend`; existing rows untouched, Paid pages unchanged) and builds `mart.market_spend_daily`.
4. **292**, then **293**, then **294**, each ends with its CALL (do not reorder: each reads the previous table).
5. **Scheduler**: add `CALL oneeighty-warehouse.mart.sp_refresh_markets();` as the last line of `rpt_refresh_hourly`, or (recommended, cost) a separate daily scheduled query at 05:30 UTC. One run processes 4.7 GB (about 110 GB/day if hourly). Markets reads by day, so daily is enough.
6. Update `infra/bigquery/live/` (two ref tables, five mart tables, six procedures) and run `qa/290_294_regression.sql` against `mart`.
7. Switch the app: `MARKETS_SOURCE=mart`.

Owner decisions still open: Dobias home market (US); daily vs hourly refresh; whether Ethia's untested forecast ships; whether `–` (en dash) should also be a delimiter (one 2023 RawBark campaign "SK– Baštílci", 90,933 CZK, outside every current window).

## 7. Known limits carried into the marts

Dobias Meta spend only from 2026-04-20 and no Google (I7): L12M nCAC and cohort CAC are lower bounds, UI must show n/a. CAD FX ends 2026-05 (I5): Dobias CA `fx_local_to_base` NULL after that, local toggle n/a. Dobias refunds NULL (I6). Manami: no gross sales, discounts, refunds, shipping (NULL, not 0); discount flag is a lower bound. Woo market is billing country (F12). Dobias COGS at current product cost (I20) also enters the backtest. Spend has no Sklik and no Meta country breakdown (F4).
