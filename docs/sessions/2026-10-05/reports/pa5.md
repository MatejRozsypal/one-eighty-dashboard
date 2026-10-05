# PA5 report: Paid > Meta tab

Branch `pa5-meta-tab`, worktree `oe-dash-wt/pa5-meta-tab`, one commit `eecb18e` on top of `7b139f1` (PA0 merged). Frontend only. No warehouse objects, no `mart_qa` objects, nothing to deploy.

## Files (all owned)
- `app/(app)/paid/meta/page.tsx` (stub replaced; capability gate kept; fragment root header, ControlBar, main as PA0 requires; `PageControls compare`, no currency toggle).
- `lib/queries/paidMeta.ts`, `lib/demo/paidMeta.ts`.
- `components/paid/meta/`: `MetaKpis.tsx` (two KPI rows + `MetaFunnel`), `MetaTrend.tsx`, `MetaCampaigns.tsx`, `CampaignDetail.tsx`, `AudienceBreakdown.tsx`, plus helpers `aggregate.ts` (pure, no server imports), `cells.tsx`, `links.ts`.

## Design notes
- One fetch feeds the tab: `getMetaCampaignDaily` returns campaign x day rows for both periods (tagged current/comparison, one scan). Totals, funnel, trend, campaign table and audience (Stage, Market) are sums over that set in `aggregate.ts`, so they cannot disagree. `getMetaAudience` from the spec is therefore not a query for Phase A (it is `audienceRows` over the same rows); Phase B dimensions will need their own query.
- Other queries: `getMetaVideoRates` (hook/hold components per campaign over ads with plays > 0, both periods), `getMetaAdsets`, `getMetaAds` (top 20 by spend, optional adset filter). All parameterised, `client_id` + date filters.
- Money in `client.metaCurrency` (fallback `client.currency` only for a half-filled registry row). No currency toggle.
- Row 1 uses `KpiTile` with `delta`; row 2 uses a local compact tile so rates (Link CTR, ATC to purchase, Hook rate) show percentage points ("0.4 pp") while money, counts and ratios show percent. Tooltips via `metricKey` from PA0 definitions.
- Funnel: existing `Funnel`, steps Impressions, Link clicks, LPV, View content, Add to cart, Checkout, Payment info, Purchases; null steps dropped; order never assumes LPV >= View content (the step rate can read above 100%, which is the truth). Cost per step is a row under the Funnel (not inside, because Funnel is read-only), CPM for impressions, CPA for purchases.
- Trend: five hand-rolled SVG small multiples with ghost comparison line aligned by bucket position; grain from `bucketGrain`; each point is a ratio of that bucket's sums.
- Campaigns: `cols` (Outcome/Funnel/Delivery), `stage`, `market` filters via the existing SegmentedControl (URL state), name link sets `?campaign=` and jumps to `#campaign-detail`, arrow opens Creative (`focus=campaignName`). Delta columns only when compare is on. Low volume (spend < 1% of table or purchases < 3): ROAS/CPA muted with "Low volume" dot, null sort key.
- Detail: ad sets (row click toggles `?adset=`), ads (top 20, Link CTR, Outbound CTR, Hook, Hold, "Open in Creative" with `focus=adId`), x closes. No thumbnails.
- Audience: Stage and Market live; Advantage+ segment, Age x gender, Placement, Geo are disabled segments, tooltip "Not ingested", no card text. Dual bar = share of spend over share of purchase value. NULL market renders "Unknown". PACKS/CBO/ASC stay Unclassified (from the mart).
- Outbound CTR renders "n/a" (column ingest is NULL live). Hook rate uses video plays; Hold uses ThruPlays (populated), not quartiles.
- Copy: section headings 1 to 3 words, no subtitles, empty states only `NotConnected` / `NoData`, no dashes, no dev vocabulary.

## Verification
- Deployed marts verified read-only (INFORMATION_SCHEMA.COLUMNS): `mart_meta_campaign_perf` has view_content, add_payment_info, funnel_stage, market, spend_client_ccy, revenue_client_ccy, client_currency; `mart_meta_campaign_dim` exists; `mart_meta_ad_perf` has outbound/quartile/view_content/add_payment_info. Migration 240 is live.
- `npx tsc --noEmit` exit 0; `npm run build` exit 0 (`/paid/meta` dynamic, log `scratchpad/pa5_build.log`); `npm run check:capabilities` 318/318; `npm run check:paid` 190/190.
- Grep gates on `app/(app)/paid/meta` and `components/paid/meta`: em/en dash, `bg-[#`, hex, `toLocaleString()`, `pageEyebrow(`, dev vocabulary, client names, `border-dashed`: all 0.
- Totals vs `mart_daily_kpis` (same query, 30d 2026-09-04 to 2026-10-03 and previous 2026-08-05 to 2026-09-03), ad account currency = client currency:
  - dobias current: spend 19,672.79 USD, revenue 49,746.18 on both sides; previous 18,373.60 / 48,727.84 on both sides.
  - manami current: spend 79,599.85 CZK, revenue 156,484.05 on both sides; previous 93,697.00 / 148,884.04 on both sides.
  - Funnel magnitudes confirm the no-assumption rule: dobias view_content 11,252 vs LPV 28,699 (below); manami 4,264 vs 2,813 (above).
- My SQL run read-only with literals for dobias: video rates (5 campaigns, plausible hook), ad sets rollup, ads (HAVING/ORDER BY by alias: `SUM(spend)` after an alias `spend` raises "Aggregations of aggregations", fixed). The row query is a plain select.
- Demo client rendered through `renderToStaticMarkup` (KPIs, funnel, trend, three column sets, detail, audience): no errors, campaign sums equal totals (diff ~1e-12), series sums equal totals, no dashes. Smoke script removed, not committed.
- Not done: visual check (no login), real-client render through the app.

## Open issues
1. `mart_creative_adset_perf` live has NO ad-set fallback (migration 225 is not deployed; the view returns 0 rows for every client). `getMetaAdsets` falls back to rolling `mart_meta_ad_perf` up by `adset_id`, but without names, so ad sets show their id. Deploying 225 (or ingesting adset insights) gives names; no app change needed.
2. Outbound CTR is n/a for every client until n8n requests outbound clicks (pa1 request 1 still open).
3. Cost: `mart_meta_campaign_perf` now joins the dim (pa1 cost note, about 22 MB and 66 s slot time per 30d scan). The tab runs it once per render. Very long ranges ("All time") return one row per campaign-day (order of 10k rows), acceptable today.
4. Venev October: not affected here (account-currency columns only); `*_client_ccy` unused.
5. On mobile the Funnel (shared component, `min-w-[560px]`) truncates labels of an 8-step funnel; fine on desktop.

## Requests to orchestrator
- Optional: `DeltaChip` / `KpiTile` could take a `unit: "pp"` option so the local `PpChip` in `components/paid/meta/cells.tsx` can be dropped (PA4, PA6 and PA7 need the same).
- Deploy migration 225 (ad-set fallback) or confirm adset insights ingest, so ad set names appear.
- Re-check the deployed column names after any later re-deploy of 240 (verified present 2026-10-04).
