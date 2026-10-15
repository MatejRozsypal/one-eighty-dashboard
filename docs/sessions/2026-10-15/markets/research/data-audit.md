# Markets page: data audit (BigQuery `oneeighty-warehouse`, read-only)

Run date: 2026-10-15. Last complete day used: 2026-10-14.
Periods: L12M = 2025-10-15..2026-10-14, P12M = 2024-10-15..2025-10-14, L90 = 2026-07-17..2026-10-14, P90 = 2026-04-18..2026-07-16.
Base currency per client (ref.clients.currency): dobias USD, rawbark CZK, ethia CZK, manami CZK, venev EUR. Every money figure below is in that base currency unless stated.
Market rule used in this audit: shipping country (Shopify `shipping_country`; Woo `billing_country`, see issue I2), fallback currency (CZK to CZ, EUR to SK for manami/rawbark, CAD to CA, USD to US). Domain fallback was not needed and is not available as a column.

## 0. Day-one verdict

| Client | Markets | Can show day one | Blocked / caveat |
|---|---|---|---|
| dobias (USD) | US, CA, OTHER | orders, new customers, gross/discounts, net revenue, AOV new vs returning, COGS %, GP, first-order GP, cohort repeat and GP at 90/180/365 d, refund ORDER rate; L90/P90 nCAC and MER | 12M nCAC and every true LTGP:CAC (Meta only from 2026-04-20, no Google); refund amounts; discount type split and payment mix only since 2026-05; CA local currency (CAD) needs payload presentment amounts or FX (CAD>USD ends 2026-05); "US & CA" campaigns need a split rule |
| rawbark (CZK) | CZ, SK | volume, discounts (code vs fee-line automatic), net revenue, AOV, repeat, revenue per customer cohorts, L90/P90/L12M nCAC and MER (Meta names + Google GeoStats), payment mix, zero-shipping share | anything GP: no COGS at all; refunds read 0; market is billing country |
| ethia (CZK) | CZ only | full order economics incl. GP and LTGP:CAC at 90/180/365 d (2.72 at 365 d on 2025 cohorts) | Meta spend allocated by client-country fallback (no tokens); a markets page adds little (single market) |
| manami (CZK) | CZ, SK via currency fallback | orders, net revenue, AOV, COGS %, GP, first-order GP, cohorts, nCAC/MER L90 and L12M, COD/payment mix | shipping country (other session), discount amounts, gross sales, refunds, shipping charged; 365 d CAC (spend starts 2025-05-07) |
| venev (EUR) | CZ, SK | counts and euros | sample too small for ratios; hide below a minimum n |

Cross-client blockers: shipping cost, payment fees, delivery time and compare-at history exist nowhere; ref.industry_benchmarks is empty; GA4 traffic/scouting exists only for Dobias and Manami for 2026-08-03..2026-10-03.

---

## 1. Coverage matrix (client x input)

Legend: OK = usable for v1; PARTIAL = usable with a caveat or for a recent window only; NO = not in the warehouse.
% figures are share of L12M orders (stg, deduped) unless stated.

| Input | dobias (Shopify) | rawbark (Woo) | ethia (Woo) | manami (Shoptet) | venev (Shopify) | Where |
|---|---|---|---|---|---|---|
| Market = shipping country | OK 99.6 % (60 blank = gift cards, reshipment payments, e-book, tests) | PARTIAL 100 % but it is BILLING country, no shipping address ingested | PARTIAL 100 % billing country | NO 0 % (NULL, fixed in another session); currency fallback CZK/EUR covers 100 % | OK 100 % | stg.stg_shopify_orders.shipping_country, stg.stg_woo_orders.shipping_country (= raw billing_country) |
| Order currency (local) | PARTIAL: `presentment_currency` 100 %; presentment AMOUNTS only in payload (from 2026-05, full from 2026-09). CA orders since the 2026-03 migration are booked in USD shop money | OK `currency_original` (CZK/EUR) 100 % | OK (CZK only) | OK `currency` + `exchangeRate` 100 % | OK (EUR shop, CZK presentment on CZ orders) | stg *_orders.currency_original, raw_shopify_orders.payload_json |
| FX table | PARTIAL: CAD>USD 2022-06..2026-05 only (stale 5 months), no USD>CAD, GBP, EUR>USD | OK EUR<>CZK 2022-06..2026-10 | n/a | OK | OK EUR<>CZK | ref.fx_rates (monthly) |
| COGS per SKU | OK 99.5 % of orders costed (line cost from product unit cost, current not at-order; product snapshot stale 2026-05-19) | NO 0 % (no Woo line cost, no ref.product_costs rows) | OK 100 % (cost stamped on Woo lines) | OK 100 % (Shoptet purchase price; 4.5 % of lines imputed) | OK 96.8 % (ref.product_costs, 14 rows, CZK) | stg.stg_customer_order_items.line_cost, ref.product_costs |
| Discount amount | OK 100 % `total_discounts` | OK 100 % (coupon `discount_total` + negative fee lines) | OK 100 % | NO amount; only line `discount_pct` flag (5.4 % of CZ orders) | OK 100 % | stg_shopify_orders.total_discounts, stg_woo_orders.total_discounts / fee_discounts, stg_shoptet_order_items.discount_pct |
| Discount split by type (code / automatic / script / manual / shipping) | PARTIAL: payload `discount_applications` only from 2026-05 (40 % of L12M orders, 100 % from 2026-09) | OK: code = `coupon_codes`/discount_total, automatic = fee lines (loyalty, tlapky, bundle) | OK same | NO | PARTIAL (payload from 2026-06) | raw_shopify_orders.payload_json, stg_woo_orders.coupon_codes, fee_discounts |
| Compare-at / regular price (markdowns) | NO history; current snapshot only (24 of 215 variants have compareAtPrice, 2026-05-19) | NO (regular_price not ingested) | NO | NO | NO history (5 of 13 variants, 2026-07-31) | raw.raw_shopify_products |
| Free shipping as discount | PARTIAL: shipping-line automatic discounts in payload from 2026-05 (477 orders) | PARTIAL: zero-shipping share 100 % (shipping_total = 0), threshold value not stored | PARTIAL same | NO (shipping not separable) | PARTIAL | payload / stg_woo_orders.total_shipping |
| Shipping charged | OK 100 % | OK 100 % | OK 100 % | NO (order total includes shipping + payment fee, no split) | OK 100 % | total_shipping |
| Shipping cost (carrier) | NO | NO (column `shipping_cost` exists, 0 % filled) | NO (0 %) | NO | NO | stg_woo_orders.shipping_cost, packaging_cost |
| Payment method / COD | PARTIAL: `payment_gateway_names` in payload from 2026-05 (shopify_payments 87 %, paypal 10 %, gift card, Afterpay) | OK 99.8 % (GoPay card, bacs; no COD) | OK 100 % (Comgate card/Apple/Google Pay/bank) | OK 100 % (`payment_method`, `cashOnDelivery`; COD 20 % CZ, 39 % SK in L90) | PARTIAL (payload from 2026-06) | payment_method columns |
| Transaction / gateway fees | NO | NO (`gateway_fee`, `cod_fee` 0 % filled) | NO | NO | NO | n/a |
| Refunds | PARTIAL: `total_refunded` NULL on 100 % of orders; refund FLAG via `financial_status` (REFUNDED/PARTIALLY_REFUNDED) 100 %; refund amounts in payload `refunds[]` from 2026-05 | PARTIAL: `refunds_total` 100 % populated but 0 refunds in 12 months (suspicious) | OK (7 refunded orders L12M) | NO (only cancelled orders excluded) | OK (`total_refunded` present) | stg_shopify_orders.financial_status / total_refunded, stg_woo_orders.total_refunded |
| VAT / tax | OK `total_tax`, taxes excluded | OK `total_tax`, revenue ex tax | OK | OK in effect: non VAT payer, WithVat = WithoutVat | OK (taxes_included netted by net_factor) | total_tax |
| Customer id / email (new vs returning) | OK 99.99 % email; history from 2013 (CA migrated + US) | OK 100 %; history from 2022-10-01 | OK 100 %; shop history from 2025-03-02 | OK 99.4 %; history only from 2024-05-06 (new counts inflated before ~2025) | OK 98 %; from 2022-07 | stg_customer_orders.customer_key |
| Meta spend by country | NO country breakdown table (only age/gender `raw_meta_ad_breakdown_demo` and placement). Campaign-name market: 100 % of L12M spend (but 6.7k USD of "US & CA" campaigns tagged US) | campaign-name: 76 % of L12M spend, 100 % of L90 | 0 % (no market token; single-market client, allocate to CZ) | 94 % L12M, 100 % L90 | 63 % L12M, 100 % L90 | mart.mart_meta_campaign_dim.market (ref.naming_rules + ref.campaign_overrides) |
| Meta spend history | PARTIAL: only from 2026-04-20 (nothing before in stg) | OK from 2023-09-12 | OK from 2025-02-20 | OK from 2025-05-07 | OK from 2025-12-04 (account in CZK, converted) | stg.stg_meta_campaign_insights |
| Google Ads geo spend | NO Google in warehouse (has_gads false) | OK: GeoStats by country criterion, reconciles 100 % with stg, from 2025-09-01 | NO Google | OK GeoStats, 100 % CZ, from 2025-10-01 | NO Google | raw_google_ads.ads_GeoStats_9406261058 / _5865960448 |
| Sklik / Heureka / TikTok | NO | NO (Sklik integration blocked on owner token) | NO | NO | NO | not ingested |
| GA4 sessions by country | PARTIAL: 2026-08-03..2026-10-03 only (stg lags raw export, which runs to 2026-10-13) | NO GA4 | NO GA4 | PARTIAL same window | NO in practice (export only 4 days, 2026-08-04..08-19) | stg.ga4_sessions.country (English names, not ISO) |
| Delivery time | NO delivery timestamp. Fulfillment created_at in payload from 2026-05 | PARTIAL proxy: `date_completed_gmt` (status change, median 1.8 d) 99.7 %; `carrier_status_code` | PARTIAL proxy (median 4.4 d) | NO | NO | stg_woo_orders.date_completed_gmt |
| Campaign naming suffix (last token = ISO) | 0 of 8 campaigns (all end "OE"); market token is first field ("US I ...") | 5 of 18 end in CZ/SK; 7 legacy names use "_CZ~" which the rule misses | 0 of 12 | 0 of 16 (market is middle field "\| CZ \|"); rule finds 10 | 1 of 5 | see section 4 |
| ref.industry_benchmarks | EMPTY table (0 rows) for every vertical/market | EMPTY | EMPTY | EMPTY | EMPTY | ref.industry_benchmarks (ref.client_verticals has 5 rows) |
| Other fixed costs | ref.client_monthly_costs EMPTY | EMPTY | EMPTY | EMPTY | EMPTY | ref.client_monthly_costs |

