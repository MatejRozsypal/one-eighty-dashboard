## Creative Hit rate: design and threshold proposal

All numbers below come from data through 2026-10-04. They were measured read-only on the warehouse, with scratch tables in `mart_qa` only: `hr_ad_life`, `hr_ad_life2`, `hr_ad_daily` and `hr_eval`, which expire on 2026-10-19. The repo was not edited. Nothing was written to Postgres.

### 0. Facts that shape the design

- **Data history is short for two clients.** Meta ad history starts on these dates:

  | Client | First day of Meta ad data |
  |---|---|
  | Dobias | 2026-04-20 |
  | Ethia | 2025-02-20 |
  | Manami | 2025-05-07 |
  | Venev | 2026-08-18 |

  Ads already running on a client's first day look "launched" that day. These are excluded as pre-existing (first delivery within 2 days of the client's history start): Dobias 6, Ethia 1, Manami 3, Venev 7.
- **The same creative often runs as several ads.** The asset is identified by video_id, then image_hash, then story id, then creative_id, from `mart_creative_asset`. Ads that reuse an asset that already ran:
  - Dobias: 23 of 64 ads (13 relaunched later, 10 duplicated across ad sets on the same day)
  - Manami: 43 of 200
  - Ethia: unknown, because `mart_creative_asset` has **0 rows for Ethia**. That is a separate ingest gap and it also affects Ethia thumbnails.
- **Concept tags barely cover launches.** Only 16% of Manami's 12-month launches carry a concept_id (19 of 122). Dobias and Ethia have 0%. Format can be derived for every ad from `video_play_actions > 0` over the ad's lifetime, the same rule Reports uses.
- **The marts are views and cannot prune by date.**
  - A launch-cohort query on `mart_meta_ad_perf` processes about 98 MB per client (dry run).
  - Building lifetime totals for all clients from `mart_creative_perf` processes about 199 MB.
- **`readPurchases` already has two jobs in `classify()`.** It is the winner purchase gate and the shrinkage weight k. Keeping it as the single N means the grid's winner badge and the hit rate can never disagree.

### 1. Threshold proposal (the owner confirms before anything is written)

#### 1.1 Inputs per client

Notes on the inputs:
- 12 months = 2025-10-05 to 2026-10-04.
- Ad ROAS and purchases are lifetime figures for ads launched in that window, excluding pre-existing ads.
- **Meta value basis**:
  - Ethia's Meta order value (1,290 Kč) equals the shop's gross AOV including VAT (1,288), not its net AOV (1,061). So its breakeven is multiplied by the VAT factor 1.21.
  - Dobias's Meta AOV of 146 is close to the shop's revenue AOV of 149, so its factor is 1.0.
  - Manami is not a VAT payer, so its factor is 1.0.

| Input | Dobias (USD) | Ethia (CZK) | Manami (CZK) | Venev (Meta in CZK) |
|---|---|---|---|---|
| CM1 % (mart, 12m) | 80.0% | 73.1% (COGS on 338 of 362 days) | 70.4% (stated 68.4%) | 80.1%, unreliable (COGS on 44 of 129 days) |
| Breakeven ROAS, Meta basis | 1.25; **1.51** with the 20.50 USD/order fulfilment that QF1 inferred but did not read | 1.21 / 0.731 = **1.66** | **1.42** (learnings state 1.46) | **1.89**, from the stated break-even CPA of 783 Kč and a Meta AOV of 1,478 Kč |
| Account ROAS 12m / 90d | 2.84 / 2.63 | 2.28 / 2.34 | 2.03 / 1.78 | 0.11 / 0.11 |
| Ad ROAS median / p75, ads with 5+ purchases | 3.18 / 4.33 | 2.41 / 3.99 | 1.95 / 2.91 | n/a (1 ad has a purchase) |
| Ad ROAS median / p75, all ads | 2.60 / 4.47 | 0.98 / 2.72 | 0.93 / 2.28 | 0 / 0 |
| Lifetime purchases per ad, p50 / p80 / p90 | 4 / 32 / 52 | 1 / 4 / 10 | 2 / 8 / 17 | 0 / 0 / 1 |
| Ads with no purchase | 9 of 58 | 70 of 156 | 56 of 159 | 8 of 9 |
| Account CPA 12m / 90d | 51.4 / 54.0 | 565 / 552 | 426 / 496 (stated 527) | 13,704 |
| Already stated in the repo | none | none | kill 1.80, target 2.50 (flagged as too high in the handoff), CPA 527 | M12 ROAS target 2.08, break-even CPA ~783 |

