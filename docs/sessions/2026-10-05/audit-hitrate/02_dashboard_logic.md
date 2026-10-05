# Dashboard creative logic: how winners, losers, verdicts and hit rate are decided

Scope: repo `one-eighty-dashboard-repo`, branch `main` (prod). Read-only audit, nothing edited. Postgres and BigQuery were NOT queried: every "saved value" below comes from the scratchpad log of the 2026-10-05 Settings entry, not from the live `creative_settings` table.

Path convention: all paths are relative to `one-eighty-dashboard-repo/`. `dashboard/` is the Next.js app, `infra/bigquery/` the warehouse SQL. Each claim ends with `file:line`.

Short map of the four separate machines (details in sections 4, 5 and 7):

| Machine | Where it shows | Grain | Inputs | Anchor for shrinkage |
|---|---|---|---|---|
| Hit rate (launch cohort) | Creative tile and trend, Paid > Meta tile, Reports `hit_rate` `winners` `ads_launched` | ad, lifetime to date, bucketed by first delivery date | `mart.rpt_ad_launch` | stored trailing 365 day Meta ROAS of the client |
| Winners / Carriers / Losers tiles | Creative scorecard, Production page | ad, totals inside the selected date window | `mart.mart_creative_perf` | blended ROAS of the ads in the selected window |
| Money verdict (Scale, Hold, Iterate, Kill, ...) | Concepts page (concept cards and weekly ad set review) only | concept, ad set | window totals | blended ROAS of the window |
| Ad diagnosis (hook, bridge, body problem) | Creative grid and ad detail panel | ad, window totals | window totals | none (impressions based) |

---

## 1. Data

### 1.1 What an "ad" is
- An ad is one Meta `ad_id` at `level=ad`, `time_increment=1`, so one raw row per ad per day. `infra/n8n/wf_meta_ads_to_bigquery.json:132-139` (fields requested: `ad_id,ad_name,campaign_id,adset_id,spend,impressions,reach,frequency,clicks,ctr,cpc,actions,action_values,video_play_actions,video_thruplay_watched_actions`, line 139).
- The staging view keeps the latest ingested row per (client, ad, day): `infra/bigquery/live/stg.stg_meta_ad_insights.sql:3`, and only the last 60 months, `:5`. The marts expose the same 60 month window: `infra/bigquery/live/mart.mart_meta_ad_perf.sql:32`.
- Post-ID graduation or a duplicate across ad sets is a different `ad_id`, so it is a different ad. Two Creative-side tables carry it: `mart.mart_creative_perf` (grid, window totals) `infra/bigquery/223_mart_creative.sql:28-107`, and `mart.mart_meta_ad_perf` (feeds the hit rate table) `infra/bigquery/live/mart.mart_meta_ad_perf.sql:1-32`. Both read the same `stg_meta_ad_insights`.
- Ads with zero spend in the window are dropped from the grid: `dashboard/lib/queries/creative.ts:217` (`HAVING spend > 0`).

### 1.2 Purchases and revenue (what "purchase" means)
- `purchases` = `omni_purchase` count, else `purchase` count; `revenue` (stored as `purchase_value`) = `omni_purchase` action value, else `purchase`: `infra/n8n/wf_meta_ads_to_bigquery.json:156` (jsCode, `purchases:` and `purchase_value:` lines). The marts rename `purchase_value AS revenue`: `infra/bigquery/live/mart.mart_meta_ad_perf.sql:6`, `infra/bigquery/223_mart_creative.sql:66`.
- ROAS is always derived after summing: `dashboard/lib/creative/model.ts:207` (`roasRaw = revenue/spend`). Header rule: `model.ts:8-15`.

### 1.3 Attribution window (important, UNVERIFIED in code)
- The ingest request sets no `action_attribution_windows`, no `use_unified_attribution_setting`, and nothing that excludes existing customers (parameter list: `infra/n8n/wf_meta_ads_to_bigquery.json:132-141`; Graph API version `v22.0`, `:68`). So the window is whatever Meta applies by default to that ad account and API version. The repo does not pin it.
- The UI prints a hard-coded literal "7-day click · customers excluded": `dashboard/components/creative/CreativeBar.tsx:42` (rationale comment `:5-12`; same literal in `docs/creative-engine/DEMO.html:409`). Nothing in the code path enforces or reads that setting. `infra/bigquery/009_create_raw_meta_ads.sql:12` only says Meta restates attribution and the mart takes the latest `ingested_at`.
- Freeze risk: the hourly workflow pulls ONE window, yesterday, once data exists (`infra/n8n/wf_meta_ads_to_bigquery.json:28` Plan execution; trigger `:7`). A day is therefore re-pulled only during the following calendar day. Purchases attributed to that day after that (7 day click window) are not picked up unless someone runs a backfill. This is how the repo JSON reads; the live n8n workflow could differ (not checked).

