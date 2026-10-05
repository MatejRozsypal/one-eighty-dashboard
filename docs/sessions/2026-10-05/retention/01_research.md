# Research: sample-set to full-size conversion, cohort method

Date: 2026-10-05. Scope: web research plus synthesis. No repo files were read or changed.
Convention: "Sourced" = taken from a cited page. "Own reasoning" = my synthesis, not from a source. Quotes are under 15 words.
Reliability tags: [A] primary doc or textbook-level, [B] vendor help doc or community answer, [C] vendor/agency blog without disclosed method.

---

## 1. Definitions and pitfalls

### 1.1 The metric family (what each name really means)

| Name | Unit | Time frame | Typical formula | Biased by cohort age? |
|---|---|---|---|---|
| Lifetime repeat rate | customer | all time since first order | customers with 2+ orders / all customers | Yes, strongly |
| Time-bounded repeat purchase rate (30/60/90/180/365d) | customer | fixed days after own first order | customers with 2nd order within N days / customers in cohort | No, if cohort is mature for N |
| Retention rate (cohort, per period) | customer | per calendar period after acquisition (month 1, 2, 3...) | cohort customers ordering in period k / cohort size | Can fall and rise; not cumulative |
| Repurchase rate (cumulative) | customer | cumulative | cohort customers with 2+, 3+... orders by time t / cohort size | Only increases or plateaus |
| Repeat orders rate (Peel) | order per customer | cohort to date | repeat orders / customers in cohort | Yes, can exceed 100% |
| Returning customer rate (Shopify analytics) | customer in a period | reporting period | returning customers / all ordering customers in period | Mixes cohorts; depends on mix of new vs old buyers |
| New vs returning order share | order | reporting period | orders by returning customers / all orders | Mix metric, not a conversion metric |

Sourced definitions:
- Generic repeat purchase rate: "percentage of customers who have made more than one purchase" in a timeframe. Daasity glossary, https://help.daasity.com/core-concepts/metrics/metric-glossary [B].
- Shopify help: Returning customer rate is the "Percentage of returning customers relative to all customers who placed orders." https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields [B]. A returning customer is one "whose order history already includes at least one order" (https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/customers-reports). Shopify groups cohorts by first purchase date by default; the doc gives no explicit retention rate formula.
- A Shopify staff reply on the community forum gives returning / (returning + first-time) for the rate. https://community.shopify.com/t/how-is-the-returning-customer-rate-calculated-in-analytics/217973 [B, community; says nothing on time window or order vs customer basis]. Third-party explainers disagree on whether it is order-based or customer-based (BLOY, https://bloy.io/blog/repeat-purchase-rate-formula-on-shopify/ [C], says order-based). Treat as unresolved; do not rely on it for an internal definition.
- Klaviyo: no built-in formal definition. A community answer suggests two segments (1+ orders and 2+ orders in a timeframe) and dividing. https://community.klaviyo.com/analytics-72/repeat-purchase-rate-16942 [B].
- Lifetimely (Amp): Retention is "% of customers who come back" and is customer-level; repeat purchasing is order-level, "how many times retained customers reorder". https://help.useamp.com/article/1288-understanding-retention-vs-repeat-purchasing-in-lifetimely [B].
- Lifetimely Repurchase Rate report: cohort by "true, historical first-ever order"; rate = customers meeting the criterion / customers in cohort; windows 30, 60, 90, 180, 365 days; a dashed line means the cohort is "too recent for the data to be complete". https://help.useamp.com/article/675-repurchase-rate-report-walkthrough [B]. This is the closest published match to the method recommended below.
- Peel: Repeat Orders Rate = repeated orders / customers (can be 200%), by monthly acquisition cohort. https://www.peelinsights.com/ecommerce-analytics-explained/repeat-orders-rate-per-cohort [B]. Peel on retention vs repurchase: retention can decline over time; repurchase "only increases or plateaus"; newer right-most cohorts "need more time to mature". https://www.peelinsights.com/post/repurchase-vs-retention-rate-how-to-measure-and-why-these-metrics-are-essential-for-dtc-brands [B].
- RetentionX: cohorts are grouped by first purchase date; "product cohorts" group customers by the SKU of the first purchase and are also called product LTV. Found via search snippet (help.retentionx.com, newsletter.retentionx.com/p/customer-cohorts); the help pages returned HTTP 403 when fetched, so quotes not verified. [B]
- Triple Whale: repeat customer rate is customers with more than one purchase over total customers in a period; cohorts by first purchase timeframe. https://www.triplewhale.com/blog/customer-retention-analytics [C]. Its KB page (kb.triplewhale.com customer-cohorts) returned HTTP 403, not verified.
- Daasity: new customer = first-ever purchase in the window; returning customer = an additional purchase in the window by someone who bought before. Glossary gives concepts, no cohort formulas.

