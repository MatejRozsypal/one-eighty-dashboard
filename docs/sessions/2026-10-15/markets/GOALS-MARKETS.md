# Goals x Markets: build proposal

Status: PROPOSAL, 2026-10-15. No code, no BigQuery writes, no ClickUp writes. All numbers below were read from prod (`oneeighty-warehouse`, read only) on 2026-10-15.

Owner decision 2026-10-15: **A** (automatic split of the client's targets into markets) plus **C** (per-market guardrails). **B** (a `Market` field on ClickUp goal tasks) only later, for a market that gets its own plan.

Inputs read: `projects/promo-pacing/HANDOFF.md`, `05-ARCHITEKTURA.md`, `11-CLICKUP-CM3-AMER.md`; migrations 279c, 279k, 283, 290 to 294; `dashboard/app/(app)/goals`, `lib/plan/*`, `components/plan/*`, `lib/markets/costStore.ts`; this folder's SPEC.md, COST-CARDS.md, DATA-BUILD.md, ROLLOUT.md, TRENDS.md.

## 0. What the data says first (affects every choice below)

| Finding | Evidence (prod, 2026-10-15) | Consequence |
|---|---|---|
| Only **Ethia and Manami** have plans. Ethia is single market (CZ 99.7 % of revenue). | `mart.plan_input`: rows only for ethia, manami. `ref.client_markets`: ethia = CZ only. | Today A matters for **Manami (CZ/SK)** only. Dobias and RawBark get A the day they get ClickUp plans. C works without a plan, so C is useful for every client now. |
| Plan revenue = market **net_sales** (goods ex VAT after discounts and refunds, no shipping). | Ethia 1 to 14 Oct: plan actual 48,591 Kč = `market_daily.net_sales` 48,591; orders 48 = 48; new customers 30 = 30; spend 19,994 = 19,994. | Split and measure revenue on `net_sales`, never `net_revenue`. |
| Manami markets do not sum exactly to the plan. | 1 to 14 Oct: plan revenue 106,408 vs CZ + SK net_sales 108,145 (+1,737, +1.6 %); orders 96 vs 97; new customers 79 = 79. Plan reads `plan_orders`, Markets reads `market_orders` (284 market rule, non-shippable exclusion). | Never rescale market actuals. Show a small **reconciliation line** (plan actual minus sum of markets) so the rings never pretend to add up when they do not. |
| Manami plan **ad_spend = Meta only**, while plan **aMER uses Meta + Google**. | Oct 1 to 14: `ad_spend` actual 28,192 = `market_daily.meta_spend`; aMER denominator 36,983 = meta 28,192 + google 8,791. | The ad budget split must use the same channel set as the plan's `ad_spend` (today Meta). Owner to confirm this is intended (decision D5). |
| Last-year shares drift hard for Manami SK. | SK share of net_sales: Oct 2025 17.4 %, Nov 24.0 %, Dec 20.0 %; last 90 days 9.4 %; Oct 2026 to date 16.0 %. SK new customers 15 to 35 a month. | "Same period last year" would give SK about 2x its recent run-rate. A **drift flag** is mandatory and the owner should decide Manami's Q4 basis (D1). |
| Last-year **spend** shares are unusable for Manami and Dobias. | Manami Q4 2025: 35 to 52 % of Meta spend per month is UNALLOCATED. Dobias: no spend before 2026-04-20. RawBark: fine (UNALLOCATED 0.1 %). | Ad budget falls back to last 90 days by rule (section 1.3). |
| Markets refresh **daily at 05:30 UTC**, plan refreshes **hourly at :45**. | ROLLOUT.md (owner 2026-10-15: daily); `market_daily` last modified 19:57 UTC, `plan_pacing` 21:47 UTC today. | Market pacing is cut at `LEAST(plan as_of, market as_of)`, so between midnight and 05:30 a market row can be one day behind the client tiles. The section says which day it covers. |

## 1. A: automatic split of client targets into markets

### 1.1 Principle

ClickUp stays the only input for targets (owner rule 2026-10-07). The split is not a new target: it is the client target times a **share** per market, computed in BigQuery from history, frozen for the period, and overridable in Settings. Market actuals come from `mart.market_daily`. The shape of the daily curve (paydays, promo multipliers) is the client's curve from `mart.plan_targets_daily`, so a market's target to date is the client's target to date times the market's share.

### 1.2 Metrics

| Plan metric | Split? | Share basis (from `market_daily`) | Market actual |
|---|---|---|---|
| `revenue` (Target revenue ex VAT) | yes | `net_sales` | `net_sales` |
| `orders` (Target orders) | yes | `orders` | `orders` |
| `new_customers` (Target new customers) | yes | `new_customers` | `new_customers` |
| `ad_spend` (Ad budget) | yes | spend on the plan's channel set (today `meta_spend`), UNALLOCATED excluded | same; UNALLOCATED shown as its own row |
| `cm3` (Target CM3) | **no** | | market CM3 shown as a contribution figure, no ring |
| `amer` (Target aMER) | **no** | | market aMER shown next to the client plan aMER, no ring |

**Why CM3 is not split.** The plan's CM3 is the Snapshot basis (mart revenue incl. shipping minus COGS, fulfilment and paid spend). Market CM3 is the cost-card basis (CM2 from shipping, payment fees, COD, returns, minus allocated spend and fixed cost). A share of one compared with the other would be read as a pace when it is a definition gap. CM3 is also not proportional to revenue: a market with higher shipping cost carries less CM3 per crown. The market's profit question is answered by guardrail C (min CM3 % or min first-order GP after ads).

**Why aMER is not split.** A ratio cannot be shared out. The market row shows its own aMER (new customer revenue / allocated spend) with the client's plan aMER as a reference figure; the efficiency limit per market is the guardrail max nCAC.

### 1.3 Default share and fallbacks

Grain: **client x month x metric x market**. A quarter's market target is the sum of its months' market targets (the quarter share is the target-weighted mean of its months' shares), so Quarter and Month always agree. Weeks and days inherit their month's share through the daily curve. Promo and Checkpoint periods are **not split** in v1 (they are store-wide windows; a market promo is a case for B).

Markets in the split: every sold market in `ref.client_markets` plus `OTHER`. Shares sum to 1.000 per client x month x metric. `UNALLOCATED` never takes a share (it has spend only).

Order of bases, first valid wins:

1. **Same month last year (LY).** Valid when, for that metric, the client's LY month had at least 30 orders / 20 new customers / 20 orders behind revenue, every market in the split already existed at the start of that LY month, and, for `ad_spend` only, UNALLOCATED was under 10 % of LY spend and no LY day had `spend_base` NULL.
2. **Last 90 days (L90)** ending the day before the month starts (for a month not yet started: ending at the plan's as_of). Same volume and spend-coverage tests.
3. **Equal** across the markets that are not new. Used only when a client has no usable history at all (a new client); it never applies to one market inside a client that has history.

**New market** (first order less than 90 days before the month starts, or no orders yet): share **0**, source `new_market`. Its actuals still show, labelled "Not in plan", so a test market never eats the target of the established ones. It joins the L90 basis automatically once it has 90 days, and LY once it has a full LY month. An owner override (1.4) can give it a share earlier.

**OTHER** gets its share like any market (Dobias about 1 %, Ethia 0.3 %). Rows with a share under 2 % are drawn as a compact line without a ring.

**Drift flag.** When LY is used and `|LY share - L90 share| >= 5 pp` for a market with a share of at least 5 %, the row gets a "Split drift" chip with both numbers in its InfoTip, and `mart.plan_market_checks` logs `split_drift` (warning, shown on /health). Today this fires for Manami SK in Oct, Nov and Dec.

**Freeze.** A month's shares are frozen at the first refresh on or after its first day, so a market target never moves inside a running month. Future months carry provisional shares (`is_frozen = FALSE`) that are recomputed every run, so the Quarter view can show the whole quarter.

### 1.4 Manual override %

Per client x market x metric (or "all four metrics" in one entry), effective from a month. The overridden markets take their %; the rest of 100 % is shared among the other markets in proportion to their default shares. Validation: 0 to 100, the overrides of one client x metric sum to 100 % or less, and a client with overrides on every market must sum to exactly 100 %.

### 1.5 Where the shares live

| Part | Where | Why |
|---|---|---|
| Default shares (computed) | BigQuery `mart.plan_market_shares` (snapshot table, frozen per month) | Computed from `market_daily`; the warehouse does the pacing arithmetic, like the rest of Goals |
| Overrides (typed) | Postgres `plan_market_splits`, Settings > Clients > (client) > **Market costs**, new block "Goal split" | Same reason as the cost cards: typed inputs, and the app's BigQuery account is read-only by design |

Consequence: BigQuery produces the market rows at the default share and carries the pieces needed to redo them at another share (client target and target to date, the noise parameter). When an override exists, `lib/plan/marketSplit.ts` recomputes target, target to date, pace, gap, projection and status with the same formulas and thresholds as `plan_pacing_v`. A parity check (`check:plan-markets`) asserts that the TS function reproduces every BigQuery row exactly at the default share.

Alternative (decision D2): overrides as a BigQuery table `ref.plan_market_split` edited in the console. All math stays in SQL, no TS mirror, but every change is a BigQuery write by the owner and there is no form.

### 1.6 SQL sketch

Sketch only, names final, details (shrink constant, noise) copied from `plan_pacing_v` (279k) at build time.

```sql
-- 302: frozen default shares --------------------------------------------------
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.mart.plan_market_shares` (
  client_id STRING, month_start DATE, metric STRING, market STRING,
  share FLOAT64,                  -- sums to 1 per client x month x metric
  source STRING,                  -- ly | l90 | equal | new_market
  ly_share FLOAT64, l90_share FLOAT64, drift_pp FLOAT64,
  basis_from DATE, basis_to DATE, basis_total FLOAT64,
  is_frozen BOOL, computed_at TIMESTAMP)
CLUSTER BY client_id, month_start;

CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_plan_market_shares`()
BEGIN
  DELETE FROM `oneeighty-warehouse.mart.plan_market_shares` WHERE NOT is_frozen;
  INSERT INTO `oneeighty-warehouse.mart.plan_market_shares`
  WITH months AS (
    SELECT DISTINCT t.client_id, t.month_start, p.as_of
    FROM `oneeighty-warehouse.mart.plan_targets_daily` t
    JOIN (SELECT client_id, MAX(as_of) AS as_of FROM `oneeighty-warehouse.mart.plan_pacing` GROUP BY 1) p
      USING (client_id)
    WHERE NOT EXISTS (SELECT 1 FROM `oneeighty-warehouse.mart.plan_market_shares` s
                      WHERE s.client_id = t.client_id AND s.month_start = t.month_start AND s.is_frozen)
  ),
  basis AS (                      -- plan metric definitions on market rows
    SELECT client_id, date, market, metric, v
    FROM `oneeighty-warehouse.mart.market_daily`
    UNPIVOT (v FOR metric IN (net_sales AS 'revenue', orders AS 'orders',
                              new_customers AS 'new_customers', meta_spend AS 'ad_spend'))
    WHERE market != 'UNALLOCATED'
  ),
  ly AS (
    SELECT m.client_id, m.month_start, b.metric, b.market, SUM(b.v) AS v
    FROM months m JOIN basis b
      ON b.client_id = m.client_id
     AND b.date BETWEEN DATE_SUB(m.month_start, INTERVAL 1 YEAR)
                    AND LAST_DAY(DATE_SUB(m.month_start, INTERVAL 1 YEAR))
    GROUP BY 1, 2, 3, 4
  ),
  l90 AS (
    SELECT m.client_id, m.month_start, b.metric, b.market, SUM(b.v) AS v
    FROM months m JOIN basis b
      ON b.client_id = m.client_id
     AND b.date BETWEEN DATE_SUB(LEAST(m.month_start, DATE_ADD(m.as_of, INTERVAL 1 DAY)), INTERVAL 90 DAY)
                    AND DATE_SUB(LEAST(m.month_start, DATE_ADD(m.as_of, INTERVAL 1 DAY)), INTERVAL 1 DAY)
    GROUP BY 1, 2, 3, 4
  )
  -- + validity tests (volume, market existed, spend coverage, UNALLOCATED < 10 %),
  -- + new_market rows at 0, renormalise the rest, equal split for a client with no history,
  -- + drift_pp = 100 * (ly_share - l90_share)
  SELECT ... ;
  -- freeze: is_frozen = month_start <= as_of
END;

-- 303: market pacing --------------------------------------------------------------
CREATE OR REPLACE VIEW `oneeighty-warehouse.mart.plan_pacing_market_v` AS
WITH
p AS (                            -- client periods that get a split
  SELECT * FROM `oneeighty-warehouse.mart.plan_pacing`
  WHERE period_type IN ('month', 'quarter', 'week')
    AND metric IN ('revenue', 'orders', 'new_customers', 'ad_spend')
    AND target_total IS NOT NULL
),
mk_asof AS (SELECT client_id, MAX(date) AS market_as_of
            FROM `oneeighty-warehouse.mart.market_daily` GROUP BY 1),
d AS (                            -- the client's curve x the month's market share
  SELECT t.client_id, t.date, t.metric, s.market, s.share, s.source, s.drift_pp,
         t.target_daily, t.target_daily * s.share AS target_daily_m
  FROM `oneeighty-warehouse.mart.plan_targets_daily` t
  JOIN `oneeighty-warehouse.mart.plan_market_shares` s USING (client_id, month_start, metric)
),
a AS (                            -- market actuals, plan definitions
  SELECT client_id, date, market, metric, v
  FROM `oneeighty-warehouse.mart.market_daily`
  UNPIVOT (v FOR metric IN (net_sales AS 'revenue', orders AS 'orders',
                            new_customers AS 'new_customers', meta_spend AS 'ad_spend'))
),
cut AS (
  SELECT p.*, LEAST(p.as_of, k.market_as_of) AS as_of_m
  FROM p JOIN mk_asof k USING (client_id)
),
tgt AS (
  SELECT c.client_id, c.period_type, c.period_id, c.metric, d.market,
         ANY_VALUE(c.as_of_m) AS as_of_m,
         SUM(d.target_daily_m)                                   AS target_total_m,
         SUM(IF(d.date <= c.as_of_m, d.target_daily_m, 0))       AS target_to_date_m,
         SUM(IF(d.date <= c.as_of_m, d.target_daily, 0))         AS client_target_to_date,
         SAFE_DIVIDE(SUM(d.target_daily_m), SUM(d.target_daily)) AS share_eff,
         STRING_AGG(DISTINCT d.source) AS share_source, MAX(ABS(d.drift_pp)) AS drift_pp
  FROM cut c JOIN d
    ON d.client_id = c.client_id AND d.metric = c.metric
   AND d.date BETWEEN c.period_start AND c.period_end
  GROUP BY 1, 2, 3, 4, 5
),
act AS (
  SELECT c.client_id, c.period_type, c.period_id, c.metric, a.market, SUM(a.v) AS actual_to_date_m
  FROM cut c JOIN a
    ON a.client_id = c.client_id AND a.metric = c.metric
   AND a.date BETWEEN c.period_start AND c.as_of_m
  GROUP BY 1, 2, 3, 4, 5
)
SELECT
  c.client_id, c.period_type, c.period_id, c.period_label, c.metric,
  COALESCE(t.market, x.market) AS market,
  c.as_of, t.as_of_m, c.period_start, c.period_end,
  t.share_eff, t.share_source, t.drift_pp,
  t.target_total_m, t.target_to_date_m, x.actual_to_date_m,
  SAFE_DIVIDE(x.actual_to_date_m, t.target_to_date_m) * 100 AS pace_pct,
  x.actual_to_date_m - t.target_to_date_m                     AS gap_abs,
  -- projection and status: the generic branch of plan_pacing_v (279k calc2/final)
  -- fed with the market's own counts, same shrink constant scaled by share, same
  -- thresholds (pace < 0.90 AND z <= -1.645 off_track, < 0.97 AND z <= -1.0 behind,
  -- > 1.10 AND z >= 1.645 ahead), same 5-day too-early rule for month and quarter.
  ... AS projected_end, ... AS z_score, ... AS status,
  -- pieces for the override recompute in TS
  c.target_total AS client_target_total, t.client_target_to_date, ... AS noise_phi
FROM cut c
JOIN tgt t USING (client_id, period_type, period_id, metric)
FULL JOIN act x USING (client_id, period_type, period_id, metric, market);
-- markets with actuals but no share (new_market, UNALLOCATED spend) come through
-- the FULL JOIN with a NULL target: shown, never paced.

-- table + procedure, the 279c pattern: __next, ASSERTs, COPY swap
CREATE OR REPLACE PROCEDURE `oneeighty-warehouse.mart.sp_refresh_plan_pacing_market`()
BEGIN
  CALL `oneeighty-warehouse.mart.sp_refresh_plan_market_shares`();
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_pacing_market__next`
  CLUSTER BY client_id, period_type, metric
  AS SELECT *, CURRENT_TIMESTAMP() AS refreshed_at FROM `oneeighty-warehouse.mart.plan_pacing_market_v`;
  ASSERT NOT EXISTS (SELECT 1 FROM `oneeighty-warehouse.mart.plan_pacing_market__next`
                     GROUP BY client_id, period_type, period_id, metric, market HAVING COUNT(*) > 1)
    AS 'plan_pacing_market: duplicate key';
  -- shares sum to 1 and market targets sum to the client target within 0.5 %
  ASSERT NOT EXISTS (
    SELECT 1 FROM `oneeighty-warehouse.mart.plan_pacing_market__next` m
    JOIN `oneeighty-warehouse.mart.plan_pacing` p USING (client_id, period_type, period_id, metric)
    GROUP BY client_id, period_type, period_id, metric, p.target_total
    HAVING ABS(SUM(m.target_total_m) - p.target_total) > 0.005 * ABS(p.target_total))
    AS 'plan_pacing_market: market targets do not add up to the client target';
  CREATE OR REPLACE TABLE `oneeighty-warehouse.mart.plan_pacing_market`
  COPY `oneeighty-warehouse.mart.plan_pacing_market__next`;
  DROP TABLE `oneeighty-warehouse.mart.plan_pacing_market__next`;
END;
CALL `oneeighty-warehouse.mart.sp_refresh_plan_pacing_market`();   -- bootstrap (snapshot trap)
```

Regression (QA file `qa/302_304_regression.sql`): for every client month with one as_of, `SUM(target_to_date_m) = plan_pacing.target_to_date` and each market's `target_to_date_m = target_to_date x share`; for Ethia, CZ actual = plan actual to the crown; for Manami, the reconciliation residual equals the numbers in section 0.

## 2. C: guardrails per client x market

### 2.1 Definitions

| Guardrail | Field (base currency, ex VAT) | Measured as | Needs |
|---|---|---|---|
| **Max nCAC** | `max_ncac` | allocated spend / new customers (the Markets definition, UNALLOCATED excluded) | spend coverage in the window |
| **Min CM3 %** | `min_cm3_pct` | market CM3 / net revenue (cost-card basis, `lib/markets/model.ts`) | a cost card for the market |
| **Min first-order GP after ads** | `min_first_order_gpa` (per new customer) | first-order GP per new customer minus nCAC (the matrix row "First-order GP minus nCAC") | COGS (not RawBark until F7) |
| **Min new customers per month** | `min_new_customers_month` | new customers in the month to date vs the minimum pro-rated on the plan's new-customer curve (linear by day when the client has no plan) | |
| Max discount rate (optional) | `max_discount_rate` | discounts / gross sales | gross sales and discounts (n/a for Manami: Shoptet has neither) |

Min CM3 % and min first-order GP after ads are alternatives: the owner fills one or both; a market with no cost card can still be guarded on first-order GP.

### 2.2 Storage

Postgres table `market_guardrails`, created by `lib/markets/guardrailStore.ts` behind its own `ensure()` guard, the exact pattern of `market_cost_cards`: key `client_id, market, effective_from`, every limit nullable with no default (empty = not guarded, never a guessed 0), `updated_at`, `updated_by`. Saving with a new date keeps history, the same date corrects. Form in **Settings > Clients > (client) > Market costs**, one "Guardrails" block per market under its cost card, same validation style (`lib/markets/guardrailForm.ts`).

### 2.3 Evaluation window

- **Ratio guardrails** (nCAC, CM3 %, first-order GP after ads, discount rate): **trailing 28 complete days** to the market as_of. Four full weeks remove the weekday pattern, and 28 days is long enough for Manami SK (about 20 new customers) to say something. On Goals the chip also states which days it covers.
- **Min new customers per month**: the calendar month to date against the pro-rated minimum; at month close the chip becomes final (met / missed), like a checkpoint.

### 2.4 Pass, warn, fail

| Result | Max-type limit (nCAC, discount rate) | Min-type limit (CM3 %, first-order GPA, new customers) |
|---|---|---|
| **Pass** | value <= limit | value >= limit |
| **Warn** | limit < value <= limit x 1.15 | limit x 0.85 <= value < limit (CM3 %: within 3 pp below) |
| **Fail** | value > limit x 1.15 | value < limit x 0.85 (CM3 %: more than 3 pp below) |
| **Too early** (grey) | under 10 new customers in the window, or under 7 days into the month for the monthly minimum | same |
| **n/a** | missing input with its reason (no card, no COGS, spend gap, platform has no discounts) | same |

A negative first-order GPA limit is allowed (an acquisition market can run at a planned loss); the 15 % band then applies to the absolute value. Tones reuse `planStatusTone` (pass = positive, warn = warning, fail = negative, too early = neutral), so the chips match the Goals status chips.

Guardrails do not change the Markets verdict chips (Scale, Hold, Fix...). Those keep their SPEC section 4 rules; a later step can feed a failed guardrail into them if the owner wants.

## 3. UI (the main /markets page stays exactly as it is)

### 3.1 Goals: a "Markets" section in the Month and Quarter views

Placement: after `PlanCharts`, before "Promos and checkpoints" (Quarter). Not a fifth view pill: a split is a property of a month or quarter, and a separate view would need its own period picker. Shown only when at least two markets have a share of 2 % or more in the period; otherwise the section is not rendered (Ethia today), with no explanatory text.

Desktop (one row per market, ranked by share; the client tiles above are unchanged):

```
MARKETS                                                    October 2026, data to 14 Oct
+----------+-------+-------------+-------------+-------------+-------------+--------------------------+
| Market   | Split | Revenue     | Orders      | New cust.   | Ad spend    | Guardrails (28 days)     |
+----------+-------+-------------+-------------+-------------+-------------+--------------------------+
| CZ       | 82.6% | (ring) 92%  | (ring) 88%  | (ring) 61%  | (ring) 71%  | nCAC 496 / 450   [Warn]  |
|          |  LY   | 248k target | 239 target  | 198 target  | 87k target  | CM3 % n/a  no card       |
|          |       | On track    | Behind      | Off track   | On track    | New cust. 63 / 50 [Pass] |
+----------+-------+-------------+-------------+-------------+-------------+--------------------------+
| SK       | 17.4% | (ring) 75%  | (ring) 81%  | (ring) 69%  | (ring) 52%  | nCAC 359 / 500   [Pass]  |
|          |  LY   | 52k target  | 51 target   | 69 target   | 18k target  | New cust. 16 / 25 [Warn] |
|          | [Split drift]        On track      On track      On track      |                          |
+----------+-------+-------------+-------------+-------------+-------------+--------------------------+
| Other    |  0.0% | 0 Kc revenue, 0 orders (compact line, no rings)                                     |
| Unallocated spend          ad spend 0 Kc                                                             |
| Not in a market            revenue -1,737 Kc   orders -1   (plan total minus markets)                |
+---------------------------------------------------------------------------------------------------- +
  CM3 and aMER per market: CM3 12,400 / 3,100 Kc (no target), aMER 2.0x / 2.6x (plan 2.0x)
```

(Figures in the sketch are illustrative, not computed; the split shown is Manami's real October 2025 revenue share; in the build each metric has its own share, for example SK new customers 25.7 %.)

- **Ring**: the existing `GoalRing` at 44 px, same geometry (arc = actual / market target, dot = market target to date), the same tone from the row status. The percentage under it is the pace (actual / target to date), exactly as on the client tiles.
- **Split cell**: share and its source (`LY`, `L90`, `Equal`, `Set` for an override, `Not in plan` for a new market). "Split drift" chip with the LY and L90 shares in its InfoTip.
- **Guardrail chips**: `StatusChip` styling, value / limit, InfoTip with the window and the rule. A market with no guardrails shows nothing in that column.
- **Reconciliation line**: only when the residual is not zero. Small text, no tone.
- **Phone (375 px)**: one card per market: header (market, split, guardrail chips), then a 2 x 2 grid of small rings (revenue, orders, new customers, ad spend). No horizontal page scroll.
- **Charts**: the existing burn-up gets no market lines (it stays the client view). A market's own burn-up opens from the row (drawer or `?market=SK` in the URL, like Markets' drawer), reading `plan_pacing_market` week and day grain from the daily curve.
- Quarter view: the same section on quarter rows; the month breakdown table is unchanged.

### 3.2 /markets/trends: "Goals and guardrails" section (optional, last section)

The subpage, not the Overview. One compact table per client: market, month-to-date pace for the four split metrics (text and small dots, no rings: rings are Goals-only by the GoalRing header rule), guardrail chips, and a link "Open in Goals". For clients without a ClickUp plan (Dobias, RawBark today) it shows the guardrails only, which makes C useful there before A has anything to split.

```
GOALS AND GUARDRAILS                         October 2026, data to 14 Oct    Open in Goals ->
Market  Revenue  Orders  New cust.  Ad spend   nCAC (28 d)      CM3 %         New cust./month
CZ      92% *    88% *   61% *      71% *      496 / 450 Warn   n/a no card   63 / 50 Pass
SK      75% *    81% *   69% *      52% *      359 / 500 Pass   n/a no card   16 / 25 Warn
```

## 4. Build plan

### 4.1 Migrations (BigQuery, prod only after the owner's OK)

| # | File | Creates | Notes |
|---|---|---|---|
| 302 | `302_gm_plan_market_shares.sql` | `mart.plan_market_shares` (table), `mart.sp_refresh_plan_market_shares()` | reads `plan_targets_daily`, `plan_pacing` (as_of), `market_daily`, `ref.client_markets`; CALL at the end |
| 303 | `303_gm_plan_pacing_market.sql` | `mart.plan_pacing_market_v`, `mart.plan_pacing_market` (snapshot), `mart.sp_refresh_plan_pacing_market()` | CALL at the end (bootstrap); does not touch any plan_* view or `sp_refresh_plan_pacing` |
| 304 | `304_gm_plan_market_checks.sql` | `mart.plan_market_checks` (view): `split_drift`, `market_residual` (over 2 %), `share_basis_equal`, `new_market_unplanned` | separate from `mart.plan_checks` so 279c's view is not patched |
| later | next free number at the time | B: `Market` field read by `stg_clickup_plan`, shares with source `clickup` | not in this build |

QA copies in `infra/bigquery/qa/30{2,3,4}_gm_*_qa.sql` writing `mart_qa.gm_*` (prefix `gm`), reading `mart.plan_*` and `mart.market_daily` read only. The app reads them through the existing `PLAN_DATASET_OVERRIDE=mart_qa` switch (`lib/plan/tables.ts` gets a `pacingMarket` name).

**Refresh wiring.** A new step in the n8n workflow `wf_clickup_to_bigquery` (id UHK8312UpMEEtnLm), after the `sp_refresh_plan_pacing` call, with its own error branch: `CALL mart.sp_refresh_plan_pacing_market()`. Separate so a market failure (ASSERT) never leaves the client Goals stale. Cost: plan tables are small and `market_daily` is about 13k rows, so well under 1 GB a run. Optionally also as the last line of the 05:30 `markets_refresh_daily` scheduled query, so the market rows pick up the new day without waiting for :45.

### 4.2 App files

| File | What |
|---|---|
| `lib/queries/planMarkets.ts` | reads `plan_pacing_market` (+ checks) for the client and period |
| `lib/plan/marketSplit.ts` | override application, recompute at another share (mirrors 279k), section visibility rule |
| `lib/plan/splitStore.ts`, `lib/plan/splitForm.ts` | Postgres `plan_market_splits` + validation |
| `lib/markets/guardrailStore.ts`, `lib/markets/guardrailForm.ts`, `lib/markets/guardrails.ts` | Postgres `market_guardrails`, validation, evaluation on `periodMetrics` / `marketCosts` output (trailing 28 d and month to date) |
| `components/plan/MarketsSection.tsx`, `MarketPaceRow.tsx`, `GuardrailChips.tsx` | Goals section, desktop rows and phone cards |
| `components/plan/PlanBody.tsx` | one insertion point (Month, Quarter) |
| `components/settings/MarketGoalSplit.tsx`, `MarketGuardrails.tsx`, `app/(app)/settings/actions.ts` | two blocks under Market costs, save actions |
| `components/markets/trends/GoalsGuardrails.tsx`, `lib/queries/marketsTrends.ts` | optional trends section |
| `lib/demo/planMarkets.ts`, `app/dev/goals-markets/page.tsx` | demo fixture (CZ/SK with drift, a new PL market, a residual) and dev harness, 404 in production |
| `scripts/check-plan-markets.ts` | parity TS vs SQL at default share, override renormalisation, guardrail bands, too early, n/a reasons, section hidden for one market, 375 px render |

### 4.3 Effort

| Work | Hours |
|---|---:|
| 302 shares + validity rules + QA copy | 5 |
| 303 market pacing (projection, z, status copied from 279k) + QA copy + regression | 9 |
| 304 checks + /health wiring | 2 |
| n8n step + deploy runbook | 2 |
| Query layer + `marketSplit.ts` + parity check | 6 |
| Goals Markets section (desktop, phone, drawer link) | 8 |
| Settings: split overrides + guardrails (stores, forms, actions) | 6 |
| Guardrail evaluation + checks | 4 |
| Trends section (optional) | 3 |
| Demo fixture, harness, browser QA at 1440 and 375 px, docs | 5 |
| **Total** | **50** (47 without the trends section) |

### 4.4 Risks

1. **Plan-layer migration trap.** Plan objects are `_v` views plus snapshot tables, and the next view reads the snapshot, not the view (279j, 283). This build adds new objects only and never replaces a plan view or `sp_refresh_plan_pacing`, so the trap cannot bite the client Goals. Inside the build: 302 must be built (CALL) before 303's view is created, 303 ends with its own CALL, and the app ships its reader only after 303 exists in prod (a missing table must render the section as absent, not crash the page).
2. **Refresh window.** Run 302 to 304 outside :45 to :50 UTC, when the n8n flow calls `sp_refresh_plan_pacing`. The shares procedure reads `plan_pacing` and `plan_targets_daily`; reading them while they are being swapped can fail the CALL.
3. **Two clocks.** Markets daily at 05:30, plan hourly. Mitigated by `as_of_m = LEAST(...)` and the "data to" label; between 00:00 and 05:30 UTC the market rows can trail the client tiles by a day.
4. **Plan vs markets reconciliation.** Manami +1.6 % revenue and +1 order on 1 to 14 Oct. Shown, not hidden; a check logs it above 2 %. If it grows, the fix is a shared order basis (plan_orders vs market_orders), a separate package.
5. **Bad default shares.** Manami SK LY share is about 2x its recent run-rate, and LY spend is 35 to 52 % unallocated. Mitigated by the validity rules, the drift chip and the override; still a decision (D1).
6. **Small-market noise.** SK has about 20 new customers a month. The z rule keeps statuses honest (mostly "On track" until the gap is real), and guardrails have a too-early gate; a Venev-size market never leaves "too early".
7. **TS mirror drift.** If 279k's formulas change later, `marketSplit.ts` must follow. The parity check fails the build when it does not.
8. **Scope creep into B.** A promo or checkpoint for one market is not split in v1; that is exactly B's job.

### 4.5 Owner inputs and actions

- Decisions D1 to D5 (summary below).
- Guardrail values per market in Settings (nothing is guarded until entered).
- Cost cards for Manami CZ and SK if the CM3 % guardrail should work (COST-CARDS.md; first-order GP after ads works without them).
- OK to deploy 302 to 304 to prod, OK for the n8n step, OK to merge and deploy the app.

## 5. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Manami Q4 basis: LY (SK 17 to 24 %) with the drift flag, or an override now (for example SK 12 %, between L90 9.4 % and October to date 16 %) | Override SK for Q4; keep LY as the default rule for every client |
| D2 | Where overrides live: Settings / Postgres (form, TS recomputes) or a BigQuery ref table (all SQL, console edits) | Settings, with the parity check |
| D3 | Guardrail values per market and the window: trailing 28 days for ratios, month to date for the new-customer minimum, warn band 15 % | As proposed; owner types the limits |
| D4 | Placement: Goals section in Month and Quarter only, or also the /markets/trends section | Both (trends gives Dobias and RawBark guardrails before they have plans) |
| D5 | Ad budget definition: the plan's `ad_spend` is Meta only for Manami while aMER uses Meta + Google. Split the budget on Meta only (as today), or move the plan to all paid spend | Confirm Meta only for the budget split now; aligning the plan definition is a separate plan-layer change |
