# Audit: Meta creative engine (SOP v3) vs dashboard winner and hit-rate logic

Date: 2026-10-05. Read-only. Inputs: `01_engine_rules.md`, `02_dashboard_logic.md`, `40_hit_rate_design.md`, spot checks of `07-analyzing.md`, `_clients/manami/learnings/meta-ads.md`, `dashboard/lib/creative/{hitRate,model,stats}.ts`, `CreativeBar.tsx`. Data: BigQuery `mart.rpt_ad_launch` (snapshot refreshed 2026-10-05, `through` = 2026-10-04), `mart.mart_meta_ad_perf`, `mart.mart_meta_campaign_perf`, `raw.raw_meta_ad_insights`. Scratch tables (expire 2026-10-19): `mart_qa.aud_daily`, `mart_qa.aud_weekly`, `mart_qa.aud_eval`. Nothing in the repo, SOP, Settings or warehouse marts was changed.

## 0. Verdict in one paragraph

**APPROVE WITH CHANGES.** The dashboard's winner rule (lifetime purchases >= N and shrunk ROAS >= Target) is the better of the available definitions: it names 5 of 5 ads the team itself calls winners (Dobias "WIN"-tagged ads, MitoBoost TOF, Manami `Něžná - 13MAR - OE` and `NicheScentLover - Testovaci sada`), while the SOP v3 Winner Definition taken literally names 1 of 5 and promotes ads the team calls weak (Dobias `GutSense VSL 6JUN`, lifetime 2.55 vs target 3.00) or that sit below the kill line (Manami `Něžná (Vyměňte chemii) SK`, lifetime 1.63). The SOP rule fails because it judges a creative on campaign-level weekly ROAS read on 10 to 13 purchases (a +/-63 to 72 % interval) and on Meta's in-pack budget split, which the 2026-10-05 Manami learning already shows is not a winner signal. The changes needed are mostly hygiene: a wrong "is video" rule that drives the hook-rate alarm, an attribution label that is a literal rather than a fact, four winner machines with three different anchors, Venev blocked by an unused CPA, and an engine SOP that has no hit-rate definition and a winner rule that cannot be computed reliably at our spend.

---

## 1. Side by side: engine vs dashboard

Legend: **A** aligned, **D** divergent (who is right and why), **U** undefined in engine.

