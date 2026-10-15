# Markets page: proposal and build spec

Status: PROPOSAL, 2026-10-15. Nothing built, no BQ writes, no deploy.
Inputs: `research/research-dtc-markets.md`, `research/research-platform-fields.md`, `research/research-ltgp-prediction.md`, `research/data-audit.md` (real numbers, SQL in `sql/`).
Related: Manami Shoptet market fix = migration 284 on branch `mm1-shoptet-market` (QA only, not deployed).

## 1. What the page is for

One page that compares every market of a client from top line to bottom line and answers four questions:

1. **Budget split:** where does the next 10k of spend earn the most contribution (Dobias US vs CA, RawBark CZ vs SK)?
2. **Go / no-go:** is a young market on track, and is an unsold market worth opening (scouting)?
3. **Pricing, discount, shipping:** is a market discount-addicted, does free shipping or COD eat the margin?
4. **Client reporting:** one clean view a client understands in a call.

The ranking column is **absolute CM3 per market**, not ROAS (research 1, CTC). Ratios explain, CM3 decides.

## 2. Owner decisions (2026-10-15)

| Topic | Decision |
|---|---|
| Market key | Shipping country, fallback order currency, then storefront domain. Customer cohort market = market of the FIRST order, frozen. |
| CAC | nCAC = paid spend allocated to the market / new customers in the market. |
| Spend split | Platform geo breakdown first, campaign name second. |
| LTGP | Cohort GP per new customer at 90 / 180 / 365 d after COGS, shipping, payment fees, discounts, refunds. Prediction: both options explained before choosing (section 7). |
| Currency | Toggle base / local. |
| Discounts | Code + automatic, compare-at markdowns, free shipping as discount, share of orders discounted. |
| Verdicts | Status chips with thresholds, default LTGP:CAC 3:1 at 365 d. |
| Scope v1 | Profit waterfall to CM3, retention, traffic + funnel, ops friction, scouting of unsold markets, benchmarks. |
| Time | Period metrics follow the date picker + Compare; LTGP follows cohorts with maturity. |
| Layout | Map as the entry, detail in P&L-matrix style. Skin decided in design options. |

## 3. Metric tree (top to bottom)

Every metric is per market, in base or local currency (toggle), ex VAT. `P` = follows the period picker, `C` = cohort metric read at a fixed age.

### 3.1 Volume (P)
| Metric | Definition |
|---|---|
| Orders | Deduped orders, cancelled and non-shippable (gift cards, payment-only, tests) excluded |
| New customers | First order ever for the customer key (lower-cased email) inside data history |
| Returning orders, returning revenue share | Orders and net revenue from customers with an earlier order |
| Share of client | Market net revenue / client net revenue |

### 3.2 Revenue waterfall (P)
| Line | Definition | Shopify | Shoptet | WooCommerce |
|---|---|---|---|---|
| Gross sales | List price x qty, ex VAT, before any discount | subtotal + total_discounts (shopMoney) | sum of product items before discount | subtotal_ex_tax + fee_discounts + discount_total |
| minus Compare-at markdown | (compare-at or regular price minus sold price) x qty | variant compareAtPrice snapshot (not on order) | standard vs action price (to verify) | regular_price vs sale_price (to verify) |
| minus Code discounts | Discount codes | discountApplications type DISCOUNT_CODE | items type `discount-coupon` | coupon_lines |
| minus Automatic discounts | Automatic, bundle, loyalty, manual | AUTOMATIC / MANUAL / SCRIPT | discount items other than coupon | negative fee lines |
| minus Free-shipping discount | Shipping the merchant gives away | shipping-line discount allocations | shipping item price 0 below threshold | shipping_total 0 |
| minus Refunds | Refunded amount by refund date | refunds[] (payload) | not ingested | refunds_total |
| = **Net revenue** | Ex VAT, incl. shipping charged | | | |
| VAT rate applied | Shown as a column (CZ 21, SK 23, HU 27, DE 19, US sales tax n/a) | | | |

### 3.3 Discount block (P)
Discount penetration (% orders with any discount), effective discount rate (all discounts / gross sales), average depth on discounted orders, full-price revenue share, split new vs returning. **Discount-addiction flag:** effective rate > 15 % AND one more signal (penetration rising, full-price share falling, returning customers only buy on promo).

### 3.4 Profit waterfall (P)
| Line | Source today | Source after rate cards |
|---|---|---|
| COGS | line_cost (Dobias, Ethia, Manami, Venev). RawBark: none | same |
| = **CM1** (gross profit) and CM1 % | computable for 4 of 5 clients | |
| Shipping and fulfilment cost (net of shipping charged) | nobody | `ref.market_cost_rates.ship_cost_per_order` |
| Payment fees incl. COD fee | nobody (Shopify Payments fees possible later) | `pay_fee_pct`, `cod_fee` |
| Duties and brokerage (US/CA lane) | nobody | `duty_pct` |
| Returns handling, COD refusal cost | nobody | `return_cost`, `cod_refusal_pct` |
| = **CM2** and CM2 % | n/a until rate cards | |
| Ad spend (Meta + Google + Sklik, incl. location fees such as Meta AT 5 %) | Meta by campaign market, Google GeoStats | + Sklik by name |
| = **CM3** and CM3 % (ranking column) | | |

