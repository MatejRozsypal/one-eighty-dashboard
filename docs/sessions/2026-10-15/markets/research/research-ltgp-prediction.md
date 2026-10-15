# Predicting LTGP 365 per market: two options explained

Prepared 2026-10-15 for Matej. Goal: understand the two candidate methods before choosing one for the dashboard.

**Definitions used throughout**

- **LTGP 365**: cumulative gross profit per new customer, from the first order to day 365 after it. We already measure it at 90 / 180 / 365 days for cohorts old enough.
- **Cohort**: all new customers of one market whose first order fell in one calendar month (or quarter, for small markets).
- **Mature cohort**: a cohort where every customer has had at least 365 days since their first order, so its LTGP 365 is a real, finished number.
- **Young cohort**: a cohort that has not reached 365 days yet. Example: customers acquired in August 2026 are about 60 days old today.

**Ground rule from the owner**: the dashboard shows pure, unadjusted actuals. Any forecast lives in its own column / table, is labelled "Forecast", carries its method and run date, and is drawn differently (dashed line, band). Actuals never get overwritten by forecasts.

---

## 1. The problem in one picture

A 60-day-old cohort has a real GP number at day 60. We want to know where it will land at day 365, so we can judge acquisition (CAC payback, aMER targets) now instead of waiting ten more months.

```
GP per customer
   ^
   |                                   .  .  .  . forecast at 365 (dashed)
   |                         .  .  .
   |               .  .  .            shaded band = plausible range
   |        _____/
   |   ____/   <- actual (solid) up to today, day 60
   |__/
   +----+-------+---------------------------------+----> days since first order
   0   60      90                                365
```

Both options answer the same question: "given what this cohort did in its first N days, what will its day-365 GP be?" They differ in **what they learn from**.

- Option A learns from **older cohorts as wholes** ("how much did cohorts typically grow between day 60 and day 365?").
- Option B learns from **every individual customer's purchase history** ("how often do people buy, how likely are they to have quietly left, and how much profit is in an order?").

---

## 2. Option A: maturity multiplier (cohort curve projection)

### 2.1 How it works

1. Take mature cohorts of the same market.
2. For each, compute GP per customer at day N (the age of the young cohort, e.g. 60) and at day 365.
3. Their ratio is the **maturity multiplier** for age N: `m(N) = GP365 / GP_N`.
4. Summarise the multipliers of the last K mature cohorts into one number.
5. Forecast for the young cohort: `GP365_forecast = GP_N(young) x m(N)`.