| # | Concept | Engine (SOP v3 and client rules) | Dashboard | Verdict |
|---|---|---|---|---|
| 1 | Unit of a test | Pack = ad set = concept (`02-ideation.md:19`, `06-publishing.md:25`); SMALL tier puts the whole weekly batch in one pack (`SOP_master:73`). Each hook is its own ad (`06-publishing.md:105`). | Ad (`ad_id`), deduplicated by asset key (video_id, image_hash, story id, creative_id); relaunches and same-day duplicates excluded (`254_rpt_ad_launch.sql:143-160`). Verdicts (Scale/Hold/Iterate/Kill) are pack and concept level on Concepts page only (`verdict.ts:17-22`). | **D, both partly right.** The SOP winner test is itself creative-level (criterion 1 is "creative receives >= 20 % of pack spend"), so an ad-level winner is consistent with the SOP's own winner definition. Decisions stay pack-level in both. Missing on the dashboard: a pack-level hit rate (data in 3.4). |
| 2 | What counts as "launched" | A new pack created, named, cap set, ClickUp LIVE: TESTING (`06-publishing.md:114-120`). Post-ID graduation, re-upload, hook swap: not addressed (contradiction 29). Manami counts "67 ads ran". | First day with impressions > 0; excludes ads in the first 3 days of client history and relaunches of a known asset (`254:131,156,159`). | **U in engine; dashboard right.** Manami's measured re-upload penalty (`MANAMI:44-53`: copies returned a third to a half of the original) supports excluding relaunches. Gap: Ethia has no asset rows, so no dedup there. |
| 3 | Winner rule | All three at once: creative >= 20 % of pack spend; campaign ROAS >= Target x 1.2 for two consecutive eval periods; pack CPA <= target (`07-analyzing.md:150-154`). "Never cherry-pick low spend + high ROAS." Period length undefined. Manami practice: "cleared target" at 2.50, N 25 (`MANAMI:37,170`). | Lifetime purchases >= `readPurchases` AND shrunk ROAS (k = N, prior = trailing 365-day client ROAS) >= `targetRoas` (`model.ts:342-363`, `hitRate.ts:73-83`). | **D, dashboard right** (evidence in section 2). SOP criterion 2 rewards the campaign, not the creative; criterion 1 is contradicted by `MANAMI` 2026-10-05 ("pack-internal budget allocation is not a winner signal at this spend": Meta put 67 % of PACK6 on the two ads that ended at 1.22); criterion 3 needs a Target CPA the KPI inputs do not define (`SOP_master:90`). The dashboard's N-purchase gate covers "no trivial spend" more strictly than the 20 % share: 15 purchases at Manami implies roughly 15 x CPA of spend. |
| 4 | Loser / kill | Pack ROAS < Floor AND significant spend AND dragging campaign below Floor (`07-analyzing.md:112-115`). Manami: 1.80 on 30-day reads with >= 25 purchases, plus a 1.80 to 2.49 pause-and-harvest band (`MANAMI:80,88`). Old WPR/concept rules (0.5 x target at $300) still published. | Ad loser (scorecard): purchases >= directional AND shrunk ROAS < kill AND spend >= 3 x CPA (`model.ts:355-361`). Pack Kill verdict: shrunk ROAS <= kill AND spend >= 3 x CPA, blocked while the interval crosses the kill line (`verdict.ts:225-276`). | **D, partly.** Dashboard has no "dragging the campaign" condition, which is the SOP's distinctive kill guard; dashboard's interval block is the statistical version of the same caution. Acceptable: the dashboard verdict is advisory and SOP decides. Stale WPR/concept kill rules should be retired (engine side). |
| 5 | Carrier / iterate | Iterate zone: pack ROAS Floor to Target x 0.9 with spend >= 2 x CPA; branch on Hook Rate < 20 % (`07-analyzing.md:99-105`). "Carrier" is not an SOP term; Manami uses it for a pack pruned to proven creative (`MANAMI:164`). | Carrier = ad with >= N purchases, shrunk ROAS between kill and target (`model.ts:352`). Iterate verdict at pack level mirrors the SOP zone (`verdict.ts:305-312`). | **D in naming only.** Same word, two meanings (Manami: a pruned ad set; dashboard: an ad between kill and target). Rename the dashboard tile "Between kill and target" or add the term to the SOP glossary. |
| 6 | Scale | Pack ROAS >= Target x 1.2 one period: +20 to 25 %; >= x 2.0 for 14+ days: +30 to 40 % and graduation check (`07-analyzing.md:88-94`). Graduation: winner definition met 2+ periods, post-ID into Scaling Campaign. | Pack/concept verdict Scale at shrunk ROAS >= Target x 1.2, Scale hard at x 2.0 (`verdict.ts:278-294`); multipliers not editable in Settings. | **A** on thresholds. Dashboard has no "sustained for N periods" check: it reads the selected window once. Fine as a display; graduation remains an SOP act. |
| 7 | Attribution | 7-day click only, existing customers excluded (`SOP_master:129`), but 2026-09-20 meeting decided to keep 7-day click + 1-day view; Manami has 5 of 8 live ad sets off strict 7-day click (`MANAMI` 2026-09-28). | Ingest requests no `action_attribution_windows` (`wf_meta_ads_to_bigquery.json:132-141`); UI prints the literal "7-day click · customers excluded" (`CreativeBar.tsx:42`). | **D, neither is right today.** The engine has two conflicting standards; the dashboard asserts one it does not enforce. See section 5. |
| 8 | Hook rate definition | ThruPlays / Impressions (`07-analyzing.md:52`), iterate branch at < 20 %, bands 25 / 15 to 25 / < 15 (`:101,132`). Founder analysis uses 3-second plays. | 3-second plays / impressions for ads with video starts (`model.ts:183-189,212`); floor 20 %; hold = ThruPlays / impressions, floor 5 %. | **D, dashboard right on the metric, wrong on "is video".** ThruPlays / impressions is a hold rate (median 4.5 to 6.9 % on our video ads), so the SOP's 20 % floor would flag every video. The dashboard's alarm comes from counting banners with incidental video starts as video (section 4). |
| 9 | Maturity / no-touch | No-touch 7 days with min-spend cap (`07-analyzing.md:32-39`); learning gate < 50 purchase events; Manami and internal 2026-09-20 note use 14-day windows. | `noTouchDays` 14 for verdicts; hit-rate maturity 60 days, open launches stay in the denominator (`hitRate.ts:31,123-129`). | **D on no-touch (7 vs 14): engine contradicts itself**; owner already lives on 14 at Manami. **U for hit-rate maturity**; 60 days is evidence-based (26 of 29 winners qualified by day 60). Restatement in the raw data finishes by about day 36 (section 5), inside 60. |
| 10 | Hit-rate definition and reference | None in SOP. Four different quantities in the repo: Manami net-new 1.5 % (1 of 67), Strategy "creative win rate" 25 % (positive ROI), Venev win rate 25 %, dashboard brief "Nathan ~5 %" (no engine source). | Winners / ads first delivered in period, pooled, lifetime to date, 60-day maturity, reference line 5 % "not an industry benchmark" (`hitRate.ts:33-34`). | **U in engine; dashboard definition is sound, its reference is not.** The 5 % has no source in any engine document. Replace with the client's own trailing rate (decision D6). |
| 11 | Readability / confidence | Learning gate < 50 purchases (never met at our accounts); spend gates 1x/1.5x/2x/3x CPA; Manami 25 purchases on 30-day reads. | `readPurchases` per client (25 / 10 / 15 / 10), shrinkage toward the 365-day mean, interval 2.29 / sqrt(n). | **D, dashboard right.** The SOP's 50-event gate holds everything at these volumes (median weekly purchases per campaign 10 to 13, per ad set 3 to 11). |
| 12 | Thresholds source | KPI Calculator (not in repo); only Manami written down (target 2.50, kill 1.80, CPA 527). Dobias meeting says target 3.5. | Postgres `creative_settings`: Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15, Venev 2.10/10 (Venev CPA unset). | **D.** The engine documents 2.50 for Manami and 3.5 for Dobias while the dashboard runs 2.25 and 3.00. One source must own the numbers (decision D5). |

---

## 2. Empirical test: three winner definitions on real data

### 2.1 Method and assumptions

