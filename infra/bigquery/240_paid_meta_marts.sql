-- 240_paid_meta_marts.sql
-- Paid redesign, package PA1 (WP-A1): Meta marts behind the new Paid > Meta tab.
--
-- ── What this does ────────────────────────────────────────────────────────
--   1. NEW   ref.naming_rules          regex rules that turn a campaign name into a
--                                      funnel stage and a market. Seeded, editable.
--   2. NEW   ref.campaign_overrides    manual stage / market per campaign. Beats rules.
--   3. NEW   mart.mart_meta_campaign_dim   one row per (client_id, campaign_id) with the
--                                      latest name, first/last date, stage, market.
--   4. CHANGED mart.mart_meta_campaign_perf  ADDITIVE columns only: view_content,
--                                      add_payment_info, funnel_stage, market,
--                                      spend_client_ccy, revenue_client_ccy, client_currency.
--   5. CHANGED mart.mart_meta_ad_perf  ADDITIVE columns only: outbound_clicks,
--                                      unique_outbound_clicks, video_p25/50/75/95/100_watched,
--                                      video_30s_watched, view_content, add_payment_info.
--
-- ── Based on (live definitions read 2026-10-04) ───────────────────────────
--   mart.mart_meta_campaign_perf, mart.mart_meta_ad_perf (both read stg.stg_meta_*_insights
--   joined to ref.clients, 60 month window). The repo copy in 300_create_mart_views.sql and
--   213_client_ad_currency.sql is NOT the base: this file starts from the live text.
--   No other view depends on these two (checked via INFORMATION_SCHEMA.VIEWS).
--
-- ── Owner decisions baked in ──────────────────────────────────────────────
--   * PACKS, CBO, ASC are NOT funnel-stage tokens. A campaign that only says
--     "PACKS CBO | CZ | 16JUN" stays `unclassified` until the Advantage+ segment
--     breakdown lands (Phase B). Only explicit words classify: retargeting words,
--     retention words, prospecting words (seed below).
--   * Meta money stays in AD-ACCOUNT currency in every existing column. The client
--     currency view of the same money is the additive *_client_ccy pair, converted
--     with ref.fx_rates for the month of the row, same pattern as mart_daily_kpis.
--     A missing rate gives NULL, never a wrong number (today: Venev from 2026-10,
--     because ref.fx_rates ends at 2026-09-01).
--
-- ── Raw field facts (checked 2026-10-04) ──────────────────────────────────
--   * `actions` is a JSON STRING at campaign and ad level (not an ARRAY). view_content
--     is `omni_view_content`, add_payment_info is `add_payment_info`. Both present for
--     every client with a pixel in the last 90 days.
--   * raw_meta_ad_insights HAS the columns outbound_clicks, unique_outbound_clicks,
--     video_p25/50/75/95/100_watched, video_30s_watched, but the ingest never fills them:
--     100 percent NULL for every client since 2025-01 (and the payload_json carries none
--     of them either). They are exposed here anyway so the view does not need a second
--     deploy once the n8n ad-insights call requests them. Until then they are NULL and the
--     dashboard must treat NULL as "not ingested" (hide the column), never as zero.
--
-- ── Regression ────────────────────────────────────────────────────────────
--   See infra/bigquery/qa/240_regression.sql and the PA1 report. Existing columns:
--   zero diff for all clients and days (EXCEPT DISTINCT both directions on
--   TO_JSON_STRING over the pre-existing column set).
--
-- ── Affected clients ──────────────────────────────────────────────────────
--   All Meta clients (dobias, ethia, manami, venev) get the new columns. No existing
--   column changes value for anyone.
--
-- ── Deploy order ──────────────────────────────────────────────────────────
--   Run the statements in this file top to bottom, once. Everything is idempotent:
--   CREATE ... IF NOT EXISTS, seed rows inserted only when the rule is absent (so later
--   manual edits of ref.naming_rules survive a re-run), CREATE OR REPLACE VIEW.
--   Needs ref.clients and ref.fx_rates (exist), stg.stg_meta_campaign_insights and
--   stg.stg_meta_ad_insights (exist).
--
-- ── Maintenance notes ─────────────────────────────────────────────────────
--   * Rule patterns are RE2 and are matched against LOWER(campaign_name), so write them
--     in lower case. A syntactically invalid pattern makes mart_meta_campaign_dim (and so
--     mart_meta_campaign_perf) fail for everyone: test a new rule in a scratch query first.
--   * Resolution: campaign_overrides > client rule > '*' rule > 'unclassified'.
--     Within the same tier the lower priority number wins, then the pattern text (stable).
--   * market is NULL when no rule matches (the dashboard shows "Unknown").
--     A name listing two markets ("US & CA") yields the first token (US).


