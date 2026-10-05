# r3-paid-creative report

Branch `r3-paid-creative`, commit b8e99df (not pushed). Worktree `oe-dash-wt/r3-paid-creative`. Only files in the package's ownership were edited, plus the two check scripts (`scripts/check-paid-math.ts`, `scripts/check-creative-engine.ts`) for new assertions.

## Findings covered

| id | status | what changed |
|---|---|---|
| B-17 | done | New helpers `isConceptCode`, `humanizeConceptCode`, `conceptLabel` in `lib/creative/display.ts`. `MAN_SensitiveSwitcher_ContrarianTruth_v1` prints as "Sensitive Switcher, Contrarian Truth, v1". A written concept name wins over a code; a short id such as C07 stays beside the name; a ClickUp task id is never printed. Used in: ad detail header tag (`AdDetail.tsx`), Concepts cards and roster (`ConceptCard.tsx`, `concepts/page.tsx`, `getConcepts`), Breakdown "concept" dimension, the Creative filter chip (`creative/page.tsx`). Raw ids stay in links and joins. |
| B-20 | done | Static ads: the Retention block ("Static ad: judge on CTR.") is dropped, the Diagnosis already says it. "Too few impressions." became "Fewer than 5,000 impressions so far." (no longer echoes the label "Not enough delivery"). |
| N-01 | done in code, BigQuery timing not measurable (see below) | Search terms, keywords and products render the top 50 by spend; the line under the table says "Showing the top 50 of N rows, by spend." with a "Show all N" link (`more=terms,keywords,products` query param, scroll kept, `AppLink`). Terms and keywords now aggregate and LIMIT 200 first, then join `mart_gads_campaign_dim` on 200 rows (before: the join ran over every daily row in range). The 9 independent queries were already in one `Promise.all`; count unchanged at 9. |
| N-02 | done | `roasOf(value, spend, conversions)` in `lib/paid/math.ts`. n/a when spend is 0/missing, value missing, or value 0 with no conversions (same as Meta, whose marts leave revenue NULL when nothing was bought). 0.00x only when conversions above 0 were recorded and worth 0. Applied to Google campaigns/rates (KPIs, brand split), ad groups, devices, search terms, keywords, products, PMax tooltip and the Overview campaigns table. Meta tables untouched. |
| B-08 / N-03 | code fix done, root cause and result NOT verified against data (see Open issues) | `getMetaAdsets`: a name equal to the ad set id is now treated as "no name" (the ad set mart's fallback view writes `COALESCE(name, adset_id)`), and unnamed ad sets are resolved with a second query reading every snapshot of every ad in `mart_creative_asset`, then `mart_creative_adset_perf.adset_name`. |

## Verification

- `tsc --noEmit`: clean. `npm run build`: passes. `check:paid` 211/211 (new roasOf cases included). `check:creative`: all assertions match (new concept-label cases included). `check:loading` 248/248.
- HTML size, measured with a throwaway harness (deleted) that renders `SearchTerms` and `Products` through `renderToStaticMarkup` with 200 synthetic rows each:
  - before (all 200 rows): terms 465.9 KB + products 398.9 KB = 864.8 KB
  - after (top 50): terms 125.8 KB + products 107.2 KB = 232.9 KB (-73%)
  - The flight payload carries the same cells again, so the real page shrinks by a similar share. Footer and "Show all 200" link render. Waste-mode zero-conversion row renders n/a for ROAS and CPA.
- Query count on the Google tab: 9 before, 9 after (already parallel). Row counts returned: still 200 per table (the cap is on rendering, so "Show all" costs nothing extra).
- BigQuery: the MCP connector (`806eaa04...`) was invalidated for the whole session ("connection invalidated", later "Not connected"), no `bq`/`gcloud`, no service-account env. So NO live query ran: before/after wall-clock for RawBark, the actual live HTML size and the check of the two Manami ad set names against the warehouse are unverified. `check:queries` also fails on credentials here.

## Open issues and requests

1. B-08 root cause is not confirmed. What I could establish: the app reads only the `mart` dataset; names exist only in `mart_creative_asset` (from the nightly creatives job, `stg_meta_ad_creatives` = latest row per ad), and the ad-level insights ingest does not request `adset_name` (see `infra/n8n/wf_meta_ads_to_bigquery.json` fields). The two Manami ad sets, read live from the Meta Ads MCP, are 120249865328400098 = "PACK7 | 22SEP-26 | CZ" and 120249942414030098 = "PACK 8 - LAST CALL PODZIMNI LIMITKY I  27SEP I CZ" (both in campaign 120246928041830098). Both are recent (22 Sep, 27 Sep), so the likely cause is that their ads are not in the creatives snapshot yet or carry a NULL `adset_name`; in that case my fallback cannot find a name either and the table still shows the id. To verify when BigQuery is back:
   `SELECT adset_id, adset_name, as_of FROM mart.mart_creative_asset WHERE client_id='manami' AND adset_id IN ('120249865328400098','120249942414030098')`
   If empty: the fix is upstream (creatives job must snapshot every ad with delivery, or the ad-level insights call must add `adset_name` so `payload_json`/a column carries it, then a mart view that names ad sets from it). That is infra (owner of `infra/**` and the n8n workflow), not in this package. Also `mart_creative_adset_perf.names` uses `ANY_VALUE(adset_name)`, which can return NULL even when another ad of the same set has a name; switching it to `ARRAY_AGG(adset_name IGNORE NULLS ORDER BY as_of DESC LIMIT 1)[SAFE_OFFSET(0)]` would be a one-line improvement (regression protocol in `00_agent_rules.md` applies).
2. N-01, bigger lever outside this package: `mart_gads_search_terms_daily`, `mart_gads_keywords_daily` and `mart_gads_products_daily` are views that scan 25 months of `raw_google_ads.p_ads_*` and group before the app's date filter is applied. Materialising them (as planned for D1) is what will bring RawBark from seconds to sub-second. Not touched here.
3. `creative.ts` line ~292 still falls back to the ad set id for the Creative grid's `adsetName` (same root cause as B-08), left as is.
4. Product decision taken, flag if you disagree: N-02 hides ROAS (shows n/a) on a Google row that spent with zero conversions, same as Meta. If you would rather show 0.00x everywhere including Meta, change `roasOf` to drop the zero-value clause and make Meta use it.
5. Sorting inside a capped table sorts the rendered rows only (top 50 until "Show all"); the footer says which.
