# Retention reporting design for the One Eighty dashboard (cohort repeat and upgrade rates)

Date: 2026-10-05. Read-only design. Repo `main` at `851cdb1`. I ran a few small read-only BigQuery queries to size the work and test the seed. There were no writes.

## 0. Decisions and new facts

**Decisions**
- **New page.** Add one page, **"Repeat rate"** at `/repeat-rate`, in the existing sidebar group "Retention" (`lib/nav.ts`), second after Customers. Repurchase, Cohorts and Repeat timing stay; I am not reworking them.
- **One new table drives everything.** It is `mart.rpt_customer_entry`, with one row per client and customer. The Repeat rate page, the Customers and Cohorts tiles, and the Reports metrics all read it.
- **Product classes are data, not code.** They live in `ref.product_classes`, matched by item code or SKU first and by name only as a fallback. A renamed product keeps its class.
- **Headline numbers use mature, non-early customers only.** The cohort table and trend use the month-level maturity rule. Reports uses the customer-level rule and adds a caveat.

**New facts from my read-only queries**
1. **The left-censoring rule is material for Manami.** On the audit's own scratch table, excluding customers first seen in the first 180 days of data (before 2024-11-02) changes:
   - all-customer 365-day repeat from 18.5% to 15.7% (111 of 709);
   - set entrants' 365-day repeat from 17.2% to 14.6%.
   - This is why open question 3 matters.
2. **Manami item codes are stable and structured as `base/variant`.** Examples: `153` is the set, `1003/5` and `1003/10` are Parfém NĚŽNÁ 5 and 10 ml, and `54/15` and `54/20` are the same scent at 15 and 20 ml.
   - The same scent therefore has two base codes, so the seed works on base codes.
   - Code `153` carries 4 names. `1001` and `469` carry 2 names each.
3. **The new table is small and cheap.**
   - Size: about 43,700 customers across the 5 clients (Dobias 21,866, RawBark 14,494, Venev 3,159, Manami 2,940, Ethia 1,258).
   - Cost: a dry run of the build join scans about 260 MB.
4. **Data starts differ a lot.**
   - Dobias has orders back to 2013-12 (migrated store).
   - RawBark starts 2022-10, Venev 2022-07, Ethia 2025-03 and Manami 2024-05-06 (backfill limit).
   - The Shopify and Woo stg views carry a rolling 60-month filter on raw `order_date`. This is a future left-truncation risk; see 2.6.

---

## 1. Definitions (exact)

Notation: c = client, i = customer, H = horizon in days, H ∈ {30, 60, 90, 180, 365}.

### 1.1 Valid order
An order counts if all of these hold:
- it is a row of `stg.stg_customer_orders`, which already drops Shoptet `%storno%`, `cancelled` and `zrušeno`, Shopify `cancelled_at IS NOT NULL`, and Woo statuses outside processing, completed and on-hold;
- `customer_key IS NOT NULL`;
- `revenue > 0`. This removes free and replacement shipments: 7 of Manami's 11 complaint orders have zero revenue;
- it is not a Shoptet order whose `LOWER(status)` starts with `reklamace`;
- it is not a Shopify order with `financial_status IN ('REFUNDED','VOIDED')`.

The audit measured that these exclusions move Manami's repeat rate by 0.1 pp.

### 1.2 Customer identity
- `customer_key = NULLIF(LOWER(TRIM(email)), '')`, as on the Customers page. This applies to every platform, including Shopify, which drops `platform_customer_id` here.
- The table stores only `customer_id = TO_HEX(SHA256(CONCAT(client_id, '|', customer_key))))`. No email leaves stg.
- Orders without an email are excluded and counted per client in the regression report. Today that is Dobias 54, Manami 14, Venev 1.

### 1.3 First order and day merge
- f_i = the earliest `order_date` of i's valid orders. It is the true first order in the data, not the first order in a filter window.
- **Entry basket** = every valid order of i on day f_i. Same-day add-ons are merged, so a set ordered in the morning and a perfume in the evening make a "mixed" entry, not an upgrade.
- **Later orders** are valid orders with `order_date > f_i`. "2nd order" means the first later order day. "3rd order" means the next later order day after that.
- Parity columns keep the audit's rule (any order with sequence 2 or more, same day included) for checks: `second_order_any_date`, `third_order_any_date`, `first_full_any_date`, `entry_class_first_order`.

### 1.4 Product classes (per client, rename-safe)

**Line classes:**

| Class | Meaning | Counts as full size |
|---|---|---|
| `discovery` | Sample or discovery set | no |
| `sample` | Single sample | no |
| `full` | Full-size product | yes |
| `bundle` | Pack of full-size products | yes |
| `gift_set` | Gift set or voucher bundle | no |
| `accessory` | Packaging or add-on | no |
| `other` | Anything else | no |

**How a line is matched.** Each line gets `code` and `code_base`:
- Shoptet: `code` = `item_code`, `code_base` = `REGEXP_EXTRACT(item_code, r'^[^/]+')`.
- Shopify: both are the normalised `sku`.
- Woo: `code` = `sku`, else `variation_id`, else `product_id`; `code_base` = `sku`, else `product_id`.

The line takes the class of the matching `ref.product_classes` rule with the lowest `priority`. Match types, in typical priority order:
1. `code` (exact)
2. `code_base`
3. `code_prefix`
4. `name_prefix`, `name_regex` (fallback for lines without a code, or codes nobody mapped)
5. `default` (everything else)

Rules carry `valid_from` and `valid_to` for reused codes. A line that matches only through `default`, or no rule at all, sets `has_unmatched_line`.

**Entry class E_i.** The basket's flags are logical ORs over its lines. The first match wins:

| Rule | Entry class |
|---|---|
| no item rows | `unknown` |
| discovery and (full or bundle) | `mixed` |
| discovery | `discovery` |
| gift_set | `gift` |
| full or bundle | `full` |
| sample | `sample` |
| anything else | `other` |

This is the audit's precedence. A client with no rows in `ref.product_classes` gets `entry_class = NULL`, and the UI hides every entry-class element for it.

### 1.5 Cut-off and maturity
- `as_of_date = CURRENT_DATE(ref.clients.timezone) - 1`.
- `cutoff_date = as_of_date - sync_lag_days`. The default lag is 3 days, a buffer for late syncs and late cancellations.
- **Customer-level:** i is mature for H iff `f_i + H <= cutoff_date`.
- **Month-level:** cohort month m is mature for H iff `LAST_DAY(m) + H <= cutoff_date`. The cohort table, the trend chart and every pooled headline use only months that are fully mature for H. Partially mature months are shown as n/a with a "Matures {date}" hover.

### 1.6 Rates
- **Repeat rate.** `R_H = Σ r_H / Σ m_H` over a set of customers, where:
  - `m_H` = 1 if mature;
  - `r_H` = 1 if mature and the 2nd order is within H days (`DATE_DIFF(second_order_date, f, DAY) <= H`).
- **Upgrade rate.** `U_H = Σ u_H / Σ m_H` over customers with a given entry class (the flagship case is `discovery`), where `u_H` = 1 if mature and `first_full_date - f <= H`.
  - `first_full_date` = the first later order containing a line with `counts_as_full`.
  - Because full size in the entry basket does not count (mixed entry), `u_H <= r_H` always.