Bottom line on the owner's LTGP definition (GP after COGS, shipping, payment fees, discounts, refunds): discounts are already netted in net sales for Shopify/Woo; COGS exists for 4 of 5 clients; shipping cost and payment fees exist for nobody; refunds are netted only for Woo (Shopify Dobias not). So day-one "LTGP" = product gross profit (net sales minus COGS), Dobias additionally not refund-netted.

---

## 2. Real numbers per client x market

Definitions used (all from `stg.stg_customer_orders` plus platform stg joins, SQL in appendix A):
- Orders: deduped, cancelled excluded (Woo: processing/completed/on-hold only; Shoptet: storno excluded).
- New customers = orders flagged `is_returning_customer = FALSE` (first order by lower-cased email inside the data history; see issue I14 for history start dates).
- Gross sales = net sales + discounts (Shopify: `subtotal_price + total_discounts`; Woo: `subtotal_ex_tax + fee_discounts + total_discounts`). All ex tax.
- Net revenue = the warehouse `revenue`: Shopify net sales + shipping ex tax, NOT refund-netted; Woo net sales + shipping ex tax minus net refunds; Shoptet total order value (non VAT payer, includes shipping and payment fee).
- COGS % = COGS / net sales on costed orders. GP = net sales minus COGS (product margin only: no shipping cost, payment fees, packaging; see section 1).
- Spend = Meta (campaign-name market) + Google (GeoStats country), converted to base currency. "incl. unalloc." spreads campaigns with no market token pro rata by new customers; it is labelled every time it is used.
- nCAC = market spend / new customers. MER = net revenue / market spend.
- Cohort GP/customer at H days = sum of GP of all orders within H days of the first order, for customers whose first order falls in the 12 months ending H days before 2026-10-14 (so every cohort is complete): H=90 cohorts 2025-07-17..2026-07-16, H=180 cohorts 2025-04-18..2026-04-17, H=365 cohorts 2024-10-15..2025-10-14. Market of a customer = market of the first order.
- Cohort CAC = all market spend inside the cohort window / cohort customers. LTGP:CAC = cohort GP per customer / cohort CAC. Target 3:1 at 365 d.

### 2.1 dobias (USD; Shopify; markets US, CA, OTHER)

| Market | Period | Orders | New cust | Gross sales | Discounts (% gross) | % orders discounted | Refunds | Net revenue | AOV new | AOV ret | COGS % | GP | 1st-order GP | Ad spend | nCAC | MER | Returning rev share |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| US | L12M | 11,604 | 2,551 | 1,965,921 | 257,825 (13.1 %) | 65.1 % | amount n/a; 271 orders (2.3 %) refunded/partial | 1,781,389 | 115.0 | 156.3 | 19.2 % | 1,374,588 | 91.7 | n/a (Meta only from 2026-04-20: 46,547 since) | n/a | n/a | 82.2 % |
| US | P12M | 11,032 | 3,368 | 1,954,520 | 253,591 (13.0 %) | 70.3 % | 269 orders (2.4 %) | 1,771,044 | 123.1 | 167.9 | 18.4 % | 1,372,521 | 99.6 | n/a (no spend data) | n/a | n/a | 74.9 % |
| US | L90 | 3,013 | 663 | 493,678 | 58,006 (11.7 %) | 67.0 % | 46 orders (1.5 %) | 455,788 | 111.1 | 154.0 | 18.7 % | 351,156 | 86.5 | 29,037 | 43.8 | 15.7 | 82.4 % |
| US | P90 | 2,845 | 609 | 485,077 | 58,884 (12.1 %) | 67.8 % | 75 orders (2.6 %) | 444,069 | 117.4 | 158.6 | 19.1 % | 343,773 | 93.8 | 17,510 (88 of 90 days) | 28.8 | 25.4 | 82.6 % |
| CA | L12M | 4,659 | 656 | 751,156 | 138,769 (18.5 %) | 78.0 % | 113 orders (2.4 %) | 627,389 | 98.8 | 136.8 | 26.1 % | 450,023 | 73.3 | n/a (CA campaigns only from 2026-06-26: 24,701 since) | n/a | n/a | 89.0 % |
| CA | P12M | 4,179 | 529 | 677,246 | 106,008 (15.7 %) | 76.2 % | 84 orders (2.0 %) | 589,104 | 101.6 | 141.9 | 24.1 % | 430,182 | 78.6 | n/a | n/a | n/a | 90.1 % |
| CA | L90 | 1,352 | 242 | 221,569 | 31,893 (14.4 %) | 82.2 % | 28 orders (2.1 %) | 193,183 | 101.4 | 148.8 | 25.3 % | 141,176 | 75.5 | 22,326 | 92.3 | 8.65 | 86.6 % |
| CA | P90 | 1,058 | 157 | 170,480 | 29,285 (17.2 %) | 81.3 % | 31 orders (2.9 %) | 144,536 | 96.4 | 139.9 | 26.5 % | 103,807 | 71.9 | 2,375 (21 days only) | 15.1 (not comparable) | 60.9 (not comparable) | 88.8 % |
| OTHER (GB, RS, IE, CH, ...) | L12M | 166 | 67 | 37,702 | 9,006 (23.9 %) | 82.5 % | 9 orders | 36,263 | 153.2 | 188.1 | 20.9 % | 22,699 | 123.3 | 0 (no campaigns) | n/a | n/a | 62.1 % |
| OTHER | L90 | 45 | 19 | 10,005 | 2,158 (21.6 %) | 84.4 % | 1 order | 9,996 | 152.7 | 190.2 | 20.8 % | 6,216 | 119.7 | 0 | n/a | n/a | 60.7 % |