### 1.2 Why lifetime repeat rate is misleading (right censoring)

- Own reasoning, standard: a customer acquired last week has had no time to reorder, but is counted in the denominator. Lifetime repeat rate = f(cohort age mix). If acquisition grows fast, the share of young customers rises and the metric drops with no change in behaviour. If acquisition is paused, the metric rises mechanically. So a single lifetime number such as 14.3% cannot say whether conversion improves.
- Time-to-event theory calls this right censoring: observation ends before the event may have happened. "A live customer base is a censored dataset"; dropping or counting them as non-events biases estimates (nishbhana.com/CLV [C]; Wikipedia Kaplan-Meier [A]).
- Practice guidance matches: compare cohorts only "at the same age", and compare Day 30 only among cohorts that existed 30 days (eightx.co cohort guide [C]; Peel above [B]; Kissmetrics https://kissmetrics.io/blog/ecommerce-cohort-analysis [C], which recommends fixed 30/60/90/180/365 day measurement).
- Also pooled lifetime rates blur channels, offers and product entry: slicing by first product shows very different repeat behaviour (a starter kit cohort vs a single accessory cohort in the ecommercecircle.com.au Shopify playbook [C]). That is the reason to segment sample-set buyers.

### 1.3 Customer-level vs order-level, new vs returning share

- Customer-level metrics answer "how many people come back". Order-level metrics answer "how many orders come from repeaters". They are not interchangeable (Lifetimely above). One heavy repeater inflates order-based returning rates (BLOY [C]).
- New vs returning order share is a mix indicator that depends on how much you acquire right now. It will fall when you scale acquisition even if loyalty is stable. Do not use it as the answer to "are first-time buyers coming back".
- Retention vs repeat rate: retention per calendar period (customers active in month k) is not the same as cumulative "has ordered again by day N". For this question (one-time event: second order, or first full-size order) the cumulative, customer-level, fixed-horizon form is correct.

---

## 2. Cohort analysis practice

### 2.1 Cohort construction
- Acquisition cohort = customers grouped by month of their first valid order (Shopify default, Lifetimely, Peel, RetentionX all do this). Use the customer's true first-ever order, not first order in the filter window (Lifetimely says explicitly it does this).
- Product-entry cohort = cohort additionally split by what the first order contained (see section 3).

### 2.2 Cumulative curves and fixed horizons
- Core output: for each cohort, share of customers with the event (2nd order, or full-size order) by day N, at N = 30/60/90/180/365 (Lifetimely, Kissmetrics).
- Compare cohorts down a column at identical age. Only cohorts old enough for that column are included.
- Maturity rule (own reasoning): a monthly cohort is mature for horizon H only if its last member's first order is at least H days before the data cut-off, i.e. last_day_of_month + H <= as_of_date - sync_lag. Add a small lag (3 to 7 days) for order sync and late cancellations. Mixed-age cohorts in a partially mature month must be excluded, not shown partial.
- Seasonality: compare like with like (a November gift cohort will differ from March); keep cohort labels and show the month (Polar Analytics / commercecatalyst guidance [C]); for Manami, Advent and Christmas cohorts should be flagged separately (own reasoning).

### 2.3 Confidence intervals and minimum size
- Use the Wilson score interval for proportions, not the normal (Wald) interval. Wilson "never produces intervals outside [0, 1]" and has better coverage at small n or p near 0 or 1 (arXiv comparison https://arxiv.org/pdf/2508.10223 [A]; Wikipedia Binomial proportion CI https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval [A]). Wald collapses to zero width at 0 or 1; Clopper-Pearson is exact but conservative.
- Wilson formula: with p = k/n, z = 1.96:
  center = (p + z^2/(2n)) / (1 + z^2/n); half-width = z * sqrt(p(1-p)/n + z^2/(4n^2)) / (1 + z^2/n); CI = center +/- half-width.
- Worked numbers (own calculation, 95% Wilson), all at observed 20%: n=50 gives 11.2 to 33.0; n=100 gives 13.3 to 28.9; n=200 gives 15.0 to 26.1; n=500 gives 16.7 to 23.7; n=1000 gives 17.6 to 22.6. 3 of 40 gives 7.5% with CI 2.6 to 19.9; 0 of 30 gives CI 0 to 11.4.
- Detectable change between two cohorts (own calculation, two-sided alpha 0.05, 80% power, equal sizes): baseline 10%: n=100 per cohort needs about +15 points, n=200 about +10, n=500 about +6, n=1000 about +4. Baseline 5%: n=200 about +8 points, n=500 about +4.6. Implication: single monthly cohorts of 100 to 200 can only show large jumps; pool consecutive months (quarters, or rolling 3 months) to detect trends.
- Suggested rule (own reasoning, a convention not a standard): show a cohort's point estimate only if n >= 30; display the CI always; mark n < 100 as "low confidence"; do not rank cohorts whose CIs overlap.

### 2.4 Survival analysis for time to second order
- Kaplan-Meier: S(t) = product over event times (1 - d_i / n_i), with d_i events and n_i customers at risk. Customers without the event by cut-off are censored at their observed age. Greenwood's formula gives the variance; the key assumption is non-informative censoring. It cannot adjust for covariates (Cox/parametric models for that). Estimates degrade under heavy censoring. Source: https://en.wikipedia.org/wiki/Kaplan%E2%80%93Meier_estimator [A]; practical intro https://campus.datacamp.com/courses/machine-learning-for-marketing-analytics-in-r/modeling-time-to-reorder-with-survival-analysis [C]. (The PMC tutorial on KM could not be fetched, CAPTCHA.)
- Use here: for each entry cohort, "event" = first full-size purchase after the sample order; time = days since first order; censor at the as-of date. 1 - S(t) = cumulative conversion. It lets you display young cohorts honestly (a curve to date, with the censored tail marked) and read the curve at day 90/180 without waiting. Headline numbers should still use mature cohorts only.
- Competing events: 1 - KM overstates cumulative incidence when competing events exist (meta-analysis, https://www.sciencedirect.com/science/article/abs/pii/S0895435617300239 [A]; Aalen-Johansen is the fix). Here a competing event would be e.g. a full refund or cancellation of the sample order. Mostly negligible; if shares are material, exclude those customers up front (they never became customers) rather than modelling.
- Hazard of second order: h(t) = d_t / n_t per interval (per 7 or 30 days). Use it to see when the conversion window actually closes; choose the primary horizon where the hazard has decayed. Do not import benchmarks from other categories for this.
- Median time to event among converters only is conditional on converting and on the window, so it is biased low. Present KM-based "days until X% have converted" or the day-N rates instead. The widely quoted "50.3% of second orders within 30 days, 76.4% within 90" (bsandco.us, 156,110 customers, 365-day lookback, mostly consumables [C]) is conditional on having repurchased within 365 days; it is not the share of all customers, and not valid for a long-cycle product like perfume.
- Order ladder: conversion 1 to 2, 2 to 3, 3 to 4 (each denominator is customers who reached the previous order, each measured at fixed horizon from the previous order). Peel/Lifetimely show "2+, 3+, 4+ purchases". Third-party sources describe 1 to 2 as the hardest step (retentionside/others [C]).

### 2.5 Testing improvement over time
- Pooled comparison with a CI on the difference (Newcombe or Wilson-based) between "latest 3 mature months" and "previous 3 mature months" at the same horizon.
- For a series of ordered cohorts: Cochran-Armitage test for trend or logistic regression of event_by_H on cohort index (https://en.wikipedia.org/wiki/Cochran%E2%80%93Armitage_test_for_trend [A]); the test is for linear trend in proportions across ordered groups. Logistic regression lets you add controls (discount used, channel, country) when mix shifts.
- Own reasoning: improvement can be an artifact of mix change (more email-driven vs paid, different price point of sample set, new offer with credit voucher). Always show cohort size and, if available, acquisition channel and discount flag next to the trend.

---

## 3. Product-entry (first-product) cohorts

- Segmenting by first order's product is standard in the tools: Lifetimely filters by Marketing Channel, Product or Discount Code; RetentionX has "SKU of first purchase" cohorts. Ecommerce practice articles note the entry product is a stronger predictor than blended averages (ecommercecircle.com.au 90-day LTV framework [C]; discounted first orders produce lower repeat rates in same source [C]).
- Entry classes for Manami (own reasoning, to confirm with product mapping): S = order has sample set only; F = has full-size only; B = bundle/mixed (sample set plus full size, or gift set); O = other (accessory, advent calendar). Mixed first orders must not count as "converted" (the full-size is in the first order); put them in B.
- Sample-to-full-size conversion is typically defined as: customers whose first order was a discovery set and who later buy a full-size product (often with a credit/voucher equal to the set price). Credit model: "Offering a credit equal to the discovery set price" works as a conversion tool (Packamor, https://www.packamor.com/blogs/knowledge-hub/perfume-discovery-set-guide [C]); examples include Phlur $20 credit, Ayond $50 toward full-size, Day Three $60 (product pages / search results [C]). No source in my search discloses how any brand tracks it; the credit/voucher redemption is a direct but incomplete measure (not everyone uses the code), so measure from order lines, and report voucher redemption as a secondary view if a code exists.
- Benchmarks (state caution): no reliable published discovery-set-to-full-size benchmark found.
  - Freeyourself.com blog quotes sampling conversions (U Beauty 40%, Carolina Herrera 13%, YSL 8.33%, "routinely exceeds 25%") [C]. The page lists only secondary blog/vendor links, no definitions, window, sample sizes. These are free sampling campaigns, not paid discovery sets. Do not use as a target.
  - General repeat purchase benchmarks (all [C], vendor blogs, 2026): bsandco.us, 156,110 customers, 365-day lookback, overall 18.8% with 2+ orders; consumables 22 to 44%; fashion 10 to 17%. https://bsandco.us/blog-post/repeat-purchase-rate-benchmarks. Beauty and skincare: 25 to 30% at 90 days and 30 to 45% at 12 months, luxury serums 20 to 30% (mageloyalty.com, https://www.mageloyalty.com/blog/beauty-skincare-repeat-purchase-rate-benchmarks-for-2026, no method disclosed). Lifetimely-style rule of thumb in a search snippet: non-consumables 10 to 15% at 90 days (source page not verified).
  - These are any-second-order rates for mainly replenishable products; they are not comparable to "sample buyer buys full-size". Perfume is a low-frequency, high-consideration purchase. Useful only as order of magnitude: expect lower than skincare consumables; the most defensible benchmark is Manami's own full-size-entry customers and its own past cohorts.
- Own reasoning on what to compare: (a) sample-entry buyers' any-second-order and full-size rates vs (b) full-size-entry buyers' any-second-order rate at the same horizon. Gap between them is the "quality of the sample entry".

---

## 4. Reporting recommendations

Five numbers for the dashboard (own synthesis from sections 1 to 3):
1. Sample-to-full-size conversion within 90 days (and a second tile at 180 days), latest mature cohort or latest 3 mature months pooled, with n and 95% Wilson CI.
2. Trend chart: the same fixed-horizon rate by acquisition month, mature cohorts only, CI as error bars or band, immature months shown greyed or absent, with cohort size as small bars below.
3. Cumulative conversion curve by days since first order (KM), last 3 to 4 mature cohorts vs older pooled, with the day-N markers; this also answers "how fast".
4. Comparison line: any-second-order rate at the same horizon for sample-entry vs full-size-entry customers (context for what "good" means in this shop).
5. Cohort health: number of sample-set buyers per month, and how many are still immature for the horizon (so the owner sees how much data is "not ready yet"). Optional 6th: order ladder 1 to 2 and 2 to 3 for all customers.

Showing progress without misleading:
- One fixed horizon per chart (state it in the title). Never mix horizons or cohort ages in one line.
- Mature cohorts only for headline numbers; show immature ones only via KM curve with censoring marked.
- Always show n and CI; use Wilson; avoid ranking cohorts with overlapping CIs; use pooled periods when n is small.
- Report the conclusion as "latest 3 mature months vs previous 3 mature months" with the difference and its CI, not as month-over-month jumps.
- Keep lifetime repeat rate as a secondary, labelled number ("all customers, any age") or remove it from the retention story.

Common mistakes (sourced where noted):
- Comparing immature cohorts or lifetime numbers across cohorts of different age (eightx, Peel, Lifetimely above).
- Mixing customer-level and order-level metrics (Lifetimely; BLOY).
- Using the conditional timing stat "76% of repeats within 90 days" as if it were a share of all customers.
- Counting the full-size item bought in the same first order as "conversion".
- Reading noise: a month with n=60 moving 12 points is within the CI.
- Ignoring mix shift (discount codes, channels, Christmas/Advent buyers, gifts).
- Averaging time to second order across converters only (biased low) [own reasoning].
- Including cancelled/unpaid orders. A source states that cancelled/voided orders left in the denominator lower the rate slightly (podvector.ai [C]); define explicitly.

---

## 5. Data requirements and what breaks the analysis

Needed fields (own synthesis, plus guest-checkout sources):
- Customer identity key. Shopify guest checkout creates duplicate customer profiles when the same email checks out as guest; "same customer" is then split across customer IDs, causing repeat undercount (Shopify community threads: https://community.shopify.com/t/guest-checkout-behavior-for-returning-customers/580328 and the merge threads [B]; the "40 to 60% of duplicates" figure comes from a vendor page, mergeguard.store [C], treat as anecdotal). Use normalised email (lowercase, trimmed, remove Gmail dots/plus only with care) as primary key, then phone or shipping name/address as fallback; keep a mapping table; report the share of customers matched only by email.
- Orders: order id, order timestamp (stored in UTC), customer key, status (paid/cancelled/refunded), currency, discount codes, total, shipping country/market, sales channel.
- Line items: order id, product id and variant id, SKU, quantity, net line price, product title, so that each line can be mapped to a class.
- Product mapping table (maintained by hand): SKU/variant to class {sample set, full-size, bundle/gift set, accessory, advent calendar, other}, with valid-from dates when SKUs change, and including bundles that contain sample sets.
- Refunds and cancellations: exclude fully cancelled/unpaid orders from both cohort entry and events; for fully refunded first orders, decide and document (recommended: exclude the customer from the cohort, since no real purchase); partial refunds keep the order. Keep an "excluded customers" count for transparency.
- Time zone: assign calendar days and cohort months in Europe/Prague (or the shop zone) from UTC timestamps, otherwise orders near midnight and month ends shift cohorts. Measure the horizon in days (24-hour blocks) or by calendar date difference; document which.
- Test/staff/B2B/wholesale orders, and orders created by admin, must be flagged and excluded.
- Same-day or next-day add-on orders (split shipments, forgotten item): decide whether orders within 24 hours of the first count as part of the first order. Recommended: merge, and show the count as a sensitivity.
- Multi-market (CZ/SK, EUR/CZK): do not pool currencies for value metrics; for conversion rates (count-based) pooling is fine, but show market split if volumes allow.

What breaks it:
- Missing or inconsistent customer ID or email for guest orders (undercounts repeats, biases toward zero conversion).
- Back-filled or merged customers after the fact (cohorts move).
- SKU renamed or bundles re-created under new IDs (entry class misclassified).
- Subscription/replenishment orders created by apps (not applicable to Manami to my knowledge; unverified) or free replacement orders counted as repeat.
- Data not as-of-stamped: maturity needs a known data cut-off.
- Order edits that move line items between orders; post-purchase upsells appearing as separate orders.
- Discount/credit vouchers that are applied to a different customer identity than the buyer (gift scenario).

---

## 6. Recommended method (for the design agent)

### Definitions
- Valid order: paid, not cancelled, not test/staff, not fully refunded; timestamp converted to Europe/Prague.
- Customer key: normalised email (primary), with fallback links as described; one row per person.
- Order 1 (O1) = the customer's earliest valid order ever (true first-ever order, not first in a filter window). t1 = its timestamp.
- Entry class E of customer = class of O1: S (sample set only, no full-size line), F (full-size only), B (mixed or bundle), O (other).
- Cohort c = customers with first-order month c (Prague time), by entry class.
- Event "any repeat" = exists valid order j > O1 with t_j - t1 <= H days and t_j more than 24 h after t1 (adjust per the add-on rule).
- Event "upgrade" (for S) = exists valid order j > O1, time within H days, containing at least one full-size line (not the same order as O1).
- Horizon set H in {30, 60, 90, 180, 365}; primary for perfume: 90 and 180; use 365 for older cohorts. Pick the primary H from Manami's own KM/hazard where the curve flattens (own reasoning).
- Maturity: cohort c is mature for H iff (last day of month c) + H <= as_of_date - 7 days. Headline numbers use mature cohorts only.

### Formulas
- N_c = number of customers in cohort (class S) with a valid first order in month c.
- K_c,H = number of those with the upgrade event by H.
- Conversion U_c,H = K_c,H / N_c.
- 95% Wilson CI: center = (p + z^2/(2N)) / (1 + z^2/N); half = z * sqrt(p(1-p)/N + z^2/(4N^2)) / (1 + z^2/N), z = 1.96, p = K/N.
- Pooled over a set of mature months M: U_M,H = sum K / sum N, with a Wilson CI on the pooled counts.
- Change between two pooled periods: difference of proportions with a Newcombe (Wilson-based) CI; report as "+x points (95% CI a to b)". Trend over many cohorts: Cochran-Armitage or logistic regression on cohort index (optional, in an appendix).
- Any-repeat rate R_c,H analogously with the "any repeat" event, for S and for F cohorts (comparison).
- Kaplan-Meier curve for class S: event = first full-size purchase; time = days from t1; censor at as_of_date for those without the event; 1 - S(t) shown; plot last 3 to 4 mature cohorts vs older pooled; Greenwood CI band.
- Ladder: L_k,H = customers whose (k+1)-th order falls within H days of their k-th order / customers who reached the k-th order and are mature for H from that order (optional).
- Display rules: show N and CI everywhere; n < 30 suppress or label "too few"; n < 100 label "low confidence"; no month-over-month ranking when CIs overlap; one horizon per chart; immature cohorts hidden from rate charts (visible only on KM curve as censored).

### Minimal output for the owner
- "Of the N sample-set buyers acquired in [mature months], X% (CI a to b) bought a full-size within 90 days and Y% (CI) within 180 days. Latest 3 mature months vs previous 3: +/- z points (CI). Another M customers are not yet mature and are excluded."

### Open points for the design agent to resolve with the data
- Product mapping for Manami SKUs (sample set vs full-size vs gift sets vs advent calendar); how mixed first orders look.
- Whether the dashboard's "Repeat rate, lifetime 14.3%" is customer-based (this research could not verify; check the code).
- Typical time to full-size (use Manami's own KM; no valid external benchmark).
- Whether a credit/voucher exists for the sample set, which would let voucher redemption be a cross-check.
- Share of guest orders and email-matching quality.

---

## Source list (URL, publisher, reliability)
- https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields (Shopify Help) [B]
- https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/customers-reports (Shopify Help) [B]
- https://community.shopify.com/t/how-is-the-returning-customer-rate-calculated-in-analytics/217973 (Shopify Community) [B]
- https://community.klaviyo.com/analytics-72/repeat-purchase-rate-16942 (Klaviyo Community) [B]
- https://help.useamp.com/article/1288-understanding-retention-vs-repeat-purchasing-in-lifetimely (Amp/Lifetimely) [B]
- https://help.useamp.com/article/675-repurchase-rate-report-walkthrough (Amp/Lifetimely) [B]
- https://www.peelinsights.com/ecommerce-analytics-explained/repeat-orders-rate-per-cohort (Peel) [B]
- https://www.peelinsights.com/post/repurchase-vs-retention-rate-how-to-measure-and-why-these-metrics-are-essential-for-dtc-brands (Peel) [B]
- https://help.daasity.com/core-concepts/metrics/metric-glossary (Daasity) [B]
- https://www.triplewhale.com/blog/customer-retention-analytics (Triple Whale) [C]; https://help.retentionx.com and https://kb.triplewhale.com returned 403, only seen in search snippets
- https://en.wikipedia.org/wiki/Kaplan%E2%80%93Meier_estimator (Wikipedia) [A]
- https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval (Wikipedia) [A]
- https://arxiv.org/pdf/2508.10223 (arXiv, Wald/Wilson comparison) [A]
- https://www.sciencedirect.com/science/article/abs/pii/S0895435617300239 (J Clin Epidemiol, KM vs competing risks) [A]
- https://en.wikipedia.org/wiki/Cochran%E2%80%93Armitage_test_for_trend (Wikipedia) [A]
- https://bsandco.us/blog-post/repeat-purchase-rate-benchmarks (B.S. & Co., 156,110-customer DTC dataset) [C]
- https://www.mageloyalty.com/blog/beauty-skincare-repeat-purchase-rate-benchmarks-for-2026 (Mage Loyalty) [C]
- https://eightx.co/blog/what-is-cohort-analysis-ecommerce and https://eightx.co/blog/average-ecommerce-time-to-second-purchase-by-vertical-2026 (EightX) [C]
- https://kissmetrics.io/blog/ecommerce-cohort-analysis (Kissmetrics) [C]
- https://www.packamor.com/blogs/knowledge-hub/perfume-discovery-set-guide (Packamor) [C]
- https://freeyourself.com/blogs/news/perfume-sample-conversion-rates (Free Yourself) [C, low trust]
- https://www.ecommercecircle.com.au/shopify-cohort-analysis-90-day-ltv-framework/ (Ecommerce Circle) [C]
- https://community.shopify.com/t/guest-checkout-behavior-for-returning-customers/580328 (Shopify Community) [B]