- **Ladder, 2nd to 3rd.**
  - `m23_180` = 1 if the 2nd order exists and `second_order_date + 180 <= cutoff`.
  - `r23_180` = 1 if also `third_order_date - second_order_date <= 180`.
  - `L23_180 = Σ r23 / Σ m23`.
- **Pooling.** Sum k and sum n over the set, then divide. Never average rates.

### 1.7 Data start and left censoring
- `data_start_date`: from `ref.retention_settings`, else the client's earliest valid order.
- `is_early = f_i < data_start_date + history_guard_days`.
- Customers first seen soon after the data start may be returning customers from before it, so their first order is not a true first order.
- Default `history_guard_days` is 0. Manami's proposed value is 180 days (open question 3).
- Early customers are excluded from headlines, the trend, the curve and Reports. They appear in the cohort table as rows marked "Early".

### 1.8 Wilson 95% CI (z = 1.96)
```
p = k/n
center = (p + z²/(2n)) / (1 + z²/n)
half   = z * sqrt(p(1-p)/n + z²/(4n²)) / (1 + z²/n)
CI     = [center - half, center + half]
```
Test vectors from the research note:
- 3 of 40: 7.5%, CI 2.6 to 19.9.
- 0 of 30: CI 0 to 11.4.
- 20 of 100: CI 13.3 to 28.9.
- 200 of 1,000: CI 17.6 to 22.6.

### 1.9 Difference between two pooled windows (Newcombe hybrid score)
With d = p1 - p2 and Wilson bounds (l1, u1) and (l2, u2):
```
L = d - sqrt((p1-l1)² + (u2-p2)²)
U = d + sqrt((u1-p1)² + (p2-l2)²)
```
- Verdict: "Up" if L > 0, "Down" if U < 0, else "No clear change".
- Worked example, production rules on the audit scratch data: Manami discovery R_90, Jan to Jun 2026 (59 of 488, 12.1%) against Jan to Jun 2025 (19 of 202, 9.4%). The result is +2.7 pp (about -2.8 to +7.3), so "No clear change".

### 1.10 Kaplan-Meier time to event
- **Event:** the 2nd order (Repeat) or `first_full_date` (Full size).
- **Time:** t = days from f_i.
- **Censoring:** at `observed_days = cutoff_date - f_i`. An event after the cut-off is censored, not counted.
- **Estimate:** `S(t) = Π_{t_j <= t} (1 - d_j / n_j)`. The chart plots `1 - S(t)`.
- **Band:** Greenwood, `Var = S(t)² Σ d_j / (n_j (n_j - d_j))`, ±1.96·SE, clipped to [0, 1].
- **Display limits:** stop the curve where `n_j < 30`, and cap at 365 days.
- **Groups:** non-early customers only.
  - "Last 6 months": `f > cutoff - 182`.
  - "6 to 18 months ago": `cutoff - 547 < f <= cutoff - 182`.

### 1.11 Display rules (every surface)
- Every rate shows n, and its CI is on hover. Tiles show the CI inline as data.
- n < 30 shows n/a, with hover "Too few customers".
- 30 <= n < 100 shows the value with a low-n marker.
- One horizon per chart.
- Immature cells show n/a.
- No month-to-month ranking.
- Comparisons always go through Newcombe.

---

## 2. Warehouse

Migration numbers are the next free ones in the reporting range: 255 to 258.

### 2.1 Migration 255: `ref.retention_settings`, `ref.product_classes`, Manami seed

