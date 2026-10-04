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

Historical note (repo state before 2026-10-01): "Still open: Phase 4 (repoint MER / aMER / CAC to `paid_spend` in METRICS.md + Looker calc fields). Not yet done, those three metrics still divide by `meta_spend` until repointed." Superseded as follows.

**Phase 4 status:** closed on 2026-10-01 for METRICS.md, runbooks 10 and 11 and the reporting process
(see the 2026-10-01 section below). The Looker calc fields still have to be changed by hand.

---

## 2026-10-01: Data-driven mapping, new clients need no view edits

The per-account `UNION ALL` / `client_map` in the stg view is gone. `stg.stg_google_ads_campaign_insights`
now reads the DTS **base tables** with a wildcard (`raw_google_ads.p_ads_CampaignBasicStats_*`,
`p_ads_Campaign_*`; the `ads_*` objects are views and cannot be prefix-queried, the `p_ads_*` base
tables can) and maps account to client through the new column `ref.clients.gads_customer_id`.
`mart_daily_kpis` was not touched (it already joins `ref.clients` on `has_gads` / `gads_currency`).
Full SQL: `infra/bigquery/202_stg_google_ads.sql`.

**Onboarding a Google Ads client now = one UPDATE** (account must sit under the MCC the transfer runs on):

```sql
UPDATE `oneeighty-warehouse.ref.clients`
SET gads_customer_id = 1234567890, has_gads = TRUE, gads_currency = 'CZK', updated_at = CURRENT_TIMESTAMP()
WHERE client_id = '<client>';
SELECT * FROM `oneeighty-warehouse.ops.v_gads_coverage`;   -- status must be 'ok'
```

**Limit: one Google Ads account per client** (`gads_customer_id` is a single column). A second account of the
same client lands in `raw_google_ads` but shows up as `UNMAPPED` in `ops.v_gads_coverage` and its spend is
not counted anywhere. When that happens, replace the column with a table `ref.gads_accounts(customer_id,
client_id)` and join it in the stg view's `client_map` (and in `v_gads_coverage`).

**`ops.v_gads_coverage`** lists every account in the transfer plus every client flagged `has_gads`.
Statuses: `UNMAPPED` (account in the transfer, no client), `NO_FLAG`, `CURRENCY_MISMATCH`,
`CLIENT_WITHOUT_ACCOUNT`, `STALE` (no transfer for more than 3 days), `ok`. Freshness is measured on the
transfer snapshot, not on stats rows, so a paused account does not read as stale. Not yet wired into
`ops.v_feed_health` / `v_pipeline_alerts`: check it by hand after adding an account.

**Regression (SOP step 7, baseline in `mart_qa.base_*_2026_10_01`):** stg Manami identical row for row
(0 rows either way). `mart_daily_kpis` for all non-RawBark clients, all days, all columns: 1 row differs,
`manami` 2026-04-17, `google_spend` 480.51252 vs 480.51252000000005. That is FLOAT64 summation order in
`google_daily` (`SUM(spend * fx)`), not data; the stg rows are identical. A `CAST ... AS NUMERIC` in the
mart would remove the noise, left alone on purpose (not in scope, would touch every client).
RawBark: mart Sep 2026 google_spend 83,214 CZK = raw. `mart_cm3_monthly` is empty (0 rows) before and
after, so it gave no regression signal.

### 2026-10-01: Phase 4 done (docs, reporting process, monthly mart)

- `mart_monthly_kpis` gained `google_spend, google_revenue, google_purchases, google_impressions,
  google_clicks, paid_spend` (before this it carried Meta only, so no monthly view could compute a
  blended MER). Regression: all 211 rows and every existing column identical before and after
  (baseline `mart_qa.base_mart_monthly_kpis_2026_10_01`).
- MER, aMER, CAC now read `paid_spend` in METRICS.md, runbooks 10 and 11 and
  `agency/_processes/reporting/` (data-pull, analysis). Meta ROAS, CPA, CPC, CTR stay on `meta_spend`.
- Not done by this change, needs a human in Looker Studio: change the `MER`, `aMER`, `CAC` calc fields
  on the Profitability page to the formulas below, then **Refresh fields** so `paid_spend` is bindable.
  The Next.js dashboard source is not in this repo, so its tiles were not checked either.