### 1.4 Currency
- Money is in the Meta ad account currency (`ref.clients.meta_currency`), not the shop currency: `infra/bigquery/live/mart.mart_meta_ad_perf.sql:14`, `infra/bigquery/223_mart_creative.sql:68`. No FX conversion happens inside Creative.
- The Creative page uses the ad account currency: `dashboard/lib/creative/page.ts:114-117`. Known values: manami CZK, dobias USD, venev CZK: `infra/bigquery/213_client_ad_currency.sql:66-68`.
- ROAS, hit rate and shrinkage are currency free. Currency only matters for `targetCpa` (spend gates, section 2). The Settings form labels Target CPA with the SHOP currency: `dashboard/app/(app)/settings/page.tsx:379` (`currency={selected.currency}`) and `dashboard/components/settings/CreativeThresholds.tsx:91`. For Venev the shop currency is EUR but Meta bills in CZK (`213_client_ad_currency.sql:68`), so a CPA typed in that box is compared against CZK spend. (Venev CPA is currently unset, see 2.2.)

### 1.5 Launch date, pre-existing, relaunch, video vs static: `mart.rpt_ad_launch`
Built by `mart.sp_refresh_rpt_ad_launch` (migration `infra/bigquery/254_rpt_ad_launch.sql:87-196`; the live copy `infra/bigquery/live/mart.sp_refresh_rpt_ad_launch.sql:1-110` was diffed against it and is identical). One row per (client_id, ad_id).
- Source rows: `mart_meta_ad_perf`, last 60 months, `date < CURRENT_DATE()` (today excluded): `254:107-112`.
- **Launch date** `first_date` = first day with `impressions > 0`: `254:131`. Ads with no impression day are dropped: `254:141`. `last_date` `:132`, `active_days` `:133`.
- **Lifetime totals**: sum of spend, revenue, purchases, impressions, video starts over all loaded days: `254:134-138`.
- **Age**: `age_days = through - first_date`, where `through` is the client's latest loaded day: `254:155`, `through` `:115`. It is NOT computed against today, so it freezes between refreshes.
- **Pre-existing**: `first_date <= history_start + 2 days`, with `history_start` = the client's first impression day in the table: `254:156`, `:115`. A heuristic: the first three days of every client's history are always treated as "already running". Counts at design time: Dobias 6, Ethia 1, Manami 3, Venev 7 (`254:67`).
- **Video vs static** `is_video` = `video_plays > 0` over the whole lifetime, where `video_plays` = `video_play_actions` (video starts): `254:157`, `:138`. (Other screens use other rules, see 6.3.)
- **Relaunch**: asset key = `COALESCE(NULLIF(video_id,''), NULLIF(image_hash,''), NULLIF(effective_object_story_id,''), NULLIF(creative_id,''))` from `mart.mart_creative_asset`: `254:143-149`. An ad is a relaunch when it is not the first (ordered by `first_date`, then `ad_id`) ad of its asset key within the client: `254:159-160`. Unknown asset key means FALSE: `254:159` (`IFNULL(...)`). The asset row is the latest creative snapshot of the ad: `infra/bigquery/live/stg.stg_meta_ad_creatives.sql:2-6`.
- **Prior ROAS** `prior_roas` = client sum(revenue)/sum(spend) over the 365 days ending at `through`: `254:118-124`.
- **Concept** from `ref.creative_tags` and `ref.concepts`: `254:161, 169-171`.
- **Refresh safety**: ASSERTs on rows > 0, rows >= 90 % of previous, no duplicate key, `MAX(through) >= today - 2`: `254:181-188`; atomic swap `254:191-193`.
- **Scheduling gap**: the daily scheduled query is NOT in the repo and was an open owner action at deploy time: `infra/bigquery/254_rpt_ad_launch.sql:45-48, 201-205`; `scratchpad/reports/hr1.md:38,43` ("Not scheduled yet ... table is a snapshot of 2026-10-05"). Whether the owner created it afterwards is unknown. Until it exists, lifetime totals, `age_days` (maturity) and prior ROAS in every hit rate surface are frozen at that snapshot.
- **Ethia relaunch gap**: Ethia has 0 rows in `mart_creative_asset`, so no ad of Ethia can be a relaunch: `254:28-29`; `scratchpad/40_hit_rate_design.md:20,391`. Ethia's denominator is therefore not deduplicated the way Dobias (23 relaunches) and Manami (39) are: `254:67-68`.

---

## 2. Thresholds

### 2.1 Every field, default, and use
Stored per client in Postgres `creative_settings`: DDL `dashboard/lib/creative/store.ts:30-73`; code defaults `store.ts:226-237`; the engine interface `dashboard/lib/creative/stats.ts:41-73`.