#### 1.2 Rules used

These make the proposal reproducible.
- **Target ROAS** = max(1.5 x breakeven, 12-month account ROAS), rounded up to 0.25. A winner must clear breakeven with margin and also beat the blended account.
  - Venev uses its stated plan target of 2.10 instead. The rule would give 3.00, but it does not matter until Venev has purchases.
- **N (`readPurchases`)** = p90 of lifetime purchases per ad, rounded to 5 and clamped to 10..25.
  - At most the top ~10% of launches can be read, which is consistent with a ~5% reference.
  - 10 is the statistical floor (+/-72% CI). 25 is the existing default (+/-46%).
- **killRoas** = breakeven on the Meta basis, rounded up to 0.05. Manami keeps its stated working line.
- **directionalPurchases** = max(5, round(0.4 x N)), which keeps the default 10:25 ratio.
- **targetCpa** = trailing 90-day account CPA. Manami keeps its stated 527 Kč. Venev uses its stated break-even CPA, because a 13.7k Kč CPA would push the kill gate to 41k per ad.
- **killGateX** = 3, the default: an ad can only be a loser after spending 3 x CPA.

#### 1.3 Proposed values

| Field | Dobias | Ethia | Manami | Venev |
|---|---|---|---|---|
| `targetRoas` | **3.00** | **2.50** | **2.25** (stated 2.50, see D4) | **2.10** |
| `readPurchases` (= N, also the shrink k) | **25** | **10** | **15** | **10** |
| `killRoas` | **1.50** (1.25 if fulfilment is not counted, see D5) | **1.70** | **1.80** | **1.90** |
| `directionalPurchases` | 10 | 5 | 6 | 5 |
| `killGateX` | 3 | 3 | 3 | 3 |
| `targetCpa` | 54 USD | 550 Kč | 527 Kč | 783 Kč |
| `breakEvenRoas` (stored) | 1.51 | 1.66 | 1.46 | 1.89 |
| `grossMargin` | 0.80 | 0.73 | 0.684 | null (COGS coverage) |
| Every other field | default | default | default | default |

The shrinkage prior is each client's trailing 365-day Meta ROAS: Dobias 2.842, Ethia 2.283, Manami 2.029, Venev 0.108.

#### 1.4 Historical hit rate under the proposal

Settings for this table:
- Cohort = month of first delivery. Status is lifetime to date, as of 2026-10-04.
- This uses the recommended relaunch exclusion (D1). The ad-grain totals the owner literally specified are given after the table.
- "-20%" and "+20%" mean the target ROAS multiplied by 0.8 and 1.2.
- "Open" = not a winner and younger than 60 days.