```sql
CREATE TABLE `oneeighty-warehouse.ref.retention_settings` (
  client_id STRING NOT NULL,
  data_start_date DATE,                 -- NULL: earliest valid order
  history_guard_days INT64 NOT NULL,    -- 0 = history complete
  sync_lag_days INT64 NOT NULL,         -- default 3
  primary_horizon_days INT64 NOT NULL,  -- default 90
  note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
CREATE TABLE `oneeighty-warehouse.ref.product_classes` (
  client_id STRING NOT NULL,
  match_type STRING NOT NULL,   -- code | code_base | code_prefix | name_prefix | name_regex | default
  pattern STRING NOT NULL,      -- '*' for default
  line_class STRING NOT NULL,   -- discovery | sample | full | bundle | gift_set | accessory | other
  counts_as_full BOOL NOT NULL,
  priority INT64 NOT NULL,      -- lower wins
  valid_from DATE, valid_to DATE,
  label STRING, note STRING,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

**Manami seed.** The rules replicate the audit's Appendix A rules on codes. Name rules are fallbacks.

| Priority | match_type | Pattern(s) | Class | Full |
|---|---|---|---|---|
| 10 | code | `153` | discovery | no |
| 20 | code_base | `409` | gift_set | no |
| 30 | code_base | `75`, `472`, `564` | sample | no |
| 40 | code_base | `1001`, `1002`, `1003`, `1004`, `1005`, `46`, `51`, `54`, `57`, `60`, `102`, `403`, `469`, `290` | full | yes |
| 50 | code_base | `551`, `554`, `557`, `560`, `563`, `570`, `573`, `576`, `579` | bundle | yes |
| 60 | code_base | `473`, `306`, `78`, `79` | accessory | no |
| 100 | name_prefix | `Testovací sada` | discovery | no |
| 101 | name_prefix | `Vzorek parfému`; name_regex `^Tester$` | sample | no |
| 102 | name_prefix | `Parfém `, `Osobní JEDINEČNÝ parfém`; name_regex `^Něžná . .*[Ll]imitovaná edice` | full | yes |
| 103 | name_regex | `^(Letní rituál na cesty\|Podzimní balíček\|(Gardénie\|Jasmín\|Lilie\|Magnólie) . limitovaná edice)` | bundle | yes |
| 999 | default | `*` | other | no |

Notes on the seed:
- The `.` stands in for the en dash in product names, so no dash character enters the repo.
- Codes the seed leaves under `default` are other gift sets (`249`, `252`, `412`, `415`), vouchers (`84`, `192`), calendars (`395`, `398`, `421`), oils, oil samples (`296`, `484`, `521`, `524`), salts, roll-ons and flower waters.
- Each row records "reviewed 2026-10-05" in `note`.

**Settings seed.** One Manami row: `('manami', DATE '2024-05-06', 180, 3, 90)`. Other clients get no row, so the defaults apply: guard 0, lag 3, primary horizon 90.

**Monitor.** `ops.v_unclassified_products` lists, per client:
- codes that match only `default` and were first seen after the default rule's `updated_at`;
- codes with no rule at all.

Each row shows code, latest name, lines and revenue. Data health (internal) can show it later.

### 2.2 Migration 256: `mart.rpt_customer_entry`, its procedure and a view

The build follows the 253/254 pattern: build `__next`, ASSERT, swap with `COPY`. The core of the procedure:

```sql
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_customer_entry`()
BEGIN
  DECLARE prev_rows INT64; DECLARE new_rows INT64; DECLARE dup_rows INT64; DECLARE n_clients INT64;
  SET @@query_label = 'feature:rpt-customer-entry-refresh';
  SET prev_rows = (SELECT row_count FROM `oneeighty-warehouse.mart`.__TABLES__
                   WHERE table_id = 'rpt_customer_entry');

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_customer_entry__next`
  CLUSTER BY client_id, cohort_month AS
  WITH cfg AS (
    SELECT c.client_id, c.timezone,
           s.data_start_date, IFNULL(s.history_guard_days, 0) AS guard,
           IFNULL(s.sync_lag_days, 3) AS lag,
           EXISTS (SELECT 1 FROM `oneeighty-warehouse.ref.product_classes` p
                   WHERE p.client_id = c.client_id) AS classes_configured
    FROM `oneeighty-warehouse.ref.clients` c
    LEFT JOIN `oneeighty-warehouse.ref.retention_settings` s USING (client_id)
  ),
  orders AS (   -- 1.1 valid orders
    SELECT o.client_id, o.order_id, o.order_date, o.customer_key, o.revenue, o.platform
    FROM `oneeighty-warehouse.stg.stg_customer_orders` o
    LEFT JOIN (SELECT client_id, order_code, status FROM `oneeighty-warehouse.stg.stg_shoptet_orders`) s
      ON o.platform = 'shoptet' AND s.client_id = o.client_id AND s.order_code = o.order_id
    LEFT JOIN (SELECT client_id, order_id, financial_status FROM `oneeighty-warehouse.stg.stg_shopify_orders`) f
      ON o.platform = 'shopify' AND f.client_id = o.client_id AND f.order_id = o.order_id
    WHERE o.customer_key IS NOT NULL AND o.revenue > 0
      AND NOT IFNULL(STARTS_WITH(LOWER(s.status), 'reklamace'), FALSE)
      AND NOT IFNULL(f.financial_status IN ('REFUNDED', 'VOIDED'), FALSE)
  ),
  lines AS (    -- 1.4 one row per line, with code and code_base
    SELECT client_id, order_code AS order_id, item_key AS line_id, NULLIF(item_code, '') AS code,
           REGEXP_EXTRACT(item_code, r'^[^/]+') AS code_base, item_name AS name
    FROM `oneeighty-warehouse.stg.stg_shoptet_order_items`
    UNION ALL
    SELECT client_id, order_id, CAST(NULL AS STRING), NULLIF(TRIM(sku), ''), NULLIF(TRIM(sku), ''), item_name
    FROM `oneeighty-warehouse.stg.stg_shopify_order_items`
    UNION ALL
    SELECT client_id, order_id, line_item_id,
           COALESCE(NULLIF(TRIM(sku), ''), NULLIF(NULLIF(variation_id, ''), '0'), NULLIF(product_id, '')),
           COALESCE(NULLIF(TRIM(sku), ''), NULLIF(product_id, '')), item_name
    FROM `oneeighty-warehouse.stg.stg_woo_order_items`
  ),
  classed AS (  -- lowest priority rule wins; NULL rule = unmatched
    SELECT o.client_id, o.order_id, l.line_id, l.code, l.name,
      ARRAY_AGG(IF(r.client_id IS NULL, NULL,
                   STRUCT(r.line_class, r.counts_as_full, r.match_type))
                IGNORE NULLS ORDER BY r.priority LIMIT 1)[SAFE_OFFSET(0)] AS cls
    FROM orders o
    JOIN lines l ON l.client_id = o.client_id AND l.order_id = o.order_id
    LEFT JOIN `oneeighty-warehouse.ref.product_classes` r
      ON r.client_id = l.client_id
     AND (r.valid_from IS NULL OR o.order_date >= r.valid_from)
     AND (r.valid_to IS NULL OR o.order_date < r.valid_to)
     AND CASE r.match_type
           WHEN 'code'        THEN l.code = r.pattern
           WHEN 'code_base'   THEN l.code_base = r.pattern
           WHEN 'code_prefix' THEN STARTS_WITH(l.code, r.pattern)
           WHEN 'name_prefix' THEN STARTS_WITH(l.name, r.pattern)
           WHEN 'name_regex'  THEN REGEXP_CONTAINS(l.name, r.pattern)
           WHEN 'default'     THEN TRUE END
    GROUP BY 1, 2, 3, 4, 5, l.code_base
  ),
  ord AS (      -- order flags; LEFT JOIN keeps orders without item rows
    SELECT o.client_id, o.customer_key, o.order_id, o.order_date, o.revenue,
      COUNT(c.order_id) AS n_lines,
      LOGICAL_OR(c.cls.line_class = 'discovery') AS has_disc,
      LOGICAL_OR(c.cls.counts_as_full)          AS has_full,
      LOGICAL_OR(c.cls.line_class = 'gift_set')  AS has_gift,
      LOGICAL_OR(c.cls.line_class = 'sample')    AS has_sample,
      LOGICAL_OR(c.cls IS NULL OR c.cls.match_type = 'default') AS has_unmatched
    FROM orders o
    LEFT JOIN classed c ON c.client_id = o.client_id AND c.order_id = o.order_id
    GROUP BY 1, 2, 3, 4, 5
  ),
  seq AS (
    SELECT *,
      MIN(order_date) OVER w AS f,
      ROW_NUMBER() OVER (w ORDER BY order_date, order_id) AS n,
      DENSE_RANK() OVER (w ORDER BY order_date) AS day_n
    FROM ord WINDOW w AS (PARTITION BY client_id, customer_key)
  ),
  cust AS (
    SELECT client_id, customer_key, MIN(f) AS first_order_date,
      SUM(IF(order_date = MIN_f_dummy, 0, 0)) AS _unused,   -- placeholder removed in implementation
      LOGICAL_OR(IF(day_n = 1, n_lines > 0, NULL)) AS b_items,
      LOGICAL_OR(IF(day_n = 1, has_disc, NULL))     AS b_disc,
      LOGICAL_OR(IF(day_n = 1, has_full, NULL))     AS b_full,
      LOGICAL_OR(IF(day_n = 1, has_gift, NULL))     AS b_gift,
      LOGICAL_OR(IF(day_n = 1, has_sample, NULL))   AS b_sample,
      LOGICAL_OR(IF(day_n = 1, has_unmatched, NULL)) AS has_unmatched_line,
      SUM(IF(day_n = 1, revenue, 0)) AS first_order_revenue,
      COUNT(*) AS orders_total,
      MIN(IF(day_n = 2, order_date, NULL)) AS second_order_date,
      MIN(IF(day_n = 3, order_date, NULL)) AS third_order_date,
      MIN(IF(day_n >= 2 AND has_full, order_date, NULL)) AS first_full_date,
      -- parity (audit rule: sequence, same day included)
      MIN(IF(n = 2, order_date, NULL)) AS second_order_any_date,
      MIN(IF(n = 3, order_date, NULL)) AS third_order_any_date,
      MIN(IF(n >= 2 AND has_full, order_date, NULL)) AS first_full_any_date,
      ANY_VALUE(IF(n = 1, STRUCT(n_lines, has_disc, has_full, has_gift, has_sample), NULL)) AS o1
    FROM seq GROUP BY 1, 2
  ),
  base AS (
    SELECT k.*, g.classes_configured, g.guard,
      DATE_SUB(CURRENT_DATE(g.timezone), INTERVAL 1 DAY) AS as_of_date,
      DATE_SUB(CURRENT_DATE(g.timezone), INTERVAL 1 + g.lag DAY) AS cutoff_date,
      COALESCE(g.data_start_date,
               MIN(k.first_order_date) OVER (PARTITION BY k.client_id)) AS data_start_date
    FROM cust k JOIN cfg g USING (client_id)
  )
  SELECT
    client_id,
    TO_HEX(SHA256(CONCAT(client_id, '|', customer_key))) AS customer_id,
    DATE_TRUNC(first_order_date, MONTH) AS cohort_month,
    first_order_date, classes_configured,
    IF(NOT classes_configured, NULL, CASE
      WHEN NOT b_items         THEN 'unknown'
      WHEN b_disc AND b_full   THEN 'mixed'
      WHEN b_disc              THEN 'discovery'
      WHEN b_gift              THEN 'gift'
      WHEN b_full              THEN 'full'
      WHEN b_sample            THEN 'sample'
      ELSE 'other' END) AS entry_class,
    -- entry_class_first_order: same CASE on o1 (parity)
    has_unmatched_line, first_order_revenue, orders_total,
    second_order_date, third_order_date, first_full_date,
    second_order_any_date, third_order_any_date, first_full_any_date,
    data_start_date, as_of_date, cutoff_date,
    first_order_date < DATE_ADD(data_start_date, INTERVAL guard DAY) AS is_early,
    DATE_DIFF(cutoff_date, first_order_date, DAY) AS observed_days,
    DATE_DIFF(second_order_date, first_order_date, DAY) AS days_to_2nd,
    DATE_DIFF(third_order_date, second_order_date, DAY) AS days_2nd_to_3rd,
    DATE_DIFF(first_full_date, first_order_date, DAY) AS days_to_full,
    1 AS n_customer,
    -- m30..m365, r30..r365, u30..u365 for each H in (30, 60, 90, 180, 365):
    --   mH = IF(DATE_ADD(first_order_date, INTERVAL H DAY) <= cutoff_date, 1, 0)
    --   rH = IF(mH = 1 AND DATE_DIFF(second_order_date, first_order_date, DAY) <= H, 1, 0)
    --   uH = IF(mH = 1 AND DATE_DIFF(first_full_date,  first_order_date, DAY) <= H, 1, 0)
    -- is_discovery, has_second, m23_180, r23_180 (1.6),
    -- dm90, du90, dm180, du180, dm365, du365 = mH * is_discovery, uH * is_discovery
    CURRENT_TIMESTAMP() AS refreshed_at
  FROM base;

  -- checks, then swap (253 pattern)
  SET (new_rows, dup_rows, n_clients) = (
    SELECT AS STRUCT COUNT(*),
           COUNT(*) - COUNT(DISTINCT FORMAT('%s|%s', client_id, customer_id)),
           COUNT(DISTINCT client_id)
    FROM `oneeighty-warehouse.mart.rpt_customer_entry__next`);
  ASSERT new_rows > 0 AS 'rpt_customer_entry refresh: 0 rows, live table kept';
  ASSERT prev_rows IS NULL OR new_rows >= 0.9 * prev_rows
    AS 'rpt_customer_entry refresh: below 90 % of live rows, live table kept';
  ASSERT dup_rows = 0 AS 'rpt_customer_entry refresh: duplicate customers, live table kept';
  ASSERT n_clients >= (SELECT COUNT(DISTINCT client_id) FROM `oneeighty-warehouse.stg.stg_customer_orders`)
    AS 'rpt_customer_entry refresh: a shop client is missing, live table kept';
  ASSERT (SELECT COUNTIF(u365 > r365 OR r365 > m365 OR r23_180 > m23_180)
          FROM `oneeighty-warehouse.mart.rpt_customer_entry__next`) = 0
    AS 'rpt_customer_entry refresh: flag order violated, live table kept';

  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_customer_entry`
  COPY `oneeighty-warehouse.mart.rpt_customer_entry__next`;
  DROP TABLE IF EXISTS `oneeighty-warehouse.mart.rpt_customer_entry__next`;
END;
```