| Field (UI label) | DB / code default | Used where |
|---|---|---|
| `killRoas` (Kill ROAS) | none (null), `store.ts:37` | `classify` loser/carrier line `model.ts:352-358`; `moneyVerdict` kill and not-separable `verdict.ts:225,263`; grid tile red/neutral `CreativeGrid.tsx:246,254`; detail ROAS dot `AdDetail.tsx:990` |
| `targetRoas` (Target ROAS) | none, `store.ts:38` | `classify` winner `model.ts:351`; verdict scale lines `verdict.ts:232,278,287,296`; grid tone `CreativeGrid.tsx:244` |
| `targetCpa` (Target CPA) | none, `store.ts:39` | every spend gate (below); velocity model `lib/creative/velocity.ts:66`. Must be non-null for ANY judgement: `store.ts:332` |
| `readPurchases` (Read at) | 25, `store.ts:54,233` | winner purchase gate, shrinkage weight k, Read confidence: `model.ts:309-312,351`, `stats.ts:57,118-125` |
| `directionalPurchases` (Directional at) | 10, `store.ts:55,233` | Directional confidence `stats.ts:123`; loser gate `model.ts:356`; grid "readable" `CreativeGrid.tsx:241`; Breakdown `readable` `breakdown/page.tsx:142`; `separation()` `stats.ts:198` |
| `killGateX` | 3, `store.ts:46,230` | loser spend gate `model.ts:358`; kill spend gate `verdict.ts:263`. **No Settings field**: the form never posts it (`CreativeThresholds.tsx:88-143`, `settings/actions.ts:103-127`), so it is the default 3 unless someone edits the DB |
| `holdGateX` | 1, `store.ts:44` | "Needs more data" spend gate `verdict.ts:172`. No Settings field |
| `iterateGateX` | 2, `store.ts:45` | Iterate spend gate `verdict.ts:305`. No Settings field |
| `scaleMultiplier` | 1.2, `store.ts:42` | scale at target x 1.2 `verdict.ts:232,287`, hold zone upper edge `:300`. No Settings field |
| `aggressiveMultiplier` | 2.0, `store.ts:43` | "Scale hard" at target x 2.0 `verdict.ts:278`. No Settings field |
| `noTouchDays` (No-touch days) | 14, `store.ts:51` | "Too early" `verdict.ts:155-163`; velocity pack length `velocity.ts:68` |
| `maxCiHalfWidth` (Max interval %) | 0.25, `store.ts:59` | only `purchasesForPrecision` (84 purchases at 25 %: `stats.ts:158-160`), the Settings hint `CreativeThresholds.tsx:77,111` and the Concepts capacity statement `concepts/page.tsx:204-210`. **It does not gate any verdict**, although `stats.ts:61` and `verdict.ts:128-131` describe it as the NOT SEPARABLE trigger |
| `hookRateFloor` (Hook rate floor %) | 0.20, `store.ts:61,234` | `diagnose` hook problem `verdict.ts:405` |
| `holdRateFloor` (Hold rate floor %) | 0.05, `store.ts:62,234` | `diagnose` bridge problem `verdict.ts:414` |
| `frequencyWarn` / `frequencyAct` | 2 / 3, `store.ts:63-64` | defined in the interface `stats.ts:66-67`, **not read by any code**; no Settings field |
| `breakEvenRoas` (Break-even ROAS) | none, `store.ts:36` | stored and shown only. Not in `CreativeThresholds` (`stats.ts:41-73`), not read by any verdict, tile or the hit rate |
| `grossMargin` (Gross margin %) | none, `store.ts:40` | only `contributionMargin` on the Production page `lib/creative/cost.ts:123-127`, `production/page.tsx:100`; not part of any verdict |
| `testPurchases` (Test size) | 25, `store.ts:66` | velocity/pack model only: `velocity.ts:66,76-79`, `velocity/page.tsx:63`. Not a verdict input |
| `minAdsetBudgetDaily`, `perAdFloorDaily`, `monthlyBudget`, `tier`, `packsPerMonthTarget`, `hooksPerBodyTarget`, `netNewShareTarget` | various | velocity and production planning only (`velocity/page.tsx:63-71`, `velocity.ts:46,286-292`); no verdict input |

Hard-coded constants that are NOT thresholds: Z = 2.29 (`stats.ts:31`); learning gate 50 purchases at ad set level (`verdict.ts:193`); hold zone starts at target x 0.9 (`verdict.ts:296`); "Check tracking" at 1.5 x CPA (`verdict.ts:145`, `:389`, `:423`); unresolvable multiple 10 (`verdict.ts:120`); minimum 5,000 impressions for a diagnosis (`verdict.ts:373`); maturity 60 days (`hitRate.ts:31`); reference 5 % (`hitRate.ts:34`).

Save behaviour: a blank Read-at, Directional-at, No-touch or floor field is silently written as its default (25, 10, 14, 20 %, 5 %, 25 %): `settings/actions.ts:116-126`.

### 2.2 Saved per client (from `scratchpad/reports/thresholds_entry.md:25-30`, entered 2026-10-05; UNVERIFIED against Postgres)

| Client | Kill | Target ROAS | Target CPA | Break-even | Gross margin | Read at (k, winner N) | Directional at |
|---|---|---|---|---|---|---|---|
| dobias | 1.50 | 3.00 | 54 USD | 1.51 | 80 % | 25 (default) | 10 (default) |
| ethia | 1.70 | 2.50 | 550 CZK | 1.66 | 73 % | 10 | 5 |
| manami | 1.80 | 2.25 | 527 CZK | 1.46 | 68.4 % | 15 | 6 |
| venev | 1.90 | 2.10 | NOT SET | 1.89 | empty | 10 | 5 |

Everything else untouched, i.e. default: max interval 25 %, hook floor 20 %, hold floor 5 %, no-touch 14, test size 25, kill gate 3 (`thresholds_entry.md:22`). The proposal that produced these numbers, with the rules (target = max(1.5 x break-even, 12 month ROAS) rounded up to 0.25; N = p90 of lifetime purchases per ad clamped 10..25; kill = Meta-basis break-even; directional = max(5, round(0.4 N))): `scratchpad/40_hit_rate_design.md:51-62`.

