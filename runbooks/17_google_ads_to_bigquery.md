# 17 — Google Ads → BigQuery (and folding spend into MER/aMER)

**Goal:** land daily Google Ads cost in the warehouse and make MER / aMER / CAC / CM3
divide by *total* paid spend (Meta + Google), not Meta alone. Today `paid_spend =
meta_spend`, so aMER is overstated wherever Google runs (~20k CZK/mo on Manami).

**Chosen method:** BigQuery Data Transfer Service (DTS) — Google's native Google Ads
connector. No developer token, free, daily auto-run + backfill, Google maintains the
schema. Point it at the **MCC** so all clients land from one config.

---

## Phase 1 — Set up the Data Transfer (console, ~10 min)

Prereq: the Google account running this has access to the Google Ads MCC and the
`oneeighty-warehouse` project (BigQuery Admin + access to create transfers).

1. Create a landing dataset (EU, to match the rest of the warehouse):
   ```sql
   CREATE SCHEMA IF NOT EXISTS `oneeighty-warehouse.raw_google_ads`
   OPTIONS (location = 'EU');
   ```
2. BigQuery Console → **Data transfers** → **+ Create transfer**.
3. Source: **Google Ads** (formerly "Google Ads Transfer").
4. Schedule: daily. Note Google Ads is always **D-1** (yesterday is the freshest full
   day) — this is unfixable and already assumed in our formulas.