| Launch month | Dobias n / W / HR (-20% / +20%) | Ethia n / W / HR (-20% / +20%) | Manami n / W / HR (-20% / +20%) |
|---|---|---|---|
| 2025-10 | n/a | 6 / 0 / 0% (0 / 0) | 13 / 2 / 15.4% (15.4 / 7.7) |
| 2025-11 | n/a | 11 / 1 / 9.1% (9.1 / 0) | 10 / 1 / 10.0% (10.0 / 10.0) |
| 2025-12 | n/a | 18 / 0 / 0% (0 / 0) | 4 / 0 / 0% (0 / 0) |
| 2026-01 | n/a | 4 / 0 / 0% (50.0 / 0) | 7 / 0 / 0% (14.3 / 0) |
| 2026-02 | n/a | 19 / 0 / 0% (0 / 0) | 8 / 0 / 0% (0 / 0) |
| 2026-03 | n/a | 41 / 0 / 0% (4.9 / 0) | 7 / 2 / 28.6% (28.6 / 14.3) |
| 2026-04 | 0 (the 6 Apr ads are pre-existing) | 6 / 1 / 16.7% (16.7 / 0) | 15 / 0 / 0% (0 / 0) |
| 2026-05 | 0 | 10 / 2 / 20.0% (30.0 / 20.0) | 9 / 0 / 0% (0 / 0) |
| 2026-06 | 10 / 0 / 0% (10.0 / 0) | 30 / 2 / 6.7% (10.0 / 3.3) | 15 / 1 / 6.7% (6.7 / 0) |
| 2026-07 | 13 / 5 / 38.5% (46.2 / 15.4) | 5 / 1 / 20.0% (40.0 / 20.0) | 18 / 1 / 5.6% (5.6 / 0) |
| 2026-08 | 12 / 1 / 8.3% (16.7 / 0), 6 open | 3 / 0 / 0%, 2 open | 7 / 1 / 14.3% (14.3 / 0), 6 open |
| 2026-09 | 0 | 3 / 0 / 0%, 3 open | 9 / 1 / 11.1% (22.2 / 11.1), 8 open |
| **12 months** | **35 / 6 / 17.1%** (25.7% / 5.7%) | **156 / 7 / 4.5%** (9.0% / 2.6%) | **122 / 9 / 7.4%** (9.0% / 3.3%) |
| Ad grain, no dedup | 58 / 8 / 13.8% (19.0% / 6.9%) | same as above | 161 / 9 / 5.6% (8.7% / 2.5%) |

**Venev:** 9 ads launched in 2026-09, 0 winners, all 9 open. It has had 6 purchases in its lifetime on 82k Kč of spend, so the hit rate is not meaningful yet.

**Sensitivity to N** (winners with relaunches excluded, target fixed):

| N | Dobias (of 35) | Ethia (of 156) | Manami (of 122) |
|---|---|---|---|
| 10 | 8 | **7** | 11 |
| 15 | 7 | 3 | **9** |
| 20 | 7 | 2 | 7 |
| 25 | **6** | 1 | 6 |

Bold marks the proposed N.

**Split by format** (ad grain, 12 months, winners / ads):

| Client | Video | Static |
|---|---|---|
| Dobias | 4 / 15 (26.7%) | 4 / 43 (9.3%) |
| Ethia | 5 / 61 (8.2%) | 2 / 95 (2.1%) |
| Manami | 6 / 95 (6.3%) | 3 / 66 (4.5%) |

**How to read this:**
- Dobias runs few ads on large budgets, so a high share of them gets enough purchases to be judged. Its 17% is real but rests on 35 launches.
- Ethia's 4.5% depends on N = 10. At N = 15 it drops to 1.9%.
- Manami's learnings quote "1 of 67, 1.5%". That figure used net-new persona ads, target 2.50 and N 25. Under this proposal the June to August cohorts read 3 of 40.

#### 1.5 Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Should a relaunch count as a new launch? Relaunch = a later ad of an asset that already ran, including same-day duplicates across ad sets. | **Exclude relaunches** from both numerator and denominator. The ad stays the unit. When the asset is unknown (Ethia today) every ad counts. |
| D2 | Confirm the threshold table in 1.3, then enter it in Settings. | As proposed. |
| D3 | `readPurchases` also sets "Read" confidence and the shrinkage weight in every Creative verdict. Ethia at 10 means verdicts read at +/-72%. | Keep a single field so the grid badge and the hit rate always agree. The alternative for Ethia is N = 15 (1.9%). |
| D4 | Manami target: 2.25 (data and rule) or the stated 2.50? | 2.25. The handoff already lists three signals that 2.50 is too high. At 2.50, Manami's hit rate is 4.9% at ad grain (6 of 122). |
| D5 | Dobias kill line: 1.50 requires confirming the fulfilment rate (QF1 inferred 20.50 USD/order without reading it). | Set 1.50 once confirmed, otherwise 1.25. The kill line does not affect hit rate, only loser counts. |
| D6 | Maturity window. | 60 days, with open ads shown (section 2.3). |

### 2. Data design

