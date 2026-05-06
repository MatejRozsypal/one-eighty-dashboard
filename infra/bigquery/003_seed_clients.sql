-- 003_seed_clients.sql
-- Seeds the two starter clients. Run AFTER 002.
--
-- Manami    — Czech, Shoptet + Ecomail. Active. You control all credentials.
-- Dr Dobias — Canadian, Shopify + Klaviyo. Onboarding until Peter sends credentials.
--
-- To add a new client later: INSERT one row here with the right has_* flags. No code changes.

INSERT INTO `oneeighty-warehouse.ref.clients` (
  client_id, slug, name, currency, timezone, country,
  shop_platform, email_platform, status,
  has_shopify, has_shoptet, has_klaviyo, has_ecomail,
  has_meta, has_gads, has_ga4, has_instagram
) VALUES
(
  'manami', 'manami', 'Manami s.r.o.',
  'CZK', 'Europe/Prague', 'CZ',
  'shoptet', 'ecomail', 'active',
  FALSE, TRUE, FALSE, TRUE,
  FALSE, FALSE, FALSE, FALSE
),
(
  'dr_dobias', 'dr-dobias', 'Dr. Dobias Natural Pet Health',
  'USD', 'America/Toronto', 'CA',
  'shopify', 'klaviyo', 'onboarding',
  TRUE, FALSE, TRUE, FALSE,
  FALSE, FALSE, FALSE, FALSE
);

-- Verify
SELECT client_id, name, status, shop_platform, email_platform
FROM `oneeighty-warehouse.ref.clients`
ORDER BY client_id;