Consequences, derived from the code:
- **Venev has no Target CPA, so `toThresholds()` returns null** (`store.ts:331-332`). For Venev: no hit rate (Creative tile n/a "Set thresholds", `hitRate.ts:269-271`; trend "Set thresholds in Settings", `HitRateTrend.tsx:287`; Reports `not_measured` "No thresholds", `lib/reports/evaluate.ts:450`), no Winners/Carriers/Losers (`creative/page.tsx:165`), no verdicts. METRICS.md amendment 25 nevertheless quotes "Venev 0 of 9 (all open)" (`METRICS.md:610-611`, item 5); that was measured before the CPA gap existed or with harness thresholds, and does not match the saved state.
- Spend gates at the saved CPAs (kill gate 3x, hold gate 1x, iterate gate 2x): Dobias 162 / 54 / 108 USD; Ethia 1,650 / 550 / 1,100 CZK; Manami 1,581 / 527 / 1,054 CZK.
- Hold zone lower edge is target x 0.9: Dobias 2.70, Ethia 2.25, Manami 2.025. Scale at target x 1.2: 3.60 / 3.00 / 2.70. Scale hard at x 2.0: 6.00 / 5.00 / 4.50.

---

## 3. Shrinkage and confidence

- Formula: `reported = (n * observed + k * account_mean) / (n + k)`, `n` = purchases (floored at 0), `k` = `readPurchases`: `dashboard/lib/creative/stats.ts:88-97`. Non-finite observed returns the account mean: `stats.ts:94`.
- Prior (account mean): which number is used depends on the surface.
  - Grid, scorecard, Concepts, Breakdown, Production: blended ROAS of the ads delivered in the selected window = sum(revenue)/sum(spend), fallback `targetRoas ?? 1` when there is no spend: `lib/creative/model.ts:413-423`, built at `lib/creative/page.ts:128`.
  - Hit rate (all four places): the stored `prior_roas`, trailing 365 days of the client's Meta ROAS: `infra/bigquery/254_rpt_ad_launch.sql:118-124`, applied in `hitRate.ts:73-83`. Docstring: it does not move with the date range, `hitRate.ts:19-20`.
- Zero purchases: the grid reports NO ROAS (null) instead of the prior: `model.ts:309-312`. `classify()` still runs `shrink` with n = 0 but cannot return winner/carrier then (needs `purchases >= readPurchases`, `model.ts:351-352`).
- Interval: relative 95 % half-width `h = 2.29 / sqrt(n)` (below 1 purchase: 9): `stats.ts:31,106-108`; interval `[max(0, roas(1-h)), roas(1+h)]`: `stats.ts:111-114`. The interval is built around the already-shrunk ROAS: `model.ts:313`.
  - Numbers: h = 0.724 at n = 10, 0.591 at n = 15, 0.458 at n = 25 (derived).
- Confidence class: `read` if purchases >= `readPurchases`, `directional` if >= `directionalPurchases`, else `noise`: `stats.ts:118-125`.
- Effective raw ROAS needed to be a winner at exactly n = k purchases is `2 x target - prior` (derived from `model.ts:349-351` and `stats.ts:96`), using the design-time priors (Dobias 2.842, Ethia 2.283, Manami 2.029, as of 2026-10-04, `scratchpad/40_hit_rate_design.md:78`): Dobias raw >= 3.158 at 25 purchases; Ethia raw >= 2.717 at 10; Manami raw >= 2.471 at 15. At n = 2k the bar relaxes to `(3 x target - prior)/2`: 3.079 / 2.609 / 2.361. As n grows the bar tends to the target. These priors move daily with the trailing 365 days.

---

## 4. Outcome classification and per-period verdicts

### 4.1 `classify()` exactly (`dashboard/lib/creative/model.ts:342-363`)
Inputs: one entity's summed components, an account mean ROAS, thresholds.
1. raw ROAS = revenue / spend; if spend is 0, return `open`: `:347-348`.
2. `roas = shrink(raw, purchases, accountMean, readPurchases)`: `:349`.
3. **winner**: `purchases >= readPurchases` AND `roas >= targetRoas`: `:351`.
4. **carrier**: `purchases >= readPurchases` AND `roas >= killRoas` (and below target by fall through): `:352`.
5. **loser**: `purchases >= directionalPurchases` AND `roas < killRoas` AND `spend >= killGateX x targetCpa`: `:355-361`.
6. Everything else: **open**: `:362`. This `open` means "not enough evidence or spend", not "too young".

### 4.2 Where `classify()` is applied
- Hit rate: the ad's LIFETIME totals, prior = stored 365 day ROAS, only the winner outcome matters: `hitRate.ts:73-83`. Only `spend`, `revenue`, `purchases` are filled in the component record, so the ONLY gate that can ever fire for a winner is purchases and shrunk ROAS: `hitRate.ts:75-79`.
- Scorecard Winners / Carriers / Losers: `winnerEconomics(data.ads, account.meanRoas, thresholds)` over the ads with delivery in the selected window, using window totals and the window blended ROAS: `dashboard/app/(app)/creative/page.tsx:165`, `model.ts:375-390`. "Decided" = winners + carriers + losers: `model.ts:387`. Tile copy: `creative/page.tsx:219-234`. Tile info for Losers says "Below the kill line", which omits the purchase and spend gates (`:230-234` vs `model.ts:355-359`).
- Production page: winners per group, "Net-new hit rate", "Ads per winner", "Wasted spend per winner", same window anchor: `production/page.tsx:118-143, 239-257`.
- `AdView.outcome` is computed per ad (`view.ts:212`) but no component renders it (searched `app`, `components`).