#### 2.1 Source of launch dates and lifetime totals

- **Launch date** = the first day with impressions > 0 in `mart_meta_ad_perf` (one ingest: `stg_meta_ad_insights`).
- `ref.creative_tags.launched_at` is not used. It is set for only 1 to 17 ads a month, and only for Manami and Venev.
- **Lifetime** = everything from the first delivery up to the latest loaded day.

**Recommendation: materialise one row per ad** in a new table `mart.rpt_ad_launch` (about 450 rows today). Use the 253 pattern exactly:
- a procedure builds `__next`
- it ASSERTs the checks
- it swaps in the result with `CREATE OR REPLACE TABLE ... COPY`
- it is called as a second node in the existing n8n workflow "BQ: refresh rpt_kpis_daily"

Querying the views directly would cost about 98 to 116 MB and 2 to 3 seconds on every page load.

```sql
-- infra/bigquery/254_rpt_ad_launch.sql (sketch)
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_rpt_ad_launch`()
BEGIN
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.rpt_ad_launch__next`
  CLUSTER BY client_id AS
  WITH d AS (
    SELECT client_id, ad_id, date, ad_name, campaign_id, adset_id, currency,
           spend, revenue, purchases, impressions, video_play_actions
    FROM `oneeighty-warehouse.mart.mart_meta_ad_perf`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH) AND date < CURRENT_DATE()
  ),
  hist AS (
    SELECT client_id, MIN(IF(impressions > 0, date, NULL)) AS history_start, MAX(date) AS through
    FROM d GROUP BY client_id
  ),
  prior AS (  -- shrinkage anchor: trailing 365 days, sum over sum
    SELECT d.client_id, SAFE_DIVIDE(SUM(d.revenue), SUM(d.spend)) AS prior_roas
    FROM d JOIN hist h USING (client_id)
    WHERE d.date > DATE_SUB(h.through, INTERVAL 365 DAY)
    GROUP BY d.client_id
  ),
  life AS (
    SELECT client_id, ad_id,
      ANY_VALUE(ad_name) AS ad_name, ANY_VALUE(campaign_id) AS campaign_id,
      ANY_VALUE(adset_id) AS adset_id, ANY_VALUE(currency) AS currency,
      MIN(IF(impressions > 0, date, NULL)) AS first_date,
      MAX(IF(impressions > 0, date, NULL)) AS last_date,
      COUNTIF(impressions > 0) AS active_days,
      IFNULL(SUM(spend), 0) AS spend, IFNULL(SUM(revenue), 0) AS revenue,
      IFNULL(SUM(purchases), 0) AS purchases, IFNULL(SUM(impressions), 0) AS impressions,
      IFNULL(SUM(video_play_actions), 0) AS video_plays
    FROM d GROUP BY client_id, ad_id
    HAVING first_date IS NOT NULL
  ),
  asset AS (
    SELECT client_id, ad_id,
      COALESCE(NULLIF(video_id, ''), NULLIF(image_hash, ''),
               NULLIF(effective_object_story_id, ''), creative_id) AS asset_key
    FROM `oneeighty-warehouse.mart.mart_creative_asset`
  )
  SELECT l.*, h.history_start, h.through,
    DATE_DIFF(h.through, l.first_date, DAY) AS age_days,
    l.first_date <= DATE_ADD(h.history_start, INTERVAL 2 DAY) AS is_preexisting,
    l.video_plays > 0 AS is_video,
    a.asset_key,
    a.asset_key IS NOT NULL AND ROW_NUMBER() OVER (
      PARTITION BY l.client_id, a.asset_key ORDER BY l.first_date, l.ad_id) > 1 AS is_relaunch,
    t.concept_id, cn.name AS concept_name, t.persona_id, t.format AS format_tag, t.production_type,
    p.prior_roas, CURRENT_TIMESTAMP() AS refreshed_at
  FROM life l
  JOIN hist h USING (client_id)
  LEFT JOIN prior p USING (client_id)
  LEFT JOIN asset a USING (client_id, ad_id)
  LEFT JOIN `oneeighty-warehouse.ref.creative_tags` t USING (client_id, ad_id)
  LEFT JOIN `oneeighty-warehouse.ref.concepts` cn
    ON cn.client_id = t.client_id AND cn.concept_id = t.concept_id;
  -- ASSERTs: rows > 0; rows >= 90% of live; no duplicate (client_id, ad_id);
  -- MAX(through) >= CURRENT_DATE() - 2. Then COPY into mart.rpt_ad_launch, DROP __next.
END;
```