The sketch has two placeholders to clean up in implementation:
- The `_unused` line in `cust` is a placeholder. Remove it.
- Compute `entry_class_first_order` from `o1` with the same CASE as `entry_class`.

The implementer writes the full column list out by hand. The flag columns must be INT64 0/1, so they can be summed in Reports.

**View `mart.mart_retention_cohorts`.** It groups `rpt_customer_entry` by `client_id, cohort_month, entry_class, is_early` and returns:
- `SUM(n_customer)` and `SUM` of every m, r and u column, plus `m23_180` and `r23_180`;
- `ANY_VALUE(cutoff_date)` and `ANY_VALUE(data_start_date)`;
- `COUNTIF(has_unmatched_line)`.

The page reads this view. The curve query reads the table directly.

**Scheduler.** Append one line to the owner's scheduled query `rpt_refresh_hourly`, after the other two:
```sql
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_customer_entry`();
```
It goes last so that a failure here cannot block the KPI and launch refreshes.

**Cost.**
- Build: the dry run of the join is about 260 MB, so expect 0.3 to 0.5 GB per CALL including the Shopify status join (WR1 measures it).
- Hourly runs: about 220 to 360 GB a month, roughly USD 1.5 to 2.5 at EU on-demand prices.
- Cheaper option: an early `RETURN` when `__TABLES__.last_modified_time` is under 6 hours old would cut this by 4x. I don't recommend it, because the flags then go up to 6 hours stale.
- Reads: the table is about 44k rows and a few MB, so each read costs the 10 MB billing minimum.

### 2.3 Migration 257: stable Shoptet product label (the Repurchase rename split)

`stg.stg_customer_order_items`, Shoptet branch:
- `product_key = COALESCE(NULLIF(item_code, ''), item_name)`.
- `product_name` = the latest `item_name` per `(client_id, REGEXP_EXTRACT(item_code, r'^[^/]+'))`, by `order_date DESC` (a `shoptet_labels` CTE, like `woo_labels`), falling back to `item_name`.

`mart_customer_product_steps` groups by `product_name`, so the four SKU 153 names collapse into "Testovací sada všech parfémů". Shopify and Woo branches are unchanged.

### 2.4 Migration 258: Shoptet item status parity (separately approvable)

`stg.stg_shoptet_order_items`: replace `LOWER(statusName) NOT IN ('storno','cancelled','zrušeno')` with the order-view rule `NOT LIKE '%storno%' AND NOT IN ('cancelled','zrušeno')`.
- This removes 128 cancelled Manami orders (227 lines, about 130k CZK) from the item level.
- It changes Products, SKU and Unit economics for Manami only.
- It is split out because it moves numbers people know.

### 2.5 Regression checks (`qa/256_*.sql`, `qa/257_*.sql`, `qa/258_*.sql`)

**256 (new objects only).**
1. **Audit parity.** This must run before `mart_qa.ret_manami_orders` expires on 2026-10-12, or the scratch table has to be rebuilt from audit Appendix A.
   - Build the candidate in `mart_qa` with cut-off fixed at 2026-10-04, lag 0, guard 0, no `revenue > 0` filter and no complaint filter.
   - Map the audit's `SET`, `FULL`, `set_plus_full`, `single_sample_only`, `gift_set_voucher`, `other_only` and `no items` classes to discovery, full, mixed, sample, gift, other and unknown.
   - Compare per customer (`customer_id`, f, `entry_class_first_order`, `second_order_any_date`, `third_order_any_date`, `first_full_any_date`) with EXCEPT DISTINCT in both directions. Expect 0 and 0, or every row explained.
2. **Independent recompute.** For all 5 clients, recompute all-customer R_30 to R_365 from `stg_customer_orders` without the item join. It must equal the table.
3. **Order totals.** `SUM(orders_total)` per client equals the valid-order count.
4. **Identity.** Customers per client equal distinct `customer_key` among valid orders.
5. **Clients without classes.** `entry_class` is NULL for every client without classes.
6. **Ladder and flags.** Flag order holds (`u <= r <= m`).

No existing object changes.

**257 and 258 (changed views).** Use the standard EXCEPT DISTINCT protocol on `TO_JSON_STRING`.
- Non-Shoptet clients: 0 rows in `stg_customer_order_items`, `mart_customer_product_steps`, `mart_first_product_repeat` and `mart_product_journey`.
- Manami under 257: diffs only in `product_name` and `product_key`, with step counts unchanged.
- 258: Manami line deltas limited to the 128 orders. `stg_shoptet_orders`, `stg_customer_orders` and all customer marts are 0 and 0.

### 2.6 Known limits (documented, not fixed here)
- **Shopify dates.** `order_date` is `DATE(processed_at)` in UTC. This can shift a few orders across month boundaries. A per-client time-zone fix belongs in stg later.
- **Rolling stg window.** The Shopify and Woo stg views filter raw `order_date >= today - 60 months`. Once a client's history is older than that, its effective data start moves every day. I recommend removing that filter for orders in a later sprint. Until then, the computed `data_start_date` follows the window.

---

## 3. UI

Copy follows `12_cleanup_sprint_plan.md` section 4: title only, 1 to 3 word headings, definitions in tooltips of at most 40 words, n/a for missing values, en-US through `lib/format`, no client names.

### 3.1 Customers page (`app/(app)/customers/page.tsx`, `lib/queries/lifetime.ts`)

| Tile | Change |
|---|---|
| Avg AOV | Becomes **"AOV"**: `SAFE_DIVIDE(SUM(lifetime_revenue), SUM(total_orders))`, order-weighted. Manami 1,026, not 962. |
| Repeat rate, lifetime | Relabel to **"Repeat rate, to date"**. Tooltip: "Customers with 2 or more orders, whatever their age. Recent customers lower it." |
| (new, accent) | **"Repeat rate, 365 days"**: pooled `Σ r365 / Σ m365`, non-early. Sub-line "k of n". Tooltip: "Second order within 365 days of the first. Customers with at least 365 days of history." |
| LTV vs LTGP tooltip | "Per customer, all orders since {Mon YYYY}. Ignores the date range. Customers who bought before then count as new." The date is `data_start_date`. |
| Header comment | The "36-month" comment in `lifetime.ts` is fixed to 60 months, from data start. |

```
+------------------------------------+  +------------------------------------------------+
| LTV vs LTGP (i)                    |  | CUSTOMERS   ORDERS/CUST   AOV        DAYS ACTIVE|
| CZK 1,222  ->  CZK 788             |  | 2,940       1.19          CZK 1,026  160        |
| [=========-----]  64.5% LTGP / LTV |  | REPEAT RATE, 365 DAYS (i)  REPEAT RATE, TO DATE (i)
+------------------------------------+  | 15.7%                      14.3%                |
                                        | 111 of 709                                      |
                                        +------------------------------------------------+
