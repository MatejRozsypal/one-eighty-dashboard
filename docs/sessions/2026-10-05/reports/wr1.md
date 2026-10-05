# WR1 report: retention warehouse core

Branch `wr1-retention-core`, commit `70e8408` (not pushed). Worktree
`/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/wr1-retention-core`.

## What changed

| File | Content |
|---|---|
| `infra/bigquery/257_ref_retention.sql` | `ref.retention_settings`, `ref.product_classes`, Manami seed: 40 rules (32 code, 7 name fallback, 1 default) and the settings row (2024-05-06, guard 180, lag 3, horizon 90) |
| `infra/bigquery/258_rpt_customer_entry.sql` | procedure `mart.sp_refresh_rpt_customer_entry`, first CALL, view `mart.mart_retention_cohorts`, view `ops.v_unclassified_products`, scheduler text |
| `infra/bigquery/qa/258_rpt_customer_entry_regression.sql` | all checks with their results |
| `infra/bigquery/live/` | `ref.retention_settings.sql`, `ref.product_classes.sql`, `mart.rpt_customer_entry.sql`, `mart.sp_refresh_rpt_customer_entry.sql`, `mart.mart_retention_cohorts.sql`, `ops.v_unclassified_products.sql`, README (table rows and a pending entry for the schedule only) |

**Status:** deployed to prod on 2026-10-05, after the mart_qa regression passed.

**MD5 checks against live:**
- The view definitions and the three table DDLs match the files in `live/`.
- The procedure file is the text exactly as sent. `ROUTINES.ddl` is normalised by BigQuery, which is the same situation as for 253.

## Table contract for WR3 to WR5

**`mart.rpt_customer_entry`** has 54 columns and is clustered by `client_id, cohort_month`.

- **Columns:**
  - `client_id`, `customer_id` (SHA256 of `client_id|customer_key`), `cohort_month`, `first_order_date`
  - `classes_configured`, `entry_class`, `entry_class_first_order`, `has_unmatched_line`
  - `first_order_revenue`, `first_day_orders`, `orders_total`, `order_days_total`
  - `second_order_date`, `third_order_date`, `first_full_date`, plus the three `*_any_date` parity columns
  - `data_start_date`, `history_guard_days`, `as_of_date`, `cutoff_date`, `is_early`, `observed_days`
  - `days_to_2nd`, `days_2nd_to_3rd`, `days_to_full`
  - `n_customer`, `m/r/u` for 30, 60, 90, 180 and 365
  - `is_discovery`, `has_second`, `m23_180`, `r23_180`, `dm/du` for 90, 180 and 365, `refreshed_at`
- **Flag type:** every flag is INT64 0/1.

**`mart.mart_retention_cohorts`**
- It groups the table by `client_id, cohort_month, entry_class, is_early`.
- The sums keep the table's column names: `n_customer`, `m*`, `r*`, `u*`, `m23_180`, `r23_180`.
- It also returns `classes_configured`, `cutoff_date`, `data_start_date`, `history_guard_days`, `n_unmatched` and `refreshed_at`.

## Deviation from the design (please confirm)

**NULL revenue counts as a valid order.**
- Dobias has 34,325 orders from 2013 to mid 2022, from the migrated store, with `revenue` NULL.
- With the literal `revenue > 0` rule they all drop out:
  - Dobias falls from 21,866 to 13,409 customers.
  - Migrated customers' later orders become false first orders.
- The rule is now `revenue IS NULL OR revenue > 0`. Zero-revenue orders stay excluded.
- Effect: Manami and the other three clients are unchanged, because they have no NULL revenue.

## Acceptance part 1: audit parity

Run in mart_qa on Manami, with cut-off 2026-10-04, lag 0, guard 0 and no validity filter.

- **Per-customer EXCEPT DISTINCT** against `mart_qa.ret_manami_orders`: **0 and 0**, 2,940 customers on both sides. The parity run is done; the scratch table can expire.
- **Entrants:**

  | Entry class | Customers |
  |---|---|
  | discovery | 1,740 (59.2%) |
  | full | 592 |
  | sample | 318 |
  | other | 171 |
  | mixed | 76 |
  | gift | 43 |

- **All customers:**

  | Horizon | Rate | k / n |
  |---|---|---|
  | r30 | 6.6% | 181 / 2,735 |
  | r90 | 10.4% | 241 / 2,312 |
  | r180 | 13.0% | 229 / 1,758 |
  | r365 | 18.8% | 204 / 1,084 |

- **Discovery:**

  | Measure | Rate | k / n | Wilson 95% CI |
  |---|---|---|---|
  | r30 | 7.7% | 124 / 1,602 | |
  | r90 | 11.8% | 156 / 1,322 | 10.2 to 13.7 |
  | r180 | 13.0% | 130 / 1,000 | |
  | r365 | 17.2% | 103 / 600 | 14.4 to 20.4 |
  | u180 | 11.6% | | |
  | u365 | 15.2% | | 12.5 to 18.3 |
  | 2nd to 3rd, 180 days | 14.1% | 19 / 135 | |

- **Full size:** r90 6.4% (n 488), r365 20.2% (n 267).
- **Monthly discovery cohorts:**
  - 2024-05: n 44, r365 25.0%
  - 2025-08: n 58, r365 20.7%
  - 2026-04: n 89, r90 16.9%