Notes: US and CA rows include 42 (US) and 17 (CA) L12M orders with blank country assigned by currency fallback; these are non-shippable (gift cards, reshipment payments, e-book, tests, subscription reactivation) and should be excluded (issue I3). Market spend for US includes the "US & CA I RecipeMaker" and "US & CA I IndependenceDay" campaigns (6,688 USD L12M) which the naming rule tags US (issue I8). GP excludes 3PL shipping cost, payment fees and refunds.

Retention and cohorts (USD):

| Market | Horizon | Cohort customers | Repeat rate (2+ orders) | Revenue / cust | GP / cust | Cohort CAC | LTGP:CAC |
|---|---|---:|---:|---:|---:|---:|---|
| US | 90 d | 2,523 | 22.7 % | 164.1 | 122.5 | n/a (spend starts 2026-04-20, window starts 2025-07-17) | n/a; proxy GP90 / L90 nCAC = 2.8 |
| US | 180 d | 2,644 | 30.8 % | 199.3 | 148.6 | n/a | n/a |
| US | 365 d | 3,368 | 42.4 % | 282.6 | 215.0 | n/a | n/a; proxy GP365 (2024-25 cohorts) / L90 nCAC = 4.9 |
| CA | 90 d | 525 | 21.9 % | 133.4 | 93.0 | n/a | n/a; proxy GP90 / L90 nCAC = 1.0 |
| CA | 180 d | 485 | 31.1 % | 164.6 | 117.1 | n/a | n/a |
| CA | 365 d | 529 | 42.2 % | 226.2 | 161.8 | n/a | n/a; proxy GP365 / L90 nCAC = 1.75 |
| OTHER | 365 d | 56 | 41.1 % | 423.8 | 268.5 | no spend | n/a |

Proxies mix a mature 2024-25 cohort with today's CAC; they are labelled proxies and must not be shown as LTGP:CAC.

### 2.2 rawbark (CZK; Woo; markets CZ, SK by billing country)

| Market | Period | Orders | New cust | Gross sales | Discounts (% gross) | % orders discounted | Refunds | Net revenue | AOV new | AOV ret | COGS % | GP | 1st-order GP | Ad spend (Meta + Google) | nCAC | MER | Returning rev share |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|---|---|---:|---:|---:|---:|
| CZ | L12M | 10,413 | 1,627 | 20,280,745 | 1,487,331 (7.3 %) | 53.7 % | 0 (0 orders, suspicious, I11) | 19,306,240 | 978.4 | 1,957.8 | n/a (no COGS) | n/a | n/a | 1,955,451 (incl. unalloc. 2,205,228) | 1,201.9 (incl. unalloc. 1,355.4) | 9.87 (8.75) | 91.2 % |
| CZ | P12M | 14,143 | 3,714 | 26,067,299 | 1,175,330 (4.5 %) | 37.1 % | 0 | 25,549,259 | 1,060.9 | 2,009.0 | n/a | n/a | n/a | n/a (Google before 2025-09 not in warehouse; 1.23M Meta unallocated) | n/a | n/a | 83.7 % |
| CZ | L90 | 2,288 | 325 | 4,462,823 | 343,083 (7.7 %) | 58.6 % | 0 | 4,245,712 | 988.3 | 1,935.1 | n/a | n/a | n/a | 577,981 | 1,778.4 | 7.35 | 91.9 % |
| CZ | P90 | 2,475 | 405 | 4,886,975 | 444,064 (9.1 %) | 55.4 % | 0 | 4,583,180 | 919.9 | 1,966.3 | n/a | n/a | n/a | 509,757 | 1,258.7 | 8.99 | 91.2 % |
| SK | L12M | 1,912 | 243 | 3,626,752 | 263,093 (7.3 %) | 54.1 % | 0 | 3,520,400 | 1,129.4 | 1,850.9 | n/a | n/a | n/a | 396,222 (incl. unalloc. 433,527) | 1,630.5 (1,784.1) | 8.88 (8.12) | 91.4 % |
| SK | P12M | 2,210 | 567 | 3,835,504 | 82,101 (2.1 %) | 19.0 % | 0 | 3,927,560 | 1,220.4 | 1,863.3 | n/a | n/a | n/a | n/a | n/a | n/a | 81.0 % |
| SK | L90 | 393 | 35 | 748,366 | 63,405 (8.5 %) | 65.1 % | 0 | 721,097 | 1,099.1 | 1,805.8 | n/a | n/a | n/a | 107,006 | 3,057.3 | 6.74 | 93.9 % |
| SK | P90 | 408 | 45 | 818,682 | 59,593 (7.3 %) | 59.8 % | 0 | 794,141 | 1,105.2 | 1,954.1 | n/a | n/a | n/a | 115,174 | 2,559.4 | 6.90 | 93.0 % |

SK values are converted from EUR at the monthly ref.fx_rates rate. 57 L12M orders pay in the "other" currency (35 CZ billing paying EUR, 22 SK billing paying CZK).

Retention (CZK; GP and LTGP blocked by missing COGS, revenue shown instead):

| Market | Horizon | Cohort customers | Repeat rate | Revenue / cust | GP / cust | Cohort CAC | LTGP:CAC |
|---|---|---:|---:|---:|---|---|---|
| CZ | 90 d | 2,150 | 27.9 % | 1,844.3 | n/a | n/a (563,694 Meta unallocated in window; Google geo from 2025-09-01 only) | n/a |
| CZ | 180 d | 2,550 | 34.7 % | 2,522.3 | n/a | n/a | n/a |
| CZ | 365 d | 3,714 | 40.6 % | 3,536.7 | n/a | n/a | n/a |
| SK | 90 d | 337 | 41.8 % | 2,412.4 | n/a | n/a | n/a |
| SK | 180 d | 436 | 51.6 % | 3,311.3 | n/a | n/a | n/a |
| SK | 365 d | 567 | 54.1 % | 4,696.2 | n/a | n/a | n/a |

### 2.3 ethia (CZK; Woo; single market CZ, shop live from 2025-03-02)

All Meta spend is unallocated by name (no market token); it is assigned to CZ because Ethia sold 1 non-CZ order in 12 months (client-country fallback, flagged).

| Market | Period | Orders | New cust | Gross sales | Discounts (% gross) | % orders discounted | Refunds | Net revenue | AOV new | AOV ret | COGS % | GP | 1st-order GP | Ad spend (Meta) | nCAC | MER | Returning rev share |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CZ | L12M | 1,422 | 908 | 1,527,177 | 63,581 (4.2 %) | 30.0 % | 4,965 (7 orders) | 1,504,953 | 981.3 | 1,114.0 | 27.5 % | 1,061,456 | 715.5 | 565,937 | 623.3 | 2.66 | 39.0 % |
| CZ | P12M | 421 | 369 | 407,551 | 10,709 (2.6 %) | 19.7 % | 1,272 (2) | 407,473 | 919.4 | 1,107.4 | 32.3 % | 268,743 | 617.9 | 139,738 | 378.7 | 2.92 | 14.3 % |
| CZ | L90 | 283 | 147 | 302,202 | 16,504 (5.5 %) | 36.0 % | 1,886 (4) | 292,178 | 883.1 | 1,146.2 | 24.5 % | 215,587 | 682.6 | 94,386 | 642.1 | 3.10 | 54.1 % |
| CZ | P90 | 253 | 103 | 284,227 | 15,501 (5.5 %) | 40.7 % | 1,927 (2) | 274,421 | 989.8 | 1,111.8 | 27.8 % | 194,119 | 713.2 | 94,801 | 920.4 | 2.89 | 62.3 % |