```

### 3.2 Cohorts page (small fixes)
- **Mature-cohort tile.** Replace "Repeat rate, mature cohorts" (an unweighted mean of to-date rates) with "Repeat rate, 365 days", the same value as on Customers.
- **Y1 means.** Y1 LTV and Y1 LTGP become customer-weighted (`Σ y1 / Σ customers` over mature cohorts).
- **Grid.**
  - Exclude the current partial month from offsets.
  - Treat a blank elapsed offset as 0, so a cohort no longer drops out of the "all cohorts" denominator (`cohortGrid.ts`).
  - Fix the tooltip "full data window" and the stale "holds 36" code comment.

### 3.3 New page "Repeat rate" (`/repeat-rate`)

**Placement and scope.**
- Nav, Retention group: Customers, **Repeat rate**, Cohorts, Repurchase, Repeat timing, Time between orders.
- Capability: shop (`lib/capabilities.ts`).
- Ignores the date range: `RangeNote` stays.

**Controls (URL params).**

| Control | Param | Options | Default |
|---|---|---|---|
| Entry | `entry` | All, plus each class present with 30 or more mature entrants: "Discovery set", "Full size", "Mixed", "Single sample", "Gift set", "Other". Hidden when the client has no classes. | Discovery set when it has 100 or more entrants in the 90-day window, else All |
| Event | `event` | Repeat \| Full size. Hidden without classes. | Repeat |
| Horizon | `h` | 30 \| 60 \| 90 \| 180 \| 365. Applies to the trend chart only. | `primary_horizon_days` (90) |
| vs | `vs` | Year earlier \| Prior 6 months | Year earlier (seasonality-safe) |

`DeltaModeToggle` sits next to the `vs` control, as on Growth.

**How the comparison and delta toggle behave.**
- The global Compare in `PageControls` does not apply here (the page ignores the range). The page's own `vs` control does the job.
- Rate differences are always pp in both modes (CMP1 `kind: "rate"`).
- Entrant counts follow the toggle: % change in "%", count difference in "123".
- The chip is neutral grey unless the Newcombe CI excludes 0. Hover: "+2.7 pp, 95% CI -2.8 to +7.3, n 488 vs 202".
- `Delta.tsx` is frozen, so WR3 renders this through a small local `RateDiff` component built on `formatDelta`.

**Headline window.** Each tile pools the last 6 months that are fully mature for its horizon and not early. It compares against the same 6 months one year earlier, or the 6 months before (per `vs`).

```
Repeat rate                                           [client v] [date] (ignored)
Not affected by date range.
Entry [All|Discovery set|Full size|Mixed|...]  Event [Repeat|Full size]
vs [Year earlier|Prior 6 months] [%|123]

