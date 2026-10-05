# 02 Audit: Manami retention metrics and the Testovací sada question

Date: 2026-10-05. Read-only audit. Dashboard repo `one-eighty-dashboard-repo`, branch main at `851cdb1` (clean). Warehouse `oneeighty-warehouse`, live view SQL from `infra/bigquery/live/` (the README says it was MD5-verified against INFORMATION_SCHEMA on 2026-10-05).
Paths: `R/` = `one-eighty-dashboard-repo/`, `L/` = `R/infra/bigquery/live/`, `M/` = `_clients/manami/` in the Second Brain.
Scratch table, the only write: `mart_qa.ret_manami_orders`. It holds one row per Manami order with product-class flags, expires on its own after 7 days, and its DDL is in Appendix A.
Data is live, and two new customers arrived while the audit was running. That is why some counts say 2,938 and others 2,940.

---

## 0. Answer in brief

1. **The tile is reproduced exactly.**
   - **What it is:** "Repeat rate, lifetime" = customers with 2 or more orders ÷ all customers.
   - **Who is counted:** every Manami email that has a non-cancelled Shoptet order since **2024-05-06**.
   - **Effect of the date picker:** none.
   - **Independent recompute from raw:** 2,940 customers, 14.25%, 1.191 orders per customer, LTV 1,221, days active 160. This matches the tile.
2. **Its tooltip is wrong.**
   - It says "36-month window". The mart uses 60 months, and for Manami the real window is **17 months**, because the Shoptet backfill only reaches back to 2024-05-06.
   - The number is a to-date rate, not a horizon rate. 40% of the customers counted first bought within the last 180 days, so they have had little time to come back.
   - **Restricted to customers who have had 365 days**, the lifetime repeat rate is **18.8%**, not 14.3%.
3. **The sample set (SKU 153, 550 then 600 CZK) is the entry product for 59% of customers.**
   - A further 2.6% buy the set together with a perfume, and 10.8% enter on single 100 CZK samples.
   - Within 365 days, **17.2%** of set-only entrants place a 2nd order (Wilson 95% CI 14.4 to 20.4).
   - Within 365 days, **15.2%** buy any perfume (12.5 to 18.3), and **11.8%** buy a 10 ml or larger bottle.
   - **About 85% of set buyers never buy a perfume within a year.**
4. **The drop-off is about coming back at all, not about what people buy.**
   - When set entrants do come back, **87.5% of their 2nd orders contain a perfume**.
   - Set entrants come back sooner than people whose first order was a perfume. Median days to the 2nd order, among those who reorder within 365 days: 26 vs 117. They then plateau, and by 365 days the two groups are level: 17.2% vs 20.2%, with overlapping CIs.
5. **First-to-second conversion has not measurably improved.**
   - **90 days, same months year on year:** Jan-Jun 2025 was 9.9% (6.5 to 14.8). Jan-Jun 2026 was 12.3% (9.7 to 15.5).
   - **90 days, before and after the "OE Tester to Full" flow (~March 2026):** 9.2% (6.4 to 12.9) before, 11.8% (8.9 to 15.4) after. A two-proportion test gives p of about 0.27.
   - **180 days, Oct-Mar year on year:** 12.4% then 10.3%.
   - **The 13 August meeting claim** that 90-day repurchase was rising to 15.4% in April did not hold. The all-customer May and June cohorts are at 9.8% and 8.5%.
6. **The numbers are too small to settle the trend.**
   - At about 11%, detecting a 3 pp lift with 80% power takes roughly 1,900 set entrants per arm. That is more than a year of current volume.
   - Monthly cohorts (24 to 150 set entrants) carry CIs of plus or minus 6 to 12 pp. Treat any month-to-month movement as noise.

---

## 1. Frontend: every tile and page

All of these pages show "Not affected by date range" (`R/dashboard/components/ui/PageNotes.tsx:7-10`). The date picker filters nothing on them: not acquisition, not orders.

### 1.1 Customers page (`R/dashboard/app/(app)/customers/page.tsx`)

Query: `getLifetimeSummary` (`R/dashboard/lib/queries/lifetime.ts:46-95`). It runs one SELECT over `mart.mart_customer_lifetime`, filtered by `client_id = @clientId AND currency = @currency` (`lifetime.ts:59-75`).

| Tile | Formula (`lifetime.ts`) | Manami value | Verdict |
|---|---|---|---|
| Customers | `COUNT(*)` of mart rows (one row per email; `:61`) | 2,938 | Correct. It is distinct emails since 2024-05-06, not "36 months". |
| Orders / customer | `AVG(total_orders)` (`:64`) | 1.19 | Correct, to date. |
| Avg AOV | `AVG(aov)`, the **mean of per-customer AOVs** (`:65`; the view defines `aov = SUM(rev)/COUNT(*)` per customer at `L/mart.mart_customer_lifetime.sql:42`) | 962 | **Misleading.** Order-weighted AOV is 1,026. The tile weights a one-order customer the same as a five-order one, and the label does not say so. |
| Repeat rate, lifetime | `COUNTIF(is_returning)/COUNT(*)`, where `is_returning = COUNT(*) > 1` (`:66`; view `:40`) | 14.3% | **The formula is correct but the tooltip is wrong.** It says "over the 36-month window" (`page.tsx:96`); the view filters 60 months (`view:11`). It is a to-date figure, so it is right-censored. |
| Days active | `AVG(IF(is_returning, days_active, NULL))`, with `days_active = DATE_DIFF(MAX, MIN)` (`:67`; view `:39`) | 160 | Matches its tooltip (`page.tsx:101`). It depends on the window length, so it can only grow as history accumulates. |
| LTV | `AVG(lifetime_revenue)`, the sum of `revenue` per email (`:62`) | 1,222 | To date, not over a fixed horizon. For Shoptet, revenue = `totalPriceWithVatCZK`, the whole order including shipping (`L/stg.stg_customer_orders.sql:45`). |
| LTGP | `AVG(lifetime_gross_profit)`, the sum of `margin_czk` (`:63`; stg `:49`) | 788 | This is product margin only. Shipping revenue (5.4% of Manami revenue) is in LTV but not in this margin base. |
| LTGP / LTV | `ltgp / ltv` (`:89`) | 64.5% | This is a ratio of two averages, which is fine. It is biased low by the shipping mismatch above. |
| LTV vs LTGP tooltip | "36-month window ... Customers first seen before the window count as new" (`page.tsx:116`) | n/a | **Wrong window.** The second half is true and matters for Manami (see 2.4). |
| Top-customers table | Masked email, top 25 by lifetime revenue (`lifetime.ts:105-143`) | n/a | Uses the same mart. |