The app reads it like this. The trailing 12 months for the trend and the page range come back in one query and are split in TypeScript.

```sql
SELECT ad_id, ad_name, first_date, age_days, spend, revenue, purchases,
       is_video, is_relaunch, concept_id, concept_name, prior_roas, through
FROM mart.rpt_ad_launch
WHERE client_id = @clientId AND NOT is_preexisting
  AND first_date >= LEAST(@from, DATE_SUB(DATE_TRUNC(@through, MONTH), INTERVAL 11 MONTH))
  AND first_date <= @to
```

**Cost:**

| Path | Processed per call | Monthly |
|---|---|---|
| View-based cohort query from the app | about 98 to 116 MB, 2 to 3 s | n/a |
| `rpt_ad_launch` read from the app | under 1 MB (10 MB billed minimum) | n/a |
| Refresh CALL | about 120 to 200 MB | hourly: about 140 GB (under 1 USD); daily: about 6 GB |

Daily is enough, because Meta lands daily. Hourly is acceptable if it simply rides the existing workflow.

#### 2.2 Definitions

```
launched(range)  = ads with first_date in range, NOT is_preexisting, NOT is_relaunch (D1)
winner           = classify(lifetime components, prior_roas, thresholds) === "winner"
                   i.e. purchases >= readPurchases AND shrink(raw, n, prior_roas, readPurchases) >= targetRoas
open             = NOT winner AND age_days < HIT_RATE_MATURITY_DAYS (60)
hit rate         = winners / launched   (pooled: sum over sum, for any rollup)
```

- The prior is the per-client 12-month ROAS stored in the table, not the selected period's mean. That way the tile does not move when the date range changes.
- The grid's per-period verdicts keep using the period mean. They answer a different question.

#### 2.3 Maturity

**Evidence.** For ads launched since 2025-07 that are winners now, the day they first qualified was:

| Client | Winners now | Qualified by day 30 | by day 60 | by day 90 |
|---|---|---|---|---|
| Ethia | 8 | 8 | 8 | 8 |
| Manami | 13 | 7 | 12 | 13 |
| Dobias | 8 | 5 | 6 | 8 |
| **Total** | **29** | | **26 (90%)** | **29** |

**Recommendation: 60 days. Show maturing cohorts, never hide them.**
- A cohort with any launch younger than 60 days is "maturing". Its rate is a lower bound, rendered hatched, with the open count.
- Hiding the last two months would remove the only feedback that matters for current production.

**Lifetime to date vs "ever won":**
- Sticky "ever won" was tested and rejected. Over the 12 months it gives Ethia 12 vs 7, Manami 13 vs 9 and Dobias 10 vs 8.
- Most of the extra cases are early lucky streaks at low N that then regressed below the target.
- So lifetime to date, as the owner decided, is the more defensible rule.

#### 2.4 Where thresholds are evaluated

**Recommendation: TypeScript, not a BigQuery reference table synced from Settings.** Reasons:
1. Thresholds already live in Postgres `creative_settings` and take effect the moment they are saved.
2. The frontend service account is read-only on BigQuery by design. A sync would need an n8n job from Postgres to BigQuery, which adds lag, a second source of truth and IAM work.
3. One `classify()` in `lib/creative/model.ts` serves the grid badge, the Creative tile, Paid and Reports, so they are identical by construction.
4. Row volume is tiny: at most about 200 launches per client per year.
5. It follows the QF1 precedent: `costRates` are injected after compile and never reach SQL or a cache key.

#### 2.5 Reports: the cleanest extension

Component sums cannot express a per-ad classification. The extension is an **entity mart with a pre-aggregation classifier**. After classification the components are plain counts, so every existing rule (bucketing, rollups, comparisons, coverage) applies unchanged.