```
MER   = SUM(revenue) / SUM(paid_spend)
aMER  = SUM(new_customer_revenue) / SUM(paid_spend)
CAC   = SUM(paid_spend) / SUM(new_customer_orders)
```

Effect (monthly, CZK): Manami MER Jun 2026 3.33 -> 2.56, Sep 2026 3.36 -> 2.93; aMER Jun 1.94, Sep 1.96;
Dobias unchanged (no Google). RawBark has no Meta in the warehouse yet, so its MER (Sep 22.28) and
aMER (1.36) are Google only and overstated until Meta lands.

---

## 2026-10-04: Paid marts and brand terms (package PA2, for the Paid > Google tab)

Seven views model the DTS tables that were loading but unused, and a per-client brand-terms list
classifies Google spend as brand or non-brand. Files: `infra/bigquery/241_ref_client_brand_terms.sql`,
`infra/bigquery/242_gads_marts.sql`, regression in `infra/bigquery/qa/242_regression.sql`.
`mart_daily_kpis` and `stg.stg_google_ads_campaign_insights` are not changed.

**Deploy order:** PA1 migration (creates `ref.naming_rules`, `ref.campaign_overrides`), then 241, then 242,
then run `qa/242_regression.sql` as is. Every block of the regression must read OK / 0 (R4, R5 and R9 are
review tables, not pass/fail). 242 also seeds one Google market rule into `ref.naming_rules` (idempotent).

| View (dataset `mart`) | Grain | Use |
|---|---|---|
| `mart_gads_campaign_dim` | client, campaign | name, type, status, bid strategy, budget/day, `brand_class`, `market` |
| `mart_gads_campaign_daily` | client, date, campaign, network | spend, value, purchases, impression-share components, `*_client_ccy` |
| `mart_gads_campaign_device_daily` | client, date, campaign, device | device split (the network view cannot carry device) |
| `mart_gads_adgroup_daily` | client, date, campaign, ad group | ad group table (no PMax: PMax has asset groups) |
| `mart_gads_search_terms_daily` | client, date, campaign, ad group, term, match type, status, keyword | search terms, `is_brand`, brand leakage |
| `mart_gads_keywords_daily` | client, date, campaign, ad group, keyword | keyword table, quality score, `is_brand` |
| `mart_gads_products_daily` | client, date, campaign, item and product attributes | product table (Shopping, Demand Gen, part of PMax) |

**Rules to keep (each one was a real trap in the DTS data):**

- Spend comes from `CampaignBasicStats` only. `CampaignStats` is 12 percent low for RawBark.
- `date = DATE(_PARTITIONTIME)` equals `segments_date` (0 mismatches in the regression), so a dashboard
  `date BETWEEN` prunes partitions. Views end at yesterday and start 25 months back.
- Conversions: `conversions` / `conversions_value` are the account's primary-conversion totals (these equal
  `mart_daily_kpis.google_purchases` / `google_revenue`). `purchases` / `purchase_value` are the PURCHASE
  conversion category. Both accounts only have PURCHASE today, so they are equal; the Google tab uses the
  purchase columns by default (owner decision) so it stays correct when other conversion types appear.
- Impression share is stored as components. Never average the shares:
  `Search IS = SUM(is_impressions) / SUM(eligible_impressions)`; lost to budget and lost to rank use
  `lost_budget_impressions` and `lost_rank_impressions` over the same denominator; absolute top IS uses
  `abs_top_impressions`; **top IS = SUM(top_impressions) / SUM(top_eligible_impressions)** (Shopping reports top
  IS as 0, so those rows are excluded from both sums); click share =
  `SUM(click_share_clicks) / SUM(eligible_clicks)`. DTS writes 0.0 for "not reported", so a share of 0 is
  treated as missing. "<10%" arrives as 0.0999: about 60 percent of RawBark rows have a component at that floor,
  so lost-share figures are upper bounds (the regression R3 counts `rows_at_floor`).
- `KeywordStats` repeats impressions per click type. The keyword view takes impressions from `URL_CLICKS` rows
  only; spend, clicks and conversions are summed over all click types (R8 proves both reconcile exactly).