**Currency and VAT.**
- The page filters `currency = 'CZK'`.
- Every Shoptet row is CZK-converted (`stg_customer_orders.sql:39`). Slovak (EUR) orders are included, converted.
- The stg comment says Shoptet revenue is "VAT inclusive" (`stg_customer_orders.sql:32`; `R/infra/bigquery/229_customer_marts_woo.sql:28`). **Manami is not a VAT payer.** In raw, `totalPriceWithoutVatCZK` equals `totalPriceWithVatCZK` on every order (with and without VAT both give an LTV of 1,221). So the VAT caveat is moot for Manami.
- One real side effect is in cost imputation. It divides by 1.21 (`L/stg.stg_shoptet_order_items.sql:4-5`), which understates imputed cost for a non-VAT payer by about 17%. This affects 272 of 7,040 lines, 5.5% of revenue. The set itself is never imputed.

### 1.2 Cohorts page (`R/dashboard/app/(app)/cohorts/page.tsx`)

- **Table.** Source is `getCohorts(.., 24)` reading `mart.mart_customer_cohorts` (`R/dashboard/lib/queries/cohorts.ts:51-61`). That view groups `mart_customer_lifetime` by first-order month (`L/mart.mart_customer_cohorts.sql:4,23`).
  - "Repeat rate" = `COUNTIF(is_returning)/COUNT(*)*100`, to date (`cohorts.sql:22`). The tooltip "with a second order, to date" (`page.tsx:272`) is honest.
  - The Y1 columns use `is_y1_complete`, meaning first order at least 365 days ago (`L/mart.mart_customer_lifetime.sql:29-35`). That part is sound.
- **"Repeat rate, mature cohorts" tile** (`page.tsx:223-224`).
  - **Formula:** an **unweighted mean of the to-date repeat rates** of cohorts with `ageMonths >= 12` (`cohorts.ts:86`), within the last 24 months.
  - **Problem 1:** a 12-month-old cohort and a 17-month-old cohort sit in the same average, so it is not a fixed-horizon rate.
  - **Problem 2:** `ageMonths` is calendar months. A customer who bought on the 31st of a 12-month-old cohort month has had about 11 months.
  - **Problem 3:** an unweighted mean gives a 26-customer cohort the same weight as a 150-customer one.
- **Heatmap.** Source is `getCohortGrid` reading `mart.mart_customer_cohort_grid` (`R/dashboard/lib/queries/cohortGrid.ts:184-195`; `L/mart.mart_customer_cohort_grid.sql`).
  - "Retention" is the share of the cohort that ordered in month offset k, including offset 0. Its denominator is the full cohort, which is correct.
  - **Caveat 1:** `is_elapsed` includes the current, partial month (`grid.sql:65-66`), so the right-most cell understates.
  - **Caveat 2:** a cohort with no activity at its latest offsets shows blanks, not zeros. That cohort is then dropped from the weighted "all cohorts" denominator (`cohortGrid.ts:243-253, 280-282`), which biases the summary row upward. This matters for Manami's small cohorts.
  - The tooltip says cohorts span "the full data window" (`page.tsx:148`). The code comment says the warehouse "holds 36" months (`page.tsx:90-91`), which is stale.
- **Market.** Shoptet's market is the order currency (`grid.sql:12-14`).

### 1.3 Repurchase page (`R/dashboard/app/(app)/repurchase/page.tsx`)

- **"X% of customers came back, lifetime"** (`page.tsx:60-64, 86`).
  - This is computed only over the rows that `getFirstProductRepeat` returns: the **top 15 products by repeat rate, with at least 30 customers each** (`R/dashboard/lib/queries/journey.ts:96-101`).
  - For Manami that is 16.7% (1,415 customers). Over all products it is 17.8% (1,758). It is a biased subset either way.
  - The only maturity rule is "first order at least 180 days ago" (`L/mart.mart_first_product_repeat.sql:14`). Repeat is `lifetime_orders >= 2`, with no horizon (`:9`), so it mixes customers who have had 6 months with customers who have had 17.
- **First-product table.**
  - Product identity is `item_name` (`L/stg.stg_customer_order_items.sql:47-49`). The order's product is its highest-revenue line (`L/mart.mart_customer_product_steps.sql:16-18`).
  - **Manami bug:** SKU 153 (the sample set) appears as **4 rows**, because the product was renamed over time. The current name is only 7 months old, so the rows show a maturity artefact as if it were a decline:

| Name on the page | Customers | Repeat |
|---|---|---|
| NOVÁ Testovací sada parfémů (2024-05 to 2026-01) | 325 | 19.1% |
| Testovací sada parfémů | 466 | 13.9% |
| NOVÁ Testovací sada všech parfémů | 57 | 12.3% |
| Testovací sada všech parfémů (since 2026-02-10) | 126 | 11.9% |

  - A first order containing the set and a perfume is anchored to the perfume.
  - Orders that have no item rows (9 Manami orders) drop out of the product marts entirely (inner join, `product_steps.sql:20-23`).
- **Sankey (product journey).** Source is `mart.mart_product_journey`, steps 1 to 3 (`journey.ts:58-80`; `L/mart.mart_product_journey.sql`). It counts customer transitions with no maturity rule and no window, and has the same item-name split.