**Registry changes:**
- **MartDef:** new optional field `entity?: { key: "ad_id"; classifier: "creative_hit" }`.
- **New mart** `ad_launch`:
  - table `mart.rpt_ad_launch`
  - `dateColumn: "first_date"`
  - `currencyColumn: null`: spend and revenue are used only inside a currency-free ratio, so there is no FX
  - grains `week`, `month`
  - `selectAll`
- **Compile.** For entity marts:
  - GROUP BY client_id, bucket, period, ad_id.
  - Select the classifier inputs with ANY_VALUE: purchases, spend, revenue, age_days, prior_roas.
  - Filter `NOT is_preexisting AND NOT is_relaunch` in WHERE. `assertDatePredicates` already covers it.
  - Thresholds never enter the SQL text or the key.
- **Evaluate.** In `normaliseRows`, before bucketing:
  - Each entity row is mapped through `classifyHit(row, client.creativeThresholds)` into virtual components `ad_launch.launched` (1), `ad_launch.winners` (0 or 1) and `ad_launch.open` (0 or 1). The classifier reuses `classify` from `lib/creative/model.ts`.
  - A client without thresholds gets a new status `not_measured`, reason `no_thresholds`. It is excluded from combined with the existing "3 of 4 clients" coverage note.
- **Route.** `app/api/reports/query/route.ts`:
  - Loads creative settings for the widget's clients, only when an `ad_launch` component is present.
  - Merges `ReportClient.creativeThresholds` after compile, exactly like `costRates`.
  - A changed threshold therefore applies immediately, with no cache invalidation.
- **Metrics:**
  - `hit_rate`: ratio winners / launched, pct with 1 decimal, goodWhen up, `benchmarkable: false`
  - `winners`: sum
  - `ads_launched`: sum
  - all three `requires: "meta"`, group "Creative"
- **Reference line.** New optional `MetricBase.reference?: { value: 0.05; label: "Reference ~5%" }`.
  - A `ref.industry_benchmarks` row is the wrong tool: those rows are time-bounded and go stale, and ~5% is not an industry benchmark.
  - KPI shows it on hover. Line and Bar draw it as a dashed line.
- **Caveats:**
  - `cohort_maturing`: a bucket with `open > 0`, text "Launches under 60 days old still open."
  - `lifetime_to_date`
  - In a comparison, the delta is suppressed when the current period is maturing and the previous one is not, because older cohorts have had more time.
- **Combined rollup** = sum of winners / sum of launched, with each client judged against its own bar. Docs: METRICS.md amendment and a `SEMANTIC_VERSION` bump.

### 3. UI spec (minimal text)

**Creative page, scorecard tile "Hit rate"** (replaces the current definition):
- Value: `7.4%`.
- Sub: `9 of 122 launched`, plus `· 18 open` when open > 0.
- Info: "Winners among ads first delivered in this period. Winner: 15+ purchases, ROAS 2.25+ after shrinkage. Reference about 5%." The numbers come from the client's own settings.
- No thresholds: value `n/a`, sub `122 launched`, info "Set thresholds in Settings."
- The Winners, Carriers and Losers tiles stay as they are (ads with delivery in the period). Change the Winners tile's info to say "with delivery in period" so the two counts are not confused.

**Creative page, section "Hit rate by launch month":**
- Placement: below the scorecard, above "Every creative".
- Chart: 12 bars for the trailing launch months, in hand-written SVG per the repo convention.
- Bar height = rate. Label above each bar = `W/n`. Months with 0 launches show a dash.
- Maturing months are hatched, with `n open` under the label.
- A dashed line at 5% labelled `Ref. ~5%`. Months inside the page range are highlighted.
- Segmented control: `All · Video · Static`, with format from video plays.
- Concept split: shown as a small table (concept, launched, winners, rate, plus an "Untagged" row) only when 50%+ of launches in range are tagged. Today that hides it for every client, which is the honest state.