-- ──────────────────────────────────────────────────────────────────────────
-- 1. ref.naming_rules
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.naming_rules` (
  client_id   STRING    NOT NULL,   -- '*' = global default
  platform    STRING    NOT NULL,   -- 'meta' | 'google'
  entity      STRING    NOT NULL,   -- 'campaign' | 'adset'
  dimension   STRING    NOT NULL,   -- 'funnel_stage' | 'market'
  pattern     STRING    NOT NULL,   -- RE2, matched on the lowercased name
  value       STRING,               -- NULL = use capture group 1, upper-cased (markets)
  priority    INT64     NOT NULL,   -- lower wins; client rules always beat '*'
  note        STRING,
  updated_at  TIMESTAMP NOT NULL
)
CLUSTER BY client_id;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. ref.campaign_overrides
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.campaign_overrides` (
  client_id     STRING    NOT NULL,
  platform      STRING    NOT NULL,   -- 'meta' | 'google'
  campaign_id   STRING    NOT NULL,
  funnel_stage  STRING,               -- NULL = leave to the rules
  brand_class   STRING,               -- google only ('brand' | 'nonbrand'), unused for meta
  market        STRING,               -- NULL = leave to the rules
  note          STRING,
  updated_at    TIMESTAMP NOT NULL
)
CLUSTER BY client_id;


-- ──────────────────────────────────────────────────────────────────────────
-- 3. Seed ref.naming_rules (global, meta, campaign). Inserted only if absent.
--    No PACKS / CBO / ASC rule on purpose (owner decision, see header).
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO `oneeighty-warehouse.ref.naming_rules`
  (client_id, platform, entity, dimension, pattern, value, priority, note, updated_at)
SELECT s.client_id, s.platform, s.entity, s.dimension, s.pattern, s.value, s.priority, s.note, CURRENT_TIMESTAMP()
FROM UNNEST([
  STRUCT('*' AS client_id, 'meta' AS platform, 'campaign' AS entity, 'funnel_stage' AS dimension,
         r'\b(rt|rmk|retarget\w*|remarketing|warm|bof|mof)\b' AS pattern, 'retargeting' AS value, 10 AS priority,
         'explicit retargeting words' AS note),
  STRUCT('*', 'meta', 'campaign', 'funnel_stage',
         r'\b(retention|existing|loyal\w*|repeat)\b', 'retention', 20,
         'explicit retention words'),
  STRUCT('*', 'meta', 'campaign', 'funnel_stage',
         r'\b(prospect\w*|broad|tof|acq\w*|cold|lal|lookalike)\b', 'prospecting', 30,
         'explicit prospecting words; PACKS / CBO / ASC deliberately not included'),
  STRUCT('*', 'meta', 'campaign', 'market',
         r'(?:^|[\s|_-])(us|ca|cz|sk|de|at|pl|hu|eu)(?:$|[\s|_-])', CAST(NULL AS STRING), 10,
         'market token delimited by space, pipe, underscore or hyphen; first match wins')
]) s
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.naming_rules` r
  WHERE r.client_id = s.client_id AND r.platform = s.platform AND r.entity = s.entity
    AND r.dimension = s.dimension AND r.pattern = s.pattern
);


-- ──────────────────────────────────────────────────────────────────────────
-- 4. mart.mart_meta_campaign_dim  (one row per client_id, campaign_id)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_dim` AS
WITH base AS (
  SELECT
    client_id, campaign_id,
    ARRAY_AGG(campaign_name IGNORE NULLS ORDER BY date_start DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name,
    MIN(date_start) AS first_date,
    MAX(date_start) AS last_date
  FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)
  GROUP BY client_id, campaign_id
),
rule_hits AS (
  SELECT
    b.client_id, b.campaign_id, r.dimension,
    COALESCE(r.value, UPPER(REGEXP_EXTRACT(LOWER(b.campaign_name), r.pattern))) AS value
  FROM base b
  JOIN `oneeighty-warehouse.ref.naming_rules` r
    ON  r.platform = 'meta'
    AND r.entity   = 'campaign'
    AND r.client_id IN (b.client_id, '*')
    AND REGEXP_CONTAINS(LOWER(b.campaign_name), r.pattern)
  WHERE TRUE  -- QUALIFY needs a WHERE, GROUP BY or HAVING
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY b.client_id, b.campaign_id, r.dimension
    ORDER BY IF(r.client_id = '*', 1, 0), r.priority, r.pattern
  ) = 1
),
ovr AS (
  SELECT client_id, campaign_id, funnel_stage, market
  FROM `oneeighty-warehouse.ref.campaign_overrides`
  WHERE platform = 'meta'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id ORDER BY updated_at DESC) = 1
)
SELECT
  b.client_id,
  b.campaign_id,
  b.campaign_name,
  b.first_date,
  b.last_date,
  COALESCE(o.funnel_stage, fs.value, 'unclassified') AS funnel_stage,
  COALESCE(o.market, mk.value)                       AS market,
  CASE WHEN o.funnel_stage IS NOT NULL THEN 'override'
       WHEN fs.value       IS NOT NULL THEN 'rule'
       ELSE 'none' END                               AS classified_by,
  CASE WHEN o.market IS NOT NULL THEN 'override'
       WHEN mk.value IS NOT NULL THEN 'rule'
       ELSE 'none' END                               AS market_classified_by
