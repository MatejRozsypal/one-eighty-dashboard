-- 225_adset_perf_fallback.sql
-- Creative Engine: make `mart_creative_adset_perf` return rows.
--
-- ── The problem ───────────────────────────────────────────────────────────
-- The view reads `stg.stg_meta_adset_insights`, and that table is EMPTY for
-- every client. `runbooks/28` section 4 says why: the ad-set-level insights
-- call was specified and never added to the Meta workflow. The table was
-- created, nothing has ever written to it, and no error was ever raised —
-- the view simply returns nothing.
--
-- Four things depend on it and all four have been silently dead:
--
--   · the ad set age and frequency on every concept card, which is what the
--     no-touch gate is read from;
--   · "This week's decisions" on the Concepts screen — ad-set level, which is
--     where the SOP says money verdicts are taken. Zero rows, so the section
--     never rendered at all;
--   · two of Velocity's eight gauges, "Packs launched, 30d" and "Ads in last
--     pack", both reading zero;
--   · the launch cadence chart, which counts packs by the month they started.
--
-- ── The fix, and its one real cost ────────────────────────────────────────
-- An ad set's delivery is the sum of its ads' delivery, and `mart_creative_perf`
-- carries `adset_id` on every ad-day. So for a client with no ad-set insights,
-- roll the ads up.
--
-- What that loses is exactly what runbook 28 warned about: **an ad set with
-- delivery but no ad rows disappears.** That happens when an ad is deleted
-- while its ad set keeps spending, and it is invisible here — the ad set simply
-- is not in the result. The real fix is still the third insights call, and this
-- does not replace it; it prefers it. The moment `stg_meta_adset_insights`
-- carries rows for a client, that client stops using the fallback entirely.
--
-- Two columns are NULL in the rolled-up half rather than wrong:
--
--   · `frequency_per_day` — impressions over reach, and reach does not sum.
--     Two ads each reaching 1,000 people did not reach 2,000 people.
--   · `reach` — the same reason.
--
-- Both are already nullable downstream: `AdsetRow.frequencyLatest` is
-- `number | null` and the concept card omits the frequency when it is absent.
-- A summed reach would have been a number, and wrong, on a screen whose whole
-- claim is that it is careful with numbers.
--
-- Run order: AFTER 223.

CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_creative_adset_perf` AS
WITH from_insights AS (
  SELECT
    a.client_id,
    a.date_start                           AS date,
    a.adset_id,
    a.adset_name,
    a.campaign_id,
    a.campaign_name,
    a.spend,
    a.purchase_value                       AS revenue,
    a.purchases,
    a.impressions,
    a.clicks,
    a.reach,
    a.add_to_cart,
    a.initiate_checkout,
    a.landing_page_views,
    a.link_clicks,
    a.outbound_clicks,
    a.frequency                            AS frequency_per_day,
    a.ctr                                  AS ctr_per_day,
    a.cpc                                  AS cpc_per_day,
    SAFE_DIVIDE(a.spend, a.purchases)      AS cost_per_purchase_per_day,
    SAFE_DIVIDE(a.purchase_value, a.spend) AS roas_per_day,
    c.meta_currency                        AS currency,
    'adset_insights'                       AS grain_source
  FROM `oneeighty-warehouse.stg.stg_meta_adset_insights` a
  JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
  WHERE a.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
),

-- Per client, not per row: mixing a real ad-set row and a rolled-up one on the
-- same day would double that day. A client is on one grain or the other.
covered AS (
  SELECT DISTINCT client_id FROM from_insights
),

-- ── Where an ad set's NAME comes from ─────────────────────────────────────
-- Nowhere, today. `mart_creative_perf` carries `adset_id` and no name; the ad
-- insights table has no `adset_name` column at all; and
-- `raw_meta_ad_creatives.adset_name` exists in the schema but the assets job
-- has never written to it — it is NULL on all 195 Manami rows.
--
-- So the name is read from the creatives table where it is present, and falls
-- back to the id. An id is ugly and it is true; inventing "Ad set 1" would be
-- neither. `creative_assets_job.py` now requests the name, so these fill in on
-- the next nightly run and the fallback quietly stops being used.
names AS (
  SELECT client_id, adset_id,
         ANY_VALUE(adset_name)    AS adset_name,
         ANY_VALUE(campaign_name) AS campaign_name
  FROM `oneeighty-warehouse.mart.mart_creative_asset`
  WHERE adset_id IS NOT NULL
  GROUP BY client_id, adset_id
),

from_ads AS (
  SELECT
    p.client_id,
    p.date,
    p.adset_id,
    COALESCE(ANY_VALUE(n.adset_name), p.adset_id) AS adset_name,
    ANY_VALUE(p.campaign_id)               AS campaign_id,
    ANY_VALUE(n.campaign_name)             AS campaign_name,
    SUM(p.spend)                           AS spend,
    SUM(p.revenue)                         AS revenue,
    SUM(p.purchases)                       AS purchases,
    SUM(p.impressions)                     AS impressions,
    SUM(p.clicks)                          AS clicks,
    CAST(NULL AS INT64)                    AS reach,
    SUM(p.add_to_cart)                     AS add_to_cart,
    SUM(p.initiate_checkout)               AS initiate_checkout,
    SUM(p.landing_page_views)              AS landing_page_views,
    SUM(p.link_clicks)                     AS link_clicks,
    SUM(p.outbound_clicks)                 AS outbound_clicks,
    CAST(NULL AS FLOAT64)                  AS frequency_per_day,
    SAFE_DIVIDE(SUM(p.clicks), SUM(p.impressions))  AS ctr_per_day,
    SAFE_DIVIDE(SUM(p.spend), SUM(p.clicks))        AS cpc_per_day,
    SAFE_DIVIDE(SUM(p.spend), SUM(p.purchases))     AS cost_per_purchase_per_day,
    SAFE_DIVIDE(SUM(p.revenue), SUM(p.spend))       AS roas_per_day,
    ANY_VALUE(p.currency)                  AS currency,
    'rolled_up_from_ads'                   AS grain_source
  FROM `oneeighty-warehouse.mart.mart_creative_perf` p
  LEFT JOIN names n ON n.client_id = p.client_id AND n.adset_id = p.adset_id
  WHERE p.adset_id IS NOT NULL
    AND p.client_id NOT IN (SELECT client_id FROM covered)
  GROUP BY p.client_id, p.date, p.adset_id
)

SELECT * FROM from_insights
UNION ALL
SELECT * FROM from_ads;