### 3.5 Acquisition efficiency (P)
MER (net revenue / spend), aMER (new-customer revenue / spend), **nCAC**, **break-even aMER** for that market (first-order AOV / max affordable CAC from the market's own CM2), **first-order profit per new customer** (first-order CM2 minus nCAC), AOV new vs AOV returning.

### 3.6 Retention and lifetime (C)
Repeat rate at 30 / 90 / 180 / 365 d, time to 2nd order (median), cohort revenue and **GP per customer at 90 / 180 / 365 d**, **LTGP:CAC** at the same age (cohort CAC = market spend inside the cohort window / cohort customers), **CAC payback days** (first day cumulative GP per customer crosses nCAC, "not yet" otherwise). Cohorts are read only once they reach the age. Forecast for young cohorts is separate and dashed (section 7).

### 3.7 Traffic and funnel (P)
GA4 sessions by country, unpaid share (organic + direct), CVR, add-to-cart rate, checkout completion; Meta CPM, CTR by country. Index vs the home market (home = 100).

### 3.8 Ops friction (P)
Payment mix and COD share (+ refusal rate when available), delivery mix (pickup / locker vs home), shipping charged per order, zero-shipping share (free-shipping hit rate), time to fulfilment (proxy), refund rate.

### 3.9 Scouting (unsold markets, P)
Countries with sessions or orders but no market setup: GA4 sessions and unpaid share, organic orders, search demand per country (Ahrefs / Keyword Planner volume for the client's head terms), Meta audience size, benchmark CVR / AOV / CPM for vertical x country from `ref.industry_benchmarks`. Ranked by an opportunity index; no verdict, only "worth a test" signals.

## 4. Status logic (chips)

Maturity badge first:
- **Young**: < 100 orders lifetime or first order < 90 d ago. Shows leading indicators (3.7, first-order CM2, 30/60 d repeat vs home at equal age) instead of LTGP verdicts.
- **Directional**: < 50 conversions / week or < 30 new customers in the period. Numbers shown, chip greyed text "directional".
- **Established**: everything else.

Verdict chip (Established markets), defaults editable per client in Settings:

| Chip | Rule |
|---|---|
| Scale | CM3 > 0 AND (LTGP:CAC 365 >= 3.0 OR payback < 180 d) AND aMER > break-even + 10 % |
| Hold | CM3 > 0 AND (LTGP:CAC 2.0 to 3.0 OR aMER within 10 % of break-even) |
| Fix acquisition | CM2 healthy (>= home market CM2 % minus 5 pp) BUT CM3 <= 0 or LTGP:CAC < 2.0 |
| Fix structure | CM2 % more than 5 pp below home; chip names the cost line driving the gap |
| Exit / pause | CM3 < -10 % of net revenue after the test window with no improving leading indicator |

While CM2 is n/a (no rate cards), the rules run on CM1 and the chip says "on CM1".

## 5. Data readiness (from `research/data-audit.md`)

| Client | Markets | Day one | Blocked by |
|---|---|---|---|
| Dobias (USD) | US, CA, other | volume, gross, discounts, net revenue, AOV new/ret, COGS %, CM1, cohorts 90/180/365, L90 nCAC (US 43.8, CA 92.3) | Meta only from 2026-04-20, no Google: no 12M nCAC, no true LTGP:CAC; no refund amounts; discount split only from 2026-05; CAD FX ends 2026-05; "US & CA" campaigns tagged US |
| RawBark (CZK) | CZ, SK | volume, discounts (code vs automatic), revenue, AOV, repeat, revenue cohorts, nCAC (L90 CZ 1,778, SK 3,057) | **no COGS at all** (no CM1, no LTGP); refunds read 0; market = billing country |
| Manami (CZK) | CZ, SK | CM1, cohorts, nCAC (L90 CZ 472, SK 466), COD (CZ 20 %, SK 39 %) | discount amounts, gross sales, refunds, shipping split; migration 284 must deploy |
| Ethia (CZK) | CZ | everything incl. LTGP:CAC 365 = 2.72 (369 customers) | single market; Markets page adds little beyond scouting |
| Venev (EUR) | CZ, SK | counts | too small (~55 orders/yr): ratios hidden |

Cross-client gaps: shipping cost, payment fees, delivery time, compare-at history exist for nobody; `ref.industry_benchmarks` and `ref.client_monthly_costs` are empty; GA4 by country only Dobias + Manami (2026-08-03 to 2026-10-03).

## 6. Fixes before or during build (proposed, each needs owner OK)

| # | Fix | Unblocks | Effort |
|---|---|---|---|
| F1 | Deploy migration 284 (Manami Shoptet market) | Manami markets | done in QA |
| F2 | New mart `mart.mart_market_daily` + `mart.mart_market_cohorts` reading stg (not raw, raw is duplicated), with the market fallback chain, non-shippable exclusion and frozen first-order market | everything | M |
| F3 | Campaign market rule: the "last suffix" rule allocates almost nothing today (6 of 59 campaigns end in a country). Keep the token-anywhere rule, add `~` as a delimiter (+222k CZK RawBark), add a "US & CA" split by Meta country breakdown or new-customer share, client-country fallback for single-market clients | correct nCAC | S |
| F4 | Ingest Meta insights with `breakdowns=country` (primary split per owner) | geo spend split, CPM/CTR by country | M |
| F5 | Backfill Dobias Meta history before 2026-04-20; connect Dobias Google | Dobias 12M nCAC, LTGP:CAC | M, owner access |
| F6 | `ref.market_cost_rates` (client x market x effective_from: ship cost/order, pay fee %, COD fee, duty %, return cost, COD refusal %) + Settings form | CM2, CM3, break-even aMER | M |
| F7 | RawBark COGS (Woo native COGS or `ref.product_costs`) | RawBark CM1 and LTGP | owner / client data |
| F8 | Dobias refunds from payload `refunds[]`; fix FX table (CAD after 2026-05, USD>CAD, EUR>USD, GBP) | refund line, local currency toggle | S |
| F9 | Daily list-price snapshot (Shopify compareAtPrice, Woo regular_price, Shoptet standard price) | compare-at markdown line | S, history starts at snapshot |
| F10 | GA4 country to ISO; GA4 for RawBark and Ethia; stg lag fix | funnel + scouting | M |
| F11 | Fill `ref.industry_benchmarks` per vertical x country from research | benchmarks | S |
| F12 | Woo shipping address ingestion (market = shipping, not billing) | correct Woo market | S |

## 7. Predicted LTGP: two options (decision pending)

Full explainer: `research/research-ltgp-prediction.md`.

- **Option A, maturity multiplier (recommended default).** First-order GP stays actual; only repeat GP is projected: repeat GP at day N x median ratio (day 365 / day N) of the last 6 to 12 mature cohorts of the same market, Nov and Dec cohorts excluded and given their own same-month-last-year ratio. Small markets use quarterly cohorts. Pure SQL, explainable, range band from the historical cohort spread.
- **Option B, BG/NBD + Gamma-Gamma.** Per-customer model of purchase rate, dropout and spend. Needs a Python job (VPS or Cloud Run, PyMC-Marketing), writes back to BQ. Learns from every customer, so it may beat A on small or young markets, but breaks on seasonality, replenishment rhythm and subscriptions.
- **Choose by backtest:** predict 365 d GP from day 30 / 60 / 90 / 180 for cohorts Jan 2024 to Sep 2025 using only data available at each freeze date; compare MAPE, bias and range coverage vs a naive baseline per market.
- Display: actual solid, forecast dashed with a band, always labelled "forecast", never mixed into actual totals or verdicts.

## 8. Page structure

1. **Header:** client, period, Compare, currency toggle (base / local), metric selector for the map.
2. **Map + leaderboard (entry):** choropleth by the selected metric (CM3, net revenue, nCAC, LTGP:CAC, status); sold markets solid, scouting countries hatched; leaderboard beside the map ranked by CM3 with the status chip.
3. **P&L matrix:** markets as columns (+ Total), rows = sections 3.1 to 3.6 top to bottom, deltas vs Compare under each value; rows collapse by section; n/a with the reason on hover.
4. **Market detail** (click a market): waterfall chart gross to CM3, cohort GP curve with LTGP vs CAC line (actual solid, forecast dashed), discount block, ops friction, funnel index vs home, leading indicators for Young markets.
5. **Scouting tab:** unsold countries ranked by opportunity index with demand, traffic and benchmark columns.

Three design options are mocked in the proposal artifact.

## 9. Phases

- **v1a (data):** F1, F2, F3, F8, F12; page with map, matrix, detail on CM1 basis; Dobias, RawBark (no GP), Manami, Venev counts.
- **v1b:** F4, F6 rate cards (CM2/CM3, break-even), F9 snapshot starts, F10 GA4, F11 benchmarks, scouting tab, status chips.
- **v1c:** F5 Dobias backfill, F7 RawBark COGS, prediction option chosen by backtest.

Migration range proposed: 290 to 299 (prefix `mk`).

Proposal artifact: https://claude.ai/artifact/EJGyA3ABUTYiHvjeyVSt4U (source copy in proposal.html).