- **Pooled discovery R_90:**
  - Jan to Jun 2025: 9.9% (20 of 202)
  - Jan to Jun 2026: 12.3% (60 of 488)
  - Pre flow: 9.2% (28 of 305)
  - Post flow: 11.8% (45 of 382)
- **Result:** every target is reproduced exactly.

## Acceptance part 2: production mode

Run on Manami with guard 180, lag 3 and cut-off 2026-10-01. mart_qa and prod give identical results.

| Measure | Result | Estimate |
|---|---|---|
| Discovery R_90, Jan to Jun 2026 | 12.1% (59 of 488) | 12.1% |
| Discovery U_90, Jan to Jun 2026 | 11.5% (56 of 488) | 11.5% |
| Discovery R_180, Oct 2025 to Mar 2026 | 9.6% (37 of 387) | 9.8% |
| Discovery U_180, Oct 2025 to Mar 2026 | 8.5% | 8.8% |
| All-customer R_365, non-early | 15.7% (111 of 709) | 15.7% |

- Every value is within 0.5 pp of its estimate.
- **Also measured:**
  - Discovery R_90 Jan to Jun 2025: 9.4% (19 of 202). The Newcombe vector in the design uses these same figures.
  - All customers including early, R_365: 18.5%.
  - Manami has 2,936 customers, of whom 369 are early.
  - 846 customers have an entry-basket line that matched only the default rule (oils, flower waters and similar).
- **Check:** the cohort view gives the same sums as the table.

## Acceptance part 3: generic

These ran in mart_qa and again on prod, with the same results.

- **All 5 clients present.**

  | Client | Customers |
  |---|---|
  | dobias | 21,655 |
  | rawbark | 14,484 |
  | venev | 3,155 |
  | manami | 2,936 |
  | ethia | 1,256 |
  | **Total** | **43,486** |

- **Independent recompute** from `stg_customer_orders` without the item join, compared per customer in both directions: 0 and 0 for every client.
- **Order totals and identity:** order totals equal the valid-order counts, and customer counts equal distinct emails.
- **Duplicates:** 0.
- **Flag order:** holds (it is also asserted in the procedure).
- **Clients without classes:** `entry_class` and `has_unmatched_line` are NULL, and every discovery flag is 0.
- **Prod table against the mart_qa candidate:** 0 and 0, with `refreshed_at` excluded.
- **Unclassified monitor:**
  - It returns 0 rows on prod.
  - Logic test: with the default rule's date moved back to 2026-06-01, it lists the 7 codes first seen after that day.
- **IAM:** `sa-frontend-reader` has `roles/bigquery.dataViewer` on dataset `mart` at dataset level, so the new table and view inherit it. This is inferred from the grant; the account itself was not impersonated.

## Bytes and duration per CALL

| Run | Duration | Processed | Billed | CTAS |
|---|---|---|---|---|
| mart_qa | 22.5 to 22.7 s | 486 MB | 547 MB | 11 s |
| Prod, first run (script including CREATE PROCEDURE) | 30.1 s | 486 MB | 547 MB | 15.6 s |
| Prod, replace run | 24.1 s | 486 MB | 547 MB | 12.4 s |

- **Split of the 547 MB billed:**
  - CTAS: 441 MB
  - Client check on `stg_customer_orders`: 94 MB
  - Row checks: 12 MB
- **Monthly cost if run hourly:** about 390 GB, roughly USD 2.5.
- **Table size:** 17.6 MB.
- **Monitor view:** each read scans about 240 MB, so read it on demand only.

## Scheduled query text (owner creates `rpt_refresh_hourly`, location EU, every 1 hour, no destination)

```sql
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_kpis`();
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`();
CALL `oneeighty-warehouse.mart.sp_refresh_rpt_customer_entry`();
```

## Prod deploy statements, in the order they were run

1. `257_ref_retention.sql`: two CREATE TABLE statements and two INSERTs.
2. `258` statement 1 (procedure) and statement 2 (`CALL`).
3. `258` statements 3 and 4 (the two views).
4. A second `CALL`, then the prod checks.

**Rollback** is in the 258 and 257 headers.

## mart_qa objects

- **Tables and procedures:**
  - `wr1_retention_settings`, `wr1_retention_settings_parity`, `wr1_product_classes`
  - `wr1_sp_refresh_rpt_customer_entry`, `wr1_sp_refresh_rpt_customer_entry_parity`
  - `wr1_rpt_customer_entry`, `wr1_rpt_customer_entry_parity`
- **Views:** `wr1_mart_retention_cohorts`, `wr1_v_unclassified_products`.
- **Note on the parity table:** keep it until WR3 to WR5 are done.

## Open issues / requests to orchestrator

1. **Owner:**
   - Create `rpt_refresh_hourly` with the 3 lines above.
   - Until then the table holds the 2026-10-05 build, and its cut-off does not move.
2. **Owner:** confirm the NULL-revenue rule for Dobias's migrated orders. The design's sizing of 21,866 Dobias customers assumed those orders are kept.
3. **Design text:** design 1.1 and 2.2 say `revenue > 0`. Update them to "revenue > 0 or NULL".
4. **For WR3 and WR5:** `has_unmatched_line` counts any entry line that matched only the default rule. For Manami that is 846 customers, so it is not a coverage alarm. Use `ops.v_unclassified_products` for coverage instead.