### 4.3 What the Creative GRID does per ad (no money verdict)
- Ad level never gets Scale/Hold/Iterate/Kill; header rule `verdict.ts:17-22`. Each tile shows shrunk ROAS and a confidence chip: `CreativeGrid.tsx:339-350`.
- Tile tone is its own rule, not `classify`: muted if `purchases < directionalPurchases`; accent (positive) if shrunk ROAS >= target; negative if shrunk ROAS < kill; else neutral: `CreativeGrid.tsx:241-256`. No `readPurchases` gate, no spend gate. Without thresholds target = Infinity and kill = 0 so nothing is coloured: `store.ts:306-329`, `creative/page.tsx:298-303`.
- Detail panel dots: ROAS good if shrunk >= target, warn if >= kill, else bad, no purchase gate: `AdDetail.tsx:985-992`. CPA good if raw CPA <= target, warn if <= target x 1.25, else bad (raw CPA, not shrunk, unrelated to the 3x gate): `AdDetail.tsx:976-983`.
- Grid order is spend descending (query `ORDER BY spend DESC`, `creative.ts:218`); nothing sorts by ROAS: `model.ts:269-272`.
- The window is the page date range, default **all time** (60 months) for every Creative screen: `lib/creative/page.ts:77-78`, `lib/params.ts:73-75`, `lib/period.ts:195-200`.

### 4.4 `diagnose()` (ad level, `verdict.ts:368-438`)
Order of checks:
1. impressions < 5,000: "Not enough delivery": `:373-381`.
2. Not a video (format tag is not exactly `DYN`, `vocabulary.ts:92-94`): if purchases = 0 AND spend >= 1.5 x CPA then "Body problem" (iteration type 4), else "Judge on CTR" (type 2): `:388-403`.
3. Video: hook rate < `hookRateFloor` then "Hook problem" (type 1): `:405-412`.
4. hold rate < `holdRateFloor` then "Bridge problem" (type 2): `:414-421`. Note `holdRate` is not null-gated on video plays, `model.ts:213` vs hook `:212`, so a DYN ad with impressions but no ThruPlays data reads hold 0 % and lands here.
5. purchases = 0 AND spend >= 1.5 x CPA: "Body problem" (type 4): `:423-430`.
6. else "Earning attention": `:432-437`.
- `format` = the ClickUp `Format` tag, else inferred from the asset (video asset or `VIDEO` object type = `DYN`, `DPA`, any other object type = `STAT`): `view.ts:190,274-280`. `CAR` (carousel) counts as no video metrics.
- Grid and detail show hook and hold only when `format === "DYN"`: `view.ts:218-219`, `CreativeGrid.tsx:353-361`.

### 4.5 `moneyVerdict()` (ad set and concept level, `verdict.ts:134-322`)
Used ONLY on the Concepts page: concept cards `concepts/page.tsx:169-173` (level "concept") and the weekly ad set review `concepts/page.tsx:228-251` via `toAdsetView` (`view.ts:322-352`, level default = ad set). Both are skipped (`unjudgedVerdict`, "Not judged") when `toThresholds()` is null: `concepts/page.tsx:63,170-172,411`. Input ROAS is the shrunk ROAS with the window anchor (`read()` `model.ts:292-324`).
Order, first match wins:
1. spend <= 0: "No data": `:139-141`.
2. purchases = 0 AND spend >= 1.5 x CPA: "Check tracking" (data-missing, explicitly not a kill): `:145-152`.
3. `ageDays < noTouchDays` (null age is treated as outside the window): "Too early": `:155-163`.
4. spend < holdGateX x CPA: "Needs more data", price = missing spend: `:172-182`.
5. ad set level only: purchases < 50: "Learning": `:193-200`.
6. roas null: "No data": `:202-204`.
7. Not separable: roas > kill AND lower bound of the interval <= kill AND roas < target x scaleMultiplier: "Not separable"; carries a price (`spendToDecide`) unless the price exceeds 10x the entity's own spend, then "treat as break-even": `:225-258`, `stats.ts:144-147,170-179`. This blocks only the dangerous direction: a wide interval blocks a kill and never a scale (rationale `:208-224`).
8. Kill: roas <= kill AND spend >= killGateX x CPA: `:263-276`.
9. Scale hard: roas >= target x aggressiveMultiplier: `:278-285`.
10. Scale: roas >= target x scaleMultiplier: `:287-294`.
11. Hold: roas >= target x 0.9: `:296-303`.
12. Iterate: roas > kill AND spend >= iterateGateX x CPA: `:305-312`.
13. Otherwise "Hold" ("Too noisy to iterate yet"): `:316-321`. This includes a below-kill row that has not yet reached the kill spend gate.
At concept level the 50-purchase learning gate (step 5) is skipped: `:184-193`.