| Market | Horizon | Cohort customers | Repeat rate | Revenue / cust | GP / cust | Cohort CAC | LTGP:CAC |
|---|---|---:|---:|---:|---:|---:|---:|
| CZ | 90 d | 976 | 15.1 % | 1,244.1 | 855.4 | 555.1 | 1.54 |
| CZ | 180 d | 1,008 | 23.8 % | 1,418.4 | 974.2 | 502.4 | 1.94 |
| CZ | 365 d | 369 (cohorts 2025-03..2025-10 only) | 25.7 % | 1,536.7 | 1,028.8 | 378.7 | 2.72 |

### 2.4 manami (CZK; Shoptet; markets by currency fallback: CZK = CZ, EUR = SK)

Discount amount, gross sales and refunds are not available (section 1). "% orders discounted" = orders with at least one line `discount_pct > 0` (lower bound: coupon codes are not ingested).

| Market | Period | Orders | New cust | Gross sales | Discounts | % orders discounted (line flag) | Refunds | Net revenue | AOV new | AOV ret | COGS % | GP | 1st-order GP | Ad spend (Meta + Google) | nCAC | MER | Returning rev share |
|---|---|---:|---:|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CZ | L12M | 1,894 | 1,571 | n/a | n/a | 5.4 % | n/a | 1,927,820 | 852.3 | 1,599.0 | 31.3 % | 1,262,026 | 583.1 | 570,836 (incl. unalloc. 601,665) | 363.4 (383.0) | 3.38 (3.20) | 25.6 % |
| CZ | P12M | 791 | 638 | n/a | n/a | 14.2 % | n/a | 856,085 | 897.8 | 1,617.6 | 32.2 % | 554,134 | 605.4 | n/a (Meta from 2025-05-07, Google from 2025-10-01) | n/a | n/a | 29.4 % |
| CZ | L90 | 662 | 542 | n/a | n/a | 4.4 % | n/a | 684,301 | 844.5 | 1,666.4 | 31.7 % | 444,880 | 573.7 | 255,961 | 472.3 | 2.67 | 27.9 % |
| CZ | P90 | 628 | 533 | n/a | n/a | 7.3 % | n/a | 632,957 | 841.6 | 1,660.2 | 31.3 % | 414,154 | 570.8 | 230,278 | 432.0 | 2.75 | 24.3 % |
| SK | L12M | 347 | 309 | n/a | n/a | 1.7 % | n/a | 339,436 | 821.5 | 1,476.2 | 32.4 % | 209,500 | 555.7 | 115,260 (incl. unalloc. 121,324) | 373.0 (392.6) | 2.94 (2.80) | 16.0 % |
| SK | P12M | 167 | 152 | n/a | n/a | 3.0 % | n/a | 159,199 | 789.9 | 1,509.8 | 34.3 % | 93,698 | 516.0 | n/a | n/a | n/a | 15.0 % |
| SK | L90 | 71 | 64 | n/a | n/a | 2.8 % | n/a | 71,960 | 869.7 | 1,395.7 | 34.3 % | 43,000 | 568.2 | 29,851 | 466.4 | 2.41 | 13.8 % |
| SK | P90 | 70 | 59 | n/a | n/a | 4.3 % | n/a | 72,371 | 909.8 | 1,303.2 | 33.2 % | 45,423 | 606.9 | 24,319 (SK campaigns only 31 of 90 days) | 412.2 | 2.98 | 18.1 % |

Google spend is 100 % CZ by GeoStats (Google campaign names carry no market token).

| Market | Horizon | Cohort customers | Repeat rate | Revenue / cust | GP / cust | Cohort CAC | LTGP:CAC |
|---|---|---:|---:|---:|---:|---:|---|
| CZ | 90 d | 1,185 | 10.3 % | 1,100.1 | 722.1 | 308.1 (incl. unalloc. pro rata) | 2.34 |
| CZ | 180 d | 783 | 12.5 % | 1,159.5 | 763.2 | 189.9 (spend coverage starts 2025-05-07, Google 2025-10-01, likely understated) | 4.02 (treat as upper bound) |
| CZ | 365 d | 638 | 17.2 % | 1,309.9 | 845.9 | n/a (spend before 2025-05-07 absent) | n/a; proxy GP365 / L90 nCAC = 1.79 |
| SK | 90 d | 317 | 6.6 % | 1,014.5 | 618.5 | 367.2 (incl. unalloc.) | 1.68 |
| SK | 180 d | 262 | 8.4 % | 1,026.1 | 629.7 | 376.4 | 1.67 |
| SK | 365 d | 152 | 13.2 % | 1,130.6 | 675.6 | n/a | n/a; proxy = 1.45 |

### 2.5 venev (EUR; Shopify; genuinely small)

| Market | Period | Orders | New cust | Gross sales | Discounts (% gross) | % orders discounted | Refunds | Net revenue | AOV new | AOV ret | COGS % | GP | 1st-order GP | Ad spend (Meta, CZK account converted) | nCAC | MER |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CZ | L12M | 31 | 27 | 1,519 | 173 (11.4 %) | 45.2 % | 0 | 1,382 | 46.1 | 33.4 | 22.0 % | 967 | 35.3 | 3,804 (incl. unalloc. 5,550) | 140.9 (205.5) | 0.36 (0.25) |
| CZ | L90 | 11 | 9 | 511 | 29 (5.6 %) | 27.3 % | 0 | 487 | 47.8 | 52.3 | 26.9 % | 353 | 37.9 | 3,804 | 422.7 | 0.13 |
| SK | L12M | 23 | 8 | 1,098 | 139 (12.7 %) | 52.2 % | 0 | 992 | 40.8 | 42.2 | 19.2 % | 729 | 31.0 | 139 (incl. unalloc. 656) | 17.4 (82.0) | 7.14 (1.51) |
| SK | L90 | 8 | 6 | 323 | 15 (4.7 %) | 37.5 % | 0 | 317 | 42.6 | 26.4 | 19.0 % | 204 | 31.7 | 139 (SK campaign from 2026-10-06) | 23.2 | 2.28 |
| OTHER | L12M | 4 | 2 | 364 | 46 | 50.0 % | 0 | 344 | 42.8 | 116.0 | 27.1 % | 232 | 30.6 | 0 | n/a | n/a |

P12M/P90: CZ 1 and 4 orders, SK 63 and 2 orders, no Meta spend before 2025-12-04 (owner-confirmed zero days) and none in P90. Cohorts: 18 CZ and 5 SK customers in the 90 d window, 0 % repeat, GP90 34.0 (CZ) and 40.1 (SK) per customer; LTGP:CAC CZ (GP90 / L90 nCAC) = 0.08. Samples are too small for any market verdict; show counts, hide ratios below a minimum n.

---

## 3. Ops friction snapshot (L90, what exists today)

| Client x market | Payment mix (orders) | COD share | Zero-shipping orders (proxy for free-shipping threshold hit) | Avg shipping charged | Time to "completed" (proxy, not delivery) |
|---|---|---:|---:|---:|---:|
| rawbark CZ | GoPay card 1,738, bank transfer 543 | 0 % | 42.5 % | 55.1 CZK | median 1.8 d |
| rawbark SK | GoPay card 354, bank transfer 38 | 0 % | 47.8 % | 91.9 CZK | median 1.8 d |
| ethia CZ | Comgate card 127, Apple Pay 94, bank 37, Google Pay 25 | 0 % | 31.8 % | 29.6 CZK | median 4.4 d |
| manami CZ | card 227, Apple Pay 142, COD 132, transfer 104, Google Pay 53 | 19.9 % | n/a | n/a | n/a |
| manami SK | card 28, COD 28, Apple Pay 8, Google Pay 4, transfer 3 | 39.4 % | n/a | n/a | n/a |
| dobias (all markets, orders with full payload since 2026-05) | shopify_payments 5,637, paypal 626, gift_card 46, Afterpay 43, store credit 16 | 0 % | shipping-line automatic discount on 477 orders | see total_shipping | n/a |

Shipping cost per order, delivery time and real refund rate per market are not computable for any client today.

## 4. Campaign naming: last token vs market

