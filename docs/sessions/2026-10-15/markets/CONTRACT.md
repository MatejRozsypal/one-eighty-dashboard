# Markets v1a: build contract (data <-> UI)

Owner decisions 2026-10-15 (after the proposal):
- Design: **Option A Atlas** (map hero + leaderboard, P&L matrix, side drawer per market, Scouting view), built in the dashboard's CURRENT visual style: the Health skin (`oe-health` on <html>, white background, white cards, hairline border, layered shadow), using only existing tokens and `components/ui` (Card, DataTable, Delta, DeltaMode, Badge, InfoTip, EmptyState, Skeleton, Sparkline, ChartSummary). No new colours, radii or fonts in components. The proposal mockup's grey canvas is NOT the target.
- Forecast: **Option A maturity multiplier** (repeat-only, median of last 6 to 12 mature non-Q4 cohorts per market, Nov/Dec cohorts use same-month-last-year ratio, quarterly cohorts for small markets, no forecast before day 30 or for markets under ~50 new customers/month). BG/NBD is out for now.
- Not yet approved: prod DDL, deploy, push to main. BQ writes only in `mart_qa` with prefix `mk_`. Migrations 290 to 299.

## Tables (QA names; prod names drop the `mk_` prefix and live in `mart`)

> **DATA BUILD AMENDMENTS 2026-10-15 (data agent, see DATA-BUILD.md section 0).** All changes are additive except two semantics a UI must respect: (1) cohort and forecast GP per customer divide by `costed_customers` / `customers` of the costed set, NOT by all cohort customers; (2) `mk_market_spend_daily.allocation` also takes `'none'` (the UNALLOCATED rows). New config table `mart_qa.mk_client_markets` (prod `ref.client_markets`). Added columns are marked **[+]** below.

### `mart_qa.mk_client_markets` [+] (new, one row per client x sold market)
client_id, market, local_currency, is_home (BOOL, index base / CM2 reference), note, updated_at, forecast_min_age_days (first age the forecast is shown; NULL = 90). Sold markets = rows here; every other country is market 'OTHER'. A client with one row is single-market.

### `mart_qa.mk_market_orders` (one row per order, the base everything else reads)
client_id, order_id, order_date, platform, market (ISO-2 or 'OTHER'), market_source ('shipping' | 'billing' | 'currency' | 'domain' | 'client_default'), customer_key, is_new_customer (BOOL), first_order_market (frozen market of the customer's first order), currency_base, currency_local, fx_local_to_base, gross_sales, discounts, refunds, net_sales, shipping_charged, net_revenue, cogs (NULL when not costed), gross_profit (net_sales - cogs, NULL if cogs NULL), is_discounted (BOOL), payment_method, is_cod (BOOL), is_zero_shipping (BOOL).
**[+]** country (ISO-2 before bucketing into OTHER, for scouting), first_order_date (frozen, cohort key). market_source also takes 'billing' (WooCommerce, no shipping address ingested).
All money in base currency ex VAT; `*_local` = value / fx where needed (UI toggle). Reads stg only (raw is duplicated). Excludes cancelled and non-shippable orders (gift cards, payment-only, tests). Market chain: shipping country, then currency, then domain; Shoptet per migration 284 (branch `mm1-shoptet-market`).

### `mart_qa.mk_market_spend_daily`
client_id, date, market, platform ('meta' | 'google'), spend_base, spend_local, allocation ('geo' | 'campaign_name' | 'client_default' | 'pro_rata'). Rule (F3): Google from GeoStats country; Meta from campaign-name market token found anywhere in the name with `~` added as a delimiter; "US & CA" campaigns split by new-customer share of the two markets that day; single-market clients use the client country; leftover unallocated spend kept as market = 'UNALLOCATED' (UI shows it, never silently spreads it).
**[+]** allocation = 'none' on UNALLOCATED rows; 'pro_rata' = the US & CA split. spend_local NULL for OTHER / UNALLOCATED and where no FX rate exists.

### `mart_qa.mk_market_daily`
client_id, date, market, orders, new_customers, returning_orders, gross_sales, discounts, refunds, net_sales, net_revenue, new_customer_revenue, returning_revenue, cogs, gross_profit, costed_orders, discounted_orders, cod_orders, zero_shipping_orders, shipping_charged, spend_base. Period metrics (AOV new/ret, discount rate, nCAC, MER, aMER, GP after ads, first-order GP) are derived in the query layer from these sums.
**[+]** new_customer_net_sales, returning_net_sales (AOV on net sales), new_customer_gross_profit, new_customer_costed_orders (first-order GP = new_customer_gross_profit / new_customer_costed_orders), costed_net_sales (COGS % = cogs / costed_net_sales), meta_spend, google_spend. Rows with market 'UNALLOCATED' carry spend only. spend_base NULL = the client had no spend data that day (ad history not started), 0 = no spend in that market. gross_sales / discounts / refunds / shipping_charged NULL = not available (Manami; Dobias refunds).

### `mart_qa.mk_market_cohorts`
client_id, first_order_market, cohort_month, customers, then for age_days IN (30, 60, 90, 180, 365): repeat_customers_N, revenue_N, gp_N (cumulative per cohort, NULL if the cohort has not reached the age as of the data's last complete day), cohort_spend (market spend inside the cohort month), first_order_gp.
**[+]** costed_customers (gp_N and first_order_gp are sums over these; GP per customer = gp_N / costed_customers), first_order_revenue, as_of_date (last complete day used for maturity). cohort_spend NULL when the client has no spend row that month; a partly covered month (Dobias 2026-04) is a lower bound, check day coverage in mk_market_daily (spend_base NULL days).

### `mart_qa.mk_market_forecast`
client_id, first_order_market, cohort_month, as_of_age_days, actual_gp_per_customer, forecast_gp365_per_customer, band_low, band_high, multiplier, n_reference_cohorts, method ('multiplier_monthly' | 'multiplier_quarterly' | 'none'), reason_if_none, run_date. Never mixed into actuals or verdicts.
**[+]** customers (costed customers the per-customer values use). Append-only: read `WHERE run_date = (SELECT MAX(run_date) ...)`. For 'multiplier_quarterly' cohort_month is the first month of the quarter. Band = curve P25..P75 + 0.84 SE (backtest-calibrated, about 80 to 90 % coverage). n_reference_cohorts = 1 means a Q4 cohort on its same-period-last-year ratio.

## UI contract
- Route `/markets`, nav item "Markets" with its own icon (sidebar icons stay), capability = any shop platform.
- Query layer `lib/queries/markets.ts` with a demo fixture `lib/demo/markets.ts` (demo mode must render the whole page without BQ, so it can be verified locally).
- Source switch like `KPIS_SOURCE`: env `MARKETS_SOURCE` = 'mart_qa' | 'mart' (default 'mart_qa' until prod OK).
- Period picker + Compare (Prev period / Prev year / None) + delta mode (% | 123) behave like the rest of the app. Currency toggle base / local.
- n/a glyph `n/a` with the reason in InfoTip. No em dashes. No filler subtitles or dev notes in UI.
- Status chip + maturity badge per SPEC section 4; rules run "on CM1" while CM2 is n/a.
- Map: d3-geo + topojson world outlines bundled in the app (npm `world-atlas` JSON imported at build time, not fetched at runtime), framed to the client's markets.