### 4.6 How the per-period grid logic differs from the lifetime hit rate
| Aspect | Grid / scorecard / verdicts | Hit rate winner |
|---|---|---|
| Totals | window sums (default all time, user can pick 7d, 30d, ...) | lifetime to the table's `through` day |
| Anchor | blended ROAS of ads delivered in the window | stored trailing 365 day client ROAS |
| Population | any ad with spend in the window, incl. old, relaunched and pre-existing ads | ads first delivered in the period, no pre-existing, no relaunch |
| Gates used | winner: read purchases + target; loser also directional + 3x CPA | winner only: read purchases + target |
| "open" | not enough evidence or spend | not a winner AND `age_days < 60` (`hitRate.ts:81-82`) |
| Needs CPA | yes, via `toThresholds` | yes (same gate), but CPA is not used in the winner test |

The design document states the intent: the grid verdicts "answer a different question" (`scratchpad/40_hit_rate_design.md:252`).

---

## 5. Hit rate

### 5.1 Definition (`dashboard/lib/creative/hitRate.ts`)
- **launched** = ads whose first delivery falls in the period, not pre-existing, not a relaunch: `eligible()` `:86-93`, `inRange()` `:95-97` (by `firstDate`).
- **winner** = `launchStatus() === "winner"`: `classify()` on lifetime totals with `priorRoas`: `:73-83`. `launchStatus` order: if `priorRoas !== null` and classify says winner then winner; else `open` if `ageDays < 60`, else `settled`: `:73-83`. No prior means never a winner: `:74,82`.
- **hit rate** = winners / launched, pooled (sum over sum), null when there are no launches or no thresholds: `:111-130`. "Open" and "maturing" are reported but are NOT removed from the denominator: `:123-129`. Hit rate is therefore a lower bound while any launch is open.
- **No thresholds** (no kill, target or CPA): winners, open and rate are null, never 0: `:112-114`.
- **Maturity**: `HIT_RATE_MATURITY_DAYS = 60`: `:31`. Evidence in the design doc: 26 of 29 current winners (90 %) had qualified by day 60: `scratchpad/40_hit_rate_design.md:256-263`.
- **Reference line** 5 % is "not an industry benchmark": `:33-34`.
- Exclusions: pre-existing and relaunch both leave numerator and denominator: `:85`; SQL left join drops pre-existing already: `queries/creativeLaunch.ts:86`. Ads without a prior are in the denominator but cannot win. Format filter (`all|video|static`) is applied only in `launchMonths`: `:166-187,86-93`.
- Period semantics = LAUNCH COHORT: the period selects when ads first delivered; winners are judged on lifetime totals up to the table's `through` day, not on performance inside the period.

### 5.2 Surfaces and how they compute it
- **Creative page tile** "Hit rate": `hitRate(inRange(launched.rows, ctx.params.range), thresholds)` then `tileText`: `creative/page.tsx:132-133, 237-246`. Value `winners/launched` one decimal; sub `W of N launched` plus `· n open`: `hitRate.ts:275-281`; tooltip text `:283-285`.
  - Default range is ALL TIME on the Creative screen (`lib/creative/page.ts:77-78`).
  - Delta vs comparison: `prevHit = hitRate(inRange(rows, comparison), thresholds)` (same CURRENT thresholds); shown in percentage points only when the previous period launched something: `creative/page.tsx:137-140, 244`, `primitives.tsx:222-229`. **No maturity suppression** here.
  - The launch read reaches back to the comparison start: `creative/page.tsx:113-126`.
- **Trend** "Hit rate by launch month": last 12 months ending at the table's `through` (`hitRate.ts:36,148-159,166-187`), each month pooled the same way; maturing months hatched; inRange month highlighted; format filter via `hrfmt` URL param: `HitRateTrend.tsx:262-312`, `creative/page.tsx:129-130,278-290`. Month = month of first delivery.
- **Concept split**: shown only when >= 50 % of launches in range carry a concept id; uses range rows, all formats: `hitRate.ts:40,204-230`, `creative/page.tsx:146-147`. Tagging: 16 % of Manami launches, 0 % Dobias and Ethia at design time (`scratchpad/40_hit_rate_design.md:21`).
- **Paid > Meta tile**: same function and the same `getLaunches`, over the Paid page range (default 30 days): `app/(app)/paid/meta/page.tsx:98,116-122,168-172`. No delta. `HitRateTile.tsx:21-54`. Missing thresholds link to Settings: `:40`.
- **Reports** (`hit_rate`, `winners`, `ads_launched`): `lib/reports/registry/metrics.ts:499-521`.
  - Mart `ad_launch` = `mart.rpt_ad_launch`, date column `first_date`, grains day/week/month, entity key `ad_id`, SQL WHERE excludes `is_preexisting` and `is_relaunch`: `lib/reports/registry/components.ts:50-58`, `lib/reports/compile.ts:408-445`.
  - One row per ad with inputs (purchases, spend, revenue, age_days, prior_roas) via `ANY_VALUE`: `compile.ts:424-429`, component defs `components.ts:214-225`. Each ad is classified before summing by `launchStatus()` into 0/1 launched, winners, open: `lib/reports/evaluate.ts:313-345`. Thresholds come from `toThresholds(getCreativeSettings())` per request and never enter SQL or the cache key: `app/api/reports/query/route.ts:180-189`.
  - Rollup = sum of winners / sum of launched, each client against its own bar; a client without thresholds is `not_measured` "No thresholds" and left out with a coverage note: `evaluate.ts:450,60-69`, doc `METRICS.md:507,610`. `ads_launched` needs no thresholds: `components.ts:221`.
  - Maturity: caveat "Launches under 60 days old still open" when open > 0 in the current total: `evaluate.ts:609`, `registry/caveats.ts:26`. Comparison delta (percentage points) is **suppressed** when the current period has open launches and the comparison has none: `evaluate.ts:716-723`.
  - Reports has no format (video/static) split and no concept split.