| Client | Campaigns with Meta spend L12M | Last token is an ISO country | Market found anywhere by ref.naming_rules | L12M spend unallocated | Note |
|---|---:|---:|---:|---:|---|
| dobias | 8 | 0 (7 end in "OE", 1 "COPY") | 8 (first field "US I ..." / "CA I ...") | 0 USD | 2 "US & CA" campaigns (6,688 USD) tagged US |
| rawbark | 18 | 5 (CZ, CZ, SK, CZ, SK) | 8 | 287,082 CZK | 7 legacy names "PER_ADV_VID_CZ~..." etc. (221,994 CZK) missed because "~" is not a delimiter in the regex |
| ethia | 12 | 0 | 0 | 565,937 CZK (100 %) | single market, allocate to CZ |
| manami | 16 | 0 (market is middle field "\| CZ \|") | 10 | 36,893 CZK | old seasonal names without token |
| venev | 5 | 1 (SK) | 2 | 54,928 CZK (2,263 EUR) | Dec 2025 to Mar 2026 "6_dis-..." campaigns |
| rawbark Google | 19 | 0 (market is prefix "CZ - " / "SK - ") | 17 | GeoStats covers 100 % | use GeoStats, not names |
| manami Google | 3 | 0 | 0 | GeoStats covers 100 % (all CZ) | use GeoStats |

Recommendation: the owner's "suffix at end of name" fallback would allocate almost nothing; use the existing token-anywhere rule (mart_meta_campaign_dim.market), add "~" to the delimiter class, add a "US & CA" split rule or override, and use client-country fallback for single-market clients.

## 5. Data quality problems

| # | Problem | Impact | Evidence |
|---|---|---|---|
| I1 | Manami `shipping_country` NULL on 100 % of orders (Shoptet payload has no address/country) | market only via currency fallback; CZK-paying SK customers would land in CZ | being fixed in another session |
| I2 | Woo market column is the BILLING country; raw payload has no shipping address | billing vs shipping can differ (gifts, pickup points); 57 rawbark orders have currency not matching billing country | stg_woo_orders: `billing_country AS shipping_country` |
| I3 | Dobias blank `shipping_country` on 60 L12M orders: gift cards, reshipment payments, e-book, HairQ tests, subscription reactivation, draft "payment only" orders | inflates order counts, fallback puts them in US/CA | source_name web / Matrixify / shopify_draft_order |
| I4 | Dobias currency: CA orders since the 2026-03 migration are booked in USD shop money with CAD presentment; stg `market_currency` = shop currency, so it says USD for CA. Presentment amounts only in payload from 2026-05 | "local currency" toggle for CA needs payload presentment_money or FX | stg_shopify_orders.currency_original vs presentment_currency |
| I5 | ref.fx_rates CAD>USD ends 2026-05-01; no USD>CAD, GBP, EUR>USD rows | any CAD shop-money order after 2026-05 would get NULL amounts; local toggle for Dobias cannot use the table for Jun..Oct 2026 | ref.fx_rates |
| I6 | Dobias `total_refunded` NULL on every order; revenue not refund-netted (known P1) | refund rate only as an order flag (about 2.3 % of orders refunded or partially) | stg_shopify_orders |
| I7 | Dobias Meta spend in warehouse only from 2026-04-20; no Google for Dobias, Ethia, Venev | nCAC and cohort CAC n/a for Dobias except L90/P90 | stg_meta_campaign_insights min date |
| I8 | "US & CA" Dobias campaigns classified US | US nCAC overstated, CA understated by up to 6,688 USD L12M | mart_meta_campaign_dim |
| I9 | Naming regex misses "_CZ~" (rawbark legacy) and any campaign without token | 287k CZK rawbark, 37k manami, 2.3k EUR venev unallocated in L12M | section 4 |
| I10 | rawbark has no COGS (0 % lines costed, no ref.product_costs rows) | GP, first-order GP, LTGP, LTGP:CAC blocked | stg_customer_order_items |
| I11 | rawbark `refunds_total` = 0 on all 12,345 L12M orders | either no refunds in Woo or returns handled off-platform; refund rate shows 0 | stg_woo_orders |
| I12 | Woo cost columns `shipping_cost`, `packaging_cost`, `gateway_fee`, `cod_fee`, `cogs_total` (rawbark) exist but are 0 % filled | shipping cost/order and fees unavailable | raw_woo_orders |
| I13 | Shopify payload (discount_applications, gateways, refunds, presentment money) is near-empty before 2026-05, partial May..Aug, complete from 2026-09 | discount type split, payment mix and refund amounts only for recent months | per-month payload check |
| I14 | New/returning is derived inside data history: manami from 2024-05-06, ethia 2025-03-02 (launch), rawbark 2022-10-01, venev 2022-07-25, dobias 2013 | Manami P12M "new" and 365 d cohorts slightly inflated by pre-May-2024 customers | MIN(order_date) |
| I15 | GA4: stg.ga4_sessions ends 2026-10-03 while raw export runs to 2026-10-13/14; history starts 2026-08-03; Venev export only 4 days; rawbark and ethia have no GA4; country is an English name, not ISO | traffic/funnel and scouting only for Dobias and Manami, 2 months, no prior period | analytics_* __TABLES__ |
| I16 | ref.industry_benchmarks is empty (0 rows); ref.client_monthly_costs empty | no benchmark overlay, no CM3 fixed-cost layer | ref tables |
| I17 | Raw tables are append-only with heavy duplication (Shoptet about 156 rows per order, Shopify about 4.7, Meta campaign-day up to 237 rows for Dobias) | any Markets query must read stg; stg verified 1 row per order_id and per campaign-day | row vs distinct counts |
| I18 | Ethia: 1 SK order in P12M with revenue -1 CZK and GP -847 CZK | garbage row in a tiny market | Q1 output |
| I19 | Shopify gross sales = subtotal + total_discounts; Shopify total_discounts may include shipping-line discounts | gross sales and discount % slightly overstated for Dobias | definition |
| I20 | Dobias COGS uses current product cost (snapshot 2026-05-19), not cost at order; known drift about 4-5k USD/month | COGS % approximate | METRICS.md known gaps |
| I21 | Shopify order_date is UTC (shop timezone differs) | small daily drift vs Shopify admin | METRICS.md |
| I22 | Venev: no orders in July 2026, Meta account in CZK while client is EUR (converted via fx), 17 shop days after 2025-12-04 with NULL Meta spend | tiny sample, ratios unstable | mart_daily_kpis |
| I23 | mart.mart_customer_market_daily groups raw `shipping_country` with no fallback, no currency, no discounts, refunds or COGS | Manami lands in a NULL market, Dobias blank country is its own market; not usable as the Markets mart as is | view definition |
| I24 | rawbark Google GeoStats (and all Google in stg) only from 2025-09-01; Manami Google from 2025-10-01 | P12M paid spend incomplete for both | min dates |

---

## Appendix A. Exact SQL used

### A1. Order economics per client x market x period (section 2 tables)