**Paid > Meta tile:**
- One small tile after `MetaKpis`: label `Creative hit rate`, value `7.4%`, sub `9 of 122 launched`.
- It links to `/creative` with the same client and range.
- Without thresholds: `n/a`, sub `Set thresholds`, linking to Settings.

**Reports:**
- The picker's "Creative" group gains Hit rate, Winners and Ads launched.
- KPI widget: value plus sub `W of n`.
- Line and Bar widgets: by launch week or month, with the 5% reference line.
- Table: one row per client. A cell with no thresholds shows `No thresholds`.
- Maturing buckets carry the caveat marker.

### 4. Work packages

**Prerequisite (owner, no code):** decide D1 to D6, then enter the thresholds in Settings.

| WP | Model | Depends | Owned files | Acceptance |
|---|---|---|---|---|
| **HR1 Warehouse table** | sonnet | none | `infra/bigquery/254_rpt_ad_launch.sql`; `infra/bigquery/qa/254_rpt_ad_launch_regression.sql`; `infra/n8n/wf_rpt_kpis_refresh.json` (add the CALL node) | Matches the view; correct exclusions, prior and asset reuse; refresh is fast and app reads are cheap (detail below). |
| **HR2 Engine + Creative + Paid** | sonnet | HR1 (demo path works without it) | `lib/creative/hitRate.ts` (new, pure); `lib/queries/creativeLaunch.ts` (new; table missing reads as not ready, never as 0); `lib/demo/creative.ts`; `app/(app)/creative/page.tsx`; `components/creative/HitRateTrend.tsx` (new); `components/paid/meta/HitRateTile.tsx` (new); `app/(app)/paid/meta/page.tsx`; `scripts/check-creative-hitrate.ts` (new) | Fixture rules hold; live numbers match an independent query; the UI behaves in the edge cases (detail below). |
| **HR3 Reports** | **opus** (changes the compile and evaluate contract) | HR1, and HR2's `hitRate.ts` | `lib/reports/registry/types.ts`, `components.ts`, `metrics.ts`, `caveats.ts`; `lib/reports/compile.ts`; `lib/reports/evaluate.ts`; `app/api/reports/query/route.ts`; `components/reports/widgets/KpiWidget.tsx`, `LineWidget.tsx`, `BarWidget.tsx` (reference line); `scripts/check-reports.ts`, `scripts/check-reports-eval.ts`; `lib/reports/README.md`, `METRICS.md` | Existing checks pass; new assertions on SQL, cache key, rollup and parity hold; reads are cheap (detail below). |

**HR1 acceptance:**
- An EXCEPT DISTINCT against lifetime sums recomputed from `mart_meta_ad_perf` returns 0 rows in both directions.
- Pre-existing counts are Dobias 6, Ethia 1, Manami 3, Venev 7.
- `prior_roas` equals the 12-month Meta ROAS: 2.842, 2.283, 2.029, 0.108 (to 2026-10-04).
- `is_relaunch` count: Dobias 23, Manami 39 within the 12-month cohorts.
- The CALL takes under 30 s.
- The app query processes under 1 MB.

**HR2 acceptance:**
- Fixtures:
  - n < N is never a winner.
  - Shrinkage is identical to `classify`.
  - A relaunch is excluded from both numerator and denominator.
  - Open = not a winner and under 60 days old.
  - Missing thresholds give `n/a` with a launched count.
- A live harness matches an independent same-day SQL (the `hr_eval` logic) per client and month.
- Tile, trend and Paid tile show the same numbers for the same range.
- `tsc` and `npm run build` pass. No em dashes.

**HR3 acceptance:**
- `check:reports` and `reports-eval` pass.
- New assertions:
  - Changing thresholds leaves the SQL and cache key byte-identical.
  - Combined hit rate = sum of winners / sum of launched.
  - A client with no thresholds is excluded with a coverage note.
  - The maturing caveat fires.
  - The comparison delta is suppressed for a maturing current period.
  - Reports KPI equals the Creative tile for Manami over the same range.
- Dry run reads under 10 MB.

I'd also flag separately that **Ethia has no `mart_creative_asset` rows**. That disables relaunch detection and thumbnails for Ethia.