- `WinnerEconomics.hitRate` (`model.ts:388`, winners / ads in window) exists but no page uses it (searched `app`, `components`, `lib`).

### 5.3 Worked outputs recorded by the repo (design time, 2025-10-01 to 2026-09-30)
Dobias 6 of 35 (17.1 %), Ethia 7 of 156 (4.5 %), Manami 9 of 122 (7.4 %), Venev 0 of 9 all open; combined 22 of 322 (6.8 %): `METRICS.md:610` item 5; `scratchpad/40_hit_rate_design.md:102`. Sensitivity of Ethia to N: 7 winners at N = 10, 3 at 15, 1 at 25: `40_hit_rate_design.md:107-114`.

---

## 6. Hook and hold rate, soft metrics

### 6.1 Definitions in the Creative engine
- `hookRate = videoViews / impressions`, `videoViews` = 3-second plays (`actions[video_view]`), only when the ad has video starts (`videoPlays > 0`) in the window: `lib/creative/model.ts:183-189,212`, component `model.ts:43-44`. Ingest: `video_views: pick(r.actions,'video_view')` and `video_play_actions: pick(r.video_play_actions,'video_view')` (video starts): `infra/n8n/wf_meta_ads_to_bigquery.json:156`.
- `holdRate = videoThruplays / impressions` (ThruPlay = 15 seconds or the whole video if shorter): `model.ts:190,213`, `model.ts:52`.
- Both use ALL impressions of the ad in the window as the denominator: `model.ts:212-213`.
- Other soft metrics shown: all-click CTR `div(clicks, impressions)` and link CTR `div(linkClicks, impressions)` (`model.ts:214-216`, ratio explanation `:193-201`), outbound CTR hidden unless reported (`:214`). 

### 6.2 Thresholds on soft metrics
- Hook floor 20 % and hold floor 5 % (Settings defaults `store.ts:61-62`, saved clients untouched: `thresholds_entry.md:22`). Used only in `diagnose` (`verdict.ts:405,414`), minimum 5,000 impressions (`:373`).
- No other hard-coded creative soft-metric thresholds exist (frequency warn/act are defined but unused, 2.1).
- **Calibration mismatch (high value finding)**: the brief that set the 20 % floor defined hook rate as `video_play_actions / impressions`, i.e. video STARTS: `CREATIVE_ENGINE_BRIEF.md:335-336`, default floor `:245`. On 2026-10-05 the code switched the numerator to 3-second plays (owner decision D2): `METRICS.md:618`, `model.ts:183-189`. Sep 2026 account-level hook rate went from 52 / 81 / 34 / 68 % (starts) to 17.3 / 25.9 / 11.2 / 18.8 % (3s plays) for Dobias / Ethia / Manami / Venev: `METRICS.md:618`. The floor was not changed, so an average video ad at Dobias, Manami or Venev now sits below the 20 % "Hook problem" floor.

### 6.3 Three different "is video" rules
1. Grid and diagnosis: ClickUp `Format` tag equals `DYN`, else asset inference: `view.ts:190,274-280`, `vocabulary.ts:92-94`; hook is null if no video starts in the window `model.ts:212`.
2. Hit rate trend format filter: `is_video` = video starts > 0 over the ad's lifetime: `254_rpt_ad_launch.sql:157`.
3. Paid > Meta and Reports hook/hold: an ad is video if it started any video in the selected period (per ad, over the period); numerator 3s plays, denominator impressions of those ads: `lib/queries/paidMeta.ts:107-112,121-143`, `lib/reports/registry/components.ts:195-209,79`, `lib/reports/registry/metrics.ts:462-475`.

---

## 7. Inconsistencies and risks an auditor should compare against the agency engine

Ordered roughly by impact.

1. **Four "winner" counts that can disagree.**
   - Hit rate (launch cohort, lifetime, 365 day prior): `hitRate.ts:73-83`.
   - Scorecard Winners/Carriers/Losers (window totals, window mean prior, all delivering ads, relaunches included): `creative/page.tsx:165`, `page.ts:128`, `model.ts:413-423`.
   - Production "Net-new hit rate" and "Ads per winner" (window mean prior; denominator = ads with delivery or net-new ads with delivery): `production/page.tsx:118-143,239-246`. It is called a hit rate and compared with the 5 % reference (`:230-234`), but it is not the tile.
   - Grid tile colour and detail dots (directional gate only, no read gate): `CreativeGrid.tsx:241-256`, `AdDetail.tsx:985-992`. An ad with 10 to 24 purchases (Dobias defaults) can be green on the wall while not counted as a winner anywhere.
   The code comments claim the badge and the hit rate "cannot disagree" (`hitRate.ts:12-15`); that is only true for the same totals and the same anchor, which is not the case between the grid (window anchor) and the tile (stored 365 day anchor). The harness check proves function equality, not UI equality (`scripts/check-creative-hitrate.ts:95-109`).