```sql
-- Q1: order economics per client x market x period (base currency = ref.clients.currency)
WITH p AS (
  SELECT 'L12M' period, DATE '2025-10-15' d0, DATE '2026-10-14' d1 UNION ALL
  SELECT 'P12M', DATE '2024-10-15', DATE '2025-10-14' UNION ALL
  SELECT 'L90',  DATE '2026-07-17', DATE '2026-10-14' UNION ALL
  SELECT 'P90',  DATE '2026-04-18', DATE '2026-07-16'
),
base AS (
  SELECT
    o.*,
    CASE
      WHEN NULLIF(o.shipping_country, '') IS NOT NULL THEN o.shipping_country
      WHEN o.market_currency = 'CZK' THEN 'CZ'
      WHEN o.market_currency = 'EUR' AND o.client_id IN ('manami', 'rawbark') THEN 'SK'
      WHEN o.market_currency = 'CAD' THEN 'CA'
      WHEN o.market_currency = 'USD' THEN 'US'
      ELSE 'UNKNOWN' END AS market_raw,
    CASE WHEN NULLIF(o.shipping_country, '') IS NOT NULL THEN 'country' ELSE 'currency_fallback' END AS market_source,
    COALESCE(s.total_discounts, w.total_discounts) AS discounts,
    COALESCE(s.total_refunded, w.total_refunded)   AS refunds,
    s.financial_status AS shopify_fin_status,
    COALESCE(s.total_discounts, w.total_discounts, 0) > 0
      OR COALESCE(si.has_item_discount, FALSE)      AS is_discounted
  FROM `oneeighty-warehouse.stg.stg_customer_orders` o
  LEFT JOIN `oneeighty-warehouse.stg.stg_shopify_orders` s
    ON o.platform = 'shopify' AND s.client_id = o.client_id AND s.order_id = o.order_id
  LEFT JOIN `oneeighty-warehouse.stg.stg_woo_orders` w
    ON o.platform = 'woocommerce' AND w.client_id = o.client_id AND w.order_id = o.order_id
  LEFT JOIN (SELECT client_id, order_code, LOGICAL_OR(discount_pct > 0) has_item_discount
             FROM `oneeighty-warehouse.stg.stg_shoptet_order_items` GROUP BY 1, 2) si
    ON o.platform = 'shoptet' AND si.client_id = o.client_id AND si.order_code = o.order_id
  WHERE o.order_date >= '2024-10-15'
),
b AS (
  SELECT *,
    CASE WHEN client_id = 'dobias' AND market_raw NOT IN ('US', 'CA') THEN 'OTHER'
         WHEN client_id IN ('rawbark', 'manami', 'venev', 'ethia') AND market_raw NOT IN ('CZ', 'SK') THEN 'OTHER'
         ELSE market_raw END AS market
  FROM base
)
SELECT
  b.client_id, ANY_VALUE(b.currency) AS ccy, b.market, p.period,
  COUNT(*)                                                     AS orders,
  COUNTIF(b.is_returning_customer IS FALSE)                    AS new_customers,
  COUNTIF(b.is_returning_customer IS NULL)                     AS orders_no_email,
  COUNTIF(b.market_source = 'currency_fallback')               AS orders_market_fallback,
  ROUND(SUM(b.revenue))                                        AS revenue,
  ROUND(SUM(b.net_sales))                                      AS net_sales,
  ROUND(SUM(b.discounts))                                      AS discounts,
  ROUND(SUM(b.net_sales) + SUM(b.discounts))                   AS gross_sales,
  ROUND(100 * SAFE_DIVIDE(SUM(b.discounts), SUM(b.net_sales) + SUM(b.discounts)), 1) AS disc_pct_gross,
  ROUND(100 * COUNTIF(b.is_discounted) / COUNT(*), 1)          AS pct_orders_discounted,
  ROUND(SUM(b.refunds))                                        AS refunds,
  COUNTIF(b.refunds > 0)                                       AS orders_refunded_amt,
  COUNTIF(b.shopify_fin_status IN ('REFUNDED', 'PARTIALLY_REFUNDED')) AS orders_refunded_status,
  ROUND(SUM(b.shipping))                                       AS shipping_charged,
  ROUND(SUM(b.cogs))                                           AS cogs,
  ROUND(100 * COUNTIF(b.cogs IS NOT NULL) / COUNT(*), 1)       AS cogs_cov_pct,
  ROUND(100 * SAFE_DIVIDE(SUM(b.cogs), SUM(IF(b.cogs IS NOT NULL, b.net_sales, NULL))), 1) AS cogs_pct_net_sales,
  ROUND(SUM(b.gross_profit))                                   AS gp,
  ROUND(SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS FALSE, b.net_sales, 0)), COUNTIF(b.is_returning_customer IS FALSE)), 1) AS aov_new,
  ROUND(SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS TRUE,  b.net_sales, 0)), COUNTIF(b.is_returning_customer IS TRUE)), 1)  AS aov_ret,
  ROUND(SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS FALSE, b.gross_profit, NULL)), COUNTIF(b.is_returning_customer IS FALSE AND b.gross_profit IS NOT NULL)), 1) AS first_order_gp,
  ROUND(100 * SAFE_DIVIDE(SUM(IF(b.is_returning_customer IS TRUE, b.revenue, 0)), SUM(b.revenue)), 1) AS returning_rev_share
FROM b
JOIN p ON b.order_date BETWEEN p.d0 AND p.d1
GROUP BY 1, 3, 4
ORDER BY 1, 3, 4
```

### A2. Paid spend per client x market x period, incl. cohort windows

```sql
-- Q2: paid spend per client x market x period, converted to the client base currency.
-- Meta: campaign market from mart.mart_meta_campaign_dim (naming rule or override), else UNALLOCATED.
-- Google: country from raw_google_ads GeoStats (both location types), 2203 = CZ, 2703 = SK.
WITH p AS (
  SELECT 'L12M' period, DATE '2025-10-15' d0, DATE '2026-10-14' d1 UNION ALL
  SELECT 'P12M', DATE '2024-10-15', DATE '2025-10-14' UNION ALL
  SELECT 'L90',  DATE '2026-07-17', DATE '2026-10-14' UNION ALL
  SELECT 'P90',  DATE '2026-04-18', DATE '2026-07-16' UNION ALL
  SELECT 'COH365', DATE '2024-10-15', DATE '2025-10-14' UNION ALL   -- cohort window for 365d LTGP
  SELECT 'COH180', DATE '2025-04-18', DATE '2026-04-17' UNION ALL   -- cohort window for 180d
  SELECT 'COH90',  DATE '2025-07-17', DATE '2026-07-16'             -- cohort window for 90d
),
cl AS (SELECT client_id, currency, meta_currency FROM `oneeighty-warehouse.ref.clients`),
meta AS (
  SELECT m.client_id, m.date_start AS d, COALESCE(dim.market, 'UNALLOCATED') AS market, 'meta' AS platform,
         m.spend * IF(cl.meta_currency = cl.currency, 1, fx.rate) AS spend
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` m
  JOIN cl USING (client_id)
  LEFT JOIN `oneeighty-warehouse.mart.mart_meta_campaign_dim` dim USING (client_id, campaign_id)
  LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
    ON fx.from_currency = cl.meta_currency AND fx.to_currency = cl.currency
   AND fx.month_start = DATE_TRUNC(m.date_start, MONTH)
  WHERE m.date_start >= '2024-10-15'
),
gads AS (
  SELECT 'rawbark' AS client_id, segments_date AS d,
         CASE geographic_view_country_criterion_id WHEN 2203 THEN 'CZ' WHEN 2703 THEN 'SK' ELSE 'OTHER' END AS market,
         'google' AS platform, metrics_cost_micros / 1e6 AS spend
  FROM `oneeighty-warehouse.raw_google_ads.ads_GeoStats_9406261058` WHERE segments_date >= '2024-10-15'
  UNION ALL
  SELECT 'manami', segments_date,
         CASE geographic_view_country_criterion_id WHEN 2203 THEN 'CZ' WHEN 2703 THEN 'SK' ELSE 'OTHER' END,
         'google', metrics_cost_micros / 1e6
  FROM `oneeighty-warehouse.raw_google_ads.ads_GeoStats_5865960448` WHERE segments_date >= '2024-10-15'
),
s AS (SELECT * FROM meta UNION ALL SELECT * FROM gads)
SELECT s.client_id, p.period, s.market,
       ROUND(SUM(IF(platform = 'meta', spend, 0))) AS meta_spend,
       ROUND(SUM(IF(platform = 'google', spend, 0))) AS google_spend,
       ROUND(SUM(spend)) AS paid_spend,
       COUNT(DISTINCT IF(platform = 'meta', d, NULL)) AS meta_days,
       COUNT(DISTINCT IF(platform = 'google', d, NULL)) AS google_days,
       MIN(d) AS first_spend_day