### 1.4 Repeat timing (`R/dashboard/app/(app)/repurchase/timing/page.tsx`, `R/dashboard/lib/queries/repeatTiming.ts`)

- **How it is computed.**
  - It looks at first-to-second order gaps from `mart_customer_product_steps`.
  - Cohort: customers whose first order is between H and H+365 days ago, with H being 90, 180 or 365 (`repeatTiming.ts:177-195`; `page.tsx:31`).
  - Headline: "x of y came back" = second order within H days ÷ cohort (`page.tsx:126`).
  - **This is the only horizon-based, uncensored repeat metric in the product.**
- **Manami today:**

| Horizon | Rate | Cohort size |
|---|---|---|
| 90 days | 9.4% | 1,443 |
| 180 days | 11.3% | 1,022 |
| 365 days | 16.2% | 770 |

- **Limits.**
  - There is no product split, and so no sample-set split.
  - It is one rolling 12-month cohort, so there is no trend.
  - The bars are shares of repeaters, not of the cohort (as documented).

### 1.5 Time between orders (`R/dashboard/app/(app)/gaps/page.tsx`, `R/dashboard/lib/queries/gaps.ts`)

- **What it shows.** Every consecutive gap from `mart.mart_order_gaps`, pooled across all order numbers. Median, mean, p25/p75/p90 and buckets (`gaps.ts:71-83`).
- **Window.** 24 months (`L/mart.mart_order_gaps.sql:5`; label at `gaps.ts:104`). Gaps longer than the time observed so far cannot appear yet, which biases the distribution short. For Manami only about 17 months exist anyway.
- **Not a conversion metric.** It says nothing about the share of first-time buyers who come back.

---

## 2. Backend: marts and Manami specifics

### 2.1 Lineage
- **Order spine.** `raw.raw_shoptet_orders` → `stg.stg_shoptet_orders` (dedupe on `code` by latest `ingested_at`, drop `%storno%`, `cancelled`, `zrušeno`; `L/stg.stg_shoptet_orders.sql:2-17`) → `stg.stg_customer_orders`, the Shoptet branch of the migration 229 union (`L/stg.stg_customer_orders.sql:34-51`).
- **Marts built on that spine.**
  - `mart_customer_lifetime`: 60 months, `customer_key IS NOT NULL`.
  - `mart_customer_cohorts`: reads lifetime.
  - `mart_customer_cohort_grid`: 60 months.
  - `mart_customer_payback`: 60 months.
  - `mart_order_gaps`: 24 months.
  - `mart_customer_product_steps`: **no window**, plus an item join. `mart_first_product_repeat` and `mart_product_journey` read it.
  - These windows match the 229 header (`R/infra/bigquery/229_customer_marts_woo.sql:38-39`).
- **Line items.** `raw.raw_shoptet_order_items` → `stg.stg_shoptet_order_items` → `stg.stg_customer_order_items`, with product key = `item_name` (`L/stg.stg_customer_order_items.sql:40-52`).
- **Excluded from Shoptet.** `mart_customer_daily` and `mart_customer_market_daily` still exclude Shoptet (`229:35-37`). Anything that reads them shows no Manami new vs returning data.

### 2.2 Customer identity (Manami)
- **The key.** `customer_key = NULLIF(LOWER(TRIM(email)), '')` (`stg_customer_orders.sql:43`). Orders with no email are excluded from every customer mart: 14 orders. There is no `platform_customer_id` for Shoptet (`:41`), and Shoptet has no customer feed in the warehouse.
- **Guest checkout.** Shoptet exports an email on guest orders, so guests are counted. The same person using two emails is split into two customers.
  - Proxy check: 17 phone numbers carry 34 distinct emails. At most about 17 customers (0.6%) are under-merged.
  - No whitespace or case duplicates exist.
  - Same-day multiple orders: 6 pairs.
  - No test or agency emails were found (pattern `manami|test|oneeighty|example`).
- **"Returning".** Returning means `COUNT(*) > 1` per email inside the window (`lifetime.sql:40`).
  - The raw Shoptet `customerOrderCount` / `isReturningCustomer` fields are broken, because they are computed per sync batch. They are kept only for audit (`R/infra/bigquery/201_fix_stg_shoptet_is_returning.sql:5-16`; `R/infra/n8n/wf_shoptet_transform_fix.md`).
  - `stg_shoptet_orders.is_returning_customer` is derived again from email order sequence (`stg_shoptet_orders.sql:45-51`).

### 2.3 Refunds, cancellations, statuses (raw, deduped, Manami)

| statusName | Orders | Included? | Note |
|---|---|---|---|
| Vyřízena | 2,656 | yes | 10 have zero revenue |
| Slevový kód - testery (+ SK) | 727 + 92 | yes | An ops flag on set orders: 664 of 819 contain SKU 153. It was used until 2025-10. These are real paid orders. |
| Stornována | 121 | no | Revenue 0 |
| 2. připomínka –> storno | 7 | no | Caught by `LIKE '%storno%'` |
| Reklamace / Reklamace 20 ml flakon | 9 + 2 | **yes** | 7 have zero revenue, so complaint or replacement shipments count as repeat orders |
| 1.připomínka platby, Nevyřízená, Vyřizuje se, Připraveno k odeslání, Kalendář | about 28 | yes | Unpaid or open orders count |

- **Impact.** Excluding complaints, unpaid orders and zero-revenue orders moves the repeat rate from 14.25% to 14.15%, a 0.1 pp change. That is immaterial.
- **No refund field.** Refunds are not modelled for Shoptet at all.
- **Separate bug (not in the customer marts).** `stg_shoptet_order_items` filters status by exact match on `('storno','cancelled','zrušeno')` (`stg_shoptet_order_items.sql:13`). The order view uses `NOT LIKE '%storno%'` (`stg_shoptet_orders.sql:15`).
  - So **128 cancelled orders (227 lines, 130k CZK) leak into item-level views.**
  - The customer product marts are protected, because they inner-join to `stg_customer_orders`. Item-level product and SKU marts may not be. That was not checked here.

