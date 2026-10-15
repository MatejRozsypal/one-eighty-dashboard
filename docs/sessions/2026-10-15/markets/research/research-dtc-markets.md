# How DTC brands run and measure multiple markets

Research for the One Eighty "Markets" dashboard page. Compiled 2026-10-15.

**How to read this report**
- Every factual claim carries a source URL. Where the source is a vendor or agency blog (most benchmark content in this space), it is labelled `[vendor]` and should be read as directional, not as a census.
- Statements marked **[OE synthesis]** are our own design conclusions drawn from the sourced material. They are not claims about what any operator said.
- Searches for operator-specific frameworks (Andrew Faris, Eli Weiss, Taylor Holiday by name, Drivepoint per-market methodology, Lifetimely payback in days) mostly did not return primary material. Where nothing was found, the report says so instead of filling the gap.

---

## 1. The per-market metric stack

### 1.1 Revenue lines (top of the waterfall)

| Line | Definition | Source |
|---|---|---|
| Gross sales | Product selling price x quantity, before discounts, returns, taxes and shipping. | Shopify Help, Sales report: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report |
| Discounts | Line-item discounts plus each line's proportional share of cart-level discounts, applied before tax. | same |
| Returns / sales reversals | Value of returned products plus cancellations, edits, and adjustments. Shopify renamed "returns" to "sales reversals". | same, and Analytics fields: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields |
| Net sales | Gross sales minus discounts minus sales reversals, excluding shipping and tax. Shopify calls it the best approximation of actual revenue. | same |
| Total sales | Net sales plus shipping plus taxes (plus duties and fees in some reports). Definitions differ across Shopify reports. | same |
| Net revenue for CM | CTC: gross sales minus returns/refunds minus discounts plus shipping revenue collected from customers. | CTC, Complete Guide to Contribution Margin: https://commonthreadco.com/blogs/coachs-corner/the-complete-guide-to-ecommerce-contribution-margin |

Important limitation: compare-at price markdowns are invisible in Shopify's discount line. Shopify treats the lower selling price as the base price, and community answers state there is no native report of price versus compare-at price. Shopify community: https://community.shopify.com/t/how-can-i-run-a-sales-report-to-show-discount-loss/248148 and https://community.shopify.com/t/show-sale-pricing-in-order-admin/415239 (user-generated, not official docs).

VAT: Drivepoint's net sales LTV excludes shipping and sales tax; CTC's CM formula starts from net sales. VAT is never revenue. Drivepoint LTV benchmarks docs: https://docs.drivepoint.io/using-the-web-app/reports/benchmarks/ltv-benchmarks

### 1.2 Contribution margin ladder

There is no single industry standard for which costs sit in CM2 vs CM3. The common ladder:

- **CM1** = net revenue minus COGS (product, packaging, landed cost).
- **CM2** = CM1 minus shipping and fulfilment (3PL, pick/pack, carrier) minus payment/merchant fees (and in most versions returns handling).
- **CM3** = CM2 minus marketing (ad spend).

Sources: Venon docs https://docs.venon.io/en/articles/15612657-what-are-cm1-cm2-and-cm3 ; Polar Analytics https://www.polaranalytics.com/post/contribution-margin-formula-for-ecommerce-how-to-calculate-it [vendor]. Both note that some write-ups put ad spend in CM2, so labels must be defined on the page.

CTC's single-line version: Contribution Margin = (Net Sales + Shipping Revenue) - COGS - Ad Spend - Shipping & Fulfilment - Merchant Fees. Fixed costs (rent, salaries, software) are excluded. CTC benchmarks: 20-35% of net sales healthy, 35-50% strong, below 15% "danger zone". By vertical: beauty/skincare 30-45%, supplements/wellness 35-50%, food and beverage 15-25%. CTC says these come from "hundreds of Ecommerce brands". https://commonthreadco.com/blogs/coachs-corner/the-complete-guide-to-ecommerce-contribution-margin

CTC also recommends separating new-customer CM from returning-customer CM, and setting channel targets that ladder up to the CM goal (same source).

### 1.3 Efficiency metrics

| Metric | Definition | Source |
|---|---|---|
| MER | Total revenue / total marketing spend. Triple Whale's KB defines it inversely, (spend)/(revenue), so the direction must be stated. | Triple Whale KB: https://kb.triplewhale.com/en/articles/6127778-summary-page-metrics-library ; CTC MER: https://commonthreadco.com/blogs/coachs-corner/marketing-efficiency-ratio-mer-ecommerce-rating |
| aMER | New-customer revenue / total ad spend. Not native in any platform; built from first-time orders. CTC's inverse is ACONS (ad cost of new sales). Marginal aMER falls faster than blended MER as spend rises. | CTC: https://commonthreadco.com/blogs/ecommerce-playbook/spend-vs-amer-spending-power |
| nCAC / NCPA | Total (blended) ad spend / number of new customers in the period. Triple Whale uses a binary new vs returning flag (first order or not); Shopify uses three classes, so counts differ. | Triple Whale: https://www.triplewhale.com/university/customer-acquisition-metrics and https://triplewhale.readme.io/docs/why-is-my-new-vs-returning-customer-count-different-in-triple-whale-vs-shopify |
| Blended vs fully loaded CAC | Blended = direct ad spend per new customer; fully loaded = total marketing spend per new customer. CTC's CAC includes agency fees. | Drivepoint: https://docs.drivepoint.io/using-the-web-app/reports/benchmarks/ltv-benchmarks ; CTC CLV: https://commonthreadco.com/blogs/coachs-corner/customer-lifetime-value-ecommerce |
| nMER | New-customer revenue / acquisition-only spend; used because blended MER includes returning revenue and can hide weak acquisition. | Summarised in Triple Whale/MER search results; Triple Whale MER article: https://www.triplewhale.com/blog/marketing-efficiency-ratio.md |

### 1.4 First-order profit (the CTC "law")