This is the same logic as the "N-day LTV" and cohort curve tools in analytics products: compare cohorts only at equal age, and keep immature cohorts out of pooled averages until they mature ([Amplitude, N-Day LTV](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-n-day-ltv)). Shopify LTV apps such as Lifetimely present predictive LTV as a forecast layered on top of historical cohort LTV, kept visually separate ([Lifetimely, Predictive LTV walkthrough](https://lifetimely.helpscoutdocs.com/article/69-predictive-ltv-walkthrough)).

### 2.2 The variant we should actually use: repeat-only multiplier

The plain version multiplies the **whole** day-N GP, which includes the first order. The first order is often 50 to 70 % of GP at day 60. If a young cohort came in on a big bundle (high first-order GP), the plain multiplier would wrongly assume its repeat buying will also be higher.

Better:

```
GP365_forecast = first_order_GP(young, actual)
               + repeat_GP_N(young, actual) x m_repeat(N)

m_repeat(N) = repeat_GP365 / repeat_GP_N   (from mature cohorts)
```

The first-order GP is an actual and stays an actual. Only the repeat part is projected. This is a simple decomposition, not an adjustment, so it fits the "pure numbers" preference.

### 2.3 Summary statistic choices

| Choice | What it is | When to use |
|---|---|---|
| Median of last K multipliers | Middle value, ignores outliers | Default. Robust when one cohort was odd (stock-out, promo). |
| Weighted average (ratio of sums) | `sum(repeat_GP365) / sum(repeat_GP_N)` across K cohorts, so big cohorts count more | When cohort sizes vary a lot and there are no outlier months. |
| Same month last year | Multiplier of the cohort acquired in the same calendar month 12 months earlier | Q4 cohorts (see failure modes). Needs 2+ years of history. |
| K | Number of mature cohorts used | 6 to 12 monthly cohorts. Fewer reacts faster to change, more is steadier. |

**Pooling as a fallback only.** For tiny markets, one option is to pool a market with a sister market of the same brand (e.g. use RawBark CZ multiplier for RawBark SK). Statisticians would "shrink" the small market towards the big one; the owner dislikes shrinkage, so do not blend. If pooling is needed, use the sister-market multiplier **as is** and label it "curve borrowed from CZ". Before borrowing, try the pure alternative first: **quarterly cohorts** instead of monthly ones (three times more customers per cohort, no borrowing at all).

### 2.4 Minimum data (our working rules, not from literature)

- History of at least 12 + K months in that market, so that K cohorts are mature. With K = 6 that is 18 months.
- At least 6 mature non-Q4 cohorts.
- Each cohort with roughly 100+ new customers; below that, switch to quarterly cohorts.
- Young cohort at least 30 days old. Before that, the day-N number is mostly first orders and the multiplier is huge and unstable.

### 2.5 How to show uncertainty

Two sources of uncertainty, both easy to compute in SQL:

1. **Curve spread**: apply the lowest and highest (or P10 and P90) multiplier of the K cohorts. Answers "how different have cohorts historically been?"
2. **Cohort size noise**: the young cohort's own day-N repeat GP is an average of few people. Its standard error is `stdev(repeat_GP_N per customer) / sqrt(customers)`. For small cohorts this is usually the bigger of the two (see the worked example).

Show the band as the combination of both. Never show a single number without the band.

### 2.6 Failure modes

| Failure | What happens | Mitigation |
|---|---|---|
| **Q4 / gifting seasonality** | November and December cohorts contain gift buyers and Black Friday bargain hunters who repeat less. Practitioner data from about 500 stores found BFCM and gifting cohorts produced about 20 % less lifetime revenue, already visible at 60 and 90 days ([Common Thread Co.](https://commonthreadco.com/blogs/ecommerce-playbook/dont-hold-back-bfcm)). Academic evidence points the same way: customers acquired with a 35 % discount had about half the long-term value ([Lewis 2006, JMR](https://www.iaorifors.com/paper/53212)). Using a "normal months" multiplier on a Q4 cohort overstates it; using Q4 multipliers on a spring cohort understates it. | Keep Nov/Dec out of the default pool. For Q4 cohorts use same-month-last-year multipliers, and flag them. |
| **Offer, product or subscription change** | If a subscription, a new consumable, a price change or a new flow launched after the mature cohorts were acquired, old curves describe a business that no longer exists. | Mark change dates in a small `ltgp_regime_changes` table; only use mature cohorts acquired after the change, or show "forecast suspended" until enough exist. |
| **Channel mix shift** | Cohorts heavy on discount-code influencers behave differently from organic cohorts. | Optional later: multiplier per acquisition channel group, only where volumes allow. |
| **Market too young** | No cohort is 365 days old, so there is no multiplier at all. | Borrow a sister-market curve (labelled) or show actuals only. Option B can partially help here (section 5). |
| **Early-age instability** | At day 14 to 30 the repeat GP is close to zero, so the ratio explodes. | No forecast before day 30. |

### 2.7 Cost and build

Pure SQL in BigQuery on the existing cohort mart. One scheduled query, negligible cost. Fully explainable: "this cohort is at 9 EUR of repeat GP at day 60; past cohorts grew 4.5x from day 60 to day 365."

---

## 3. Option B: BG/NBD (or Pareto/NBD) + Gamma-Gamma

These are the "Buy Till You Die" (BTYD) models from Fader and Hardie's line of research. They model each customer, then add customers up into a cohort.

### 3.1 What each part models, in plain language

The models tell a story about every customer:

1. **While a customer is "alive", they buy at their own steady rate** (some buy every month, some twice a year). The model does not try to guess each person's rate from scratch; it learns how rates are spread across all customers (parameters `r`, `alpha`) ([PyMC-Marketing BG/NBD notebook](https://www.pymc-marketing.io/en/latest/notebooks/clv/bg_nbd.html)).
2. **At some point a customer silently leaves and never buys again.** We never see the moment they leave. In **BG/NBD**, after each purchase there is a chance the customer drops out; that chance also varies across customers (parameters `a`, `b`) ([Fader, Hardie, Lee 2005](https://www.brucehardie.com/papers/bgnbd_2004-04-20.pdf); [PyMC-Marketing BetaGeoModel](https://pymc-marketing.readthedocs.io/en/stable/api/generated/pymc_marketing.clv.models.beta_geo.BetaGeoModel.html)). In **Pareto/NBD**, dropout can happen at any moment, not only after a purchase ([Schmittlein, Morrison, Colombo 1987](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/pareto_nbd.html)). BG/NBD was introduced as an easier-to-fit alternative that gives very similar results in most settings ([Fader, Hardie, Lee 2005, abstract](https://brucehardie.com/abstracts/abstract-fhl_2004-04.html)).
3. **Gamma-Gamma: how much each order is worth.** Each customer has their own average order value; individual orders vary around it; averages vary across customers. It is fitted on repeat customers only ([Fader and Hardie, gamma-gamma note](https://www.brucehardie.com/notes/025/gamma_gamma.pdf); [PyMC-Marketing Gamma-Gamma](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/gamma_gamma.html)). For us the "value" should be **GP per order**, not revenue (or revenue times a stable margin).

Intuition for "silent leaving": a customer who used to buy monthly and has not bought for 5 months is probably gone. A customer who buys twice a year and has not bought for 5 months is probably fine. The model uses exactly this logic.

### 3.2 Inputs (one row per customer, built in SQL)

| Field | Meaning |
|---|---|
| `frequency` | Number of **repeat** purchase days (first order excluded) |
| `recency` | Age of the customer at their last purchase (days from first order to last order) |
| `T` | Age of the customer today (days from first order to the cut-off date) |
| `monetary_value` | **Mean** GP per repeat order (not the sum) |

Only these "sufficient statistics" are needed ([Shopify Engineering](https://shopify.engineering/how-shopify-merchants-can-measure-retention); [lifetimes docs](https://lifetimes.readthedocs.io/en/latest/Quickstart.html)).

### 3.3 Outputs

- **Expected number of purchases** per customer in the next X days (e.g. from day 60 to day 365 of their life).
- **P(alive)**: probability the customer is still a customer.
- **Expected GP per future order** from Gamma-Gamma.
- Combined: expected future GP per customer. Add the cohort's actual GP to date and average over the cohort:

```
LTGP365_forecast(cohort) = actual GP to date (first order + repeats so far)
                         + avg over customers of [ E(purchases until day 365) x E(GP per order) ]
```

### 3.4 Assumptions that break in DTC e-commerce

| Assumption | Why it can break for our clients | What to do |
|---|---|---|
| **Stationarity**: buying and dropout rates do not change over time | Seasonality, promos, new launches all change rates ([MetricGate BG/NBD reference](https://metricgate.com/docs/bg-nbd-buy-till-you-die-model/)). Shopify notes the model "doesn't handle seasonal trends well" because frequency collapses all purchases into one number ([Shopify Engineering](https://shopify.engineering/how-shopify-merchants-can-measure-retention)). | Backtest Q4 cohorts separately. The extended Pareto/NBD in the R package CLVTools supports time-varying covariates such as a "high season" flag ([CLVTools](https://cloud.r-project.org/web/packages/CLVTools/index.html); [Bachmann, Meierer, Naef 2021, Marketing Science](https://rdrr.io/pkg/CLVTools/man/pnbd.html)). That is a later upgrade, not a start. |
| **Random (Poisson) buying while alive** | Pet food and cosmetics are replenishment products: people buy on a rhythm (every 4 to 6 weeks), not randomly. | Cohort-level totals usually survive this; individual predictions get noisier. Backtest decides. |
| **Non-contractual relationship** | Subscriptions (if a market has them) behave like contracts: regular orders until an explicit cancel. | Split subscribers out. For them a contractual model such as the shifted-beta-geometric fits better ([Fader and Hardie 2007, How to Project Customer Retention](https://brucehardie.com/papers/021); [PyMC-Marketing sBG](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/sBG.html)). |
| **Spend independent of frequency** (Gamma-Gamma) | In pet food, big-bag buyers buy less often, so spend and frequency can be negatively correlated. The model assumes no relationship ([Fader and Hardie note](https://www.brucehardie.com/notes/025/gamma_gamma.pdf)). | Check the correlation between `frequency` and `monetary_value` per market; it should be close to 0. The lifetimes example shows about 0.11 as acceptable ([lifetimes docs](https://lifetimes.readthedocs.io/en/latest/Quickstart.html)). If it is strongly off, use a flat "average GP per repeat order of this market" instead of Gamma-Gamma. |
| **Positive values** | Gamma-Gamma cannot handle negative values ([CLVTools gg](https://rdrr.io/cran/CLVTools/man/gg.html)). Orders with negative GP (heavy discount + shipping) exist. | Floor or exclude negative-GP orders for the spend model and document it. |
| **BG/NBD quirk** | Customers with zero repeat purchases are treated as certainly alive (dropout can only happen after a purchase) ([Fader, Hardie, Lee 2005](https://www.brucehardie.com/papers/bgnbd_2004-04-20.pdf)). For a 60-day cohort, most customers have zero repeats, so P(alive) reads too high. | Expected purchases are still sensible, but for P(alive) displays prefer Pareto/NBD or the modified BG/NBD (MBG/NBD, available in lifetimes as `ModifiedBetaGeoFitter`). |
| **Acquisition mix shifts** | The model learns rate distributions from past customers. A new channel bringing different people breaks that. | Same as Option A: regime-change table, refit after big changes. |

Note on shrinkage: these models are by nature "borrow from the population". A customer with one order gets a forecast mostly from the market-wide pattern. This is shrinkage at the customer level. At the cohort level it washes out (we only report cohort averages), but it is worth knowing given the owner's preference.

### 3.5 Minimum sample size

No paper gives a hard minimum. The classic benchmark dataset (CDNOW) is a single cohort of **2,357 customers** with 18 months of history ([BTYD cdnowSummary](https://search.r-project.org/CRAN/refmans/BTYD/html/cdnowSummary.html)). Shopify fits up to 50,000 customers per shop and saw diminishing returns beyond that ([Shopify Engineering](https://shopify.engineering/how-shopify-merchants-can-measure-retention)). The lifetimes docs warn that small samples can give implausible parameters and suggest a small penalizer ([lifetimes docs](https://lifetimes.readthedocs.io/en/latest/Quickstart.html)).

Our working rule (not from literature): at least about 1,000 customers in the fitting window and at least about 150 of them with a repeat purchase, plus a stability check (refit on random 70 % subsamples; parameters and the cohort forecast should move only a few percent).

Important difference from Option A: BG/NBD learns from **all** customers, including young ones, not only from finished cohorts. So a market with 12 to 18 months of history can be fitted even if it has very few mature cohorts. It still extrapolates to day 365 from shorter histories, which the backtest must check.

### 3.6 Running it with BigQuery

BigQuery ML has no BG/NBD or Gamma-Gamma model. Its trained model families are regressions, boosted trees, DNNs, matrix factorization, clustering, PCA, autoencoders, time series and imported models ([BigQuery ML end-to-end journeys](https://docs.cloud.google.com/bigquery/docs/e2e-journey); [model overview](https://docs.cloud.google.com/bigquery/docs/model-overview)). Google's own reference pipeline for BTYD models builds the RFM table in BigQuery and fits the model in Python with the lifetimes library ([GoogleCloudPlatform/tensorflow-lifetime-value](https://github.com/GoogleCloudPlatform/tensorflow-lifetime-value)).

Practical setup for us:

1. **BigQuery (SQL)**: scheduled query builds `ltgp_rfm_input` (one row per customer per market, with cut-off date).
2. **Python job**: reads the table, fits per market, writes `ltgp_forecast_btyd` (customer-level expectations and cohort aggregates, with `method`, `model_version`, `run_date`, `cutoff_date`) back to BigQuery.
   - Library: **PyMC-Marketing** (`BetaGeoModel`, `ParetoNBDModel`, `GammaGammaModel`). It is maintained; lifetimes has had no meaningful update since July 2020 ([PyMC-Marketing Gamma-Gamma notebook](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/gamma_gamma.html)).
   - Fit mode: MAP (fast point estimate) for daily runs; full MCMC weekly to get credible intervals for the band. In the PyMC-Marketing example, MCMC on 2,357 customers samples in about 4 seconds and MAP in about 2 seconds ([PyMC-Marketing BG/NBD notebook](https://www.pymc-marketing.io/en/latest/notebooks/clv/bg_nbd.html)).
3. **Where to run**: our Hostinger VPS (already hosts the dashboard assistant agent) as a cron job, or a Cloud Run job triggered by Cloud Scheduler. Either works.

### 3.7 Compute cost

Tiny. Even Dobias US at a few tens of thousands of customers fits in seconds to low minutes with MAP, a few minutes with MCMC. BigQuery scans for the RFM table are small. On the VPS it is effectively free; on Cloud Run it is cents per month. The real cost is **maintenance**: a Python dependency stack, a scheduled job that can fail silently, and model diagnostics someone must look at.

### 3.8 How to validate

Standard practice is a **time split**: fit on a calibration period, compare predictions with what actually happened in a holdout period. lifetimes provides `calibration_and_holdout_data` and a calibration-vs-holdout plot for this ([lifetimes docs](https://lifetimes.readthedocs.io/en/latest/Quickstart.html)). Split by time, never randomly by customer, or future information leaks into the fit. Our version of it is the backtest in section 6, run identically for both options.

---

## 4. Worked mini example (ILLUSTRATIVE NUMBERS, NOT REAL DATA)

> Every number in this section is made up to show the mechanics. None of it is RawBark data.

**Setting**: RawBark SK, cohort of customers whose first order was in August 2026. Today (mid-October) they are about 60 days old.

| Young cohort, actuals at day 60 | Value |
|---|---|
| New customers | 120 |
| First-order GP per customer | 22.0 EUR |
| Repeat GP per customer by day 60 | 9.0 EUR |
| Total GP per customer at day 60 (actual) | 31.0 EUR |

### 4.1 Option A

Mature cohorts of the same market (illustrative):

| Cohort | Repeat GP at day 60 | Repeat GP at day 365 | Multiplier |
|---|---|---|---|
| Oct 2024 | 8.5 | 38.0 | 4.47 |
| Nov 2024 (Q4) | 6.0 | 21.0 | 3.50 |
| Dec 2024 (Q4) | 5.0 | 16.0 | 3.20 |
| Jan 2025 | 9.0 | 41.0 | 4.56 |
| Feb 2025 | 8.8 | 37.5 | 4.26 |
| Mar 2025 | 9.5 | 44.0 | 4.63 |
| Apr 2025 | 10.0 | 43.0 | 4.30 |
| May 2025 | 8.0 | 39.5 | 4.94 |
| Jun 2025 | 9.2 | 38.0 | 4.13 |
| Jul 2025 | 8.6 | 40.0 | 4.65 |
| Aug 2025 | 9.4 | 46.5 | 4.95 |
| Sep 2025 | 9.0 | 39.0 | 4.33 |

- Q4 cohorts excluded (August is not Q4), 10 cohorts left.
- Median multiplier **4.51**; ratio of sums 4.52 (the two agree, no outlier problem); range 4.13 to 4.95.
- Same-month-last-year (Aug 2025) would give 4.95; we keep it only as a cross-check.

Forecast:

```
repeat GP to 365 = 9.0 x 4.51 = 40.6 EUR   (curve range 9.0 x 4.13 = 37.2 to 9.0 x 4.95 = 44.6)
LTGP 365         = 22.0 + 40.6 = 62.6 EUR  (curve range 59.2 to 66.6)
```

Now the cohort size noise: suppose repeat GP at day 60 per customer has a standard deviation of 20 EUR (most customers 0, a few 30 to 60). Standard error = 20 / sqrt(120) = 1.8 EUR, so the 95 % range of the young cohort's own repeat GP is about 5.4 to 12.6 EUR. Multiplied by 4.51 and added to 22:

```
LTGP 365 band including cohort size noise: about 46 to 79 EUR
```

Lesson: for a 120-customer cohort, **the young cohort's own small sample is the dominant source of uncertainty**, not the choice of multiplier. Quarterly cohorts (about 360 customers) would narrow that part of the band by about 40 % (sqrt(3)).

### 4.2 Option B

BG/NBD + Gamma-Gamma fitted on all RawBark SK customers acquired in the last 24 months (say 2,000 customers, 600 repeaters). For the August 2026 cohort the model returns (illustrative):

| Output | Value |
|---|---|
| Customers with a repeat already | 30 of 120 |
| Expected purchases per customer, day 61 to 365 | 1.15 |
| Average P(alive) today (Pareto/NBD, see quirk above) | 0.70 |
| Expected GP per future order (Gamma-Gamma) | 27.0 EUR |
| Expected future GP per customer | 1.15 x 27.0 = 31.1 EUR |

```
LTGP 365 = 31.0 (actual to date) + 31.1 = 62.1 EUR
MCMC 90 % credible interval: about 55 to 70 EUR
```

Caution on that interval: it covers parameter uncertainty only, not the risk that the model's story is wrong (seasonality, replenishment rhythm). Such intervals tend to be too narrow. The backtest measures how often actuals really land inside it.

The two methods agree here only because the numbers were made up to agree. In real data, **disagreement between A and B is itself a useful signal** that something changed (offer, channel mix, season).

### 4.3 How the dashboard would show it

Chart, one line per cohort or the selected cohort:

```
EUR / customer
 80 |                                          .......... upper band (79)
 70 |                                   ......
 63 |                         - - - - - - - - - - - - - ● 62.6  Forecast (A)
 55 |                 - - - -     ..........
 46 |          ____---  ......                          lower band (46)
 31 |    ●____/  <- today, day 60, actual 31.0 (solid)
 22 |___/
    +----+------+-----------------------------------------+---- days
    0   30     60                                        365
    solid = actual     dashed = forecast     shaded = range
```

Table, actuals and forecast never in the same cell:

| Market | Cohort | Customers | Age | GP 90 (actual) | GP 180 (actual) | GP 365 (actual) | **GP 365 forecast** | Range | Method | Run |
|---|---|---|---|---|---|---|---|---|---|---|
| RawBark SK | 2026-08 | 120 | 60 d | n/a | n/a | n/a | *62.6* | 46 to 79 | A, median of 10 non-Q4 | 2026-10-15 |

Rules: forecast column in italics with a "Forecast" badge; tooltip shows method, K, multiplier and band source; forecast data in its own table (`ltgp_forecast`), never joined into actual KPI tiles unless a "show forecast" toggle is on; once the cohort hits day 365 the forecast is kept for audit next to the actual (that is free, ongoing backtesting).

---

## 5. Recommendation matrix

New customers per month is what matters, not orders. Rough mapping from the order volumes given (new customers are a share of orders; confirm with real counts):

| Market type | Examples (to confirm) | Recommended method | Notes |
|---|---|---|---|
| **Large and mature**: 300+ new customers/month, 2+ years of history | Dobias US, RawBark CZ, likely Dobias CA | **Option A (repeat-only, median of last 6 to 12 non-Q4 monthly cohorts)** as default, **Option B as challenger** | A is transparent and cheap. Keep B running in the background and switch only if the backtest shows a clear win (e.g. 3+ pp lower MAPE). |
| **Small but mature**: 50 to 300 new customers/month, 18+ months | RawBark SK, Ethia CZ | **Option A on quarterly cohorts**; B worth testing here, because it uses every customer's history and can be more data-efficient | Show wide bands honestly. Do not borrow a sister-market curve unless quarterly cohorts are still too thin. |
| **Tiny**: under about 50 new customers/month | Venev | **No forecast**, actuals only, labelled "too few customers to forecast" | Fallback, clearly labelled: borrowed curve from a bigger market of the same brand, if one exists and the products match. |
| **Young market**: under 12 months of history, no mature cohort | Any new country launch | Option A impossible natively. Either **borrowed curve** (labelled) or **Option B** if 1,000+ customers exist; otherwise actuals only | Treat any forecast as provisional until the first own cohort matures; the backtest cannot validate it yet. |
| **Young cohort under 30 days** | Any market | **No forecast** | Too early; mostly first orders. |
| **Q4 cohorts** (Nov, Dec) | All markets | Option A with **same-month-last-year** multiplier; B flagged | Show a "Q4 cohort" badge. |
| **Markets with subscription** | If applicable | Split subscribers; sBG for them, A or B for the rest | Only if subscriptions are a meaningful share. |

Default if no time for a backtest: **Option A, repeat-only, median, non-Q4, quarterly cohorts for small markets, no forecast for tiny ones.** It is simple, auditable, SQL-only and matches the owner's pure-numbers stance.

---

## 6. Suggested backtest for the data team

Goal: choose per market, based on our own cohorts, not on theory.

**Data**: monthly cohorts acquired January 2024 to September 2025 (all have a finished actual GP 365 by today). Markets: Dobias US, Dobias CA, RawBark CZ, RawBark SK, Ethia CZ (Venev only for information).

**For each market, each cohort c and each checkpoint N in {30, 60, 90, 180}:**

1. Set the **freeze date** F = last day of cohort month + N days. Pretend today is F.
2. **No leakage**: use only transactions dated on or before F.
   - Option A: only cohorts that were already mature at F (acquired at least 365 days before F) may feed the multiplier.
   - Option B: fit BG/NBD + Gamma-Gamma on all customers of the market with transactions up to F (fitting window, e.g., the 24 months before F).
3. Predict GP 365 per customer for cohort c with:
   - **Baseline 0** (naive): GP 365 of the most recent mature cohort at F, ignoring cohort c's own data. If neither method beats this, early data adds nothing.
   - **A1**: repeat-only multiplier, median of last 6 mature non-Q4 cohorts.
   - **A2**: same, last 12, ratio of sums.
   - **A3** (Q4 cohorts only): same-month-last-year.
   - **B1**: BG/NBD + Gamma-Gamma, MAP.
   - **B2**: Pareto/NBD + Gamma-Gamma (or MBG/NBD), MAP.
   - For small markets, repeat everything with quarterly cohorts.
4. Compare with the actual GP 365.

**Metrics, per market x method x N:**

| Metric | Why |
|---|---|
| MAPE (mean absolute % error) | Headline accuracy |
| Median APE | Less sensitive to one bad cohort |
| Bias (mean signed % error) | Does the method systematically over- or under-forecast? Bias matters more than MAPE for budget decisions. |
| Band coverage | Share of actuals that fell inside the shown range. Target about 80 % for a P10 to P90 band. Too low means the band lies. |
| Q4 vs non-Q4 split | Seasonality failure shows up here. |

**Decision rule (proposal):**

- Per market, pick the method with the lowest MAPE at N = 60 and N = 90 (the ages we most need for acquisition decisions).
- If A and B are within 3 percentage points, pick A (simpler, SQL-only, explainable).
- If no method beats Baseline 0 by at least 5 pp at N = 60, do not forecast that market at day 60; start forecasting at the first N where it does.
- If band coverage is below 65 %, widen the band method before shipping.

**Effort estimate**: Option A backtest is a few SQL queries (half a day). Option B needs a Python notebook looping over freeze dates (about 21 cohorts x 4 checkpoints x 5 markets = 420 fits, each seconds with MAP; one to two days of work including the RFM-at-freeze-date SQL).

**After launch**: keep every published forecast row with its run date. When a cohort reaches day 365, the "forecast vs actual" pair is stored automatically, so accuracy is tracked live, not only once.

---

## 7. Sources

Academic and method notes

- Fader, Hardie, Lee (2005), "Counting Your Customers the Easy Way: An Alternative to the Pareto/NBD Model", Marketing Science 24(2). [Paper PDF](https://www.brucehardie.com/papers/bgnbd_2004-04-20.pdf), [abstract](https://brucehardie.com/abstracts/abstract-fhl_2004-04.html), [Excel implementation note](https://brucehardie.com/notes/004/bgnbd_spreadsheet_note.pdf)
- Fader, Hardie, "The Gamma-Gamma Model of Monetary Value" (note). [PDF](https://www.brucehardie.com/notes/025/gamma_gamma.pdf)
- Fader, Hardie (2007), "How to Project Customer Retention", Journal of Interactive Marketing. [Paper page](https://brucehardie.com/papers/021); 2018 revisit with beta-discrete-Weibull: [paper page](https://brucehardie.com/papers/037)
- Schmittlein, Morrison, Colombo (1987), Pareto/NBD, Management Science; implementation and background: [PyMC-Marketing Pareto/NBD notebook](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/pareto_nbd.html)
- Bachmann, Meierer, Naef (2021), "The Role of Time-Varying Contextual Factors in Latent Attrition Models for Customer Base Analysis", Marketing Science 40(4); implemented in [CLVTools](https://cloud.r-project.org/web/packages/CLVTools/index.html), see [pnbd help](https://rdrr.io/pkg/CLVTools/man/pnbd.html) and [CLVTools paper](https://arxiv.org/html/2602.09845v1)
- Lewis (2006), "Customer Acquisition Promotions and Customer Asset Value", Journal of Marketing Research 43(2). [Summary](https://www.iaorifors.com/paper/53212)
- BTYD R package, CDNOW benchmark data. [cdnowSummary](https://search.r-project.org/CRAN/refmans/BTYD/html/cdnowSummary.html)

Libraries and tooling

- PyMC-Marketing: [BG/NBD notebook](https://www.pymc-marketing.io/en/latest/notebooks/clv/bg_nbd.html), [BetaGeoModel API](https://pymc-marketing.readthedocs.io/en/stable/api/generated/pymc_marketing.clv.models.beta_geo.BetaGeoModel.html), [Gamma-Gamma notebook](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/gamma_gamma.html), [GammaGammaModel API](https://pymc-marketing.readthedocs.io/en/stable/api/generated/pymc_marketing.clv.models.gamma_gamma.GammaGammaModel.html), [sBG notebook](https://pymc-marketing.readthedocs.io/en/latest/notebooks/clv/sBG.html)
- lifetimes (unmaintained since 2020, still the reference for calibration/holdout helpers): [Quickstart](https://lifetimes.readthedocs.io/en/latest/Quickstart.html)
- BigQuery ML model families: [end-to-end journeys](https://docs.cloud.google.com/bigquery/docs/e2e-journey), [model overview](https://docs.cloud.google.com/bigquery/docs/model-overview)
- Google Cloud reference pipeline for LTV with lifetimes + BigQuery: [GoogleCloudPlatform/tensorflow-lifetime-value](https://github.com/GoogleCloudPlatform/tensorflow-lifetime-value)

Practitioner

- Shopify Engineering, "How Shopify Merchants Can Measure Retention" (BG/NBD in production, limitations). [Link](https://shopify.engineering/how-shopify-merchants-can-measure-retention)
- Lifetimely, Predictive LTV walkthrough. [Link](https://lifetimely.helpscoutdocs.com/article/69-predictive-ltv-walkthrough)
- Amplitude, N-Day LTV (immature cohorts excluded until mature). [Link](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-n-day-ltv)
- Common Thread Co., BFCM and gifting cohorts about 20 % lower lifetime revenue (podcast-based, about 500 stores, methodology not published). [Link](https://commonthreadco.com/blogs/ecommerce-playbook/dont-hold-back-bfcm)
- MetricGate, BG/NBD assumptions reference. [Link](https://metricgate.com/docs/bg-nbd-buy-till-you-die-model/)

**Caveats on sources**: the minimum-data rules (sections 2.4 and 3.5), the decision thresholds in section 6 and the market tiering in section 5 are our own working proposals, not taken from the literature. Lifetimely does not publish its algorithm. The Common Thread figure is from a talk, not a peer-reviewed study.
