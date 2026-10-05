# HF1: /paid/google crash (B-01) and error boundaries (B-02)

Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/hf1-google-crash`, branch `hf1-google-crash`, one commit `9ea3fae` (not pushed).

## What changed
- `dashboard/lib/queries/paidGoogle.ts`: `getGadsPmaxSplit`, `getGadsAdGroups`, `getGadsDevices`, `getGadsProducts` now `HAVING spend > 0` (alias form, same as paidMeta.ts and creative.ts). Cause: unqualified `SUM(spend)` in HAVING resolves to the SELECT alias `spend`, so it became `SUM(SUM(spend))`. Comment added at the top of the file. `getGadsKeywords` and the search-terms modes qualify columns (`SUM(k.spend)`, `SUM(s.spend)`) and were already fine. paidMeta, paidGa4, paidOverview, paid.ts already used the alias or qualified form (no change needed).
- New `components/ui/ErrorState.tsx` (client): header (title from the route), page frame, one line "Could not load this view." and a Retry button (router.refresh() then reset(), pulses while pending). Tokens only, no error text or digest shown.
- New boundaries: `app/(app)/error.tsx`, `app/(app)/paid/error.tsx`, `app/(app)/creative/error.tsx`, `app/(app)/reports/error.tsx` (each renders ErrorState inside its layout, so sidebar, account menu, Paid tab bar, report list stay), and `app/global-error.tsx` (own html/body, imports globals.css, same line + Retry).
- `scripts/check-warehouse.ts`: now probes every Paid tab query (Google incl. all 4 term modes, 8 product variants, ad groups, devices; Meta; GA4 incl. all funnel channels and landing filters; Overview native and CZK). Needs ADC like the rest of that script.

Server-side logging: Next.js already logs the real error for every failed server render (that is how B-01 showed up in Vercel runtime logs) together with the digest. The boundaries do not add a log endpoint (an unauthenticated log sink would be an abuse surface); the browser console gets the digest only (`[view] render failed <digest>`). The boundary was not exercised in a browser (needs a login); only compiled and type-checked.

## Verification
- Negative control: the original pmaxSplit SQL against the warehouse returns `Aggregations of aggregations are not allowed at [1:351]`.
- `npx tsc --noEmit`: clean. `npm run build`: compiled, all routes built.
- check:paid 190/190, check:loading 203/203 (needed ErrorState to avoid useTransition), check:capabilities 329/329, check:creative all assertions match, check:reports 315/315 (BigQuery steps skipped, no creds), reports-eval 333, reports-authz 37, reports-store 286, reports-url 193, reports-widgets 655, reports-canvas 98, reports-pages 201: all pass.
- Not runnable locally (no ADC / network): check:queries (credentials), check:warehouse, check:clickup.

## BigQuery MCP runs (execute_sql_readonly, project oneeighty-warehouse, literal params, each query wrapped `SELECT COUNT(*) FROM (<sql>)`)
SQL was captured from the real functions (a stub on BigQuery.query, so the text is exactly what the app sends; harness `scratchpad/hf1/capture.ts`, generated SQL files in `scratchpad/hf1/*.sql`). 30d = 2026-09-04..2026-10-03 (compare 08-05..09-03), Sep = 2026-09-01..09-30 (compare 08-02..08-31). Every query returned without error. Counts are rows returned. "zero" = `zeroOnly` variant.

### Google tab (all functions, page-level = no campaign selected; adGroups/devices = campaign selected)
| query | manami 30d | manami Sep | rawbark 30d | rawbark Sep |
|---|---|---|---|---|
| getGadsCampaignAgg | 2 | 2 | 19 | 19 |
| getGadsLeakage | 0 | 0 | 2 | 2 |
| getGadsPmaxSplit | 4 | 4 | 10 | 10 |
| getGadsCoverage | 1 | 1 | 1 | 1 |
| getGadsKeywords | 0 | 0 | 66 | 66 |
| getGadsSearchTerms all | 0 | 0 | 200 | 200 |
| getGadsSearchTerms brand | 0 | 0 | 25 | 26 |
| getGadsSearchTerms nonbrand | 0 | 0 | 200 | 200 |
| getGadsSearchTerms waste | 0 | 0 | 200 | 200 |
| getGadsProducts item / zero | 86 / 78 | 85 / 77 | 42 / 32 | 42 / 30 |
| getGadsProducts type / zero | 7 / 4 | 7 / 4 | 8 / 3 | 8 / 2 |
| getGadsProducts brand / zero | 2 / 1 | 2 / 1 | 2 / 0 | 2 / 0 |
| getGadsProducts label0 / zero | 1 / 0 | 1 / 0 | 8 / 3 | 8 / 2 |
| getGadsAdGroups (campaign) | PMax 23760052077: 0 | 0 | Search 21247049270: 12; PMax 20381425429: 0 | 12 / 0 |
| getGadsDevices (campaign) | PMax 23760052077: 4 | 4 | Search: 3; PMax: 4 | 3 / 4 |

Sensible-row notes: manami is PMax only (no search terms, keywords, leakage, ad groups: 0 is correct; PMax has no ad groups by design). Manami PMax 30d spend 13318 CZK over 4 networks, devices MOBILE first. Rawbark Search campaign spend 30d about 23.3k (22.8k covered by terms, coverage chip about 98%). Product groups with null key (no brand/label) come back as one row with key null, handled by the page ("not set").

### Meta, GA4, Overview (dobias, manami; campaign / adset ids real: dobias 52545975900212 / 52547215215812, manami 120246928041830098 / 120249508201360098)
Counts identical between 30d and Sep except where noted.
| query | dobias | manami |
|---|---|---|
| getMetaCampaignDaily | 300 | 180 |
| getMetaVideoRates | 5 | 3 |
| getMetaAdsets (mart_creative_adset_perf) | 0, falls back to mart_meta_ad_perf: 3 | 0, fallback: 11 |
| getMetaAds (campaign) / (campaign + adset) | 14 / 6 | 20 / 4 |
| getGa4LastDate | 1 (2026-10-03) | 1 (2026-10-03) |
| getGa4Kpis | 1 | 1 |
| getGa4CrossCheck (2 queries) | 4 + 1 | 5 + 1 |
| getGa4Funnel all / Paid Social / Paid Search / Paid Shopping / Cross-network | 1 each (Paid Shopping all null, no sessions) | 1 each (Paid Shopping all null) |
| getGa4Channels | 4 | 4 |
| getGa4LandingPages all / meta / google | 50 / 50 / 19 (Sep 20) | 50 / 41 (Sep 40) / 50 |
| getPaidDaily native / CZK | 60 / 60 | 60 / 60 |
| getCampaignsAcross native / CZK | 5 / 5 (Meta only) | 4 / 4 (Meta + Google) |
| getGa4PlatformTotals native / CZK | 4 / 4 | 5 / 5 |
| legacy getMetaTotals / getTopAds / getChannelTotals | 1 / 10 / 1 | 1 / 10 / 1 |

Observation (not fixed, not in scope): `mart_creative_adset_perf` returns 0 rows for both clients, so Meta ad sets always come from the fallback (adset names are null there). Already known from the check-warehouse header, only noting it.

## Ready for prod deploy
Nothing outside the dashboard repo: no migrations, no warehouse objects created (no mart_qa objects). Merge `hf1-google-crash` and deploy the dashboard. After deploy open /paid/google for manami and rawbark (30d, Sep, `?campaign=` set, Products group-by buttons, Search terms modes).

## Open issues / requests to orchestrator
- Boundary behaviour is compile/type verified only. Suggest a one-time manual check after deploy by forcing a failing query on a preview.
- `check:warehouse` (extended) and `check:queries` need ADC; run them from a machine with `gcloud auth application-default login` before release.
- `dashboard/node_modules` shows as untracked in the worktree (symlink); not committed.