+----------------+ +----------------+ +-------------------+ +-------------------+ +-----------+
| REPEAT, 90D (i)| | REPEAT, 180D(i)| | FULL SIZE, 90D (i)| | FULL SIZE, 180D(i)| | MATURING  |
| 12.1%  +2.7pp  | | 9.8%   ...     | | 11.5%   ...       | | 8.8%    ...       | | 412       |
| 59 of 488      | | 38 of 387      | | 56 of 488         | | 34 of 387         | | customers |
| 9.5 to 15.3%   | | ...            | | ...               | | ...               |           |
| Jan to Jun 26  | | Oct 25 to Mar26| | Jan to Jun 26     | | Oct 25 to Mar 26  |           |
+----------------+ +----------------+ +-------------------+ +-------------------+ +-----------+
```

Tile notes:
- The tile values above are this design's production-mode estimates for Manami's discovery set; WR1 confirms them.
- Full-size tiles show only when the client has classes.
- "Maturing" = customers of the selected entry class not yet mature for the 90-day horizon. It tells the owner how much data is not ready yet.

**Cohorts table.**
```
Cohorts (i)                                                   25 months [13|25|All]
+-----------+-----------+--------+--------+--------+--------+--------+
| Cohort    | Entrants  |  30d   |  60d   |  90d   |  180d  |  365d  |
+-----------+-----------+--------+--------+--------+--------+--------+
| Last 6    |     ...   |  7.9%  |  ...   | 12.1%  |  9.8%  | 16.3%  |   pooled per column
| All mature|     ...   |  ...   |  ...   |  ...   |  ...   |  ...   |   non-early, weighted
| Aug 2026  |    144    |  8.3%  |  n/a   |  n/a   |  n/a   |  n/a   |   n/a muted: "Matures Oct 30"
| Jul 2026  |    150    |  3.3%  |  4.7%  |  n/a   |  n/a   |  n/a   |
| Apr 2026  |     89 .  | 11.2%. | 14.6%. | 16.9%. |  n/a   |  n/a   |   "." = low n (<100)
| ...       |           |        |        |        |        |        |
| Oct 2024 [Early] 34 . | 11.8%. | 17.6%. | 23.5%. | 23.5%. | 23.5%. |   Early: "First months of data. May include earlier customers."
+-----------+-----------+--------+--------+--------+--------+--------+
```

Table rules:
- Cells show R_H or U_H, following the Event control.
- Hover: "k of n, 95% CI a to b".
- n < 30 shows n/a, with hover "Too few customers".
- Example rows are Manami discovery entrants at audit parity.
- Early rows are excluded from both summary rows.

**Trend chart** (one horizon, from the Horizon control).
```
Trend (i)                                              Horizon [30|60|90|180|365]
 25% |            o
     |   o   |    |       o            o
 15% |---|---+----|---o---|--===[ q ]===--o--- (pooled quarter, CI band)
     |   |   o    |   |   |    o     |    |
  5% |                                          hollow = Early, absent = not mature
     +--------------------------------------------------------------
      Nov24  Jan25  Mar25  May25  Jul25  Sep25  Nov25  Jan26  Mar26  May26
     [n bars: 30 35 42 40 27 24 34 26 58 47 62 81 56 54 52 82 89 111 100]
```

Trend rules:
- Points: each monthly cohort with a Wilson whisker.
- Quarters: pooled calendar quarters drawn as a step with a shaded CI, only when all 3 months are mature and not early.
- Only mature months appear.

**Time to repeat curve (Kaplan-Meier).**
```
Time to repeat (i)
 20% |                                   ___________  6 to 18 months ago
     |                     ______-------
 10% |          ____-----         ............  Last 6 months (stops at n<30 at risk)
     |   __----   ....
  0% +----|-----------|---------------|-------------------|----
          30          90              180                 365 days
