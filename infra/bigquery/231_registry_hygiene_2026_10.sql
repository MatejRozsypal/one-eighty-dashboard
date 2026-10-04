-- 231_registry_hygiene_2026_10.sql
-- Purpose:   registry hygiene on ref.clients (audit 03 section 1, P1-15, plan W7).
--              1. rawbark.taxes_included NULL -> FALSE (raw prices_include_tax is false).
--              2. has_woocommerce NULL -> FALSE for the clients that are not WooCommerce.
--              3. has_ga4 -> TRUE for dobias and manami, which have a live GA4 export
--                 (analytics_314809580 and analytics_343337695, fresh 2026-10-03).
--                 NOT set for ethia, rawbark, venev: their exports are not linked yet.
--              4. (commented out) RawBark Meta: has_meta and meta_currency together.
-- Based on:  live/ref.clients.sql (snapshot 2026-10-04).
-- Affected clients: rawbark (1), dobias, manami, venev (2), dobias, manami (3).
-- Regression: no view reads has_ga4 or has_woocommerce except the n8n readers
--            (WHERE has_woocommerce = TRUE, unaffected by NULL -> FALSE) and the
--            dashboard registry loader (dashboard/lib/clients.ts, treats has_ga4 as
--            === true, nothing branches on it yet). taxes_included: only
--            stg_shopify_orders reads it; stg_woo_orders does not, and the column
--            description already says NULL is treated as FALSE. Net effect on every
--            mart: zero rows changed.
-- NOT EXECUTED against prod. Needs owner OK. Deploy order: any time, independent of 230, 232, 233.
--
-- Idempotent: every UPDATE has a WHERE that no longer matches after the first run.

-- 1. RawBark prices are entered ex tax. Evidence: raw_woo_orders.prices_include_tax = FALSE.
UPDATE `oneeighty-warehouse.ref.clients`
SET taxes_included = FALSE, updated_at = CURRENT_TIMESTAMP()
WHERE client_id = 'rawbark' AND taxes_included IS NULL;

-- 2. NULL must not mean "unknown" for a platform flag.
UPDATE `oneeighty-warehouse.ref.clients`
SET has_woocommerce = FALSE, updated_at = CURRENT_TIMESTAMP()
WHERE has_woocommerce IS NULL;

-- 3. GA4 exports exist and are fresh for these two only.
UPDATE `oneeighty-warehouse.ref.clients`
SET has_ga4 = TRUE, updated_at = CURRENT_TIMESTAMP()
WHERE client_id IN ('dobias', 'manami') AND has_ga4 IS DISTINCT FROM TRUE;

-- 4. RawBark Meta. DO NOT run until the Meta ad account exists, the secrets
--    meta-rawbark-access-token and meta-rawbark-ad-account-id are created and the
--    owner has sent the ad account currency (replace 'CZK' below if it differs).
--    has_meta and meta_currency MUST be set in the SAME statement: a NULL
--    meta_currency makes mart_daily_kpis compute fx = NULL for the Meta rows and
--    silently drops the spend (audit 03 section 3).
-- UPDATE `oneeighty-warehouse.ref.clients`
-- SET has_meta = TRUE, meta_currency = 'CZK', updated_at = CURRENT_TIMESTAMP()
-- WHERE client_id = 'rawbark' AND (has_meta IS DISTINCT FROM TRUE OR meta_currency IS NULL);

-- Verify (expect rawbark taxes_included = FALSE, has_woocommerce never NULL,
-- has_ga4 TRUE only for dobias and manami):
--   SELECT client_id, taxes_included, has_woocommerce, has_ga4, has_meta, meta_currency
--   FROM `oneeighty-warehouse.ref.clients` ORDER BY 1;