- First-order profit = first-order revenue - COGS / cost of delivery (product, shipping, fulfilment, merchant fees, returns, taxes where included) - other variable costs - blended CAC. Only variable costs count.
- Break-even aMER = first-order AOV / max CAC. CTC worked example: $59 AOV, $21 COGS, max CAC about $26, break-even aMER about 2.27. At 50% gross margin you need roughly 2:1 aMER to be first-order profitable.
- Use the order-value distribution, not the mean AOV, when setting CAC caps (example: mean new-customer AOV $88.98 but the mode band $39-56).
- CTC's rule: pursue lifetime value over first-order profit only with "extraordinary" LTV (around 300%); first-order profit should govern "in almost every scenario". In their Bambu Earth test, an extra $70k spend returned only about $12k incrementally over 60 days.
- Source: https://commonthreadco.com/blogs/bridges/unlock-first-order-profitability
- CTC's forecast model offers three spend points: (a) first-month contribution positive (most conservative), (b) and (c) up to where cohort lifetime gross margin covers acquisition (more volume, longer payback). https://commonthreadco.com/blogs/ecommerce-playbook/spend-vs-amer-spending-power

### 1.5 Lifetime metrics

| Metric | Definition | Source |
|---|---|---|
| Contribution profit LTV (Drivepoint) | Cumulative contribution profit per customer; net revenue (gross - discounts - returns + shipping, excl. sales tax) x contribution margin of that month. Day-N versions (days since first order) recommended for charts. Also "CP LTV less blended CAC", "CP LTV / blended CAC". | https://docs.drivepoint.io/using-the-web-app/reports/benchmarks/ltv-benchmarks |
| LTGP | Lifetime gross profit per customer before fixed costs (repeat purchases minus cost to serve). LTGP:CAC is Hormozi's framing; 3:1 widely cited, the Hormozi attribution is second-hand. | Shortform episode summary: https://shortform.com/podcast/episode/the-game-w-alex-hormozi-2025-11-14-episode-summary-11-lifetime-gross-profit-ltgp-100m-lost-chapters-audiobook ; AOK Marketing: https://aokmarketing.com/evaluating-your-marketing-spend-is-it-delivering-enough-roi/ [vendor] |
| Cash multiplier (CTC) | Revenue of a customer segment over a limited window (30/60/90/120 days); functionally 60-day LTV. "Rule of 30:100": +30% LTV within 60 days, +100% within a year, so the first order is about 50% of 1-year value. | https://commonthreadco.com/blogs/coachs-corner/customer-lifetime-value-ecommerce |
| CAC payback | Time until a cohort's cumulative contribution (not revenue) covers its CAC. Cohort method: month where cumulative contribution per customer crosses CAC. First-order payback ratio = first-order contribution / CAC; above 1.0 means self-funding from day one. | Admetrics: https://admetrics.io/en/post/payback-periods-dtc-ecommerce-49765 [vendor]; Lifetimely/Amp help: https://help.useamp.com/article/682-cohort-analysis-use-cases [vendor] |
| Repeat / repurchase rate | Peel: share of a monthly cohort that buys again, tracked over time. Peel's "repeat orders rate" (repeat orders / customers) is a different metric and can exceed 100%. Drivepoint: cumulative customer retention = % of cohort with at least one returning purchase. | Peel: https://peelinsights.com/glossary/repurchase-rate and https://www.peelinsights.com/glossary/repeat-orders-rate-per-cohort ; Drivepoint as above |

