# FX4: Meta soft metrics in the Reports metric picker

Branch `fx4-meta-metrics` (worktree `oe-dash-wt/fx4-meta-metrics`), commit `b1c7116` on top of `9b49428`. Not pushed. Frontend semantic layer only: no warehouse change, no `mart_qa` objects, nothing to deploy to BigQuery.

## Interpretation
"Hit rate" in the request is read as **Hook rate** = 3-second video plays / impressions. `hit rate` and `thumbstop rate` are aliases of `meta_hook_rate` in the picker search.

## What changed

| File | Change |
|---|---|
| `lib/reports/registry/types.ts` | `MartId` + `meta_ad`; `MartDef.accountCurrency?` (money in the ad account currency, converted, no foreign caveat); `ComponentDef.onlyWhenPositive?` (row filter); `SEMANTIC_VERSION` 4 to 5. |
| `lib/reports/registry/components.ts` | `meta_campaign` (mart_meta_campaign_perf) to phase 1, new `meta_ad` (mart_meta_ad_perf), both `accountCurrency`. Components: `meta_campaign.{spend, impressions, reach, link_clicks, landing_page_views, add_to_cart, initiate_checkout, purchases}`, `meta_ad.{spend, video_play_actions, video_thruplays, video_impressions}`. Outcomes are `nullMeans: "gap"` with `missingWhenNull` = that mart's spend (gap = missing spend only). `video_impressions` = column `impressions` filtered on `video_play_actions > 0`. Validation for the column override and the filter. |
| `lib/reports/registry/ids.ts` | 14 ids appended to `METRIC_IDS` (44 queryable). `meta_atc_rate` moved from reserved phase 2 (never queryable, 0 benchmark rows) with the owner's formula. |
| `lib/reports/registry/metrics.ts` | The 14 metrics, Meta group, descriptions <= 40 words, tenant-neutral, aliases, `definitionKey` to the Paid tab tooltips where they exist. |
| `lib/reports/compile.ts` | Row filter: `SUM(IF(t.video_play_actions > 0, t.impressions, NULL))`, NULL count `COUNTIF(filter AND t.spend IS NULL)`. Multi-mart was already one CTE per mart; each now carries its own date predicate (asserted), guards, NULL counts, FX joins on its own `currency`. |
| `lib/reports/evaluate.ts` | Guards kept **per mart**: a component reads only its own mart's `fxMissing` and `foreignRows` (an EUR shop with a CZK Meta account: KPI money keeps the native shortcut, Meta money converts; a missing Meta rate nulls only Meta money). Foreign-currency caveat only from marts without `accountCurrency`. |
| `scripts/check-reports-eval.ts` | Section 4.13 (39 new checks): formulas, groups, descriptions, aliases unique, resolve marts and components, EUR client with CZK account, per-mart FX, spend-gap vs zero outcome, not_connected and "2 of 3" rollup, combined from display sums, hook from the ad mart, week without Meta rows = null point. Live column lists for both Meta marts. |
| `scripts/check-reports.ts` | 44 ids; fixture `meta_ad` mart; real-registry SQL assertions for a 3-mart widget (join chain, date predicate per CTE, per-mart guards, FX, missingWhenNull, row filter, tampered Meta CTE rejected, normalise of an absent joined side). |
| `scripts/check-reports-pages.ts` | Picker count 30 to 44. |
| `lib/reports/README.md`, `METRICS.md` | Registry table rows, amendment 22. |

### Metric set (Meta group)
| id | label | formula | benchmarkable |
|---|---|---|---|
| meta_cost_per_lpv | Cost per LPV | campaign spend / landing_page_views | yes |
| meta_lpv | Landing page views | sum | no |
| meta_link_ctr | Link CTR | link_clicks / impressions | yes |
| meta_cpc_link | CPC (link) | spend / link_clicks | yes |
| meta_cpm (existing) | Meta CPM | kpis meta_spend / meta_impressions x 1000, reused unchanged | yes |
| meta_add_to_cart | Add to carts | sum | no |
| meta_cost_per_atc | Cost per ATC | spend / add_to_cart | yes |
| meta_atc_rate | ATC rate | add_to_cart / landing_page_views | yes |
| meta_atc_to_purchase | ATC to purchase | purchases / add_to_cart | yes |
| meta_initiate_checkout | Initiate checkouts | sum | no |
| meta_cost_per_ic | Cost per checkout | spend / initiate_checkout | yes |
| meta_hook_rate | Hook rate | video_play_actions / video-ad impressions (ad mart) | yes |
| meta_hold_rate | Hold rate | video_thruplays / video-ad impressions (ad mart) | yes |
| meta_frequency | Frequency | impressions / reach over campaign days, described as average daily frequency | no |
| meta_cpa (existing) | Meta CPA | kpis, reused unchanged | yes |
| meta_conversion_rate | Meta conversion rate | purchases / link_clicks | yes |

Hold rate: `video_thruplays` is populated (Sep 2026: 28,574 Dobias, 9,386 Ethia, 5,847 Manami, 5,433 Venev), so it is live, not phase 2. Outbound CTR and quartile metrics are not registered: `outbound_clicks` and `video_p25..p100/30s` are 100 percent NULL (pa1).

## Live column verification (read-only MCP)
`INFORMATION_SCHEMA.COLUMNS`: `mart_meta_campaign_perf` has spend, impressions, reach, link_clicks, landing_page_views, add_to_cart, initiate_checkout, purchases, currency; `mart_meta_ad_perf` has spend, impressions, video_play_actions, video_thruplays, currency. Sep 2026: spend never NULL in either mart; ATC / IC / purchases NULL on campaign days without the event (now zero); video plays NULL on static-ad rows. The live view comment in `mart_creative_perf` labels `video_play_actions` as "3s+, the hook-rate numerator" and thruplays as the hold numerator; I followed that.