5. Destination dataset: `raw_google_ads`.
6. **Customer ID:** enter the **MCC (manager) ID** (digits only, no dashes). This pulls
   all sub-accounts. Refresh window: 7 days (covers Google's conversion restatements).
7. Authorize with the Google Ads-enabled account. Save.
8. Trigger a manual backfill: transfer → **Schedule backfill** → last 24 months (matches
   our window). First run takes a while; subsequent daily runs are incremental.

What lands: ~100 `ads_*` tables. We only use **`ads_CampaignBasicStats_<MCC_ID>`**
(daily cost/impressions/clicks per campaign) and **`ads_Campaign_<MCC_ID>`** (names +
which account each campaign belongs to). Cost is in **micros** (1,000,000 micros = 1
currency unit) and must be divided by 1e6.

---

## Phase 2 — stg view (flatten to one daily row per campaign)

Map each Google Ads account to our `client_id`. Fill in the real numeric IDs.

```sql
CREATE OR REPLACE VIEW `oneeighty-warehouse.stg.stg_google_ads_campaign_insights` AS
WITH client_map AS (
  -- Google Ads customer_id (no dashes) -> our client_id. Add a row per client.
  SELECT 1234567890 AS customer_id, 'manami' AS client_id UNION ALL
  SELECT 9876543210 AS customer_id, 'dobias' AS client_id
),
stats AS (
  SELECT
    s._DATA_DATE                         AS date,
    s.customer_id,
    s.campaign_id,
    SUM(s.metrics_cost_micros) / 1e6     AS spend,
    SUM(s.metrics_impressions)           AS impressions,
    SUM(s.metrics_clicks)                AS clicks,
    SUM(s.metrics_conversions)           AS conversions,
    SUM(s.metrics_conversions_value)     AS conversions_value
  FROM `oneeighty-warehouse.raw_google_ads.ads_CampaignBasicStats_*` s   -- DTS suffix = MCC id
  WHERE s._DATA_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
    AND s._LATEST_DATE = s._DATA_DATE    -- DTS keeps daily snapshots; take the current one
  GROUP BY date, customer_id, campaign_id
)
SELECT
  m.client_id,
  st.date              AS date_start,
  st.date              AS date_stop,
  CAST(st.customer_id AS STRING) AS ad_account_id,
  CAST(st.campaign_id AS STRING) AS campaign_id,
  c.campaign_name,
  st.spend,
  st.impressions,
  st.clicks,
  st.conversions       AS purchases,
  st.conversions_value AS purchase_value
FROM stats st
JOIN client_map m USING (customer_id)
LEFT JOIN `oneeighty-warehouse.raw_google_ads.ads_Campaign_*` c
  ON c.campaign_id = st.campaign_id AND c.customer_id = st.customer_id
  AND c._LATEST_DATE = (SELECT MAX(_LATEST_DATE) FROM `oneeighty-warehouse.raw_google_ads.ads_Campaign_*`);
```

> Note: exact DTS column names (`metrics_cost_micros`, `_DATA_DATE`, `_LATEST_DATE`,
> table suffix) are stable but verify against the landed tables on first run with
> `SELECT * FROM raw_google_ads.ads_CampaignBasicStats_<id> LIMIT 5`.

---

## Phase 3 — fold into mart_daily_kpis (`paid_spend = meta + google`)

Patch `300_create_mart_views.sql` `mart_daily_kpis`:

1. Add a `google_daily` CTE next to `meta_daily`:
   ```sql
   google_daily AS (
     SELECT
       client_id,
       date_start AS date,
       CASE WHEN client_id='manami' THEN 'CZK'
            WHEN client_id='dobias' THEN 'USD' ELSE 'UNKNOWN' END AS currency,
       SUM(spend)          AS google_spend,
       SUM(purchase_value) AS google_revenue,
       SUM(purchases)      AS google_purchases,
       SUM(impressions)    AS google_impressions,
       SUM(clicks)         AS google_clicks
     FROM `oneeighty-warehouse.stg.stg_google_ads_campaign_insights`
     WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 36 MONTH)
     GROUP BY client_id, date, currency
   )
   ```
2. Add Google to the final FULL OUTER JOIN (join on client_id, date, currency) and
   COALESCE the keys across all three sources.
3. Expose new columns + a real paid_spend:
   ```sql
   g.google_spend, g.google_revenue, g.google_purchases,
   COALESCE(m.meta_spend, 0) + COALESCE(g.google_spend, 0)   AS paid_spend,
   ```
4. Change CM3 to subtract all paid media, not just Meta:
   ```sql
   s.revenue - s.cogs - 0 - 0 - (COALESCE(m.meta_spend,0) + COALESCE(g.google_spend,0)) AS cm3
   ```

(Full rewritten view will be delivered as `203_add_google_spend_to_mart.sql` once the
DTS column names are confirmed on the first landed batch.)

---

## Phase 4 — repoint the metrics (METRICS.md + Looker)

These were Meta-only; switch the denominator to `paid_spend`:

| Metric | Old | New |
|---|---|---|
| `MER`  | `SUM(revenue) / SUM(meta_spend)`              | `SUM(revenue) / SUM(paid_spend)` |
| `aMER` | `SUM(new_customer_revenue) / SUM(meta_spend)` | `SUM(new_customer_revenue) / SUM(paid_spend)` |
| `CAC`  | `SUM(meta_spend) / SUM(new_customer_orders)`  | `SUM(paid_spend) / SUM(new_customer_orders)` |

Keep Meta-only ROAS/CPC/CPA as-is (they're channel diagnostics). Update METRICS.md
lines ~149–152 and the Looker calc fields on the Profitability page. Expect aMER to
**drop** once Google spend lands — that's the correction, not a regression.

---

## Verify

```sql
SELECT date_trunc(date, MONTH) AS month,
  SUM(meta_spend)   AS meta,
  SUM(google_spend) AS google,
  SUM(paid_spend)   AS paid,
  ROUND(SAFE_DIVIDE(SUM(new_customer_revenue), SUM(paid_spend)),2) AS amer_corrected
FROM `oneeighty-warehouse.mart.mart_daily_kpis`
WHERE client_id='manami' AND date >= '2026-01-01'
GROUP BY month ORDER BY month;
```
google should be non-zero from the first backfilled month; amer_corrected should fall
to a realistic level.

---

## 2026-07-03 — DEPLOYED (phases 2–3 live) + two corrections to the Phase 2 snippet

Phases 2 and 3 are live in BigQuery (`stg.stg_google_ads_campaign_insights` and
`mart.mart_daily_kpis`). Before deploying, the Phase 2 stg snippet above was found to have
two bugs against the actually-landed DTS tables — the snippet above is left as-is for history;
the deployed, corrected version lives in `infra/bigquery/202_stg_google_ads.sql`:

1. **Wildcard over views.** `ads_CampaignBasicStats_*` / `ads_Campaign_*` cannot be queried —
   in this project the `ads_*` objects are VIEWS over the DTS `p_ads_*` base tables, and
   BigQuery rejects prefix queries over views (`Views cannot be queried through prefix`).
   Use the concrete per-account view `ads_CampaignBasicStats_5865960448`; add a `UNION ALL`
   block per new account (mirroring `client_map`).
2. **`_LATEST_DATE = _DATA_DATE` filter zeroes history.** In these views
   `_DATA_DATE = DATE(_PARTITIONTIME)` = the metric date and `_LATEST_DATE` is a constant
   literal (last run date), so the predicate keeps only the single latest day. There is one
   partition per metric date (no cross-run duplication), so no dedup is needed — just filter
   on `segments_date`.

**Verified after deploy:** Manami Google spend June 2026 = 19,901 CZK, May = 18,069 CZK
(match the Google Ads account). CM3 now nets Meta + Google via `paid_spend`; Dobias unchanged
(no Google account → `google_spend` NULL → `paid_spend = meta_spend`). Data present from 2025-10-01.

**Still open:** Phase 4 (repoint MER / aMER / CAC to `paid_spend` in METRICS.md + Looker calc
fields). Not yet done — those three metrics still divide by `meta_spend` until repointed.
