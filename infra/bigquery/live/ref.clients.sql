CREATE TABLE `oneeighty-warehouse.ref.clients`
(
  client_id STRING NOT NULL,
  slug STRING NOT NULL,
  name STRING NOT NULL,
  currency STRING NOT NULL,
  timezone STRING NOT NULL,
  country STRING,
  shop_platform STRING,
  email_platform STRING,
  status STRING NOT NULL,
  has_shopify BOOL DEFAULT FALSE,
  has_shoptet BOOL DEFAULT FALSE,
  has_klaviyo BOOL DEFAULT FALSE,
  has_ecomail BOOL DEFAULT FALSE,
  has_meta BOOL DEFAULT FALSE,
  has_gads BOOL DEFAULT FALSE,
  has_ga4 BOOL DEFAULT FALSE,
  has_instagram BOOL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  klaviyo_conversion_metric_id STRING,
  klaviyo_subscriber_segment_id STRING,
  meta_currency STRING OPTIONS(description="ISO-4217 the Meta ad account bills in. Set when the ad account is created and cannot be changed retroactively; it is unrelated to the shop's currency. NULL = no Meta account."),
  gads_currency STRING OPTIONS(description="ISO-4217 the Google Ads account bills in (customer_currency_code in the DTS ads_Customer_* table). NULL = no Google Ads account."),
  taxes_included BOOL OPTIONS(description="TRUE when the shop's displayed prices already contain tax (Shopify shop.taxesIncluded). Determines whether revenue must be deflated to reach the ex-tax definition. NULL is treated as FALSE."),
  has_woocommerce BOOL,
  gads_customer_id INT64 OPTIONS(description="Google Ads customer id (digits only, no dashes). stg_google_ads_campaign_insights maps account -> client through this column. Set together with has_gads and gads_currency when onboarding.")
)
OPTIONS(
  description="Master registry of agency clients. Every workflow loops over rows here filtered by status='active' and the relevant has_<source> flag."
);