### 2.4 Data window and censoring
- **Start of data.** Manami data starts **2024-05-06**, the 24-month backfill horizon (`201_fix...sql:9-10`). There is no earlier history in raw.
  - Anyone who bought before May 2024 and returned after it is counted as a new customer. This is left truncation.
  - It probably **inflates the earliest cohorts' repeat rates** (2024-05 to 2024-10) and biases any trend downward.
  - Agency notes do not say when the shop opened.
- **Recent customers.** 40.2% of customers first ordered in the last 180 days, so the lifetime tile is dominated by customers who have not yet had time to return.
- **Duplicate raw rows.** Duplicates since about 2026-09-20 are handled by the stg dedupe on `code` (noted in `MEM/manami-advent-2026.md:14,20,23` per the Second Brain scan).

### 2.5 Line items and product naming (Manami)
- **Availability.** Line items exist for 3,492 of 3,501 orders in the window.
- **Fields.** Names are Czech marketing names that get renamed: SKU 153 has had 4 names. Variants hold the size ("Objem: 5 ml"). Item codes are mostly stable per product and size.
- **Product classes used in this audit** (rules in Appendix A):

| Class | Rule | Price (CZK) |
|---|---|---|
| Sample set | `item_code = '153'`: "NOVÁ Testovací sada parfémů" (2024-05 to 2026-01), "Testovací sada parfémů" (2024-11 to 2025-11), "NOVÁ Testovací sada všech parfémů" (2026-01 to 02), "Testovací sada všech parfémů" (2026-02 onward). 7 × 0.5 ml (`M/research/voc-2026-09-30/claims-inventory.md:40`; `M/brain_manami.md:94`). | 550, later 600 |
| Gift set + voucher | `409/*` | 1,250 / 1,600 |
| Single sample | "Vzorek parfému*", "Tester" (75/*) | 100 (some 40) |
| Full-size perfume | "Parfém <SCENT>" 5 / 10 / 15 / 20 ml, "Něžná – (Letní) Limitovaná edice", "Osobní JEDINEČNÝ parfém" | 650 / 1,050 / 1,450 / 1,800 |
| Perfume bundles | "Letní rituál na cesty", "Podzimní balíček *", "Gardénie, Jasmín, Lilie, Magnólie - limitovaná edice" | 1,390 to 1,590. Contents are not documented, so these are counted as perfume (a sensitivity choice). |
| Other | oils, oil samples, flower waters, salts, roll-ons, calendars, vouchers, packaging | n/a |

- **No 50 ml.** Manami sells no 50 ml. The largest bottle is 20 ml, and the agency analysis treats 5 ml as "more of a tester" (`M/reports/manami_letni_bundle_analyza_2026-06-12.md:61`).
- **Two definitions of "full size".** "Any perfume" and "10 ml or larger" are both reported below.

---

## 3. Independent recompute and reconciliation

The recompute reads raw directly, rather than through the marts. It takes `raw_shoptet_orders` deduped on `code`, excludes `%storno%`, keys on `LOWER(TRIM(email))` and has no window.

| Metric | Page | Raw recompute | Variant: also excl. complaints, unpaid and zero-revenue |
|---|---|---|---|
| Customers | 2,938 | 2,940 (2 new since) | 2,933 |
| Repeat rate | 14.3% | 14.25% | 14.15% |
| Orders / customer | 1.19 | 1.191 | 1.190 |
| LTV | 1,222 | 1,221 | 1,219 |
| Order-weighted AOV | (page shows 962, a per-customer mean) | 1,025 | 1,025 |
| Days active | 160 | 160 | 160 |
| LTGP | 788 | 805 before the imputed-cost adjustment | n/a |
| Repeat rate, customers first seen at least 365 days ago | n/a | **21.5%** (n = 1,084) | 21.6% |

**Biases, ranked by size.**
1. **Right censoring (large).** The tile mixes customers with 1 to 520 days of history. The fixed 365-day rate is 18.8% over everyone eligible, and the "first seen at least 365 days ago" to-date rate is 21.5%.
2. **Left truncation (unknown, probably material for 2024 cohorts).** See 2.4.
3. **Identity splits (at most 0.6%).**
4. **Complaints, unpaid orders and zero-revenue orders (0.1 pp).**
5. **Email case, whitespace and test orders (nil).**

---

## 4. The sample-set question, with real numbers

**Definitions.**
- First order = the earliest non-cancelled order per email (data starts 2024-05-06).
- Horizon H: a customer counts only if first order + H ≤ 2026-10-04.
- A monthly cohort is shown for H only when its last day + H ≤ 2026-10-04.
- "2nd order" means any order, same day included. Only 6 same-day second orders exist, so this is the dashboard definition.
- "Full" means a later order (sequence 2 or higher) containing a full-size perfume or bundle.
- CIs are Wilson 95%.

### 4.1 How customers enter (n = 2,940)

| First order | Customers | Share | Mean first-order revenue (CZK) | Repeat to date |
|---|---|---|---|---|
| Set, no perfume (**SET**) | 1,740 | 59.2% | 784 | 12.9% |
| Perfume, no set (**FULL**) | 592 | 20.1% | 1,310 | 15.7% |
| Single samples only | 318 | 10.8% | 410 | 14.2% |
| Other products only | 171 | 5.8% | 1,171 | 18.1% |
| Set + perfume | 76 | 2.6% | 1,958 | 23.7% |
| Gift set + voucher | 43 | 1.5% | 1,825 | 18.6% |

### 4.2 Horizon-based conversion, all eligible customers

| Entry | r30 | r60 | r90 | r180 | r365 | Perfume ≤180d | Perfume ≤365d | Median days to 2nd (if ≤365) | 2nd→3rd within 180d of 2nd |
|---|---|---|---|---|---|---|---|---|---|
| SET | 7.7% (6.5-9.1) n1602 | 10.2% | 11.8% (10.2-13.7) n1322 | 13.0% (11.1-15.2) n1000 | 17.2% (14.4-20.4) n600 | 11.6% (9.8-13.7) | 15.2% (12.5-18.3) | 26 (IQR 14-83) | 14.1% (9.2-20.9) n135 |
| FULL | 3.7% (2.5-5.7) n561 | 5.2% | 6.4% (4.5-8.9) n488 | 10.7% (8.0-14.3) n373 | 20.2% (15.8-25.4) n267 | 6.7% | 15.4% (11.5-20.2) | 117 (IQR 39-237) | 10.8% (5.3-20.6) n65 |
| Single samples | 6.4% | 9.1% | 10.4% | 15.5% | 20.9% n110 | 12.9% | 19.1% | 41 | 11.1% n27 |
| All customers | 6.6% | 8.9% | 10.4% | 13.0% | 18.8% n1084 | 10.5% | 15.3% | 44 | 14.4% n263 |

**What happens after the set.**
- SET entrants buying a perfume of 10 ml or more: 7.2% within 90 days, 8.4% within 180, **11.8% within 365**. For any perfume, including 5 ml, the figures are 11.0%, 11.6% and 15.2%.
- What SET entrants buy in their 2nd order (n = 224):

| 2nd order contains | Share |
|---|---|
| A perfume | 87.5% |
| Other products | 8.5% |
| Another set | 1.3% |
| Single samples | 1.3% |

  When set buyers return, they buy a perfume. The problem is that so few return.

**Reading the horizons.** r365 only covers first orders up to 2025-10-04 (older cohorts), while r90 runs to 2026-07-06. So the curve across horizons mixes populations, and left truncation affects r365 the most.

### 4.3 Which cohorts are mature enough
Data runs from 2024-05-06 to 2026-10-04.

| Horizon | Fully observed monthly cohorts | Count |
|---|---|---|
| 30 days | 2024-05 to 2026-08 | 28 |
| 60 days | 2024-05 to 2026-07 | 27 |
| 90 days | 2024-05 to 2026-06 | 26 |
| 180 days | 2024-05 to 2026-03 | 23 |
| 365 days | 2024-05 to 2025-09 | 17 |

- **Monthly SET cohorts are small:** 24 to 150 customers, median about 50. At p ≈ 12% the CI half-width is about 9 pp for n = 50 and about 5 pp for n = 150.
- **Practical minimum for a trend read:** a pooled quarter of 200 or more SET entrants. **No 365-day read exists for any cohort after Sep 2025.** The earliest 365-day read of a post-flow (March 2026) cohort will be in March 2027.

### 4.4 SET cohorts by month (%; blank = not yet observable)

| Cohort | n | r30 | r60 | r90 | r180 | r365 | perf≤180 | perf≤365 | Median d to 2nd |
|---|---|---|---|---|---|---|---|---|---|
| 2024-05 | 44 | 11.4 | 15.9 | 18.2 | 22.7 | 25.0 | 20.5 | 22.7 | 38 |
| 2024-06 | 37 | 16.2 | 18.9 | 21.6 | 21.6 | 24.3 | 21.6 | 24.3 | 26 |
| 2024-07 | 27 | 7.4 | 11.1 | 11.1 | 14.8 | 14.8 | 11.1 | 11.1 | 29 |
| 2024-08 | 38 | 18.4 | 18.4 | 21.1 | 21.1 | 21.1 | 15.8 | 15.8 | 11 |
| 2024-09 | 26 | 7.7 | 15.4 | 19.2 | 19.2 | 19.2 | 19.2 | 19.2 | 40 |
| 2024-10 | 34 | 11.8 | 17.6 | 23.5 | 23.5 | 23.5 | 20.6 | 20.6 | 27 |
| 2024-11 | 30 | 6.7 | 10.0 | 10.0 | 10.0 | 10.0 | 10.0 | 10.0 | 23 |
| 2024-12 | 28 | 7.1 | 7.1 | 7.1 | 10.7 | 10.7 | 10.7 | 10.7 | 20 |
| 2025-01 | 35 | 5.7 | 5.7 | 5.7 | 8.6 | 17.1 | 8.6 | 14.3 | 181 |
| 2025-02 | 42 | 7.1 | 9.5 | 14.3 | 14.3 | 14.3 | 11.9 | 11.9 | 15 |
| 2025-03 | 40 | 2.5 | 5.0 | 7.5 | 7.5 | 10.0 | 7.5 | 10.0 | 72 |
| 2025-04 | 27 | 7.4 | 11.1 | 11.1 | 14.8 | 25.9 | 11.1 | 22.2 | 117 |
| 2025-05 | 24 | 16.7 | 16.7 | 16.7 | 20.8 | 25.0 | 16.7 | 20.8 | 15 |
| 2025-06 | 34 | 5.9 | 5.9 | 5.9 | 5.9 | 8.8 | 5.9 | 5.9 | 14 |
| 2025-07 | 26 | 7.7 | 11.5 | 11.5 | 15.4 | 15.4 | 15.4 | 15.4 | 6 |
| 2025-08 | 58 | 12.1 | 17.2 | 17.2 | 17.2 | 20.7 | 15.5 | 17.2 | 22 |
| 2025-09 | 47 | 6.4 | 6.4 | 8.5 | 8.5 | 8.5 | 8.5 | 8.5 | 11 |
| 2025-10 | 62 | 8.1 | 9.7 | 9.7 | 9.7 | | 9.7 | | 13 |
| 2025-11 | 81 | 2.5 | 3.7 | 3.7 | 7.4 | | 7.4 | | 36 |
| 2025-12 | 56 | 5.4 | 5.4 | 7.1 | 7.1 | | 5.4 | | 23 |
| 2026-01 | 54 | 9.3 | 11.1 | 13.0 | 13.0 | | 11.1 | | 30 |
| 2026-02 | 52 | 5.8 | 11.5 | 15.4 | 15.4 | | 11.5 | | 31 |
| 2026-03 | 82 | 6.1 | 8.5 | 8.5 | 11.0 | | 9.8 | | 29 |
| 2026-04 | 89 | 11.2 | 14.6 | 16.9 | | | | | 17 |
| 2026-05 | 111 | 7.2 | 9.9 | 10.8 | | | | | 25 |
| 2026-06 | 100 | 8.0 | 11.0 | 11.0 | | | | | 10 |
| 2026-07 | 150 | 3.3 | 4.7 | | | | | | 29 |
| 2026-08 | 144 | 8.3 | | | | | | | 14 |

- November and December cohorts are consistently weak (gift buyers).
- The median-days column is among repeaters to date, so later cohorts are right-censored.

### 4.5 FULL cohorts by month (%, compact)

| Cohort | n | r90 | r180 | r365 |
|---|---|---|---|---|
| 2024-05 | 25 | 8.0 | 16.0 | 16.0 |
| 2024-06 | 12 | 8.3 | 25.0 | 41.7 |
| 2024-07 | 24 | 16.7 | 25.0 | 37.5 |
| 2024-08 | 12 | 0.0 | 8.3 | 25.0 |
| 2024-09 | 11 | 18.2 | 18.2 | 45.5 |
| 2024-10 | 10 | 0.0 | 0.0 | 10.0 |
| 2024-11 | 25 | 8.0 | 16.0 | 16.0 |
| 2024-12 | 47 | 2.1 | 6.4 | 12.8 |
| 2025-01 | 16 | 6.3 | 12.5 | 25.0 |
| 2025-02 | 15 | 6.7 | 13.3 | 20.0 |
| 2025-03 | 9 | 33.3 | 33.3 | 44.4 |
| 2025-04 | 8 | 12.5 | 12.5 | 12.5 |
| 2025-05 | 13 | 0.0 | 7.7 | 7.7 |
| 2025-06 | 12 | 0.0 | 8.3 | 8.3 |
| 2025-07 | 9 | 0.0 | 11.1 | 11.1 |
| 2025-08 | 9 | 0.0 | 0.0 | 11.1 |
| 2025-09 | 8 | 0.0 | 0.0 | 0.0 |
| 2025-10 | 12 | 8.3 | 8.3 | |
| 2025-11 | 16 | 0.0 | 0.0 | |
| 2025-12 | 21 | 4.8 | 4.8 | |
| 2026-01 | 23 | 4.3 | 13.0 | |
| 2026-02 | 22 | 4.5 | 4.5 | |
| 2026-03 | 8 | 0.0 | 0.0 | |
| 2026-04 | 15 | 0.0 | | |
| 2026-05 | 47 | 10.6 | | |
| 2026-06 | 45 | 4.4 | | |

Monthly FULL cohorts (8 to 47 customers) cannot be read individually.

### 4.6 Has conversion improved? Pooled windows, Wilson 95%

**Last 12 eligible months vs the 12 before.** For each horizon, the windows end at the last fully observable first-order date.

| Group | Horizon | Prior 12 m | Last 12 m |
|---|---|---|---|
| SET | 90d repeat | 12.7% (9.7-16.3) n387 [2024-07 to 2025-07] | 10.7% (8.8-13.0) n850 [2025-07 to 2026-07] |
| SET | 180d repeat | 15.8% (12.5-19.8) n385 | 11.2% (9.0-14.0) n615 |
| SET | 365d repeat | 21.5% (16.1-28.1) n177 [May-Oct 2024 only] | 15.4% (12.2-19.1) n423 |
| SET | perfume ≤180d | 14.3% (11.1-18.1) | 9.9% (7.8-12.5) |
| SET | perfume ≤365d | 19.2% (14.1-25.6) | 13.5% (10.5-17.1) |
| FULL | 90d repeat | 7.5% (4.6-12.1) n199 | 5.2% (3.1-8.8) n248 |
| FULL | 180d repeat | 14.4% (10.3-19.8) n208 | 6.1% (3.3-10.8) n165 |
| FULL | 365d repeat | 31.0% (22.1-41.5) n84 | 15.3% (10.8-21.2) n183 |

**Same months year on year (controls for seasonality and keeps away from the left-truncated 2024 cohorts).**

| Group | Comparison | Before | After |
|---|---|---|---|
| SET | 90d repeat, Jan-Jun 2025 vs Jan-Jun 2026 | 9.9% (6.5-14.8) n202 | 12.3% (9.7-15.5) n488 |
| SET | 90d perfume, same windows | 8.9% (5.7-13.6) | 11.5% (8.9-14.6) |
| SET | 180d repeat, Oct24-Mar25 vs Oct25-Mar26 | 12.4% (8.6-17.6) n209 | 10.3% (7.7-13.8) n387 |
| FULL | 90d repeat, Jan-Jun 2025 vs Jan-Jun 2026 | 8.2% (3.8-16.8) n73 | 5.6% (3.0-10.3) n160 |
| FULL | 180d repeat, Oct24-Mar25 vs Oct25-Mar26 | 11.5% (7.0-18.3) n122 | 5.9% (2.7-12.2) n102 |

**Before and after the "OE Tester to Full" flow (SET entrants; flow built about March 2026).**

| Horizon | Pre: first order 2025-10-01 to 2026-02-28 (n305) | Post: 2026-03-01 to 2026-06-30 (n382) |
|---|---|---|
| 30d | 5.9% (3.8-9.1) | 8.1% (5.8-11.3) |
| 60d | 7.9% (5.3-11.4) | 11.0% (8.2-14.5) |
| 90d | 9.2% (6.4-12.9) | 11.8% (8.9-15.4); z ≈ 1.1, p ≈ 0.27 |

- The pre window includes the weak Nov and Dec gift cohorts, which flatters the "post" side.

**Verdict.**
- **No statistically supported improvement**, at any horizon or for any group. Every CI overlaps.
- The point estimates for SET are up 2 to 3 pp at 30 to 90 days in 2026 against 2025, and down at 180 days.
- The older "decline" in the rolling comparisons is at least partly left truncation in the 2024 cohorts, so it should not be reported as a real deterioration either.
- **Power:** detecting 11% → 14% at 80% power needs about 1,900 SET entrants per arm. A randomised holdout in the flow, rather than before/after, is the only way to get a causal read at Manami's volume.

---

## 5. Second Brain: state of the sample-set initiative

Citations come from a scan of the Second Brain. The key lines were re-checked by me.

- **Problem as owned by the agency.** The weakness is low tester → full-size conversion, and "Tester to Full" is the key flow (`M/brain_manami.md:140-142`).
- **The 2026-06-12 bundle analysis** (`M/reports/manami_letni_bundle_analyza_2026-06-12.md:20,47-49`):
  - 71% of customers start with a tester, 1,561 of them. This definition includes single samples.
  - 12.2% of those later bought a perfume, 191 customers. That is an unbounded, censored figure.
  - Repeat rate 14.9%.
  - This audit's horizon-based equivalent is 15.2% buying a perfume within 365 days (12.5 to 18.3).
- **"OE Tester to Full" Ecomail flow.**
  - Built around March 2026 (`agency/meetings/internal/2026-03-13-meeting.md:3095` per the scan).
  - Separate post-purchase emails for set buyers and for bottle buyers were agreed on 2026-04-16 (`M/meetings/2026-04-16-...md:873-877` per the scan).
  - Results:

| Period | Sends | Conversion | Revenue | Source |
|---|---|---|---|---|
| May | 622 | 0.97% | 9,193 CZK | `M/reports/manami_30d_2026-05-31.md:278` |
| June | n/a | 1.1% | n/a | `M/reports/manami_30d_2026-06-30.md:260` per the scan |
| Cumulative to early August | n/a | 0.87% | n/a | `M/reports/manami_30d_2026-07-31.md:356` |
| Last 4 weeks to early August | 759 | 0.40% (3 conversions) | n/a | `M/reports/manami_30d_2026-07-31.md:356` |

  - A rebuild with a target conversion of at least 2% is recommended (`manami_30d_2026-07-31.md:453`). It is still being optimised (`M/meetings/2026-08-13-ai-meeting-note.md:28`).
- **Claim of rising 90-day repurchase** (Jan about 9.5% → Apr 15.4%; `M/meetings/2026-08-13-ai-meeting-note.md:28`).
  - Reproduced for all-customer cohorts: Jan 8.6, Feb 11.3, Mar 11.5, Apr 14.7.
  - **But it reverted:** May 9.8% (n214) and Jun 8.5% (n177).
  - **Do not report it as an improvement.**
- **A/B test of the set landing page, "15% credit on a full bottle" vs a set discount.** Planned 2026-07-09 (`M/meetings/2026-07-09...md:36,91`). Still an open action item (`agency/_ops/open-action-items.md:256`). No result exists.
- **"Z testeru do plné lahvičky" offer to about 1,370 "stuck" set buyers.** Modelled at 6% conversion (`manami_letni_bundle_analyza:101-105`). There is no evidence it was sent.
- **Summer kit "Letní rituál"**, 1,390 CZK: 9 units sold.
- **Packaging redesign:** postponed.
- **24-07 email "Testovací sada s bonusem pro věrné":** planned, no result recorded.
- **Set credit.**
  - **No mechanism that credits the set price toward a bottle was found.** What exists is "1 000 voňavých bodů = 100 Kč sleva na příští nákup" (`M/research/voc-2026-09-30/claims-inventory.md:40`).
  - Yet September 2026 Meta copy promises a credit toward a full bottle (scan: `M/ads/2026-09-04-HeadacheFromSynthetics-LESK-STAT-v1.md:60`; the critique flags it at `critique.md:269,284`). **This is a claims risk.**
  - The order status "Slevový kód - testery" (2024-05 to 2025-10) suggests a per-order discount-code step existed then. Its meaning is not documented in the Second Brain. Ask the client.
- **VoC, 2026-09-30.** Short wear time is the main reason testers drop off (`M/research/voc-2026-09-30/00-SYNTHESIS.md:18`, per the scan). A survey of set buyers is recommended.

---

## 6. Gap list

### 6.1 What the dashboard can answer today
- Lifetime repeat rate, orders per customer, LTV and LTGP, all to date (Customers).
- Cohort to-date repeat rate and Y1 LTV (Cohorts).
- Monthly retention heatmap (Cohorts grid).
- First-to-second within 90, 180 or 365 days for one rolling 12-month cohort, all products pooled (Repeat timing).
- Gap distribution, 24-month window (Time between orders).
- First-product repeat and Sankey, with no horizon (Repurchase).

### 6.2 What it cannot answer
1. Conversion of **sample-set entrants vs perfume entrants**. Entry-product segmentation exists only as an item-name split, with no horizon.
2. **"Later order contains a full-size perfume."** There is no product classification and no size dimension.
3. **Horizon-based repeat per cohort (30/60/90/180/365) with a trend and confidence intervals.** Repeat timing gives one pooled cohort only.
4. 2nd → 3rd conversion.
5. Any experiment readout. There is no flow-exposure or holdout data in the warehouse, and the Ecomail flow stats are lifetime totals only (`manami_30d_2026-07-31.md:343` per the scan).

### 6.3 Wrong or misleading today
1. **Window tooltips.** "36-month window" on the Customers page (`customers/page.tsx:96,116`; `lifetime.ts:5`) and "holds 36" on Cohorts (`cohorts/page.tsx:90-91`) are false. Live is 60 months, and Manami effectively has 17.
2. **The headline "Repeat rate, lifetime" has no horizon** and is presented without a maturity caveat. For Manami it understates the 365-day rate by about 4.5 pp.
3. **"Avg AOV" is a per-customer mean** (962), not an order AOV (1,026).
4. **"Repeat rate, mature cohorts"** is an unweighted mean of to-date rates across cohorts of 12 to 24 months.
5. **The Repurchase "came back, lifetime" blend** covers only the top-15 products by repeat rate. The first-product table splits SKU 153 into 4 names, which creates a fake decline across the set's names.
6. **Cohort grid:** the current-month cell is partial, and trailing blanks drop out of the "all cohorts" weighting.
7. **LTGP/LTV** mixes shipping-inclusive revenue with product-only margin. The Shoptet cost imputation divides by 1.21 for a non-VAT payer.
8. **`stg_shoptet_order_items` keeps 128 cancelled orders**, through its exact-match status filter. This does not reach the customer marts but does reach item-level product views.
9. **Complaint and unpaid orders** count as orders. Shoptet has no refund handling (0.1 pp effect on repeat).
10. **The stg comment says "VAT inclusive" for Shoptet revenue.** For Manami, with VAT equals without VAT.

### 6.4 Data and modelling to add (proposals only, nothing changed)
1. **`ref.product_class`**, keyed by `(client_id, item_code)` with a name fallback.
   - Fields: class (sample_set / single_sample / full_perfume / bundle / other), size_ml, is_full_size, scent.
   - Product identity for Shoptet should be `item_code`, not `item_name`.
2. **`mart_customer_entry`**, one row per customer.
   - Fields: first_order_date, entry_class, d2, d3, first full-size date, flags for 30/60/90/180/365 and `eligible_H` per horizon.
   - Logic as in Appendix A.
3. **A horizon repeat view by cohort month × entry class**, with n, k, Wilson bounds, and fully observed cohorts only. Page: "Sample → full size".
4. **A data-start marker per client** (`ref.clients.data_start_date`), so pages can show left truncation and exclude truncated cohorts from trend reads.
5. **A customer feed from the Shoptet API** (customerGuid), to merge multi-email customers and to bring in pre-2024-05 history, if the API exposes it.
6. **Flow exposure and holdout:** Ecomail per-contact flow events, plus a randomised 10 to 20% holdout on "Tester to Full". This is the only way to measure the flow's causal lift at this volume.
7. **Fixes:**
   - Status filter parity in `stg_shoptet_order_items`.
   - Exclude or flag `Reklamace*` and zero-revenue orders.
   - Weighted mature-cohort tile.
   - Order-weighted AOV.
   - Correct the window tooltips.
   - Remove `/1.21` for non-VAT-payer clients.

---

## Appendix A: SQL

**Scratch table** (`mart_qa.ret_manami_orders`, expires 2026-10-12):
- **Orders:** `stg.stg_customer_orders`, client manami, `customer_key IS NOT NULL`, 60 months. This is the page-consistent spine.
- **Items:** `stg.stg_shoptet_order_items`, classified by line with these rules, applied in order:
  1. `item_code='153'` → set
  2. `STARTS_WITH(item_code,'409')` → gift_set_voucher
  3. `STARTS_WITH(item_name,'Vzorek parfému') OR item_name='Tester'` → single_sample
  4. `STARTS_WITH(item_name,'Parfém ') OR REGEXP_CONTAINS(item_name, r'^Něžná – .*[Ll]imitovaná edice') OR STARTS_WITH(item_name,'Osobní JEDINEČNÝ parfém')` → full
  5. `Letní rituál na cesty | Podzimní balíček* | (Gardénie|Jasmín|Lilie|Magnólie) - limitovaná edice` → bundle
  6. `Dárkový poukaz*` → voucher
  7. `Roll-on*` → rollon
  8. `adventní kalendář` → calendar
  9. zero revenue or packaging → free_pack
  10. anything else → other
- **Order class** (`has_*` = LOGICAL_OR per order), in this order:
  1. no items
  2. set and (full or bundle) → set_plus_full
  3. set → set_no_full
  4. gift → gift_set_voucher
  5. full or bundle → full_no_set
  6. single → single_sample_only
  7. else → other_only
- **Sequence:** `ROW_NUMBER() OVER (PARTITION BY customer_key ORDER BY order_date, order_id)`.

**Per-customer logic** (used in every section 4 query):
```sql
SELECT customer_key, MIN(first_date) f, ANY_VALUE(IF(seq=1, order_class, NULL)) fc,
  MIN(IF(seq=2, order_date, NULL)) d2, MIN(IF(seq=3, order_date, NULL)) d3,
  MIN(IF(seq>=2 AND (has_full OR has_bundle), order_date, NULL)) dfull
FROM mart_qa.ret_manami_orders GROUP BY 1
-- eligible for horizon H: DATE_ADD(f, INTERVAL H DAY) <= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
-- hit: DATE_DIFF(d2, f, DAY) <= H ; perfume hit: DATE_DIFF(dfull, f, DAY) <= H
-- 2nd->3rd: d2 IS NOT NULL AND d2 + 180 <= cutoff ; hit DATE_DIFF(d3, d2, DAY) <= 180
-- Wilson: (p + z²/2n ± z*sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n), z = 1.96
```

**Raw recompute** (section 3):
```sql
WITH d AS (SELECT * EXCEPT(rn) FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, code ORDER BY ingested_at DESC) rn
  FROM raw.raw_shoptet_orders WHERE orderDate >= '2020-01-01' AND client_id='manami') WHERE rn=1),
k AS (SELECT LOWER(TRIM(email)) e, code, orderDate, statusName s, totalPriceWithVatCZK r FROM d WHERE email IS NOT NULL AND TRIM(email)!='')
SELECT COUNT(*) customers, COUNTIF(n>1)/COUNT(*) repeat_rate, AVG(n) opc, AVG(rev) ltv
FROM (SELECT e, COUNT(*) n, SUM(r) rev FROM k WHERE LOWER(s) NOT LIKE '%storno%' GROUP BY e)
```