```

Curve rules:
- It follows the Event control: 2nd order, or first full-size order.
- Markers at 30, 90 and 180 days. Hover: "Day 90: 11.0%, CI a to b, at risk n".

**Entry products table** (shown only with classes).
```
Entry products (i)
+---------------+-----------+-------+----------+-----------+------------------+----------------+
| Entry         | Customers | Share | Repeat   | Repeat    | Full size        | 3rd order      |
|               |           |       | 90d      | 365d      | 365d             | 180d           |
+---------------+-----------+-------+----------+-----------+------------------+----------------+
| Discovery set |   1,740   | 59.2% |  11.8%   |  17.2%    |  15.2%           |  14.1%         |
| Full size     |     592   | 20.1% |   6.4%   |  20.2%    |  15.4%           |  10.8% .       |
| Single sample |     318   | 10.8% |  10.4%   |  20.9%    |  19.1%           |   n/a          |
| ...           |           |       |          |           |                  |                |
+---------------+-----------+-------+----------+-----------+------------------+----------------+
```

Table rules:
- Example values are audit parity.
- Every rate pools all mature, non-early customers of the class (customer level). Hover gives k, n and CI.
- Rows with fewer than 30 mature customers show n/a.

**Tooltips** (40 words or fewer each, kept in `lib/metrics.ts`):
- Repeat, H days: "Share of customers with a second order within H days of the first. Only customers whose first order is at least H days old count."
- Full size, H days: "Share of customers with a later order containing a full-size product within H days of the first order. Full size in the first order does not count."
- Cohorts: "Rows are first-order months. A cell shows once every customer in the month has had the full horizon."
- Trend: "One point per first-order month, with its 95% range. Bars are quarters pooled."
- Time to repeat: "Share converted by day since the first order. Recent customers count until today."
- Entry products: "What the first order contained. Same-day orders count as one."
- Early: "First months of data. May include earlier customers."

### 3.4 Repurchase page fixes
- After migration 257, SKU 153 is one row.
- Remove the line "X% of customers came back, lifetime". It blends only the top 15 products and duplicates the new page.
- The "First product" tooltip becomes: "Customers whose first order is at least 180 days old. Repeat counts any later order. Grouped by product code."

---

## 4. Reports

**Mart.** `customer_entry`:
```
table: mart.rpt_customer_entry, dateColumn: first_order_date, currencyColumn: null,
grains: [week, month], phase 1, selectAll: true, rowFilter: { excludeTrue: ["is_early"] }
```
- `rowFilter` is a new optional `MartDef` field. `compile.ts` adds `AND t.is_early IS NOT TRUE` to the CTE, and `assertDatePredicates` checks it.
- This is a plain sum mart, not an entity mart. All per-customer verdicts are already 0/1 columns, so no classifier is needed and no per-customer rows reach the app.

**Components.** All are counts, `nullMeans: "zero"`, `requires: "shop"`:
- `n_customer`, `is_discovery`, `has_second`, `classes_configured`
- `m90`, `r90`, `m180`, `r180`, `m365`, `r365`
- `m23_180`, `r23_180`
- `dm90`, `du90`, `dm180`, `du180`

**Metrics.** These are new ids appended to `ids.ts`, group `retention`, `benchmarkable: false`, `showCounts: { noun: "customers" }`:

| Id | Label | Formula | goodWhen |
|---|---|---|---|
| `repeat_rate_90` | Repeat rate, 90 days | r90 / m90 | up |
| `repeat_rate_180` | Repeat rate, 180 days | r180 / m180 | up |
| `repeat_rate_365` | Repeat rate, 365 days | r365 / m365 | up |
| `third_order_rate_180` | 3rd order, 180 days | r23_180 / m23_180 | up |
| `discovery_upgrade_90` | Discovery to full size, 90 days | du90 / dm90 | up |
| `discovery_upgrade_180` | Discovery to full size, 180 days | du180 / dm180 | up |
| `discovery_entry_share` | Discovery entry share | is_discovery / n_customer | neutral |

**Semantics.**
- The period means first-order dates (the acquisition cohort). Bucketing by week or month is the cohort.
- Combined and vertical rollups are sum over sum. Comparisons (previous period or year) compare earlier cohorts. Deltas are pp.

**New optional field `MetricBase.cohort`.** It takes `{ population: ComponentId, minN: 30, lowN: 100, needsClasses?: true }`. `evaluate.ts` applies these rules, in order:
1. `needsClasses` and Σ `classes_configured` = 0: not_measured "Products not classified". Rollups leave the client out and report coverage. Dobias, RawBark, Venev and Ethia are in this state until they are seeded.
2. Denominator 0 while the population is above 0: not_measured "Not mature yet".
3. Denominator below 30: not_measured "Too few customers".
4. Denominator from 30 to 99: data-driven caveat `low_n` ("Fewer than 100 customers").
5. Population above the denominator: data-driven caveat `cohort_partial` ("Recent customers not yet counted"). The period contains customers who have not yet had H days.

Deltas follow the standard rule: none when either side is not_measured.

**Version and caches.**
- `SEMANTIC_VERSION` goes from 7 to 8.
- Caveat ids are appended (`low_n`, `cohort_partial`).
- Picker and metric counts go from 47 to 54 in `check-reports.ts`, `check-reports-eval.ts` and `check-reports-pages.ts`.
- `METRICS.md` gets a "Cohort retention" section.

**Coverage.**
- `repeat_rate_*` and `third_order_rate_180` work for every shop client today.
- Discovery metrics work for Manami only until other clients get `ref.product_classes` rows. Seeding is per client data entry, with no code change.

**Not in Reports (phase 2):** CI per cell (a `MetricCell.interval`), KM curves, entry-class splits other than discovery.

---

## 5. Experiment support for "Tester to Full" (later phase)

**Why before/after cannot answer it.** The audit's pre/post comparison (9.2% vs 11.8%, p about 0.27) mixes season, offer and mix changes. Only a randomised holdout gives a causal read.

**Design.**
- **Unit and population.** The unit is the customer. The population is discovery-set entrants whose first order falls on or after the start date.
- **Assignment.** It is deterministic and recomputable in SQL:
  ```
  arm = IF(MOD(ABS(FARM_FINGERPRINT(CONCAT(salt, '|', customer_key))), 100) < 50, 'holdout', 'flow')
  ```
  - n8n writes the arm to an Ecomail contact field when the first order syncs.
  - The flow's first step skips `holdout` contacts.
  - Holdout contacts still receive campaigns; only the flow is withheld.
- **Analysis.**
  - Intention to treat, by assigned arm, whether or not mails were delivered.
  - Primary outcome: U_90. Secondary: R_90, U_180, and revenue per entrant at 180 days.
  - One pre-registered read when the target n is mature (no peeking), using a Newcombe CI on the difference.
- **Health checks.**
  - Sample-ratio mismatch: chi-square on arm counts.
  - Exposure rate in the flow arm.
  - Zero flow sends in the holdout.

**Sample size.**
- At an 11 to 12% baseline, a 3 pp lift needs about 1,900 per arm (the audit's figure, re-derived). That is 3,800 entrants, about 3 years at Manami's current set volume of roughly 110 a month at 50/50.
- 12 months (about 1,300 entrants, 650 per arm) detects about 5 pp.
- Recommendation: 50/50 split, minimum detectable effect 5 pp, a 12-month enrolment, then read 90 days later.

**Data needed.**
- `ref.experiments`: id, salt, start, end, population rule.
- New ingest of Ecomail per-contact automation events (entered flow, sent, opened, clicked) into `raw.raw_ecomail_automation_log`. This is used for the exposure and compliance checks only; the outcome comes from `rpt_customer_entry`.
- View `mart.rpt_experiment_ttf`: entrants by arm with m and u counts.
- UI later: an "Experiment" section on the Repeat rate page.

---

## 6. Work packages

All packages follow `00_agent_rules.md`. BigQuery writes happen only in `mart_qa`, with the package prefix. Prod deploys need the owner's OK.

| WP | Model | Depends on | Touches prod BigQuery |
|---|---|---|---|
| WR1 Warehouse core | opus | none; must run before 2026-10-12 for parity | Yes, 255 and 256 plus the scheduled query line (owner OK) |
| WR2 Repurchase and item fixes | sonnet | none (parallel) | Yes, 257 and 258, each needs its own owner OK |
| WR3 Repeat rate page | sonnet | WR1 schema contract; live check after the 256 deploy | No |
| WR4 Customers and Cohorts fixes | sonnet | WR1 (view) | No |
| WR5 Reports | opus | WR1 (table) | No |

**Order:**
1. WR1 and WR2 run in parallel.
2. The owner deploys 255 and 256.
3. WR3, WR4 and WR5 run in parallel, developing against demo fixtures and verifying live after the deploy.
4. The orchestrator merges: WR2, then WR4, then WR3, then WR5. The `package.json` scripts are added by the orchestrator.

### WR1 Warehouse core (opus)

**Owns:**
- `infra/bigquery/255_ref_retention.sql`, `256_rpt_customer_entry.sql`
- `infra/bigquery/qa/256_rpt_customer_entry_regression.sql`
- `infra/bigquery/live/ref.retention_settings.sql`, `ref.product_classes.sql`
- `infra/bigquery/live/mart.sp_refresh_rpt_customer_entry.sql`, `mart.mart_retention_cohorts.sql`
- `infra/bigquery/live/ops.v_unclassified_products.sql`
- the live README "Pending deploy" entry

**mart_qa objects:** `wr1_product_classes`, `wr1_retention_settings`, `wr1_rpt_customer_entry` and a procedure variant.

**Acceptance, part 1: audit parity mode.** Settings: cut-off 2026-10-04, lag 0, guard 0, no validity filter, parity columns. Tolerance ±0.1 pp, n ±2.
- **Per-customer match.** EXCEPT against `mart_qa.ret_manami_orders`: 0 and 0, or explained.
- **Entrant counts.** Customers 2,938 to 2,940:

  | Entry class | Customers |
  |---|---|
  | discovery | 1,740 (59.2%) |
  | full | 592 |
  | sample | 318 |
  | other | 171 |
  | mixed | 76 |
  | gift | 43 |

- **All customers:** r30 6.6%, r90 10.4%, r180 13.0%, r365 **18.8%** (n 1,084).
- **Discovery set:**

  | Measure | Value |
  |---|---|
  | r30 | 7.7% (n 1,602) |
  | r90 | 11.8%, CI 10.2 to 13.7 (n 1,322) |
  | r180 | 13.0% (n 1,000) |
  | r365 | **17.2%**, CI 14.4 to 20.4 (n 600) |
  | u180 | 11.6% |
  | u365 | **15.2%**, CI 12.5 to 18.3 |
  | 2nd to 3rd, 180 days | 14.1% (n 135) |

- **Full size:** r90 6.4% (n 488), r365 20.2% (n 267).
- **Monthly discovery cohorts:** 2024-05 n 44, r365 25.0%; 2025-08 n 58, r365 20.7%; 2026-04 n 89, r90 16.9%.
- **Pooled discovery R_90:** Jan to Jun 2025 9.9% (n 202), Jan to Jun 2026 12.3% (n 488). Before and after the flow: 9.2% (n 305) and 11.8% (n 382).

**Acceptance, part 2: production mode** (defaults, Manami guard 180). Report the values. They should land within ±0.5 pp of these estimates from the scratch table:
- discovery R_90 Jan to Jun 2026: 12.1% (59 of 488); U_90 11.5%;
- R_180 Oct 2025 to Mar 2026: 9.8% (38 of 387); U_180 8.8%;
- all-customer R_365, non-early: 15.7% (111 of 709).

**Acceptance, part 3: generic.**
- All 5 clients are present.
- The independent recompute matches.
- No duplicates.
- Discovery metrics are NULL or 0 for clients without classes.
- Bytes and duration per CALL are recorded.
- The prod deploy statements are listed in order.

### WR2 Repurchase and item fixes (sonnet)

**Owns:**
- `infra/bigquery/257_stg_customer_items_shoptet_label.sql`, `258_stg_shoptet_items_status.sql`
- `qa/257_regression.sql`, `qa/258_regression.sql`
- `live/stg.stg_customer_order_items.sql`, `live/stg.stg_shoptet_order_items.sql`
- `dashboard/app/(app)/repurchase/page.tsx`

**Acceptance:**
- **257.**
  - SKU 153 is one row, "Testovací sada všech parfémů". At audit time the four rows summed to 974 customers (325, 466, 57 and 126); report the current value.
  - Non-Shoptet clients have 0 diff rows in the four views.
  - Manami diffs are limited to the product label and key.
- **258.**
  - Exactly the 128 orders and 227 lines leave the Manami item level.
  - The Products, SKU and Unit economics deltas are explained.
  - Customer marts and `stg_shoptet_orders` are 0 and 0.
- **Repurchase page.** The blended line is gone, the tooltip is updated, the copy gates pass, and tsc and the build pass.

### WR3 Repeat rate page (sonnet)

**Owns:**
- `dashboard/app/(app)/repeat-rate/{page,loading}.tsx`
- `lib/queries/retention.ts` (two queries: the cohort view, and KM rows grouped by group and t)
- `lib/retention/{stats,model}.ts`: `wilson`, `newcombe`, `kaplanMeier` with Greenwood, `poolMonths`, `monthMature`, `lastMatureWindow`
- `components/retention/{RetentionTiles,CohortRateTable,CohortTrendChart,RepeatCurveChart,EntryClassTable,RateDiff}.tsx` (charts use Recharts via `next/dynamic`)
- `lib/demo/retention.ts`
- `scripts/check-retention.ts`
- additions only to `lib/nav.ts`, `lib/capabilities.ts` and `lib/metrics.ts`

**Acceptance:**
- The Wilson vectors in 1.8 are exact to 0.1.
- The Newcombe vector (59 of 488 vs 19 of 202) gives +2.7 pp, about -2.8 to +7.3, "No clear change".
- KM: with no censoring it equals the empirical cumulative share. A hand-computed censored example (5 customers) passes. The curve stops at fewer than 30 at risk.
- Month maturity: Aug 2026 is mature for H = 30 only when `cutoff >= 2026-09-30`.
- Manami tiles equal a SQL pooled query on the table, per tile.
- Early rows are excluded from the summary rows.
- Copy gates pass: no em or en dash, no table names, no client names, n/a for missing values.
- Demo client renders every state.
- tsc and build pass.

### WR4 Customers and Cohorts fixes (sonnet)

**Owns:**
- `app/(app)/customers/page.tsx`, `lib/queries/lifetime.ts`
- `app/(app)/cohorts/page.tsx`, `lib/queries/cohorts.ts`, `lib/queries/cohortGrid.ts`
- `lib/demo/customers.ts`

**Acceptance (Manami):**
- AOV is 1,026 (±5 for new orders).
- "Repeat rate, to date" stays at 14.3%.
- "Repeat rate, 365 days" equals the WR3 value (estimated 15.7%; 18.8% in parity mode).
- No "36-month" text remains.
- The Cohorts tile equals the Customers tile.
- Y1 means are weighted, checked against SQL.
- The grid's "all cohorts" row equals a SQL recompute with blanks as 0 and the current month excluded.
- Copy gates, tsc and build pass.

### WR5 Reports (opus)

**Owns:**
- `lib/reports/registry/{types,components,metrics,caveats,ids}.ts`
- `lib/reports/{compile,evaluate}.ts`
- `scripts/check-reports{,-eval,-pages}.ts`
- `lib/reports/README.md`, `METRICS.md` section

**Acceptance:**
- SQL snapshots:
  - every `customer_entry` CTE has its date predicate and `is_early IS NOT TRUE`;
  - widgets without the mart compile to byte-identical SQL;
  - no threshold or user value in SQL.
- Manami monthly 2026-01 to 2026-06, combined: `discovery_upgrade_90` = Σ du90 / Σ dm90 equals the page tile (about 56 of 488 = 11.5%).
- `repeat_rate_365` on a range that includes immature months carries `cohort_partial`.
- n < 30 shows not_measured "Too few customers".
- Dobias discovery metrics show not_measured "Products not classified", with combined coverage 1 of 2.
- Deltas are pp.
- `SEMANTIC_VERSION` is 8. Counts go from 47 to 54. All existing check scripts pass.
- Live column check against the table.

---

## 7. Open questions for the owner (recommended defaults)

1. **Manami product classification (table 2.1).**
   - Default: as seeded, which matches the audit.
     - 5 ml counts as full size.
     - Perfume bundles count as full size.
     - `409` (test gift set plus voucher) is its own "gift" entry, not discovery.
     - Gift sets `249`, `252`, `412` and `415` are "other".
   - Please confirm, or name the codes to move. In particular: should `249` and `252`, which come in 5, 10 and 20 ml variants, count as full size?
2. **"Slevový kód - testery" status** (819 orders, 2024-05 to 2025-10, 664 containing the set).
   - Default: keep them as valid paid orders.
   - Please ask Manami what the code was: a discounted set, or a credit toward a bottle. If it was a set discount, the 2025 to 2026 trend compares discounted entrants with full-price ones, and I would add a first-order discount flag.
3. **Left-censoring guard.**
   - Default: Manami 180 days, because the backfill starts 2024-05-06 and earlier sales are unknown. All other clients 0.
   - It moves Manami's headline: all-customer 365-day repeat is 18.5% with early cohorts and 15.7% without.
   - Did Manami sell before May 2024, and is Ethia's 2025-03 start the shop's real start?
4. **Validity and timing rules.**
   - Default:
     - merge same-day orders into the first order;
     - exclude zero-revenue, complaint and fully refunded orders;
     - leave a 3-day sync buffer before the cut-off.
   - Each moves numbers by 0.5 pp or less against the audit. Parity columns keep the audit's rule available for checks.
5. **Experiment.**
   - Default: approve a 50/50 deterministic holdout on "Tester to Full", starting after the page ships.
   - Accept a minimum detectable effect of about 5 pp at 12 months. A 3 pp lift needs about 3 years at current volume.
   - Approve building the Ecomail per-contact automation-log ingest.

Separately from these questions, each prod step needs your OK: deploying 255 and 256, adding the CALL line to `rpt_refresh_hourly`, deploying 257, and deploying 258.

### Critical Files for Implementation
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/infra/bigquery/254_rpt_ad_launch.sql
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/infra/bigquery/live/stg.stg_customer_orders.sql
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/reports/registry/types.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/reports/evaluate.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/app/(app)/customers/page.tsx