FROM s JOIN p ON s.d BETWEEN p.d0 AND p.d1
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
```

### A3. Cohort retention, revenue and GP per customer at 90/180/365 d

```sql
-- Q3: cohort retention and GP per customer at 90/180/365 days, complete cohorts only
WITH o AS (
  SELECT client_id, customer_key, order_id, order_date, revenue, gross_profit, cogs,
    CASE
      WHEN NULLIF(shipping_country, '') IS NOT NULL THEN shipping_country
      WHEN market_currency = 'CZK' THEN 'CZ'
      WHEN market_currency = 'EUR' AND client_id IN ('manami', 'rawbark') THEN 'SK'
      WHEN market_currency = 'CAD' THEN 'CA'
      WHEN market_currency = 'USD' THEN 'US'
      ELSE 'UNKNOWN' END AS market_raw
  FROM `oneeighty-warehouse.stg.stg_customer_orders`
  WHERE customer_key IS NOT NULL
),
f AS (
  SELECT client_id, customer_key,
         ARRAY_AGG(STRUCT(order_date, market_raw) ORDER BY order_date, order_id LIMIT 1)[OFFSET(0)] AS fo
  FROM o GROUP BY 1, 2
),
c AS (
  SELECT f.client_id, f.customer_key, f.fo.order_date AS first_date,
    CASE WHEN f.client_id = 'dobias' AND f.fo.market_raw NOT IN ('US','CA') THEN 'OTHER'
         WHEN f.client_id != 'dobias' AND f.fo.market_raw NOT IN ('CZ','SK') THEN 'OTHER'
         ELSE f.fo.market_raw END AS market
  FROM f
),
h AS (
  SELECT 90 AS hz, DATE '2025-07-17' AS w0, DATE '2026-07-16' AS w1 UNION ALL
  SELECT 180, DATE '2025-04-18', DATE '2026-04-17' UNION ALL
  SELECT 365, DATE '2024-10-15', DATE '2025-10-14'
),
per_cust AS (
  SELECT c.client_id, c.market, h.hz, c.customer_key,
         COUNT(o.order_id) AS n_orders, SUM(o.revenue) AS rev, SUM(o.gross_profit) AS gp,
         LOGICAL_AND(o.cogs IS NOT NULL) AS all_costed
  FROM c
  JOIN h ON c.first_date BETWEEN h.w0 AND h.w1
  JOIN o ON o.client_id = c.client_id AND o.customer_key = c.customer_key
        AND o.order_date >= c.first_date AND o.order_date < DATE_ADD(c.first_date, INTERVAL h.hz DAY)
  GROUP BY 1, 2, 3, 4
)
SELECT client_id, market, hz,
  COUNT(*) AS cohort_customers,
  ROUND(AVG(n_orders), 3) AS orders_per_cust,
  ROUND(100 * COUNTIF(n_orders >= 2) / COUNT(*), 1) AS repeat_rate_pct,
  ROUND(AVG(rev), 1) AS rev_per_cust,
  ROUND(SAFE_DIVIDE(SUM(IF(all_costed, gp, NULL)), COUNTIF(all_costed)), 1) AS gp_per_cust,
  ROUND(100 * COUNTIF(all_costed) / COUNT(*), 1) AS pct_cust_fully_costed
FROM per_cust
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
```

### A4. Derived ratios
nCAC, MER, pro-rata allocation of unallocated spend (share of new customers in the period, or of cohort customers for cohort CAC) and LTGP:CAC were computed from A1 to A3 outputs in `scratchpad/markets/calc.py`.

### A5. Coverage and quality probes

```sql
-- Woo field coverage (L12M)
WITH o AS (SELECT * FROM `oneeighty-warehouse.stg.stg_woo_orders` WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))
SELECT client_id, COUNT(*) n,
  COUNTIF(JSON_VALUE(payload_json,'$.shipping.country') IS NOT NULL AND JSON_VALUE(payload_json,'$.shipping.country')!='') ship_cc,
  COUNTIF(shipping_country IS NULL OR shipping_country='') bill_null,
  COUNTIF(cogs_total IS NOT NULL) cogs_total_nn, COUNTIF(shipping_cost IS NOT NULL) ship_cost_nn,
  COUNTIF(gateway_fee IS NOT NULL) gw_nn, COUNTIF(cod_fee IS NOT NULL) cod_nn, COUNTIF(packaging_cost IS NOT NULL) pack_nn,
  COUNTIF(payment_method IS NOT NULL AND payment_method!='') pm_nn,
  COUNTIF(coupon_codes IS NOT NULL AND coupon_codes NOT IN ('','[]')) coupon_orders,
  COUNTIF(total_discounts>0) disc_orders, COUNTIF(fee_discounts<0) fee_disc_orders, COUNTIF(total_refunded>0) refund_orders,
  COUNTIF(total_shipping>0) paid_ship_orders, COUNTIF(date_completed_gmt IS NOT NULL) completed_nn
FROM o GROUP BY 1;

-- Woo subtotal_ex_tax is post-coupon (gross = net + discounts)
WITH o AS (SELECT client_id, order_id, subtotal_ex_tax, discount_total, payload_json FROM `oneeighty-warehouse.raw.raw_woo_orders`
  WHERE order_date >= '2026-08-01' AND discount_total > 0
  QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, order_id ORDER BY ingested_at DESC)=1)
SELECT client_id, COUNT(*) n,
  COUNTIF(ABS(subtotal_ex_tax - (SELECT SUM(CAST(JSON_VALUE(l,'$.total') AS NUMERIC)) FROM UNNEST(JSON_QUERY_ARRAY(payload_json,'$.line_items')) l)) < 0.05) eq_line_total
FROM o GROUP BY 1;

-- Shopify payload completeness per month
SELECT client_id, ingest_source, FORMAT_DATE('%Y-%m', order_date) m, COUNT(*) n,
  COUNTIF(JSON_QUERY(payload_json, '$.discount_applications') IS NOT NULL) full_payload,
  COUNTIF(JSON_QUERY(payload_json, '$.refunds[0]') IS NOT NULL) has_refund_obj
FROM `oneeighty-warehouse.stg.stg_shopify_orders` WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 15 MONTH)
GROUP BY 1,2,3 ORDER BY 1,3,2;

-- Shopify discount types, gateways and financial status (orders with full payload)
WITH o AS (SELECT * FROM `oneeighty-warehouse.stg.stg_shopify_orders` WHERE order_date >= '2026-05-01' AND JSON_QUERY(payload_json, '$.discount_applications') IS NOT NULL),
da AS (SELECT o.client_id, o.order_id, JSON_VALUE(d,'$.type') typ, JSON_VALUE(d,'$.target_type') tgt FROM o, UNNEST(JSON_QUERY_ARRAY(o.payload_json,'$.discount_applications')) d)
SELECT client_id, typ, tgt, COUNT(DISTINCT order_id) orders FROM da GROUP BY 1,2,3
UNION ALL SELECT client_id, CONCAT('gateway:', JSON_VALUE(payload_json,'$.payment_gateway_names[0]')), NULL, COUNT(*) FROM o GROUP BY 1,2,3
UNION ALL SELECT client_id, CONCAT('fin_status:', financial_status), NULL, COUNT(*) FROM o GROUP BY 1,2,3;

-- Shopify product snapshot / compare-at
SELECT client_id, COUNT(*) n, MIN(ingested_at) mn, MAX(ingested_at) mx,
  COUNTIF(REGEXP_CONTAINS(payload_json, r'compare_?[aA]t_?[pP]rice\W+:\W*"?[0-9]')) with_compare_at
FROM `oneeighty-warehouse.raw.raw_shopify_products` WHERE ingested_at >= '2020-01-01' GROUP BY 1;

-- Shoptet line discounts and imputed costs
SELECT currency, COUNT(DISTINCT order_code) orders, COUNTIF(revenue_czk < 0) neg_lines,
  COUNTIF(discount_pct > 0) disc_pct_lines, COUNT(DISTINCT IF(discount_pct>0, order_code, NULL)) orders_disc_pct,
  COUNTIF(cost_is_imputed) imputed_lines, COUNT(*) lines
FROM `oneeighty-warehouse.stg.stg_shoptet_order_items` WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1;