- Search terms cover only part of Search spend (privacy threshold): RawBark 62.7 percent (30 days to 2026-10-03).
  Products cover RawBark Shopping 100 percent, RawBark PMax 0 percent, Manami PMax 25.8 percent. The tab shows
  these as "Covers N% of spend"; they are not errors.
- Money is in the Google Ads account currency; `*_client_ccy` columns apply the month's `ref.fx_rates` rate per
  row, NULL when the rate is missing. `ref.fx_rates` currently ends 2026-09-01; both live accounts are CZK with a
  CZK client currency, so the factor is 1 and nothing is NULL.

**Brand class of a campaign** (`mart_gads_campaign_dim.brand_class`): 1) `ref.campaign_overrides` row with
`platform = 'google'`; 2) channel SHOPPING or PERFORMANCE_MAX gives `shopping_pmax`; 3) channel SEARCH and the name
has the token `brand` or `brd` (split on any non letter or digit, so `PER_BRD_KW_CZ~Brand CPC` counts) or matches a
brand term of scope `campaign` or `all` gives `brand`; 4) other SEARCH gives `non_brand`; 5) everything else
(Display, Video, Demand Gen) gives `other`. Search terms and keywords get `is_brand` from the same list with scope
`search_term` or `all`. Brand leakage = brand search-term spend in `non_brand` campaigns divided by search-term
spend in `non_brand` campaigns.

### Add brand terms (INSERT helper)

`ref.client_brand_terms` has one row per term variant; misspellings and product-line brand names are separate
rows. The helper writes `term_norm` (lower case, diacritics stripped, whitespace collapsed) for you and skips
rows that already exist. Edit the client and the list, run it, then re-run regression R5 and R9.

```sql
INSERT INTO `oneeighty-warehouse.ref.client_brand_terms`
  (client_id, term, term_norm, match_type, is_exclusion, applies_to, note, added_by, updated_at)
SELECT 'rawbark', t,
       TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(t, NFD)), r'\p{M}', ''), r'\s+', ' ')),
       'contains',   -- 'contains' | 'word' | 'exact' | 'regex'
       FALSE,        -- TRUE = a match makes the text NOT brand (generic word that contains the brand)
       'all',        -- 'all' | 'search_term' | 'campaign'
       NULL, 'matej', CURRENT_TIMESTAMP()
FROM UNNEST(['raw bark', 'rawbark', 'rawbrk']) t           -- the variants as typed
WHERE NOT EXISTS (
  SELECT 1 FROM `oneeighty-warehouse.ref.client_brand_terms` x
  WHERE x.client_id = 'rawbark'
    AND x.term_norm = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(t, NFD)), r'\p{M}', ''), r'\s+', ' '))
    AND x.match_type = 'contains' AND x.is_exclusion = FALSE AND x.applies_to = 'all'
);
```

- `contains` matches anywhere in the text; `word` matches a whole word (the term is regex-escaped); `exact`
  needs the whole text to equal the term; `regex` uses `term_norm` as an RE2 pattern as typed, so for regex rows
  write `term_norm` yourself instead of using the helper (an invalid pattern is ignored, it does not break the views).
- An exclusion row (`is_exclusion = TRUE`) beats any brand match on the same text, for example to stop a generic
  word that happens to contain the brand from counting.
- Remove a term: `DELETE FROM ref.client_brand_terms WHERE client_id = '...' AND term_norm = '...'`.
- Fix one campaign by hand instead of by name: add a row to `ref.campaign_overrides` with `platform = 'google'`,
  the `campaign_id` and a `brand_class` (`brand`, `non_brand`, `shopping_pmax`, `other`) and/or a `market`.

Review the result with regression R9 (every campaign with spend in the last 90 days, its class and market).
Live on 2026-10-04 with only the seed terms: RawBark `CZ - S: Brand`, `SK - S: Brand` are `brand`, the
`S: Granule` campaigns are `non_brand`, PMax and PLA are `shopping_pmax`; Manami has no Search spend and no
brand campaign, so all of it is `shopping_pmax`. Demand Gen RMK campaigns carry no country token, so their market is NULL.