FROM base b
LEFT JOIN ovr o
  ON o.client_id = b.client_id AND o.campaign_id = b.campaign_id
LEFT JOIN rule_hits fs
  ON fs.client_id = b.client_id AND fs.campaign_id = b.campaign_id AND fs.dimension = 'funnel_stage'
LEFT JOIN rule_hits mk
  ON mk.client_id = b.client_id AND mk.campaign_id = b.campaign_id AND mk.dimension = 'market';


-- ──────────────────────────────────────────────────────────────────────────
-- 5. mart.mart_meta_campaign_perf  (additive columns appended at the end)
--    The pre-existing columns are the live definition, untouched.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_campaign_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.campaign_id, i.campaign_name, i.ad_account_id,
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  i.frequency     AS frequency_per_day,
  i.ctr           AS ctr_per_day,
  i.cpc           AS cpc_per_day,
  i.purchase_roas AS roas_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)          AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.purchases) AS aov_meta_per_day,
  c.meta_currency AS currency,
  -- additive (PA1) ------------------------------------------------------
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'omni_view_content')  AS view_content,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'add_payment_info')   AS add_payment_info,
  COALESCE(d.funnel_stage, 'unclassified') AS funnel_stage,
  d.market                                 AS market,
  i.spend          * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate) AS spend_client_ccy,
  i.purchase_value * IF(c.meta_currency = c.currency, NUMERIC '1', fx.rate) AS revenue_client_ccy,
  c.currency AS client_currency
FROM `oneeighty-warehouse.stg.stg_meta_campaign_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
LEFT JOIN `oneeighty-warehouse.mart.mart_meta_campaign_dim` d
  ON d.client_id = i.client_id AND d.campaign_id = i.campaign_id
LEFT JOIN `oneeighty-warehouse.ref.fx_rates` fx
  ON  fx.month_start   = DATE_TRUNC(i.date_start, MONTH)
  AND fx.from_currency = c.meta_currency
  AND fx.to_currency   = c.currency
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);


-- ──────────────────────────────────────────────────────────────────────────
-- 6. mart.mart_meta_ad_perf  (additive columns appended at the end)
--    The pre-existing columns are the live definition, untouched. adset_id was already there.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.mart_meta_ad_perf` AS
SELECT
  i.client_id,
  i.date_start AS date,
  i.ad_id, i.ad_name, i.campaign_id, i.adset_id, i.ad_account_id,
  i.spend, i.purchase_value AS revenue, i.purchases, i.impressions, i.clicks, i.reach,
  i.add_to_cart, i.initiate_checkout, i.landing_page_views, i.link_clicks, i.video_views,
  i.video_play_actions, i.video_thruplays,
  i.frequency                            AS frequency_per_day,
  i.ctr                                  AS ctr_per_day,
  i.cpc                                  AS cpc_per_day,
  SAFE_DIVIDE(i.spend, i.purchases)      AS cost_per_purchase_per_day,
  SAFE_DIVIDE(i.purchase_value, i.spend) AS roas_per_day,
  c.meta_currency AS currency,
  -- additive (PA1). The first eight are NULL until the ad-insights ingest requests them.
  i.outbound_clicks,
  i.unique_outbound_clicks,
  i.video_p25_watched,
  i.video_p50_watched,
  i.video_p75_watched,
  i.video_p95_watched,
  i.video_p100_watched,
  i.video_30s_watched,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'omni_view_content')  AS view_content,
  (SELECT CAST(SUM(SAFE_CAST(JSON_VALUE(a, '$.value') AS NUMERIC)) AS INT64)
     FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(i.actions))) a
    WHERE JSON_VALUE(a, '$.action_type') = 'add_payment_info')   AS add_payment_info
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights` i
JOIN `oneeighty-warehouse.ref.clients` c USING (client_id)
WHERE i.date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH);