-- Meta campaign names, last token, classified market (L12M)
WITH s AS (SELECT client_id, campaign_id, ANY_VALUE(campaign_name) campaign_name, SUM(spend) spend, MIN(date_start) f, MAX(date_start) l
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1,2)
SELECT s.client_id, s.campaign_name, ROUND(s.spend) spend, s.f, s.l, d.market,
  UPPER(REGEXP_EXTRACT(TRIM(s.campaign_name), r'([A-Za-z0-9]+)\W*$')) last_token
FROM s LEFT JOIN `oneeighty-warehouse.mart.mart_meta_campaign_dim` d USING (client_id, campaign_id)
WHERE s.spend > 0 ORDER BY 1, spend DESC;

-- Google campaign market by name
WITH s AS (SELECT client_id, CAST(campaign_id AS STRING) campaign_id, ANY_VALUE(campaign_name) campaign_name, SUM(spend) spend
  FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1,2)
SELECT s.client_id, s.campaign_name, ROUND(s.spend) spend, d.market FROM s
LEFT JOIN `oneeighty-warehouse.mart.mart_gads_campaign_dim` d ON d.client_id=s.client_id AND CAST(d.campaign_id AS STRING)=s.campaign_id
WHERE s.spend>0 ORDER BY 1, spend DESC;

-- Google GeoStats by country (reconciles to stg_google_ads_campaign_insights)
SELECT geographic_view_country_criterion_id, geographic_view_location_type, MIN(segments_date), MAX(segments_date), ROUND(SUM(metrics_cost_micros)/1e6) cost
FROM `oneeighty-warehouse.raw_google_ads.ads_GeoStats_9406261058` WHERE segments_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1,2;
-- same for ads_GeoStats_5865960448 (manami)

-- Spend history start per platform and GA4 window
SELECT client_id, MIN(date_start), MAX(date_start), COUNT(DISTINCT date_start), ROUND(SUM(spend)) FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` GROUP BY 1
UNION ALL SELECT CONCAT('gads_stg:', client_id), MIN(date_start), MAX(date_start), COUNT(DISTINCT date_start), ROUND(SUM(spend)) FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` GROUP BY 1
UNION ALL SELECT 'ga4_stg', MIN(date), MAX(date), COUNT(DISTINCT date), COUNT(*) FROM `oneeighty-warehouse.stg.ga4_sessions`;

-- GA4 sessions by country (L12M)
SELECT client_id, IFNULL(country,'NULL') country, COUNT(*) sessions, SUM(purchases) purchases, MIN(date), MAX(date),
  COUNTIF(has_add_to_cart) atc, COUNTIF(has_begin_checkout) bc
FROM `oneeighty-warehouse.stg.ga4_sessions` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH) GROUP BY 1,2;

-- GA4 raw export ranges
SELECT 'a314809580', MIN(table_id), MAX(table_id), COUNT(*) FROM `oneeighty-warehouse.analytics_314809580.__TABLES__` WHERE table_id LIKE 'events_%'
UNION ALL SELECT 'a324879665', MIN(table_id), MAX(table_id), COUNT(*) FROM `oneeighty-warehouse.analytics_324879665.__TABLES__` WHERE table_id LIKE 'events_%'
UNION ALL SELECT 'a343337695', MIN(table_id), MAX(table_id), COUNT(*) FROM `oneeighty-warehouse.analytics_343337695.__TABLES__` WHERE table_id LIKE 'events_%';

-- Benchmarks, verticals, costs, FX
SELECT vertical, region, metric_id, COUNT(*) FROM `oneeighty-warehouse.ref.industry_benchmarks` GROUP BY 1,2,3;  -- returns 0 rows
SELECT 'product_costs', client_id, currency, COUNT(*), MIN(effective_from) FROM `oneeighty-warehouse.ref.product_costs` GROUP BY 1,2,3
UNION ALL SELECT 'fx', CONCAT(from_currency,'>',to_currency), CAST(MIN(month_start) AS STRING), COUNT(*), MAX(month_start) FROM `oneeighty-warehouse.ref.fx_rates` GROUP BY from_currency, to_currency;

-- Monthly order volume and history start (gaps)
WITH m AS (SELECT client_id, DATE_TRUNC(order_date, MONTH) mo, COUNT(*) n, COUNT(DISTINCT order_date) days
  FROM `oneeighty-warehouse.stg.stg_customer_orders` WHERE order_date >= '2024-07-01' GROUP BY 1,2)
SELECT client_id, STRING_AGG(FORMAT('%s:%d/%dd', FORMAT_DATE('%y%m', mo), n, days), ' ' ORDER BY mo) months FROM m GROUP BY 1;

-- Duplication raw vs stg
SELECT 'woo_raw', client_id, COUNT(*), COUNT(DISTINCT order_id) FROM `oneeighty-warehouse.raw.raw_woo_orders` WHERE order_date >= '2025-10-15' GROUP BY 2
UNION ALL SELECT 'shoptet_raw', client_id, COUNT(*), COUNT(DISTINCT code) FROM `oneeighty-warehouse.raw.raw_shoptet_orders` WHERE orderDate >= '2025-10-15' GROUP BY 2
UNION ALL SELECT 'shopify_raw', client_id, COUNT(*), COUNT(DISTINCT order_id) FROM `oneeighty-warehouse.raw.raw_shopify_orders` WHERE order_date >= '2025-10-15' GROUP BY 2
UNION ALL SELECT 'stg_customer_orders', client_id, COUNT(*), COUNT(DISTINCT order_id) FROM `oneeighty-warehouse.stg.stg_customer_orders` GROUP BY 2
UNION ALL SELECT 'meta_campaign_raw', client_id, COUNT(*), COUNT(DISTINCT CONCAT(campaign_id, CAST(date_start AS STRING))) FROM `oneeighty-warehouse.raw.raw_meta_campaign_insights` WHERE date_start >= '2025-10-15' GROUP BY 2
UNION ALL SELECT 'meta_campaign_stg', client_id, COUNT(*), COUNT(DISTINCT CONCAT(campaign_id, CAST(date_start AS STRING))) FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` WHERE date_start >= '2025-10-15' GROUP BY 2;

-- Dobias blank-country orders
SELECT source_name, COUNT(*) n, ROUND(SUM(subtotal_price)) sub, ARRAY_AGG(JSON_VALUE(line_items, '$[0].title') IGNORE NULLS LIMIT 5) titles
FROM `oneeighty-warehouse.stg.stg_shopify_orders`
WHERE client_id='dobias' AND (shipping_country IS NULL OR shipping_country='') AND order_date >= '2025-10-15' GROUP BY 1;

-- Payment mix, zero-shipping share, completion time (L90)
WITH w AS (SELECT client_id, IF(shipping_country IN ('CZ','SK'), shipping_country, 'OTHER') market, payment_method pm, total_shipping,
    TIMESTAMP_DIFF(date_completed_gmt, COALESCE(date_paid_gmt, date_created_gmt), HOUR)/24 AS days_to_complete
  FROM `oneeighty-warehouse.stg.stg_woo_orders` WHERE order_date BETWEEN '2026-07-17' AND '2026-10-14'),
s AS (SELECT client_id, IF(currency='EUR','SK','CZ') market, payment_method pm FROM `oneeighty-warehouse.stg.stg_shoptet_orders` WHERE order_date BETWEEN '2026-07-17' AND '2026-10-14'),
pmix AS (SELECT client_id, market, pm, COUNT(*) n FROM (SELECT client_id, market, pm FROM w UNION ALL SELECT client_id, market, pm FROM s) GROUP BY 1,2,3)
SELECT 'paymix', client_id, market, STRING_AGG(FORMAT('%s=%d', pm, n), '; ' ORDER BY n DESC LIMIT 6) FROM pmix GROUP BY 1,2,3
UNION ALL
SELECT 'woo_ship', client_id, market, FORMAT('orders=%d zero_ship_pct=%.1f avg_ship=%.1f median_days=%.1f', COUNT(*), 100*COUNTIF(total_shipping=0)/COUNT(*), AVG(total_shipping), APPROX_QUANTILES(days_to_complete, 2)[OFFSET(1)]) FROM w GROUP BY 1,2,3;
```