## Dry-run bytes (MCP, 90 days 2026-07-06..2026-10-03, previous period, week grain, 4 Meta clients, CZK)
| widget | marts | totalBytesProcessed | share of 2 GiB |
|---|---|---|---|
| all 16 Meta metrics (incl. CPM/CPA from kpis) | kpis, meta_ad, meta_campaign | 430,260,363 | 20.0 % |
| cost per LPV + link CTR | meta_campaign | 25,478,844 | 1.2 % |
| hook + hold | meta_ad | 130,623,943 | 6.1 % |

## End to end (offline, read-only MCP)
Two table widgets of 8 metrics (limit per widget), clients dobias, ethia, manami, rawbark, venev, custom 2026-09-01..2026-09-30, previous period, CZK, clients from live `ref.clients`. One superset query compiled by `compileWidget`, params inlined, run via MCP (`TO_JSON_STRING` rows, 8 rows, 425 MB), each widget through `normaliseRows` + `evaluateWidget`. Script and rows: `scratchpad/fx4/` (`_fx4_live.ts`, `_fx4_dry.ts`, `rows.jsonl`, `eval_out.txt`), not committed.

| client | CPLPV | LPV | Link CTR | CPC link | CPM | ATC | Cost/ATC | ATC rate | ATC to purch | IC | Cost/IC | Hook | Hold | Freq | CPA | Conv rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dobias | 14.52 | 28,776 | 2.38% | 11.61 | 276.56 | 1,458 | 286.58 | 5.07% | 22.91% | 654 | 638.90 | 52.24% | 4.17% | 1.50 | 1,251.02 | 0.93% |
| ethia | 15.12 | 1,985 | 1.44% | 13.24 | 191.37 | 267 | 112.40 | 13.45% | 19.10% | 161 | 186.41 | 80.82% | 8.23% | 1.49 | 588.46 | 2.25% |
| manami | 28.20 | 3,104 | 1.39% | 13.54 | 187.87 | 465 | 188.27 | 14.98% | 39.78% | 375 | 233.46 | 34.19% | 2.69% | 1.34 | 473.23 | 2.86% |
| venev | 89.83 | 563 | 1.49% | 30.76 | 459.81 | 31 | 1,631.40 | 5.51% | 12.90% | 14 | 3,612.39 | 68.13% | 6.63% | 1.33 | 12,643.38 | 0.24% |
| rawbark | not connected (Meta not connected) on every cell | | | | | | | | | | | | | | | |
| All clients | 17.02 | 34,428 | 2.07% | 12.64 | 261.17 | 2,221 | 263.83 | 6.45% | 25.84% | 1,204 | 486.69 | 52.81% | 4.48% | 1.45 | 1,020.86 | 1.24% |

Combined cells are "4 of 5" (RawBark not connected). Venev shows no "another currency" caveat although its Meta account is CZK and the shop EUR (accountCurrency).

Sanity vs `mart_meta_campaign_perf` sums, Sep 2026 (independent query): Dobias spend 19,812.24 USD (= 417,840.14 CZK through the same monthly rate), LPV 28,776, link clicks 35,975, impressions 1,510,861: CPLPV 0.6885 USD = 14.52 CZK, CTR 2.381 %. Ethia 30,011.52 / 1,985 = 15.12, 2,266 / 156,821 = 1.445 %. Manami 87,546.84 / 3,104 = 28.20, 6,464 / 466,000 = 1.387 %. Venev 50,573.52 CZK / 563 = 89.83, 1,644 / 109,989 = 1.495 %. All match. Campaign mart impressions equal `mart_daily_kpis.meta_impressions` for every client.

## Verification
- `npx tsc --noEmit` clean; `npm run build` exit 0 (`scratchpad/fx4/build.log`).
- check:reports 315/315 (BigQuery steps skip locally, no credentials), reports-eval 333/333, reports-authz 37, reports-store 286, reports-url 193, reports-widgets 655, reports-canvas 98, reports-pages 201, capabilities 329, paid 190, creative ok. check:queries and check:warehouse fail only on missing GCP default credentials (unchanged).
- No em or en dash in the diff.

## Open issues / decisions
1. **Hook and hold: row-level vs ad-level "video ads only".** Reports filter per ad-day (impressions of rows with plays > 0); the Paid > Meta tab filters per ad over the period. Sep 2026 hook: Dobias 52.24 vs 52.19, Ethia 80.82 vs 79.92, Manami 34.19 vs 32.97, **Venev 68.13 vs 55.25**. Venev has 46 video-ad days with up to 1,925 impressions and no plays reported (19,105 impressions). If those are image renditions of flexible ads or missing play counts, the row level is closer to the truth; if they are real zero-play impressions, the ad level is. Changing to ad level needs a two-level CTE in the compiler. Owner decision.
2. Meta marts contain only days with delivery, so a day without any Meta row is never a "Missing days" gap there (KPI-view Meta metrics do flag it, e.g. Venev 2026-08-10). Rates are unaffected; counts for such a period simply omit the day.
3. Venev October: Meta money needs the CZK to EUR rate like the KPI view (fx_rates ends 2026-09), so it shows "No FX Oct 2026" for an EUR display, while Meta rates and KPI money stay ok (per-mart guards).
4. No templates were changed; the metrics are available in the picker only.

## Requests to orchestrator
- Merge `fx4-meta-metrics`; the `SEMANTIC_VERSION` bump changes every cache key.
- Owner decision on open issue 1.
- Still open from pa1: ingest outbound clicks and video quartiles to unlock Outbound CTR and quartile hold curves.