On LTV:CAC thresholds: the 3:1 rule is called a SaaS import by at least one source, which proposes 2.5:1 to 4:1 on a 12-month cohort using CM2 rather than revenue for DTC (Eightx: https://eightx.co/blog/average-ecommerce-ltv-cac-ratio-by-vertical-2026 [vendor]). Using revenue LTV against CAC is the main reason brands believe they are at 3:1 when they are nearer 1:1 (same family of sources). Payback is increasingly weighted as heavily as the ratio; "under 12 months on contribution margin" is cited as an investor expectation (https://lebesgue.io/growth/the-ideal-ltv-to-cac-ratio-for-shopify-stores [vendor]).

### 1.6 Which metrics operators say matter most for allocation decisions

1. **Contribution margin (CM3) in absolute currency**, not ROAS. CTC places business-level CM above channel ROAS in its metric hierarchy. https://commonthreadco.com/blogs/coachs-corner/the-complete-guide-to-ecommerce-contribution-margin
2. **First-order profit / aMER vs break-even aMER** as the spend governor. https://commonthreadco.com/blogs/bridges/unlock-first-order-profitability
3. **Marginal (not average) efficiency** of the next unit of spend: marginal aMER declines faster than blended. https://commonthreadco.com/blogs/ecommerce-playbook/spend-vs-amer-spending-power
4. **Contribution-based LTV at fixed Day-N windows** and payback, compared at equal cohort age. Drivepoint docs above; cohort-age guidance in section 6.
5. No source found that publishes a per-market version of this hierarchy; the per-market application is [OE synthesis], and it is the same stack cut by ship-to country.

---

## 2. Decision frameworks: scale, hold, fix, exit

### 2.1 What operators and vendors publish

**Domestic prerequisites before going abroad** (ATTN Agency [vendor], https://www.attnagency.com/blog/international-expansion-unit-economics):
- Domestic CM 25%+ (healthy 15-25% after all variable costs; below 15% fix home first), AOV $80+ (sweet spot $100-200), domestic return rate under 15%, $50k+ budget per market, and at least 5% of traffic already coming from the target country.

**Staged test frameworks**

| Framework | Phases and budget | Read / thresholds | Source |
|---|---|---|---|
| ATTN 90-day test | D1-30 set-up (localised store, VAT registration, DDP pricing, creative). D31-60: $3-5k ad spend, target 100+ orders, track every cost line, returns and CS volume. D61-90: actual CM per order, CAC/LTV vs domestic, fixed-cost break-even. | Go if CM positive after 90 days (even marginally). Stop if CM worse than -10%. Gray zone 0 to -10% undefined. Expand beyond tier 1 only at 500+ orders/month per market with positive CM. | https://www.attnagency.com/blog/international-expansion-unit-economics [vendor] |
| Portless 3-stage | Stage 1 signal (30-60 days, $10-20k/market): CTR, PDP engagement, add-to-cart. Stage 2 confirmation (60-120 days, $30-50k): in-market CAC, AOV, CVR, CM, payback, early repeat. Stage 3 local commitment ($100k+). | Stage 1 advances only if intent metrics beat home benchmarks by 50%+ ("Stage 1 should rule markets out"). Stage 2 advances if unit economics clear the home floor within 90 days. Stage 3 only after Stage 2 economics hold 60+ days at volume. | https://www.portless.com/blogs/test-new-markets-ecommerce [vendor] |
| OpenBorder test-validate-scale | Concurrent tests in 2-3 markets; validate on CTR, CVR, CAC, refund rate vs home. | 10-20% outperformance vs home suggests scalable; cohorts of 500-1,000 customers or sessions per market; then 2-3x budget and check CAC stays stable before committing logistics. | https://www.openborder.com/blog/from-test-to-scale-how-ecommerce-brands-use-a-b-testing-to-identify-winning-markets [vendor] |
| Shopify | Test with Markets before building infrastructure; monitor CVR and AOV by region; one market at a time. | No numeric threshold. | https://www.shopify.com/enterprise/blog/global-expansion |

Note the disagreement: Portless wants intent metrics 50% better than home to advance, OpenBorder 10-20%. Neither publishes evidence for its number. **[OE synthesis]** Pick one and pre-register it; the stricter number suits small budgets because it only filters markets out.

**Spend governance once a market is live** (CTC):
- Conservative ceiling: spend to the point where first-month contribution of new customers is still positive; aggressive: to where cohort lifetime gross margin covers CAC. https://commonthreadco.com/blogs/ecommerce-playbook/spend-vs-amer-spending-power
- First-order profit governs "in almost every scenario". https://commonthreadco.com/blogs/bridges/unlock-first-order-profitability

### 2.2 How brands localise a test market

- Order of operations: local currency and local payment methods first, language last (one source claims 20-40% combined lift; directional). Summarised in https://thedtcplaybook.com/international-expansion/ [vendor]
- Stripe holdback experiment across 50+ payment methods: surfacing at least one relevant non-card method gave on average +7.4% conversion and +12% revenue; one geographically irrelevant method can cut conversion by up to 15%. https://stripe.com/blog/testing-the-conversion-impact-of-50-plus-global-payment-methods [vendor, own platform data]
- Stripe Adaptive Pricing (local currency): +3.3% subscription payment completion in a 15M-session holdback; Stripe also claims +17.8% average cross-border revenue; 76% of customers choose local currency when offered. https://stripe.com/guides/how-local-pricing-affects-subscription-conversion-for-media-entertainment-and-gaming and https://support.stripe.com/questions/adaptive-pricing [vendor]
- Non-English conversion can run 30-50% lower without proper localisation (ATTN [vendor], link above).
- Launch with a narrow assortment (8-12 SKUs: high margin, low weight, low returns), international prices 15-25% above domestic-equivalent, free-shipping threshold 1.5-2x domestic (ATTN [vendor], link above).
- Shopify Managed Markets: 3.5% per transaction (3.25% Plus) plus currency conversion; duties-included prices may be rounded by up to 2.5%; only for US-continental and some CA/UK merchants. https://www.shopify.com/international/pricing and https://help.shopify.com/en/manual/international/managed-markets

### 2.3 Leading indicators read before cohorts mature

From the frameworks above: CTR, CPM, PDP engagement, add-to-cart rate, CVR, in-market nCAC, AOV, refund/return rate, CS volume, early repeat signal (Portless, OpenBorder, ATTN links above). Meta's own stability marker is about 50 optimisation events per ad set in the 7 days after the last significant edit ("learning limited" otherwise). https://en-gb.facebook.com/business/help/269269737396981

### 2.4 Sizing a market you do not yet sell in

- Shopify: start with Sessions by location and existing unpaid orders by country; a high-traffic, low-conversion country signals friction (currency, language, shipping, payment) rather than lack of demand. Then search demand in local-language terms, competitor presence and price points, GDP per capita / disposable income, e-commerce penetration, regulation. https://www.shopify.com/enterprise/blog/global-expansion
- Google Market Finder ranks countries by search volume, CPC, ease of doing business, GDP growth; its maintenance status was questioned in early 2025. Keyword Planner run country by country gives volume (size proxy) and CPC (CAC proxy). https://thegtmdirectory.com/tools/market-finder/md and https://www.r-bloggers.com/2017/05/r-and-keyword-planner/
- Meta audience size as a proxy: Poland 21.0M users 18+, Czechia 6.0M, Hungary 5.8M, Germany 37.6M (Affect Group table [vendor]). https://affectgroup.com/blog/european-meta-ads-audience-total-reach-and-shopper-engagement/
- Eurostat: 78% of EU 16-74 year-olds bought online in 2025; Czechia had one of the largest increases since 2015 (+33 pp). https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20250220-3 and https://ec.europa.eu/eurostat/statistics-explained/index.php?title=E-commerce_statistics_for_individuals
- For CZ brands, Slovakia is the traditional first step because of language, culture and shared logistics (Upgates via BusinessInfo). https://www.businessinfo.cz/clanky/ceska-e-commerce-stale-v-kondici-expanzi-do-zahranici-planuje-vetsina-e-shopu/

---

## 3. Market-specific economics that change the P&L

### 3.1 EU VAT and OSS

- EU-wide EUR 10,000 threshold (sum of intra-EU B2C distance sales of goods plus TBE services, current and previous calendar year, excl. VAT). Below it, a seller established in one Member State may charge home VAT; above it, VAT is due at the customer's country rate, declared quarterly via the Union OSS. Not available to sellers with establishments in several Member States or shipping from more than one Member State. https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en and https://europa.eu/youreurope/business/taxation/vat/one-stop-shop/index_en.htm
- Consequence for the page **[OE synthesis]**: the same gross price yields different net revenue per country. A CZ brand selling into SK at a matched gross price keeps less (23% vs 21% VAT).
- Rates relevant to our markets:
  - CZ: 21% standard; reduced rates consolidated into a single 12% from 1 Jan 2024. https://meridianglobalservices.com/czech-republic-consolidation-of-the-reduced-vat-rates-into-a-single-12-rate-from-1st-january-2024-was-signed-into-law/ (Which rate applies to pet food or cosmetics was not verified in this research.)
  - SK: 23% standard from 1 Jan 2025 (was 20%), new 19% reduced, 5% super-reduced. https://www.ey.com/en_gl/technical/tax-alerts/slovakia-increases-vat-rate and https://trade.ec.europa.eu/access-to-markets/en/news/recent-vat-changes-certain-eu-member-states
  - HU 27% (highest in EU), DE 19%: https://taxfoundation.org/data/all/global/value-added-tax-vat/
  - PL 23%, AT 20% (table as of April 2023): https://www.fonoa.com/resources/blog/eu-vat-rates
- EU low-value imports: from 1 July 2026 a temporary EUR 3 customs duty per item (by tariff heading) on parcels under EUR 150 from outside the EU, on top of VAT. Relevant only for goods imported into the EU (for example Dobias product if ever sold into the EU from Canada). https://commission.europa.eu/news-and-media/news/ensuring-fairness-and-safety-eur3-customs-duty-low-value-parcels-2026-06-29_en

### 3.2 US and Canada (Dobias)

- US de minimis: the $800 exemption was suspended for all countries from 29 Aug 2025 (EO 14324); CBP made the suspension indefinite by interim final rules in June 2026; the One Big Beautiful Bill Act repeals it statutorily from 1 July 2027. KPMG: https://kpmg.com/us/en/taxnewsflash/news/2026/06/cbp-suspends-de-minimis-exemption.html ; BDO: https://www.bdo.com/insights/tax/cbp-suspends-de-minimis-exemption-and-introduces-new-postal-entry-requirements
- Canada to US specifically: goods sent through the postal stream became subject to tariff collection even if CUSMA-qualifying; commercial couriers (UPS, FedEx, DHL) can still apply CUSMA exemptions. CFIB: https://www.cfib-fcei.ca/en/tools-resources/us-de-minimis-exemption-cusma ; BDO Canada: https://www.bdo.ca/insights/u-s-to-suspend-de-minimis-exemption-for-commercial-shipments-effective-august-29-2025
- US Supreme Court struck down IEEPA tariffs (Feb 2026); a Section 122 global tariff from 24 Feb 2026 kept the CUSMA exemption; its 150-day limit would have lapsed around late July 2026 and current status was not confirmed. Osler: https://www.osler.com/en/insights/updates/u-s-supreme-court-strikes-down-ieepa-tariffs-but-global-tariff-introduced/ ; Fasken: https://www.fasken.com/en/knowledge/2026/02/us-supreme-court-rejects-ieepa-tariffs
- **[OE synthesis]** For the page: shipping lane (post vs courier) and CUSMA origin determine whether a US order carries duty + brokerage cost. Make "duties & brokerage" a separate CM2 cost line for US, not buried in shipping.
- Canada inbound de minimis: courier shipments from US/Mexico CAD 40 (tax) / CAD 150 (duty); postal CAD 20; from other countries CAD 20. https://www.ghy.com/trade-talk/canadas-new-courier-de-minimis-thresholds-under-cusma/ and https://docs.zonos.com/guides/decoding-canada
- US sales tax: economic nexus usually $100k sales or 200 transactions per state (CA, NY, TX $500k; AL, MS $250k); about 16 states had removed the transaction test by 1 Jan 2026 (Illinois from 1 Jan 2026, Utah from 1 Jul 2025). Avalara: https://www.avalara.com/us/en/blog/states-eliminating-economic-nexus-transaction-thresholds.html . Shopify tax reports use the shipping address for destination. https://help.shopify.com/en/manual/taxes/tax-reports

### 3.3 Cross-border shipping cost

- Indicative parcel costs from the US (1 lb): Canada $12-18, UK/EU $18-30, about 2-5x US domestic $5-8. International returns $15-40 vs $5-8 domestic; return rates 25-40% higher on DDU orders; duties + taxes under DDP 15-30% of product price in major markets. ATTN [vendor]: https://www.attnagency.com/blog/international-expansion-unit-economics
- ATTN's worked example (US skincare to UK): same AOV ($68), shipping $6 to $24, DDP duties+VAT $13.80, payment fees $2.27 to $3.99, returns $1.80 to $4.50, CAC $22 to $26; CM goes from +25.6% to about -28%. Same source. It is a vendor illustration, but it shows why market-level CM2 must be computed, not assumed equal to home.
- Packeta (Zásilkovna) consumer price list from 20 Feb 2025: pickup point SK 99 CZK, HU 109 CZK, RO 119 CZK; home delivery SK 169, HU 199, RO 209 CZK; COD fee 26 CZK. These are retail prices; e-shop contract prices differ. https://www.finance.cz/novinky/zasilkovna-zdrazi-za-co-si-od-20-unora-priplatite
- Shopsys test: pickup-point delivery cost shoppers on average 70 CZK; COD on average 35 CZK. https://www.shopsys.cz/?p=16283

### 3.4 Payment-method mix and cash on delivery (CZ, SK, HU, PL)

- CZ (Shoptet merchants, Nov 2025): bank transfer 33.6%, COD just under 23%, Shoptet Pay 11.8%; carriers Packeta 56%, personal pickup 45%, PPL 35%, Česká pošta 19%, DPD+GLS about 12%; AOV about 2,100 CZK. https://zpravy.kurzy.cz/839296-pro-obchodniky-na-shoptetu-byl-black-friday-rekordni/
- CZ market 2025 (APEK/Heureka): about 206 bn CZK goods, +6% YoY, AOV about 1,900 CZK, online about 15% of retail; supplements were the "winner of the year"; share of shoppers using a parcel locker at least once rose from 56% (Jan) to 72% (Dec). https://cc.cz/e-commerce-prekonala-ocekavani-cesi-podruhe-v-historii-v-e-shopech-nakoupili-za-vice-nez-200-miliard/
- CZ COD history: 32% of orders in 2018 (Heureka); a later Seznam article says 36% of Czechs use COD vs about 13% European average (undated). https://www.mediaguru.cz/podil-plateb-pomoci-online-karty-se-v-e-shopech-zvysuje and https://www.seznamzpravy.cz/clanek/ekonomika-byznys-doprava-velke-e-shopove-srovnani-cesi-se-lisi-od-zbytku-evropy-227429
- CZ lockers: 47% typically have parcels delivered to lockers (Geopost E-shopper Barometer 2025 via DPD CZ). https://www.lapostegroupe.com/en/news/dpd-cz-becomes-number-one-in-the-number-of-pickup-points-and-lockers-in-the-czech-republic
- SK: COD remains the most popular payment method (Heureka, no % given); market 1.84 bn EUR in 2024 (+6%). https://www.teraz.sk/ekonomika/heureka-e-commerce-na-slovensku-vlani-n/848854-clanok.html and https://podnikam.sk/pri-nakupe-na-internete-preferuju-slovaci-dobierku/ . No 2025 COD % found.
- HU: about 60% of parcels ordered with COD (Pénzcentrum, March 2024); 63% in a 2023 Ecommerce Hungary survey; an uncollected COD parcel costs a webshop about 4,000 HUF. https://www.penzcentrum.hu/vasarlas/20240311/bekemenyitenek-a-hazai-webaruhazak-legy-ovatos-ez-minden-megrendelot-erint-1148054
- PL: BLIK e-commerce payments +20% in 2025 to 1.4 bn transactions, avg basket 158 PLN; COD around 16% in a 2021 survey; parcel lockers dominant. https://itwiz.pl/blik-w-2025-roku-29-mld-transakcji-i-dynamiczny-rozwoj-e-commerce/ and https://antyweb.pl/zakupy-w-internecie-platnosci
- **[OE synthesis]** COD changes the P&L three ways: COD fee per order, refused/uncollected parcels (two-way shipping with zero revenue), and delayed cash. The page needs COD share and COD refusal rate per market.

### 3.5 Return rates by country

- Germany: about 24% of online parcels returned (Uni Bamberg, 2021 study: 530M returns); 2025 forecast about 550M parcels, "almost one in four". Fashion item-level about 34%. https://transport-online.de/en/news/returns-online-retail-number-returns-reaches-record-high-186156.html and https://www.textilwirtschaft.de/business/news/retourenforscher-legen-european-return-o-meter-vor-so-hoch-sind-die-retourenquoten-im-deutschen-online-modehandel-237248
- Czechia: average return rate long-run about 10%; fashion up to 30%; furniture/decor single digits. https://www.seznamzpravy.cz/clanek/311389 and https://www.novinky.cz/finance/499604-cesi-vrati-e-shopum-kazdy-desaty-nakup.html
- Poland fashion 15% vs Germany fashion 18.6% (ECDB, fashion only). https://ecdb.com/blog/poland-vs-dach-gsa-e-commerce-category-mix-compared/5247 [vendor]
- No reliable country figures found for SK, HU, AT, US, CA in consumables. Category matters more than country for our verticals (supplements, food, skincare) which return far less than fashion. **[OE synthesis]** Measure each client's own refund rate by market; do not import fashion-driven national averages.

### 3.6 Free-shipping thresholds

- Extra costs (shipping, tax, fees) are the top checkout abandonment reason at about 39-40% of shoppers (Baymard, Sept 2025 data). https://baymard.com/lists/cart-abandonment-rate
- Rules of thumb (vendor): threshold 15-30% above AOV (Fermat https://www.fermatcommerce.com/post/free-shipping-threshold , Eightx https://eightx.co/blog/average-free-shipping-threshold-by-vertical); Branvas argues the rule is wrong for 6 of 11 categories and conflates revenue with profit lift (https://branvas.com/blogs/news/free-shipping-threshold-by-category). US median threshold $64 in 2025 (Red Stag https://redstagfulfillment.com/what-percentage-of-ecommerce-orders-offer-free-shipping). International threshold 1.5-2x domestic (ATTN, above).
- **[OE synthesis]** Threshold must be set per market from that market's shipping cost and margin, and shown on the page as "share of orders at or just above threshold" (bunching) to see whether it moves AOV.

### 3.7 Price localisation, psychological pricing, FX

- Charm pricing: Anderson and Simester's mail-order field experiment found a $39 dress outsold the same dress at $34 and $44 (Quantitative Marketing and Economics, 2003); a 2013 paper flags possible confounds in .99 field experiments. https://ideas.repec.org/a/jec/journl/v9y2013i2p211-229.html and https://kolenda.io/tactics/charm-prices
- Stripe: 76% choose local currency when offered; currency conversion fee of 2-4% sits in the buyer price. https://support.stripe.com/questions/adaptive-pricing
- FX: ATTN cites margin swings of 3-8% per quarter and recommends a 2-3% FX buffer in the model [vendor]. https://www.attnagency.com/blog/international-expansion-unit-economics . Report growth both as reported and in constant currency to separate FX from performance. https://www.getmonetizely.com/articles/how-to-measure-multi-currency-revenue-impact-a-guide-for-saas-executives [vendor]

### 3.8 Market-specific media costs

- Meta location fees from 1 July 2026, charged on top of budget by audience location: Austria and Turkey 5%, France, Italy, Spain 3%, UK 2%. Not shown in Ads Manager spend. https://www.jonloomer.com/meta-location-fees/ and https://www.mediapost.com/publications/article/413378/meta-passes-eu-digital-services-tax-to-advertisers.html
- **[OE synthesis]** For Venev (CEE incl. AT) and any AT spend, ad cost per market must be spend x 1.05 plus VAT treatment, read from invoices, not from the API spend column.

---

## 4. Benchmarks by market and vertical

All figures below are third-party; none is a census of our verticals in our markets. Use as sanity ranges only.

### 4.1 CPM (Meta)

| Market | Value | Year | Source |
|---|---|---|---|
| US | FB $16-21, IG $20-28 | 2026 | Adligator [vendor, no methodology]: https://adligator.com/blog/meta-ads-cpm-by-country-benchmarks |
| US | avg $23.00, range $18-28 | 2026 projection | AdAmigo [vendor]: https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026 |
| CA | FB $11.00-14.50; avg $13.40 | 2026 | Adligator; AdAmigo |
| DE | FB $8-11; avg $10.05 | 2026 | Adligator; AdAmigo |
| AT | avg $9.50 ($7.80-11.20) | 2026 projection | AdAmigo |
| PL | FB $3.50-5.50; avg $5.50 | 2026 | Adligator; AdAmigo |
| CZ | FB $3.50-5.00; avg $6.20 | 2026 | Adligator; AdAmigo |
| HU | Eastern Europe group $2.50-5.50 | 2026 | Adligator |
| SK | not found | | |
| Relative CAC vs US | UK 0.9-1.2x, DE 1.1-1.5x, CA 0.85-1.0x, FR 1.2-1.6x | undated | ATTN [vendor]: https://www.attnagency.com/blog/international-expansion-unit-economics |

### 4.2 Vertical medians (Triple Whale, Aug 2025 to Jul 2026, its customer base, mostly US)

| Vertical | Blended paid CVR | CPM | AOV | ROAS | Meta CVR |
|---|---|---|---|---|---|
| Beauty | 2.38% | $16.90 | $61.18 | 1.82 | 1.79% |
| Health & Wellness | 1.83% | $20.34 | $62.99 | 1.55 | 1.50% |
| Pets & Animals | 2.39% | $16.71 | $60.12 | 1.89 | 1.63% |
| All (median) | 1.69% | | $61.22 | | |

Sources: https://www.triplewhale.com/blog/ecommerce-benchmarks and https://www.triplewhale.com/blog/facebook-ads-benchmarks (pages blocked direct fetch; figures from search extraction, verify before quoting externally). No fragrance row found.

### 4.3 Conversion rate by country

- US 2.30%, DE 2.22% (2024 averages, sample not shown). https://blockifyapp.com/blog/ecommerce-conversion-rate/ [vendor]
- Global 1.6% of visits (Salesforce via Statista, Q3 2025). https://www.statista.com/statistics/439576/global-e-commerce-conversion-rate/
- Germany 2.0-2.2% (Leap). https://leap.de/en/wissen/fachartikel/conversion-rate-benchmark-ecommerce-2026 [vendor]
- CZ, SK, PL, HU, AT, CA: no credible public figure found.

### 4.4 AOV

- CZ 2025 market AOV about 1,900 CZK (APEK/Heureka); Shoptet Nov 2025 about 2,100 CZK. Links in 3.4.
- PL BLIK e-commerce basket 158 PLN (2025). Link in 3.4.
- Dynamic Yield regional AOV: EMEA $193, Americas $158 (undated, live tool). https://marketing.dynamicyield.com/benchmarks/average-order-value/

### 4.5 Repeat rate, interpurchase time, payback, CAC

- Blended DTC: about 28% of customers place a second order within 12 months; consumables (supplements, food, pet) 30-40% at 12 months; beauty 21-35% (Eightx [vendor, back-calculated]). https://eightx.co/blog/average-repeat-purchase-rate-by-vertical
- Pet and health/supplements 40-55%, beauty 35-45% (LTV.ai [vendor]). https://www.ltv.ai/blog/average-customer-ltv-ecommerce-vertical-benchmarks
- 50% of repeat purchases happen within 30 days of the first order, 76% within 90 days (repeated across several vendor pages, single underlying study). Summarised from https://www.rivo.io/blog/customer-retention-strategies-dtc-brands [vendor]
- Poland: repeat e-shoppers 60%, 8 pp above European average (Geopost 2025). https://www.pap.pl/mediaroom/barometr-e-shopper-2025-od-geopost-po-dwoch-latach-spadkow-polscy-konsumenci-znow-chetnie
- Subscription churn: Recharge's health and wellness vertical rose from about 4.2% monthly (2023) to 8.8% (2026 trend report, 112M orders), via Eightx. Pet replenishment 5-8% monthly. https://eightx.co/blog/supplement-subscription-churn-rate-benchmark and https://eightx.co/blog/pet-subscription-churn-rate-benchmark [vendor]
- CAC payback: consumables (supplements, skincare, food) 3-6 months common, top brands under 3; non-consumables 6-12 months (Amp/Lifetimely). https://help.useamp.com/article/682-cohort-analysis-use-cases [vendor]
- Blended new-customer CAC, health and beauty about $25 (Amp, undated). https://useamp.com/benchmarks/new-customer-cac/ [vendor]
- LTV:CAC: supplements 4.8:1, pet 3.9:1, apparel 2.1:1, cross-industry median 3.4:1 (Eightx 2026 [vendor]). https://eightx.co/blog/average-ecommerce-ltv-cac-ratio-by-vertical-2026
- Fragrance: no benchmark found for repeat, CAC or CVR.

---

## 5. Discount measurement

### 5.1 Metric definitions

| Metric | Definition | Source |
|---|---|---|
| Discount penetration | Orders with a discount / total orders. | Intelligems docs: https://docs.intelligems.io/analytics/metric-definitions/discounts |
| Effective discount rate | Total discount value / gross sales (including full-price orders). Example: a 20% code used on 35% of orders = 7% effective. | Eightx [vendor]: https://eightx.co/blog/average-ecommerce-discount-rate-by-vertical-2026 |
| Average depth | Discount value / gross value of discounted orders only. | [OE synthesis], complement to the two above |
| Discount as % of revenue | Some tools divide by post-discount revenue, which understates intensity (50% off reads as 33%). | VortexIQ docs: https://docs.vortexiq.ai/nerve-centre/kpi-cards/shopify/discount-of-revenue.md |
| Full-price revenue share | Share of revenue sold without any discount; a falling share quarter over quarter signals demand being propped up with margin. | Eightx [vendor]: https://eightx.co/blog/average-discount-promo-depth-by-vertical |

### 5.2 Mechanisms to separate

- **Codes** and **automatic discounts** both land in Shopify's discount line (line-level plus allocated cart-level). Shopify sales report link in 1.1.
- **Compare-at / sale prices** do not appear as discounts in Shopify; gross sales is already the reduced price. Capturing them requires storing list price per order line. Shopify community links in 1.1. (WooCommerce and Shoptet equivalents were not researched here.)
- **Free shipping** is a shipping discount, reported in the shipping line (shipping charges minus shipping discounts minus refunded shipping), not in product discounts. https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report
- **Bundles / mini kits** priced below parts are a discount by price architecture, not by code. CTC's Bambu Earth finding (discount-acquired customers more valuable) was a bundle price, not a code. https://commonthreadco.com/blogs/coachs-corner/customer-lifetime-value-ecommerce

### 5.3 Judging whether a market is "discount addicted"

- Vendor tiers for effective discount rate: under 5% disciplined, over 15% promo-dependent (Eightx). A BigCommerce KPI card calls 10-20% of order totals a typical baseline and over 40% an alert; a Shopify card flags persistent over 25% as dependence (VortexIQ). These bands disagree and are vendor-set. Links in 5.1 and https://docs.vortexiq.ai/nerve-centre/kpi-cards/bigcommerce/discount-dependency
- Cohort evidence cuts both ways: CTC found Black Friday-acquired cohorts produced about 20% less lifetime revenue at 60 days, 90 days and lifetime, while Bambu Earth discount buyers were more valuable. https://commonthreadco.com/blogs/ecommerce-playbook/maximize-black-friday-sales and https://commonthreadco.com/blogs/coachs-corner/customer-lifetime-value-ecommerce
- CTC: start discounts with existing customers to avoid extra acquisition cost, then discount for new buyers only above target CAC (same CLV source).
- **[OE synthesis]** A practical per-market addiction test: (1) effective discount rate and penetration trend up while full-price share trends down; (2) returning customers' penetration exceeds new customers' (they have learned to wait); (3) revenue concentrates in promo weeks; (4) discount-acquired cohorts underperform full-price cohorts at equal age. Flag only when at least two hold, since vendor thresholds alone are not evidence.

---

## 6. Common traps in per-market reporting

1. **Market assignment.** Shopify offers "sales by billing location" and a shipping-country dimension; tax uses the shipping address (billing as fallback). Billing and shipping can differ (gifts, expats). https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report and https://help.shopify.com/en/manual/taxes/tax-reports . **[OE synthesis]** Use shipping country for orders and costs; define a customer's cohort market as the shipping country of the first order and keep it fixed, so a customer who moves country does not jump between cohorts. Report "cross-market repeat" as its own small number.
2. **Currency mixing.** Shopify sales metrics are in store currency; "Total sales by currency" (Shopify Payments only) shows presentment currency converted to store currency. https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report and https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales . Ad platforms report in each ad account's currency (multi-currency normalisation issue noted by https://www.cometly.com/post/multi-currency-attribution-reporting [vendor]). **[OE synthesis]** Convert at a single documented daily rate source; show constant-currency growth beside reported growth.
3. **Multi-country campaigns.** Advantage+ budget does not split spend evenly across countries; delivery can leak to non-targeted countries; check the country breakdown. https://www.jonloomer.com/break-from-meta-advertising-defaults/ and https://www.seoworks.co.uk/avoid-wasting-meta-ads-budget/ . Meta's Insights API will not aggregate across multiple attribution settings and country breakdowns of reach are limited to 13 months (Supermetrics notes: https://docs.supermetrics.com/docs/facebook-ads-reach-and-attribution-changes-june-10-2025). Separate campaigns are recommended for markets with different languages or CPMs (summarised from https://benly.ai/learn/meta-ads/meta-ads-international-targeting [vendor]). **[OE synthesis]** Country-level spend should come from the platform's country breakdown (delivery location), and MER per market should be the default because it does not depend on attribution.
4. **Spillover / halo between markets.** Attribution says nothing about incrementality. Geo experiments by country or region (Haus uses commuting zones or NUTS2-level targeting; synthetic controls built from other countries) are the operator answer; 4-8 weeks typical duration (vendor guidance). https://haus.io/blog/run-cleaner-more-accurate-holdout-tests-with-haus-commuting-zones and https://www.haus.io/case-study/affiliate-on-off-test-reveals-the-incrementality-of-loyalty-sites-for-global-dtc-brand
5. **Small-sample markets.** Detecting a 10% relative change on a 1% base conversion rate needs over 300,000 subjects; rule of thumb n = 16 p(1-p) / delta^2; do not peek repeatedly. https://www.evanmiller.org/the-low-base-rate-problem.html and https://www.evanmiller.org/how-not-to-run-an-ab-test.html . Meta needs about 50 optimisation events per week per ad set to stabilise (link in 2.3). ATTN uses 100+ orders as its minimum read (link in 2.1).
6. **Cohort maturity.** Compare cohorts at equal age (set the window to the youngest cohort's age); observed LTV of a live cohort is a lower bound (right-censoring); do not project from curves that have not flattened, and keep projected separate from realised. https://exacti.us/growth-library/cohort-analysis and https://www.adspirer.com/skills/ltv-calculation.md [vendor]
7. **Revenue LTV vs profit LTV.** Revenue-based LTV against CAC inflates the ratio; use contribution or gross profit. https://eightx.co/blog/average-ecommerce-ltv-cac-ratio-by-vertical-2026 [vendor]; Drivepoint contribution profit LTV (link in 1.5).
8. **New vs returning definitions differ by tool** (Shopify three-way vs Triple Whale binary). https://triplewhale.readme.io/docs/why-is-my-new-vs-returning-customer-count-different-in-triple-whale-vs-shopify
9. **Averages hide the distribution.** CTC: set CAC caps from the order-value distribution, not the mean AOV. https://commonthreadco.com/blogs/bridges/unlock-first-order-profitability
10. **Fees outside the spend column** (Meta location fees, Shopify Managed Markets 3.5%, currency conversion) distort per-market CM3 if read from APIs only. Links in 3.8 and 2.2.

---

## 7. Implications for the Markets page

Everything in this section is **[OE synthesis]** built on sections 1-6.

### 7.1 Unit of analysis and plumbing

- One row per **ship-to country**. Customer cohort market = ship-to country of first order, frozen.
- All money in the client's **reporting currency** with a toggle to local currency; store the daily rate used; show constant-currency growth beside reported.
- Revenue always **net of VAT/sales tax**. Show the VAT rate applied per market as a column so a 21% vs 23% difference is visible.
- Spend per market from the platform's **country breakdown**, plus fees not in the spend column (Meta AT 5%, Managed Markets 3.5%).
- Status badge per market: **Young** (under 100 orders lifetime or first order less than 90 days ago), **Maturing**, **Established**. Young markets switch to the leading-indicator view in 7.4.

### 7.2 Metrics that must be on the page (in waterfall order)

1. Orders, new customers, returning customers.
2. Gross sales, discounts (split: code / automatic / free shipping / compare-at where capturable), returns/refunds, **net revenue (excl. VAT)**.
3. COGS, **CM1** and CM1 %.
4. Shipping and fulfilment (net of shipping revenue), payment fees (incl. COD fee), duties and brokerage (US/CA lanes), returns handling, COD refusal cost, **CM2** and CM2 %.
5. Ad spend (incl. location fees), **CM3** and CM3 % (absolute CM3 is the ranking column).
6. **MER**, **aMER**, **nCAC**, break-even aMER for that market (first-order AOV / max CAC from that market's own CM2).
7. **First-order profit per new customer** (new-customer CM2 per order minus nCAC).
8. **New vs returning AOV**, returning revenue share.
9. **Repeat rate at 30 / 90 / 180 / 365 days**, read only for cohorts that have reached that age.
10. **Contribution-profit LTV at Day 90 / 180 / 365 per new customer**, **LTGP:CAC** at the same day, **CAC payback days** (first day cumulative contribution per customer crosses nCAC; "not yet" if never).
11. Discount block: penetration, effective discount rate, average depth, full-price revenue share, new vs returning penetration.
12. Market mix context: payment mix (COD share and refusal rate), delivery mix (pickup/locker vs home), refund rate.

### 7.3 Default thresholds (editable per client)

| Signal | Default | Basis |
|---|---|---|
| CM3 % healthy | 20-35% of net revenue; danger below 15% | CTC CM guide |
| First-order profit | at or above 0 = scale freely; below 0 requires LTV justification | CTC first-order profitability |
| Break-even aMER | computed per market; flag when 30-day aMER is within 10% of break-even | CTC worked example (about 2.0-2.3 at 50% GM) |
| LTGP:CAC (contribution-based, Day 365) | 3:1 scale, 2-3:1 hold, below 2:1 fix | 3:1 convention (Hormozi/industry); 2.5-4:1 DTC range from Eightx |
| CAC payback | consumables target under 180 days, good under 90 | Amp/Lifetimely 3-6 months common, top under 3 |
| Young-market go | positive CM2 per order and CM3 not worse than -10% after about 100 orders / 90 days | ATTN 90-day test |
| Young-market advance on intent | CTR, ATC, CVR at least home benchmark (stricter option: +50%) | Portless vs OpenBorder (disagree) |
| Discount addiction flag | effective discount rate over 15% AND at least one other signal from 5.3 | Eightx/VortexIQ bands, combined with cohort test |
| Sample-size badge | under 50 conversions/week per market or under 100 orders total = "directional" | Meta learning phase; ATTN |

Suggested state machine for the status column:
- **Scale**: CM3 positive, first-order profit at or above 0 (or payback under target), marginal aMER above break-even.
- **Hold**: CM3 positive but aMER near break-even, or LTGP:CAC 2-3:1.
- **Fix (acquisition)**: CM2 healthy but CM3 negative (ad efficiency, creative, CPM, offer problem).
- **Fix (structure)**: CM2 itself weak (shipping, duties, COD refusals, returns, VAT, pricing problem); show which cost line drives the gap vs the home market.
- **Exit / pause**: CM2 negative after a structural fix attempt, or CM3 worse than -10% after the test window with no improving leading indicators.

### 7.4 Leading indicators for young markets

Show against the home market as an index (home = 100), each with sample size and confidence badge:
- Sessions and share of unpaid (organic/direct) sessions from that country before any spend (demand proof).
- CPM, CTR, landing-page CVR, add-to-cart rate, checkout completion.
- nCAC and new-customer AOV vs home; first-order CM2 per order (computable from day 1).
- Payment and delivery mix vs what the market expects (for example COD share in HU, BLIK in PL, lockers in CZ/PL).
- Refund/return rate and COD refusal rate.
- Early repeat: 30-day and 60-day repeat at equal age vs the home market's cohorts at the same age.
- Search demand (Keyword Planner / Ahrefs volume by country) and Meta audience size as a sizing panel for markets not yet sold in.

### 7.5 Client-specific notes for configuration

- **Dobias (US + CA, Shopify)**: CA to US duty exposure depends on post vs courier and CUSMA origin; US sales tax nexus by state; Canadian GST/HST for domestic. Needs a duties and brokerage cost line and USD/CAD constant-currency view.
- **RawBark (CZ + SK, WooCommerce)**: SK VAT 23% vs CZ 21% (check OSS status and the applicable reduced rate for pet food, not verified here); Packeta SK lane costs; COD share and refusals.
- **Ethia (CZ, WooCommerce) and Manami (CZ, Shoptet)**: mostly single-market; the page still adds value through SK spillover orders (Manami SK campaigns), discount block, and compare-at capture on Shoptet (not researched).
- **Venev (CEE, Shopify)**: HU VAT 27% and high COD (about 60%), AT Meta location fee 5%, PL BLIK; widest spread of market economics, the strongest case for the CM2 decomposition.

### 7.6 Open gaps worth closing later

- No public CVR, CPM or COD benchmark for SK; no fragrance benchmarks at all.
- WooCommerce and Shoptet handling of sale/regular price in order exports was not researched.
- Current US Section 122 tariff status after its 150-day window was not confirmed.