2. **Different shrinkage anchors.** Window blended ROAS (all time by default) vs stored trailing 365 days: `page.ts:77-78,128` vs `254:118-124`. At the default all-time range the two can differ materially for clients whose ROAS drifted.
3. **Venev reads nothing** because Target CPA is unset (`store.ts:331-332`), although winner/hit rate logic does not use CPA at all (`hitRate.ts:75-79`, `model.ts:351`). Also, while CPA is null the display thresholds set `targetCpa = 0` (`store.ts:310`), so `diagnose()` sees `spend >= 1.5 x 0` and flags EVERY zero-purchase ad with 5,000+ impressions as "Body problem" (`verdict.ts:389,423`), i.e. a diagnosis that depends on a threshold that is absent.
4. **Hook floor 20 % vs 3-second hook rate**: see 6.2. Likely over-flags "Hook problem".
5. **Ad set age is window-clamped.** `AdsetRow.ageDays = DATE_DIFF(CURRENT_DATE(), MIN(date))` over the selected window only: `queries/creative.ts:236-237`, and the code's own warning `:726-738`. With a 7-day range every ad set (even mature) gets age ~7 < 14 no-touch days and the weekly review/concept cards say "Too early" (`verdict.ts:155`, `concepts/page.tsx:129-134`). At 30 days or more it is fine, at the default all time it reflects true age within 60 months.
6. **Attribution label is a literal**, not a fact (1.3). Unknown real window, no pinned `action_attribution_windows`, and incremental ingest freezes each day after one day (`wf_meta_ads_to_bigquery.json:28`). This affects purchases, ROAS, winners and hit rate alike, and makes recent cohorts look worse until a backfill.
7. **No scheduled refresh of `rpt_ad_launch`** in the repo; at deploy it was an open owner task (`254:45-48`, `hr1.md:38`). Maturity (`age_days`), lifetime totals and the prior then stay at the snapshot day while the grid (live views) keeps moving. The Creative page prints `through` (`CreativeBar.tsx:49-53`, from `mart_creative_perf` max date), not the table's `refreshed_at`, so a stale tile is invisible.
8. **Relaunch coverage differs by client.** Ethia has no asset rows, so no deduplication (`254:28-29`); Dobias and Manami lose 23 and 39 ads from both sides. Hit rates are not like for like across clients.
9. **Pre-existing is a three-day heuristic** at each client's history start (`254:156`), so a client's genuine first launches are excluded, and the history start is a function of how far the backfill went.
10. **Delta handling differs by surface.** Creative tile delta has no maturity suppression (`creative/page.tsx:244`), Reports suppresses it (`evaluate.ts:716-723`), the Paid tile has none (`HitRateTile.tsx`). The comparison period's hit rate uses TODAY's thresholds (`creative/page.tsx:137-140`).
11. **Default ranges differ**: Creative screens open on all time (`page.ts:77-78`), Paid and Reports default to 30 days (`params.ts:45`). "Same range, same number" holds only when the range is the same; the Paid tile links to Creative with the range carried over (`paid/meta/page.tsx:170`).
12. **Format split only in the trend**, and only by lifetime video starts (`hitRate.ts:86-93`, `254:157`). Tile, Paid and Reports are all-format.
13. **Documentation drift.**
    - `METRICS.md:503` still defines hook rate as `video_play_actions / impressions`; amendment 24 changed it to 3s plays (`METRICS.md:618`).
    - `infra/bigquery/223_mart_creative.sql:78` comment calls `video_play_actions` "3s+, the hook-rate numerator" (it is starts).
    - `stats.ts:61` and `verdict.ts:128-131` describe `maxCiHalfWidth` as gating NOT SEPARABLE; the code gates on whether the lower bound crosses the kill line instead (`verdict.ts:225`).
    - Settings hint for Directional ("Below this a row is greyed and hatched", `CreativeThresholds.tsx:108`) is only true on the grid and Breakdown opacity.
14. **Currency units of Target CPA** are labelled with the shop currency, compared with Meta-currency spend (1.4). Matters for Venev (EUR label, CZK spend) once CPA is entered; a typed 783 (CZK, per `thresholds_entry.md:34`) would be read as EUR in the form.
15. **Config that is stored but inert**: `breakEvenRoas`, `frequencyWarn`, `frequencyAct`, `maxCiHalfWidth` for verdicts, `tier`; and multipliers and gates that exist in the DB but are not editable in Settings (`killGateX`, `holdGateX`, `iterateGateX`, `scaleMultiplier`, `aggressiveMultiplier`). The agency engine's gate multiples can only be matched by these defaults.
16. **Ad level is deliberately never a money verdict** (`verdict.ts:17-22`); money verdicts exist only for concept and ad set on the Concepts page. If the agency engine judges at ad level or per pack, there is no like-for-like dashboard object.
17. **Not-live / not-checked**: the live n8n workflow, the live Postgres thresholds, whether the scheduled refresh exists, and current prior ROAS values.

Tests the repo already carries (for the auditor's reuse): `dashboard/scripts/check-creative-hitrate.ts` (fixtures for gates, 59/60 day maturity, relaunch exclusion, grid parity of `launchStatus` with `classify`), `dashboard/scripts/check-reports-eval.ts:909-927,1013-1023` (Reports equals tile), `dashboard/scripts/check-creative-engine.ts` (verdict and diagnose fixtures), `infra/bigquery/qa/254_rpt_ad_launch_regression.sql`.
