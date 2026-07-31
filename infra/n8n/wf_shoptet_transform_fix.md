# wf_shoptet — fix for new/returning tagging

**Date:** 2026-06-14
**Severity:** high (Manami new/returning split was wrong from ~2026-05-13)

## What was wrong

The Shoptet ingestion workflow has a Function/Code node — the **"Transform Item Data"**
node that rolls flat CSV line-item rows up into one row per order (`raw_shoptet_orders`).
That node computes two customer-history fields:

- `customerOrderCount`
- `isReturningCustomer`

It computes them by counting how many times a customer (email) appears **in the
current run's data only**. That is correct during a full backfill (the whole order
history is in one batch) but wrong on every incremental run, where the node only sees
recent orders. So from the hourly sync onward each customer looks like a first-timer:
`customerOrderCount` caps at 2 and `isReturningCustomer` collapses to ~1.6% (May 2026)
vs a true ~14–20% repeat rate.

`stg_shoptet_orders` then passed `isReturningCustomer` straight through, and the marts
reported a fake retention collapse.

## The fix has two parts

### 1. BigQuery (DONE — already applied 2026-06-14)

`stg.stg_shoptet_orders` now derives `is_returning_customer` from email order-sequence
across the full table (same method as `stg_shopify_orders`), ignoring the broken raw
flag. The raw flag is kept as `is_returning_customer_raw` for audit. This retroactively
fixes all historical months — no re-ingest needed. See
`infra/bigquery/201_fix_stg_shoptet_is_returning.sql`.

### 2. n8n (TO DO — stop producing the misleading raw values)

In the Shoptet **"Transform Item Data"** Code node, stop computing returning status
from the batch. Mirror what `wf_shopify_csv_import` already does (it sets
`is_returning_customer: null` and lets BigQuery derive it).

**Find these two fields in the object the node returns per order:**

```javascript
// BEFORE — batch-local count, wrong on incremental runs
customerOrderCount:  countForThisEmailInThisBatch,   // however it's currently named
isReturningCustomer: countForThisEmailInThisBatch > 1,
```

**Replace with:**

```javascript
// AFTER — do not infer history from a partial batch.
// BigQuery (stg_shoptet_orders) derives returning from full email history.
customerOrderCount:  null,
isReturningCustomer: null,
```

That is the whole change. Remove any now-unused per-email tally/`Map`/`reduce` that
was only there to build those two values.

> If you instead want a TRUE lifetime counter stored at source, the only reliable way
> in an incremental pipeline is to read it from Shoptet's customer record
> (`GET /api/customers`, field for number of orders) and join by `customerGuid` /
> email before insert. More work, and unnecessary now that the view handles it —
> recommended only if you need the lifetime count in raw for other purposes.

## Doc drift to reconcile

`wf_shoptet.md` (Node 10 — Normalize orders) documents:

```javascript
is_returning_customer: Boolean(item.json.customerGuid),
```

That is also wrong (it flags "has a registered account", not "has ordered before")
**and** does not match what is actually running in production (which used the
batch count). Update `wf_shoptet.md` Node 10 to set `is_returning_customer: null`
so the runbook matches reality.

## Verify after deploying the n8n change

```sql
-- corrected flag should stay stable; *_raw should now be null for new ingests
SELECT DATE_TRUNC(order_date, MONTH) AS month,
  COUNT(*) AS orders,
  ROUND(100*SAFE_DIVIDE(COUNTIF(is_returning_customer IS TRUE), COUNT(*)),1)     AS corrected_ret_pct,
  COUNTIF(is_returning_customer_raw IS NOT NULL)                                 AS rows_with_raw_flag
FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
WHERE client_id='manami' AND order_date >= '2026-04-01'
GROUP BY month ORDER BY month;
```
