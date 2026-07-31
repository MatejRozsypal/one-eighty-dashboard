-- 201_fix_stg_shoptet_is_returning.sql
-- =============================================================================
-- FIX: Manami (Shoptet) new vs returning customer tagging
-- =============================================================================
-- PROBLEM
--   stg_shoptet_orders.is_returning_customer is a pass-through of the raw
--   Shoptet field `customerOrderCount` (is_returning = customerOrderCount > 1).
--   That counter is computed PER SYNC WINDOW, not from the customer's true
--   lifetime history. During the 24-month backfill (ingested 2026-05-06) the
--   counts were correct (max 4-5, ~20-30% returning). From the hourly
--   incremental sync onward (2026-05-13+) each run only sees recent orders,
--   so customerOrderCount caps at 2 and ~99% of orders read as "new".
--
--   Result: returning-customer share collapsed to ~1.6% in May 2026 while an
--   independent email-history measure shows the real repeat rate is unchanged
--   (~14-20%). The drop is a DATA ARTIFACT, not a retention collapse.
--
-- FIX (immediate, view-only — no pipeline change)
--   Re-derive is_returning_customer from order history by email, exactly as
--   stg_shopify_orders does. Recomputes correctly on every query, independent
--   of the broken counter. The raw counter is preserved as
--   customer_order_count_raw / is_returning_customer_raw for audit.
--
-- LIMITATION
--   Email-based history is bounded by the warehouse window and fragments when a
--   customer uses different emails or guest-checkouts. It is therefore a FLOOR
--   on the true returning rate. For the canonical lifetime figure, join the
--   customer's real order count from Shoptet's /api/customers record by
--   customerGuid (see PROPER FIX note at bottom) and fix the n8n transform so
--   customerOrderCount is not computed incrementally.
-- =============================================================================

CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_shoptet_orders` AS
WITH deduped AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY client_id, code ORDER BY ingested_at DESC) AS rn
    FROM `oneeighty-warehouse.raw.raw_shoptet_orders`
    WHERE orderDate >= '2020-01-01'
  )
  WHERE rn = 1
    AND LOWER(statusName) NOT IN ('storno', 'cancelled', 'zrušeno')
)
SELECT
  client_id,
  code AS order_code,
  orderDate AS order_date,
  statusName AS status,
  sourceName AS source,
  email,
  currency,
  exchangeRate AS exchange_rate,
  totalPriceWithVat        AS total_with_vat,
  totalPriceWithVatCZK     AS total_with_vat_czk,
  productRevenue           AS product_revenue,
  productRevenueCZK        AS product_revenue_czk,
  totalMargin              AS margin,
  totalMarginCZK           AS margin_czk,
  priceToPay               AS price_to_pay,
  priceToPayCZK            AS price_to_pay_czk,
  shippingMethod  AS shipping_method,
  paymentMethod   AS payment_method,
  itemCount       AS item_count,
  totalQuantity   AS total_quantity,

  -- CORRECTED returning flag: first order by this email = new, any later = returning.
  -- NULL when email is missing (cannot determine history).
  CASE
    WHEN email IS NULL OR TRIM(email) = '' THEN CAST(NULL AS BOOL)
    ELSE ROW_NUMBER() OVER (
      PARTITION BY client_id, LOWER(TRIM(email))
      ORDER BY orderDate, code
    ) > 1
  END AS is_returning_customer,

  -- Original passthrough kept under its existing name (non-breaking) + audit alias.
  customerOrderCount  AS customer_order_count,
  isReturningCustomer AS is_returning_customer_raw,

  ingested_at
FROM deduped;

-- =============================================================================
-- VALIDATION — run after applying. flag (corrected) should track email history
-- and stay stable across the April->May 2026 boundary; *_raw should show the
-- artificial collapse.
-- =============================================================================
-- SELECT
--   DATE_TRUNC(order_date, MONTH) AS month,
--   COUNT(*) AS orders,
--   ROUND(100*SAFE_DIVIDE(COUNTIF(is_returning_customer IS TRUE), COUNT(*)),1)      AS corrected_ret_pct,
--   ROUND(100*SAFE_DIVIDE(COUNTIF(is_returning_customer_raw IS TRUE), COUNT(*)),1)  AS broken_raw_ret_pct
-- FROM `oneeighty-warehouse.stg.stg_shoptet_orders`
-- WHERE client_id = 'manami' AND order_date >= '2025-01-01'
-- GROUP BY month ORDER BY month;

-- =============================================================================
-- PROPER FIX (pipeline) — do this so the lifetime counter is trustworthy again:
--   1. In wf_shoptet, stop deriving customerOrderCount incrementally. Either:
--      a) read the order count from Shoptet's customer record (/api/customers,
--         join by customerGuid), or
--      b) recompute is_returning over the FULL order table at transform time,
--         not over the current sync batch.
--   2. Reconcile doc drift: infra/n8n/wf_shoptet.md documents
--      `is_returning_customer: Boolean(item.json.customerGuid)`, which is also
--      wrong (it flags "has an account", not "has ordered before") and does not
--      match what is actually running. Update the runbook to the real logic.
-- =============================================================================
