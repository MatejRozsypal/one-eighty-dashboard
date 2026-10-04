CREATE TABLE `oneeighty-warehouse.ref.ad_spend_zero_days`
(
  client_id STRING NOT NULL,
  platform STRING NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  note STRING,
  updated_by STRING NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
)
OPTIONS(
  description="Days on which a platform ran no ads: mart.mart_daily_kpis shows spend 0 instead of NULL (missing) on them. Fills NULL only, never creates rows. Only for days the owner confirmed as no ads; real ingestion holes stay NULL. See METRICS.md."
);