- **Cohort (same denominator for every rule):** ads in `mart.rpt_ad_launch` with first delivery 2025-10-05 to 2026-10-04, not pre-existing, not relaunch. Dobias 35, Ethia 156, Manami 120. (The design doc's 122 for Manami used 2025-10-01 to 2026-09-30.) Status is lifetime to 2026-10-04.
- **(a) Dashboard rule:** purchases >= N and `(n x raw + N x prior) / (n + N)` >= Target, prior = stored 365-day ROAS (2.842 / 2.283 / 2.029). Thresholds as saved: Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15.
- **(b) SOP v3 rule, as literal as data allows:**
  - Evaluation period = calendar week Monday to Sunday (the review runs every Monday, `07-analyzing.md:9`).
  - Criterion 1: ad spend / its ad set's spend in that week >= 20 %.
  - Criterion 2: the ad's campaign ROAS that week >= Target x 1.2 (3.60 / 3.00 / 2.70), using the same targets as the dashboard because the SOP keeps targets in a calculator that is not in the repo.
  - Criterion 3: the ad set's CPA that week <= target CPA (54 USD / 550 CZK / 527 CZK, the saved dashboard values; the SOP defines no Target CPA).
  - Winner = all three true in two consecutive weeks, at any point in the ad's life.
  - Campaign and ad set totals are summed from ad-level rows; this reproduces `mart_meta_campaign_perf` exactly (Q3 2026 spend, purchases and ROAS identical to the unit for all three clients).
  - Sensitivities: (b2) pack ROAS instead of campaign ROAS (the decision tree says pack, the winner definition says campaign, contradiction 5); (b3) 14-day periods instead of weeks; (b4) Manami at the learnings target 2.50 (x 1.2 = 3.00).
  - Not modelled: the SOP's "never cherry-pick" clause has no number; the 50-purchase learning gate would block every week at these volumes, so applying it would return zero winners for all clients.
- **(c) Manami learnings rule:** lifetime purchases >= 25 and raw lifetime ROAS >= 2.50 for Manami. For Dobias and Ethia the same rule with the client's dashboard target (3.00, 2.50), since no learnings file states one.

### 2.2 Counts, rates and overlaps (12 months)

| Client (currency) | Launched | (a) Dashboard | (b) SOP weekly | (c) Learnings 25 / target | a and b | a and c | b and c | all three | any of three |
|---|---|---|---|---|---|---|---|---|---|
| Dobias (USD) | 35 | **6 (17.1 %)** | 4 (11.4 %) | 6 (17.1 %) | 2 | 6 | 2 | 2 | 8 |
| Ethia (CZK) | 156 | **7 (4.5 %)** | 3 (1.9 %) | 2 (1.3 %) | 1 | 1 | 2 | 1 | 9 |
| Manami (CZK) | 120 | **9 (7.5 %)** | 9 (7.5 %) | 4 (3.3 %) | 5 | 4 | 4 | 4 | 13 |

Sensitivity of the SOP rule:

| Client | (b) weekly, campaign ROAS | (b2) weekly, pack ROAS | (b3) 14-day periods | (b4) Manami target 2.50 |
|---|---|---|---|---|
| Dobias | 4 | 6 | 3 | n/a |
| Ethia | 3 | 5 | 2 | n/a |
| Manami | 9 | 12 | 7 | 8 |

None of the SOP's 14-day winners at Manami, and only 2 of its 9 weekly ones, come from Jun to Sep 2026; the rest are October 2025 to March 2026 ads (`reels 1`, `výběr parfému - Copy`, `banner obecný ...`). The SOP rule follows the campaign's seasonal ROAS (Q4 2025 was Manami's strong quarter), not the creative.

Why the SOP rule is noisy at our spend: median purchases per campaign-week are Dobias 12, Ethia 13, Manami 10; per ad set-week 6, 11 and 3. At 10 purchases the 95 % interval on ROAS is about +/-72 % (`stats.ts:31`). Two consecutive weekly reads above Target x 1.2 happen by chance in small campaigns. Example: `Něžná (Vyměňte chemii) SK` qualified on the weeks of 2026-08-03 and 2026-08-10, when its campaign ran 5.13 and 3.44 on 9 and 7 purchases; the ad itself had 4 and 2 purchases those weeks and ended at 1.63 lifetime.

### 2.3 Ground truth: which rule matches what the team calls a winner?

The team's own labels in names and learnings:

| Ad (client) | Team label and source | Lifetime spend / purchases / raw ROAS | (a) | (b) | (c) |
|---|---|---|---|---|---|
| `12 Essentials Principles I MOF I STAT I 17JUL-26 I v1 WIN I US` (Dobias) | "WIN" in the ad name | 968 USD / 44 / 6.29 | Yes | No (11 % of its pack) | Yes |
| `GutSense VSL I MOF I DYN I 11AUG-26 I v1 win I CA` (Dobias) | "win" in the ad name | 1,703 USD / 40 / 3.18 | Yes | No | Yes |
| `MitoBoost I TOF I DYN I 17JUL-26 I v1 I US` (Dobias) | "MitoBoost TOF winner" (`slate.md:21`, `FOUNDER-ANALYSIS:22`) | 3,581 USD / 85 / 3.26 | Yes | Yes | Yes |
| `Něžná - 13MAR - OE` (Manami) | "primary winner" (`MANAMI:21`) | 111,585 CZK / 288 / 2.35 | Yes | No | No (2.35 < 2.50) |
| `NicheScentLover - Testovaci sada ... 1JULY` (Manami) | "second proven winner" (`MANAMI:22`) | 24,250 CZK / 73 / 2.36 | Yes | No (b2: yes) | No |
| **Matches** | | | **5 of 5** | **1 of 5** | **3 of 5** |
| `GutSense VSL I 6JUN I OE` (Dobias) | "GutSense VSL (live, weak)" (`slate.md:45`) | 7,388 USD / 124 / 2.55 | No | **Yes** | No |
| `Limitka Něžná Last Call | DYN | 22SEP` (Manami) | best per-ad result, but "under the 25-purchase readability threshold" and promo-confounded (`MANAMI` 2026-10-05) | 4,728 CZK / 17 / 4.30 at 12 days old | **Yes** | No | No |

Two lessons. The dashboard rule matches the team's vocabulary. Its one disputed call, `Limitka`, is a winner at day 12 on 17 purchases inside a promo; that is the case for a minimum-age guard (change C9).

Note: every Manami ad that carries "WIN" in its name (`Příběh Manami vid V2 - 31MAR - WIN`, `DYN I UGC Dagmar unboxing I WIN I 29APR I CZ` and four more) is a relaunch copy of an earlier asset, so all are correctly outside the cohort. The best of them returned 1.33 on 26 purchases; the rest have 0 to 7 purchases. This independently confirms the re-upload penalty in `MANAMI:44-53` and the relaunch exclusion.

### 2.4 Ads that differ between the rules (all differing ads; each client has 10 or fewer)

Columns: lifetime spend, purchases, raw ROAS, shrunk ROAS (dashboard), ad's share of its ad set's lifetime spend, number of weeks meeting SOP criteria 1 / 2 / 3 / all three, out of weeks with delivery.

**Dobias (USD; target 3.00, N 25, CPA 54)**

| Ad | Spend | Purch. | Raw | Shrunk | Share | Weeks c1/c2/c3/all of n | (a) | (b) | (c) |
|---|---|---|---|---|---|---|---|---|---|
| DYN I GutSense VSL I 6JUN I OE | 7,388 | 124 | 2.55 | 2.60 | 0.57 | 18/3/6/3 of 18 | N | **Y** | N |
| FeelGood Omega I TOF I DYN I 17JUL-26 I v1 I US - Copy | 4,065 | 82 | 2.80 | 2.81 | 0.47 | 10/5/10/4 of 12 | N | **Y** | N |
| GutSense VSL I MOF I DYN I 11AUG-26 I v1 win I CA | 1,703 | 40 | 3.18 | 3.05 | 0.60 | 8/2/5/2 of 8 | **Y** | N | **Y** |
| MitoBoost Testimonial I BOF I DYN I 24JUL-26 I v1 I US | 1,068 | 32 | 4.10 | 3.55 | 0.27 | 6/4/10/1 of 11 | **Y** | N | **Y** |
| MitoBoost Blog Funnel I TOF I DYN I 24JUL-26 I v1 I US | 1,047 | 32 | 4.04 | 3.51 | 0.27 | 7/4/10/2 of 11 | **Y** | N | **Y** |
| 12 Essentials Principles I MOF I STAT I 17JUL-26 I v1 WIN I US | 968 | 44 | 6.29 | 5.04 | 0.11 | 2/5/10/0 of 12 | **Y** | N | **Y** |

Agreed by all three: `MitoBoost I TOF I DYN I 17JUL-26` (3,581 / 85 / 3.26) and `MitoBoost Clinical Study I TOF I DYN I 24JUL-26` (1,616 / 52 / 4.33). Reading: the SOP rule rewards the two biggest spenders at 2.55 and 2.80, below the 3.00 target, because their campaigns had two good early weeks (GutSense VSL 6JUN: 6.53 and 4.22 in its first two weeks on 28 and 20 purchases, then below 3.0 in 15 of the next 16 weeks). It rejects four ads at 3.2 to 6.3 ROAS because they never held 20 % of a pack in two consecutive weeks or their campaign did not.

**Ethia (CZK; target 2.50, N 10, CPA 550)**

| Ad | Spend | Purch. | Raw | Shrunk | Share | Weeks c1/c2/c3/all of n | (a) | (b) | (c) |
|---|---|---|---|---|---|---|---|---|---|
| BA 2026-06-09 niac-akne-05-9x16 | 27,495 | 54 | 2.50 | 2.47 | 0.06 | 9/7/9/4 of 17 | N | **Y** | **Y** |
| carusel retinol lin | 18,317 | 34 | 2.39 | 2.36 | 0.04 | 6/6/6/3 of 9 | N | **Y** | N |
| Recenze zákaznic - niacinamid + růže DOF v2 | 7,261 | 21 | 4.70 | 3.92 | 0.01 | 2/1/2/1 of 6 | **Y** | N | N |
| [Andromeda] Niacinamid - 3 kroky | 6,999 | 15 | 2.72 | 2.54 | 0.01 | 2/2/4/0 of 6 | **Y** | N | N |
| banner retinol | 5,733 | 14 | 4.36 | 3.50 | 0.01 | 2/5/5/1 of 6 | **Y** | N | N |
| Black Friday | 5,174 | 11 | 3.52 | 2.93 | 0.01 | 1/0/0/0 of 1 | **Y** | N | N |
| [banner-retinol-nocni-krem] testimonials-konsolidovany | 4,165 | 10 | 3.26 | 2.77 | 0.01 | 1/1/1/1 of 4 | **Y** | N | N |
| [banner-fb10-welcome] brand-discount DOF | 2,700 | 10 | 5.02 | 3.65 | 0.01 | 1/2/2/1 of 5 | **Y** | N | N |

Agreed by all three: `retinol recenze z google banner` (9,958 / 28 / 3.99). Reading: Ethia is the client where the dashboard is least certain. 6 of its 7 winners rest on 10 to 21 purchases, the floor set by N = 10. Two dashboard winners are promo ads (`Black Friday`, `brand-discount`). The SOP and learnings rules prefer the two high-volume ads at about target (2.39 to 2.50 on 34 to 54 purchases) that the dashboard's shrinkage pulls just under 2.50. The owner already chose N = 10 knowingly (design D3); this table is the price of that choice.

**Manami (CZK; target 2.25, N 15, CPA 527)**

| Ad | Spend | Purch. | Raw | Shrunk | Share | Weeks c1/c2/c3/all of n | (a) | (b) | (c) |
|---|---|---|---|---|---|---|---|---|---|
| Něžná - 13MAR - OE | 111,585 | 288 | 2.35 | 2.34 | 0.53 | 24/8/23/4 of 30 | **Y** | N | N |
| NicheScentLover - Testovaci sada ... 1JULY ... CZ | 24,250 | 73 | 2.36 | 2.30 | 0.88 | 14/1/11/1 of 14 | **Y** | N | N |
| Něžná (Vyměňte chemii) I TOF I STATIC I 16JUN ... SK | 16,250 | 33 | 1.63 | 1.76 | 0.55 | 16/3/7/3 of 16 | N | **Y** | N |
| Něžná (Jan 2026) | 8,995 | 20 | 1.95 | 1.98 | 0.04 | 4/5/6/2 of 8 | N | **Y** | N |
| Testovaci sada | MOF | STAT | 14AUG ... CZ | 7,539 | 21 | 2.54 | 2.32 | 0.26 | 6/1/5/1 of 8 | **Y** | N | N |
| Testovací sada 20off I TOF I STAT I 24JUN ... SK | 4,970 | 16 | 3.04 | 2.55 | 0.81 | 15/3/7/3 of 15 | **Y** | **Y** | N |
| Limitka Něžná Last Call | DYN | 22SEP | 4,728 | 17 | 4.30 | 3.24 | 0.90 | 2/1/2/1 of 2 | **Y** | N | N |
| banner obecný - celá sezóna | 2,903 | 9 | 6.42 | 3.68 | 0.34 | 4/4/4/3 of 8 | N | **Y** | N |
| banner obecný 1 - sleva | 978 | 5 | 10.55 | 4.16 | 0.11 | 2/2/2/2 of 2 | N | **Y** | N |

Agreed by all three: `Testery - copy (zelený banner)` (23,642 / 79 / 3.11), `reels 1` (Oct 2025, 17,026 / 84 / 3.84), `výběr parfému - Copy` (15,042 / 57 / 2.64), `reels 1` (Nov 2025, 12,671 / 51 / 2.91). Reading: the SOP rule names an ad below the kill line (1.63) and two banners on 5 and 9 purchases, exactly the "15x ROAS on trivial spend" the SOP forbids; its own clause cannot be enforced without a purchase gate. It misses the account's primary winner because the ABO winner lane's campaign never held 2.70 for two straight weeks.

### 2.5 Reconciling Manami "1 of 67, 1.5 %" (Jun to Aug 2026, net-new)

| Reading of the cohort | Ads | Rule | Winners | Rate |
|---|---|---|---|---|
| As quoted (`MANAMI:37`) | 67 "ran" | "cleared target" | 1 | 1.5 % |
| Ads with any delivery 1 Jun to 31 Aug (all vintages, incl. 15 older ads and relaunches) | 69 | none of the rules applied to this denominator | n/a | n/a |
| Ads first delivered Jun to Aug | 54 | | | |
| ... minus relaunches (dashboard denominator) | **40** | (a) 2.25 / 15 | **3** (NicheScentLover 1JULY, Testovací sada 20off SK, Testovaci sada MOF 14AUG) | **7.5 %** |
| same 40 | 40 | (a) at target 2.50, N 15 | 1 (20off SK) | 2.5 % |
| same 40 | 40 | (a) at 2.50, N 25 | 0 | 0 % |
| same 40 | 40 | (b) SOP weekly | 2 (20off SK; Něžná SK at 1.63 lifetime) | 5.0 % |
| same 40 | 40 | (c) 25 purchases, 2.50 | 0 | 0 % |
| Net-new persona ads only (name contains one of the nine personas), deduplicated | 24 | (a) | 1 (NicheScentLover 1JULY) | 4.2 % |
| same 24 | 24 | (b), (c) | 0 | 0 % |

What "1 of 67" actually is:
- The numerator is `NicheScentLover - Testovaci sada | TOF | STAT | 1JULY`. Its Jun to Aug window figures in the warehouse are **2.45 on 37 purchases**, byte-for-byte the figures in `MANAMI:22`. 2.45 is below the stated 2.50 target, so "cleared target" was already a loose bar.
- The denominator cannot be reproduced exactly. The nearest warehouse count is 69 ads with any delivery in Jun to Aug, which mixes older ads and relaunch copies with the nine-persona launches (only 29 persona-named ad_ids exist, 24 after dedup).
- So the 1.5 % mixes a net-new numerator with an all-delivering denominator. Under the dashboard's definition the same months read 3 of 40 (7.5 %) overall and 1 of 24 (4.2 %) for net-new personas. The qualitative conclusion in the learnings (net-new personas without a proven anchor rarely win) survives; the number does not.
- Recommendation: mark `MANAMI:37` "1.5 %" as superseded by the dashboard definition (SOP edit E8), and remove the "1 of 67" figure from `landing-page-playbook.md:222` and `CREATIVE_ENGINE_BRIEF.md:529,596`.

### 2.6 Two structural findings the test surfaced

1. **New packs vs ads added to existing ad sets.** Of the cohort ads, those launched into an ad set that already existed (topped up) vs into a brand-new ad set:

   | Client | New-pack ads: winners / launched | Added to an existing ad set: winners / launched |
   |---|---|---|
   | Dobias | 6 / 31 (19 %) | 0 / 4 |
   | Ethia | **0 / 64** | **7 / 92 (7.6 %)** |
   | Manami | 4 / 65 (6.2 %) | 5 / 55 (9.1 %) |

   All of Ethia's winners came from ads added to mature ad sets. Ethia does not follow the SOP's "never top up" rule, and its new packs produced nothing in 12 months. Manami shows the same direction, which matches `MANAMI` "mature ad sets outperform new ones regardless of creative". Strongly confounded (mature lanes get budget and history), so this is a reason to **measure** by launch context, not to change the SOP yet (change C7, SOP edit E9).
2. **Pack-level hit rate** (new ad sets in 12 months with at least one dashboard winner): Dobias 3 of 15, Ethia 0 of 14, Manami 6 of 31. This is the SOP's own unit and is not shown anywhere.

---

## 3. The four dashboard winner machines

Measured at the Creative page default (all time), approximating `mart_creative_perf` with all rows of `rpt_ad_launch`:

| Machine | Population | Anchor (prior) | Gates | Dobias | Ethia | Manami |
|---|---|---|---|---|---|---|
| Hit rate tile (12-month launch cohort) | first delivered in period, no relaunch / pre-existing | stored 365-day ROAS (2.842 / 2.283 / 2.029) | N purchases + target | 6 | 7 | 9 |
| Scorecard "Winners", all time | every ad with delivery, incl. relaunch and pre-existing | all-time blended ROAS (2.842 / 2.166 / 2.125) | N purchases + target | 9 | 7 | 15 |
| Grid green tile, all time | every ad with delivery | all-time blended | directional purchases + target, **no** read gate | 13 | 13 | 24 |
| ... of which green but not a winner anywhere | | | | 4 | 6 | 9 |
| Money verdict | ad set / concept, window | window blended | spend gates, interval, zones | n/a | n/a | n/a |
| Diagnosis | ad, window | none | impressions, hook / hold floors, 1.5 x CPA | n/a | n/a | n/a |

Assessment:
- **Hit rate vs scorecard:** same predicate, different population and anchor. At Manami the anchor alone moves the bar: the effective raw ROAS needed at n = N is `2 x target - prior`, so 2.47 with the 365-day anchor vs 2.38 with the all-time anchor. The code comment "badge and hit rate cannot disagree" (`hitRate.ts:12-15`) is false on screen.
- **Grid green vs winner:** 4 / 6 / 9 ads are green on the wall and counted as winners nowhere. A viewer will read green as "winner".
- **Production "Net-new hit rate":** a third hit rate (winners / ads delivered in window) compared with the same 5 % line. Not the tile.
- **Money verdict and diagnosis** answer different questions (what to do with a pack, why an ad fails). They should stay separate, but share the anchor.

Recommendation (change C3): one predicate, one anchor, explicit populations.
1. Use the stored 365-day client ROAS as the shrinkage prior on every surface: grid, scorecard, Concepts, Production. It is already in `rpt_ad_launch`; the window-blended prior makes the bar move with the date picker.
2. Grid colour: green only when `classify()` returns winner (read gate); a second, lighter tone "promising" for directional-and-above-target.
3. Rename scorecard tile "Winners with delivery in period" (the design doc already asked for this) and make the Production page "Net-new hit rate" call `hitRate()` on the launch cohort filtered to Production Type = Net New, or rename it "Winner share of ads delivered".
4. Keep verdict and diagnosis separate, documented as "decision" and "explanation" machines.

---

## 4. Hook-rate floor

### 4.1 What the data says

- **The 20 % alarm is mostly a classification error, not a floor error.** The account-level September hook rates in `METRICS.md:618` (Dobias 17.3 %, Ethia 25.9 %, Manami 11.2 %) are reproduced exactly when "video" means "any ad with at least one video start". Restricted to genuine video ads (video starts >= 30 % of impressions) the same month reads **22.1 %, 27.2 %, 20.7 %**.
- The lifetime `is_video = video_plays > 0` flag in `rpt_ad_launch` counts **14 of 61 Ethia and 24 of 67 Manami "video" ads that are banners** (video start rate under 5 %, e.g. `retinol banner hravé`, `akce - listopad`, `Testery - copy (zelený banner)`). That also contaminates the hit-rate trend's Video / Static split.

Hook rate (3-second plays / impressions) on genuine video ads with >= 5,000 impressions, delivered in the last 12 months:

| Client | Ads | p10 | p25 | median | p75 | below 20 % | Corr. with ROAS (ads with 5+ purchases) |
|---|---|---|---|---|---|---|---|
| Dobias | 10 | 19.0 % | 21.6 % | 22.2 % | 25.5 % | 1 | -0.36 |
| Ethia | 26 | 10.4 % | 20.3 % | 28.0 % | 34.1 % | 5 | -0.38 |
| Manami | 24 | 18.0 % | 21.2 % | 28.0 % | 33.2 % | 3 | 0.00 |

Winners vs non-winners (cohort, genuine video): Dobias winners 19.0 to 21.2 % vs read non-winners 21.6 to 22.4 %; Ethia winners median 28.5 % vs read non-winners 31.8 %; Manami winners median 20.3 % vs others 23.0 %. **Hook rate does not separate winners from non-winners at any client**; the correlation with ROAS is zero or negative.

Hold rate (ThruPlays / impressions): medians 4.5 % / 6.9 % / 6.1 %; the 5 % floor flags **5 of 10 Dobias, 6 of 26 Ethia and 10 of 24 Manami videos**. The hold floor over-flags more than the hook floor.

### 4.2 Recommendation (change C1 + C5, SOP edit E4)

1. Fix "is video" everywhere (lifetime flag, Paid and Reports hook rate): an ad is video when video starts >= 30 % of impressions, or when the asset is a video (`video_id` present). Re-state the September account hook rates on that basis.
2. Make both floors **relative**: floor = the client's p25 of genuine video ads over the trailing 180 days, minimum 15 ads, else fall back to 20 % hook / 5 % hold. Today that gives hook floors of about 21.6 % (Dobias, small sample, fallback 20 % until 15 ads), 20.3 % (Ethia), 21.2 % (Manami), and hold floors of about 4.3 %, 5.9 %, 4.0 %.
3. Keep hook and hold **diagnostic only**, as the SOP already says ("never decide alone"). The data supports that rule strongly.
4. Engine: change the SOP hook definition from ThruPlays / Impressions to 3-second plays / Impressions; ThruPlays / Impressions is the hold rate. Under the SOP's current definition every video in all three accounts is below 20 %, so the iterate branch always reads "hook problem".

---

## 5. Attribution

Facts:
- The label "7-day click · customers excluded" is a JSX literal (`CreativeBar.tsx:42`), justified in a comment (`:5-12`). The ingest requests no attribution window (`wf_meta_ads_to_bigquery.json:132-141`), and the raw payload carries no window keys (checked `raw.raw_meta_ad_insights.payload_json`: no `7d_click`, `1d_view` or `attribution` fields). The numbers are therefore whatever Meta returns by default for each ad account. Depending on the API behaviour, that is the ad set's own attribution setting or Meta's default click-plus-view window, but it is not pinned to 7-day click.
- At Manami, 5 of 8 live ad sets were not on 7-day click only as of 2026-09-28 (`MANAMI`), so the warehouse mixes windows inside one account.
- "Customers excluded" is an ad set audience setting, not a reporting filter. Nothing in the warehouse can confirm or deny it.
- **Correction to `02_dashboard_logic.md` section 1.3 (freeze risk):** the warehouse shows the live workflow re-pulls a rolling window. Ad-days from Aug to Sep 2026 were ingested on an average of 17 to 18 distinct days, with the last ingest about 34 to 36 days after the ad day. Restatement between first and last ingest: Dobias **+11.6 % purchases, +12.2 % purchase value**; Manami **0.0 %**; Ethia not measurable (first ingest was a backfill). Restatement is complete well inside the 60-day maturity, so it does not bias settled hit rates. It does make the latest one to two weeks look about 10 % worse at Dobias.

Quantified impact: **not measurable from the warehouse.** The only in-repo evidence is directional (PACK6 judged at 1.56 on 7-day click + 1-day view, "7-day click alone would be lower"; the strictest-window ad set ranked last in the 2026-09-28 week). Thresholds were calibrated on the same Meta-default numbers, so the dashboard is internally consistent. The risk is external: a dashboard winner is not guaranteed to be a 7-day-click winner, and every comparison against SOP numbers is apples to pears.

Recommendation (change C2, decision D3):
1. Now: replace the literal with a true label, for example "Meta reporting window as set per ad set (not pinned)". 
2. Ingest: request `action_attribution_windows=['7d_click','1d_view']` and store both values per row (two purchase and value columns). The engine reads `7d_click`; the click-plus-view total stays available. This also quantifies the view share per client in one backfill.
3. One-off check before (2) lands: pull 90 days of ad-level insights per client with both windows to measure how many current winners change status. If no winner changes, the label fix suffices.

---

## 6. Verdict and proposals

### 6.1 Verdict: APPROVE WITH CHANGES

Approve the hit-rate process (launch cohort, ad grain with asset dedup, N-purchase gate, shrinkage to the 365-day client ROAS, lifetime to date, 60-day maturity with open launches shown). It identifies what the team calls winners (5 of 5 vs SOP 1 of 5), it is computable, and its gates are statistically honest. Conditions: changes C1 to C4 below before the hit rate is used in client reporting or the agency scorecard.

### 6.2 Dashboard changes, ranked

| Rank | Change | Effort | Impact | Owner decision needed |
|---|---|---|---|---|
| C1 | Fix "is video": start rate >= 30 % of impressions or a video asset, in `rpt_ad_launch.is_video`, Paid and Reports hook rate, and the trend split. Re-state METRICS.md hook figures. | S (SQL + 2 query files) | High: removes the false "average ad below hook floor" and the 38 misclassified ads in the Video / Static split | None |
| C2 | Attribution: true label now; pin and store `7d_click` and `1d_view` in ingest; engine reads 7-day click | S now, M for ingest + backfill | High: every ROAS, winner and hit rate depends on it | **D3** |
| C3 | One winner predicate and one anchor: 365-day client prior on grid, scorecard, Concepts, Production; grid green only for read winners, "promising" tone for directional; rename scorecard tile and Production metric | M | High: removes three conflicting winner counts (e.g. Manami 9 vs 15 vs 24 green) | None |
| C4 | Decouple hit rate and winners from `targetCpa` (needs target + N only); keep CPA for spend gates. Fix the CPA unit label (shop vs Meta currency) | S | Medium: Venev gets a hit rate; removes the "Body problem on every ad" artefact at CPA 0 | None |
| C5 | Relative hook and hold floors (client p25 of genuine video, trailing 180 days, min 15 ads, fallback 20 % / 5 %); label them diagnostic | S | Medium: hold floor today flags up to half of videos | **D4** |
| C6 | Schedule `sp_refresh_rpt_ad_launch` daily and show `refreshed_at`; suppress the tile delta when the current period is maturing (as Reports does) | S | Medium: today the tile is a 2026-10-05 snapshot and its delta is unfair to recent cohorts | None |
| C7 | Show hit rate by launch context (new ad set vs added to existing) and a pack-level hit rate (ad sets with >= 1 winner / ad sets launched) | M | Medium: answers the Ethia 0 / 64 vs 7 / 92 question with data | None |
| C8 | Ethia asset ingest (`mart_creative_asset` has 0 rows): enables relaunch dedup and thumbnails | M | Medium: Ethia hit rate is not like for like today | None |
| C9 | Winner needs age >= `noTouchDays` (14) and, when a promo calendar exists, a "promo launch" marker | S | Low to medium: the only disputed dashboard winner (`Limitka`, 12 days, 17 purchases, promo) | None (default on) |
| C10 | Reference line: replace fixed 5 % with the client's own trailing-12-month hit rate (or remove) | S | Low: removes an unsourced benchmark | **D6** |

### 6.3 Engine SOP edits, ranked

| Rank | Edit (file) | Effort | Impact | Owner decision needed |
|---|---|---|---|---|
| E1 | Split "winner" from "graduation" (`07-analyzing.md` Step 5, `SOP_master:50,194`). **Creative winner** = lifetime >= N purchases and shrunk ROAS >= Target (the dashboard rule, N and Target per client). **Graduation** = winner AND its pack ROAS >= Target x 1.2 in two consecutive evaluation periods, each with >= N pack purchases. Drop "creative >= 20 % of pack spend" as a criterion (keep as context); drop "pack CPA <= target" or define Target CPA in the KPI inputs. | S (text) | High: makes the winner computable and matches team usage | **D1** |
| E2 | Define the evaluation period (`07-analyzing.md:9,88,153`): 14 days for decisions at accounts below about 25 purchases per pack per week; weekly review continues as a monitoring and execution meeting | S | High: weekly reads at 3 to 13 purchases are +/-63 to 100 % noise | **D2** |
| E3 | Add a formal hit-rate section to `SOP_master` (and `08-feedback-loop.md`): definition, denominator, relaunch rule, 60-day maturity, reported per client monthly by launch month; retire the Strategy "creative win rate % positive ROI" and the Venev "25 %" or restate them in this definition | S | High: ends four incompatible hit-rate numbers | **D6** |
| E4 | Hook rate = 3-second plays / impressions; hold rate = ThruPlays / impressions; floors relative per client; diagnostics never decide alone (`07-analyzing.md:52,101,132`, `08-feedback-loop.md:25`) | S | Medium | **D4** |
| E5 | Replace Gate 1 "< 50 purchase events = HOLD" with the client's N (readability) from the KPI file; remove the 50 that no pack reaches | S | Medium: the gate currently blocks every decision | None |
| E6 | Attribution: reconcile `SOP_master:129` with the 2026-09-20 decision; set the window at ad set creation; state which window the review and the dashboard read | S | High | **D3** |
| E7 | Write per-client thresholds into the repo (one KPI file per client, or a table in `brain_<client>.md`), identical to dashboard Settings: target, N, kill, CPA, break-even. Resolve Manami 2.25 vs 2.50 and Dobias 3.00 vs 3.5 | S | High: one source of truth | **D5** |
| E8 | Define "launched" and relaunch: post-ID graduation duplicate and re-uploaded copies are not launches; hook swaps are launches. Mark `MANAMI:37` "1.5 %" superseded with the recomputed 3 of 40 (7.5 %) and 1 of 24 (4.2 %) net-new | S | Medium | None |
| E9 | Open question, not a rule change: "never top up an existing ad set" vs data (Ethia winners all in existing ad sets, Manami 9.1 % vs 6.2 %). Add as an active test in the SOP until C7 has two quarters of data | S | Medium | None |
| E10 | Retire stale rule sets: `WPR:42-56` and `CONCEPT-SKILL:84` absolute gates; fix links to the non-existent `meta-provozni-pravidla`, `agency/frameworks/meta-ads-sop.md` | S | Low to medium | None |

### 6.4 Owner decisions (6), each with a recommended default

| # | Decision | Options | Recommended default |
|---|---|---|---|
| **D1** | Adopt the dashboard winner as the engine's "creative winner" and move the SOP's three-part rule to "graduation" (E1)? | (a) yes; (b) keep SOP rule for winners and treat the dashboard as an indicator | **(a)**. 5 of 5 team-named winners vs 1 of 5; SOP rule names a 1.63 ad and the "weak" GutSense VSL |
| **D2** | Length of an evaluation period for scale and graduation | weekly; 14 days; 30-day reads with >= 25 purchases | **14 days**, with the per-period purchase floor N; weekly meeting stays |
| **D3** | Attribution standard for decisions and for the dashboard | 7-day click only (SOP); 7-day click + 1-day view (2026-09-20 decision); store both, decide on one | **Store both; decide on 7-day click**; set 7-day click on every new ad set; label shows the window |
| **D4** | Hook and hold floors | fixed 20 % / 5 %; relative per client (p25 of genuine video, 180 days) | **Relative**, diagnostic only, after the "is video" fix (C1) |
| **D5** | Single source of truth for client thresholds, and Manami's target | dashboard Settings mirrored into a repo KPI file; repo first and Settings copies it. Manami 2.25 or 2.50; Dobias 3.00 or 3.5 | **Settings is the source, mirrored into a repo KPI file per client; Manami 2.25, Dobias 3.00** (both already approved in Settings; the repo text is older) |
| **D6** | Hit-rate reference and target | keep "~5 %"; client's own trailing 12-month rate; an agency target | **Client's own trailing 12-month rate as the reference**; set explicit targets per client after two quarters of maturity-clean data; retire "Nathan ~5 %" and the 25 % "creative win rate" |

---

## Appendix A. Data notes and caveats

- Dashboard winner counts reproduce the design doc: Dobias 6 of 35, Ethia 7 of 156; Manami 9 of 120 (122 in the design doc window).
- Sample sizes are small: Dobias 35 launches, all from 2026-06 onward. Treat Dobias percentages as indicative.
- SOP criterion 2 uses the ad's campaign; at Dobias campaign and ad set coincide in most weeks, so (b) and (b2) differ little there.
- Promo windows were not removed; `MANAMI` 2026-10-05 retired the promo index as unreliable.
- The `rpt_ad_launch` snapshot is from 2026-10-05 and has no scheduled refresh in the repo (C6).
- Hook-rate figures use `video_views` (3-second plays) from `mart_meta_ad_perf`; "genuine video" = video starts >= 30 % of impressions and >= 5,000 impressions.
- Restatement figures: `raw.raw_meta_ad_insights`, ad-days 2026-08-01 to 2026-09-27, first vs last `ingested_at` per ad-day.
- Queries are reproducible from the three `mart_qa.aud_*` tables until 2026-10-19.
