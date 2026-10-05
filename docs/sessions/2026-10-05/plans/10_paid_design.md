# Marketing > Paid redesign: implementation spec

Date: 2026-10-04. Repo `one-eighty-dashboard-repo`, branch `cleanup/2026-10`. Warehouse `oneeighty-warehouse` (EU). I checked every BigQuery fact below today with read-only, partition-filtered queries, unless it is marked "verify".

---

## 0. What I checked in the warehouse and code (these facts shape the design)

**Google Ads DTS (`raw_google_ads`).**
- All roughly 100 `p_ads_*` base tables are loading for both accounts (manami 5865960448, rawbark 9406261058). That includes `ShoppingProductStats`, `SearchQueryStats`, `KeywordStats` + `Keyword`, `CampaignCrossDeviceStats` (impression share), `CampaignConversionStats` (conversion action category), `Budget`, `AdGroup*`, `GeoStats`, `AssetGroup` and `AssetGroupProductGroupStats`, `Hourly*` and `Video*`.
- None of them is modelled today. Only `CampaignBasicStats`, `Campaign` and `Customer` are read.
- **The partition date equals `segments_date`.** Mismatches were 0 of 2,082 rows in CampaignBasicStats and 0 of 11,597 in SearchQueryStats. So new views can expose `DATE(_PARTITIONTIME) AS date`, and the dashboard's date filter will prune partitions.
- **Use `CampaignBasicStats` for every spend split.**
  - It carries `segments_ad_network_type`, `segments_device` and `segments_slot`, and it reconciles exactly to `mart_daily_kpis` (rawbark 30d: 85,136 CZK).
  - `CampaignStats` must not be used for money. It is under by 12% for rawbark (74,884), it is missing part of PMax and Demand Gen cost, and its impressions are inflated by the click_type segment.
- **PMax channel split is available from DTS today**, as `ad_network_type` values SEARCH, YOUTUBE, CONTENT, DISCOVER, GMAIL and SEARCH_PARTNERS on PMax campaigns.
- **Impression share** is in `CampaignCrossDeviceStats`, keyed by campaign, date and network. It has search IS, lost IS (budget), lost IS (rank), top and absolute-top, and click share. "<10%" arrives as 0.0999.
- **Conversion scope.** `CampaignConversionStats` carries `segments_conversion_action_category`. Both accounts currently have only PURCHASE ("Nákup"), so purchase-only Google ROAS equals all-conversions ROAS today. This will not hold forever.
- **Coverage gaps, 30d to 2026-10-03:**
  - Search terms cover 22,765 of 36,199 CZK of rawbark Search spend (63%). This is the privacy threshold. KeywordStats covers all of it.
  - Product rows cover all of rawbark Shopping (7,167) but **none of rawbark PMax** (39.7k). For manami PMax they cover 3,440 of 13,318.
  - Demand Gen product rows also exist (723).
- **No PMax search terms or asset-group performance in DTS.** Both need the Google Ads API (Phase B).
- **Shopping item ids** are rawbark numeric ids (for example `14371`) and manami Shoptet codes (for example `469/10`). No shop mart carries those ids, so product titles need Merchant Center (Phase B).

**Meta.**
- `raw_meta_adset_insights`, `raw_meta_ad_breakdown_demo`, `raw_meta_ad_breakdown_placement` and `raw_meta_ad_accounts` exist with schemas but are empty for every client.
- `actions` in `raw_meta_campaign_insights` is a **JSON STRING live** (the DDL says ARRAY). It holds `omni_view_content`, `add_payment_info`, `omni_search` and so on, which can be pivoted with no re-ingest.
- **Campaign naming does not carry the funnel stage for most spend.** Live 90d names:
  - "PACKS CBO | CZ | 16JUN", "US I PACKS I CBO I 17JULY-26 I OE", "Prospecting | CZ | ABO", "CBO - Sales - Hlavní kampaň".
  - No retargeting token appears anywhere.
  - So the naming-based prospecting vs retargeting split will be mostly "Unclassified" until the Advantage+ segment breakdown lands.
- **Currency.** The Meta marts are in ad-account currency. `mart_daily_kpis` is FX-converted to client currency, so Venev is CZK on Meta and EUR in the shop.
  - **Bug:** the current Paid page formats Meta money with `client.currency`, so for Venev it prints CZK amounts as EUR.
  - `ref.fx_rates` ends 2026-09-01, so October Venev `meta_spend` in `mart_daily_kpis` is NULL until FX is refreshed.

**GA4.**
- `analytics_314809580` (dobias) and `analytics_343337695` (manami) run 2026-08-03 to yesterday.
- `analytics_324879665` (venev) has only 4 days in August and has been stalled since.
- The export carries `session_traffic_source_last_click` (default_channel_group, google_ads_campaign, manual_campaign) and `ecommerce.*`.
- `has_ga4` is FALSE for everyone and there is no `ref.ga4_properties`.

**Shop mart (`mart_daily_kpis`, live, 30d to 2026-10-03).**
- All five clients have rows, including the Woo clients.
- Example, manami: revenue 274,929, new-customer revenue 184,740, orders 260, new-customer orders 205, paid spend 92,918 CZK. That gives MER 2.96x, aMER 1.99x, nCAC 453 and blended CAC 357.
- **Cost:** one 30-day query scanned 308 MB at about 1.3M slot-ms. The Overview must read this mart once per render.

**Code.**
- `app/(app)/paid/page.tsx` decides what to render from query emptiness, not capabilities. It shows a permanent explanatory banner and dev text (the eyebrow prints `mart_meta_ad_perf`). It ignores Compare and Currency. CTR uses all clicks, and money prints with 0 decimals (`lib/format.ts:31`).
- Its "Frequency" sums daily reach, which is not period frequency.
- Sidebar active state is exact-match (`Sidebar.tsx:77`), so `/paid/meta` would not highlight Paid.
- Creative already supports deep links: `/creative?focus=<AdView field>&is=<value>` (generic field match in `CreativeGrid.tsx`), so `focus=adId&is=<ad_id>` and `focus=campaignName&is=<name>` work today. `focusLabel` falls back to the raw key name.
- **Paid is visible to the `client` role today.** The owner decision "internal users only" means it gets the same layout gate as Creative.

---

## 1. Information architecture

### 1.1 Routes and shell

| Route | Tab | Rendered when |
|---|---|---|
| `/paid` | Overview | always |
| `/paid/meta` | Meta | always; compact NotConnected if `!capabilities.meta` |
| `/paid/google` | Google | always; compact NotConnected if `!capabilities.googleAds` |
| `/paid/ga4` | GA4 | always; compact NotConnected if `!capabilities.ga4` |

- **`app/(app)/paid/layout.tsx` (new).**
  - Role gate: admin and agency only; `client` is redirected to `/snapshot`. This copies `creative/layout.tsx`.
  - Renders `PaidTabs`, sticky under the header and carrying the full query string, like `CreativeTabs`.
- **Nav.**
  - Paid stays one item in Marketing. It gains an `internalOnly` flag, which `navFor` filters for the client role.
  - Active state uses `pathname === href || pathname.startsWith(href + "/")`.
  - `pageTitle` and `pageEyebrow` use prefix match for `/paid`.
- **Tab dots.** The tab labels carry no status text. A tab for an unconnected platform shows its label at muted weight.
- **Controls.** All four tabs read `range` and `compare`. The currency toggle applies to Overview only. Meta and Google tabs render in the ad-account currency and pass `hideCurrency` to `PageControls`. GA4 renders in client currency.
- **States** (one shared component `components/dashboard/NotConnected.tsx`; text is exactly as shown):
  - Not connected (capability false): dashed card, one line, "Google Ads not connected". For internal users, a small link "Data health".
  - Connected, no rows in range: one line, "No Meta delivery in this range".
  - Stale (GA4 only, last export date older than 3 days): one line, "No GA4 data since 19 Aug".
  - Error: re-throw (existing rule).
- **Text policy.**
  - No subtitles, banners, methodology paragraphs, mart names or footers.
  - Definitions live in `MetricTooltip`, sourced from `lib/metrics.ts`.
  - The only inline chips allowed:
    - "Covers 63% of spend" (search terms, products);
    - "Low volume" (row marker);
    - "Meta not connected", as a badge on MER, aMER and nCAC when the client has Google but no Meta, because MER is then overstated.
- **Null display.** Use the existing null glyph from `lib/format.ts`. Never 0, never 0.00x.

### 1.2 Global metric rules (every tab)

- Every rate is SUM(numerator) / SUM(denominator) over the selected rows. No `_per_day` column is read, summed or averaged.
- Compare (`previous_period | previous_year | none`):
  - KPI tiles show a `DeltaChip`. Rates show pp; money, counts and ratios show %.
  - Campaign tables add `Δ Spend` and `Δ ROAS` columns only when compare is not `none`.
  - The current and comparison periods come from one query using `scanBounds` and `CASE WHEN date BETWEEN @from AND @to`.
- Sentiment:
  - Spend, frequency, impressions and share: neutral.
  - MER, aMER, ROAS, CTR, CVR, IS, new-customer revenue and new customers: up is good.
  - nCAC, CAC, CPA, CPM, CPC, cost/LPV, cost/ATC, lost IS and brand leakage: down is good.
- **Low volume** (`lib/paid/math.ts isLowVolume`):
  - Rule: a row is low volume if spend < 1% of the table total, or purchases (conversions) < 3.
  - Effect: ROAS and CPA render muted with a "Low volume" dot, and their sort keys are null so they sort last in both directions (DataTable already sorts nulls last).
- **Default sort:** spend descending, everywhere.
- **Money decimals.** Unit costs (CPC, CPM, cost/LPV, cost/ATC, CPA under 100) show 2 decimals. Totals show 0. This needs a `decimals` option on `formatMoney`.

### 1.3 Overview tab (`/paid`), shop-first and blended

Source for sections A, B, E: **one query** on `mart_daily_kpis` (Q-OV1). Everything is derived in TypeScript from daily rows over `scanBounds`. The currency toggle is honoured with `fxSql` (Snapshot pattern).

**A. Hero KPI row** (`MetricCard`, 4-up, delta + sparkline, WAREHOUSE badge with contributing sources on hover)

| Tile | Formula | Good when |
|---|---|---|
| Paid spend | `SUM(paid_spend)` | neutral |
| New-customer revenue | `SUM(new_customer_revenue)` | up |
| aMER | `SUM(new_customer_revenue) / SUM(paid_spend)` | up |
| nCAC | `SUM(paid_spend) / SUM(new_customer_orders)` (this is METRICS.md `CAC`) | down |

**B. Secondary row** (compact `MetricCard`, 4-up, delta, no sparkline)

| Tile | Formula |
|---|---|
| MER | `SUM(revenue) / SUM(paid_spend)` |
| CAC (blended) | `SUM(paid_spend) / SUM(orders)` (see Q2) |
| Revenue | `SUM(revenue)` |
| New customers | `SUM(new_customer_orders)` |

- Badge "Meta not connected" on MER, aMER, nCAC and CAC when `googleAds && !meta`. Likewise "Google not connected" is NOT shown, because Meta-only is the normal case.
- If a shop is missing (revenue NULL for all days), the shop tiles show null. Paid spend still renders.

**C. Spend and efficiency chart** (new `components/paid/overview/SpendEfficiencyChart.tsx`, recharts)

- Bars: spend stacked Meta and Google (platform tokens).
- Line: the selected efficiency metric from SegmentedControl `aMER | MER | nCAC`. Default aMER.
- Comparison: a dotted line for the same metric over the comparison period, aligned by day index.
- Grain: auto. Day if ≤ 45 days, week (ISO Monday) if ≤ 180, month beyond. Ratios are recomputed per bucket from summed components.

**D. By platform** (DataTable, 3 to 4 rows)

| Column | Meta / Google row | Total row |
|---|---|---|
| Spend | `SUM(meta_spend)` / `SUM(google_spend)` | `SUM(paid_spend)` |
| Share | platform spend / total paid spend | 100% |
| Purchases | `SUM(meta_purchases)` / `SUM(google_purchases)` | shop `SUM(orders)` |
| Value | `SUM(meta_revenue)` / `SUM(google_revenue)` | shop `SUM(revenue)` |
| ROAS | value / spend | MER |
| CPA | spend / purchases | CAC (blended) |
| GA4 revenue (only if `ga4`) | GA4 last-click revenue attributed to that platform (Q-OV3) | GA4 paid total |
| GA4 ROAS (only if `ga4`) | GA4 revenue / spend | GA4 paid / paid spend |

- A row for an unconnected platform is a single muted cell spanning the columns: "Not connected".
- The platform rows are visually a sub-block ("platform-reported" tooltip on the header). The Total row is the shop.

**E. Period table** (DataTable)

- Rows are buckets at the same grain as C.
- Columns: Period, Paid spend, Meta, Google, Revenue, New-customer revenue, MER, aMER, nCAC, New customers.
- Sort: period descending.

**F. Spend mix** (new `SpendMix.tsx`; two 100% stacked horizontal bars)

- Meta bar: Prospecting / Retargeting / Retention / Unclassified, by `mart_meta_campaign_dim.funnel_stage` (Phase A naming rules; Phase B prefers the Advantage+ segment share).
- Google bar: Brand / Non-brand / Shopping & PMax / Other, by `mart_gads_campaign_dim.brand_class`.
- Segment hover shows spend, share and ROAS.
- Clicking a segment links to the platform tab filtered: `?stage=retargeting` or `?class=brand`.

**G. Campaigns, all platforms** (DataTable, top 15 by spend, Q-OV2)

- Columns: platform dot, Campaign, Type (Meta funnel stage, or Google channel type plus brand class), Spend, Δ Spend, Value, ROAS, Δ ROAS, CPA, Purchases.
- Money is in client currency (`*_client_ccy` columns), so rows are comparable.
- Row click goes to `/paid/meta?campaign=<id>` or `/paid/google?campaign=<id>`, keeping the query string.

### 1.4 Meta tab (`/paid/meta`)

- Currency is `client.metaCurrency`.
- Gate: `!capabilities.meta` shows NotConnected. No rows in range shows the one-line empty state.

**A. KPI row 1** (KpiTile with delta, 5 tiles: 5-up desktop, 2-up mobile)

| Tile | Formula |
|---|---|
| Spend | `SUM(spend)` |
| Purchase value | `SUM(revenue)` (= purchase_value) |
| ROAS | `SUM(revenue) / SUM(spend)` |
| Purchases | `SUM(purchases)` |
| CPA | `SUM(spend) / SUM(purchases)` |

**B. KPI row 2, soft metrics** (8 compact tiles, 4-up)

| Tile | Formula | Source |
|---|---|---|
| CPM | `SUM(spend) / SUM(impressions) * 1000` | campaign perf |
| Link CTR | `SUM(link_clicks) / SUM(impressions)` | campaign perf |
| CPC (link) | `SUM(spend) / SUM(link_clicks)` | campaign perf |
| Cost / LPV | `SUM(spend) / SUM(landing_page_views)` | campaign perf |
| Cost / ATC | `SUM(spend) / SUM(add_to_cart)` | campaign perf |
| ATC to purchase | `SUM(purchases) / SUM(add_to_cart)` | campaign perf |
| Frequency | Phase A: `SUM(impressions) / SUM(reach)` over daily rows, labelled "Avg daily frequency" in the tooltip. Phase B: exact period frequency `reach_windows.impressions / reach_windows.reach` when the range matches a stored window, else the daily average. | campaign perf / `mart_meta_reach_windows` |
| Hook rate | `SUM(video_play_actions) / SUM(impressions)` over ads with `video_play_actions > 0` in range. This is the same definition as Creative `hookRate`, restricted to video ads. Tooltip also gives hold rate `SUM(video_thruplays) / same denominator`. | `mart_meta_ad_perf` |

**C. Funnel** (existing `Funnel`, broken scale)

- Steps: Impressions, Link clicks, LPV, View content (new column), Add to cart, Initiate checkout, Add payment info (new), Purchases.
- Each step shows its count, step rate (step / previous step) and cost per step (spend / step).
- Steps with NULL are dropped.

**D. Trend small multiples** (new `MetaTrend.tsx`)

- Five sparkline cards: ROAS, CPA, CPM, Link CTR, Cost/ATC.
- Daily if ≤ 45 days, else weekly. Each card has a comparison ghost line.
- The point is diagnosis (is CPM or conversion moving?) without text.

**E. Campaigns** (DataTable)

- Column-set SegmentedControl: `Outcome | Funnel | Delivery`. The URL param `cols` keeps the table narrow.
  - Always: Campaign, Stage, Spend, Δ Spend (compare).
  - Outcome: Value, ROAS, Δ ROAS, Purchases, CPA, AOV (`SUM(revenue)/SUM(purchases)`).
  - Funnel: Link CTR, LPV rate (`SUM(lpv)/SUM(link_clicks)`), Cost/LPV, ATC rate (`SUM(atc)/SUM(lpv)`), Cost/ATC, ATC to purchase.
  - Delivery: Impressions, CPM, CPC (link), Avg daily frequency, Hook rate.
- Sort: spend descending. Filter chips from `?stage=` (Prospecting, Retargeting, Retention, Unclassified) and `?market=`.
- Row click sets `?campaign=<campaign_id>` (server-rendered; URL is the state) and scrolls to F.
- A row icon opens Creative: `/creative?<range params>&client=<id>&focus=campaignName&is=<campaign_name>`.

**F. Selected campaign detail** (only when `?campaign=` is set)

- Ad sets (source `mart_creative_adset_perf`, which already falls back to the ad rollup):
  - Columns: Ad set, Spend, ROAS, Purchases, CPA, CPM, Link CTR, Cost/ATC.
  - Reach and frequency stay NULL while the adset feed is empty.
  - Row click sets `?adset=<id>`, which filters the ads table.
- Ads (source `mart_meta_ad_perf`, top 20 by spend in campaign or adset):
  - Columns: Ad, Spend, ROAS, Purchases, CPA, Link CTR, Outbound CTR (`SUM(outbound_clicks)/SUM(impressions)`), Hook, Hold.
  - Each row has an "Open in Creative" icon linking `/creative?...&focus=adId&is=<ad_id>`.
  - **No thumbnails or creative scoring here. That is Creative's job.**
- Close: a small `x` that removes `campaign` and `adset` from the URL.

**G. Audience** (new `AudienceBreakdown.tsx`; dimension SegmentedControl in `?aud=`)

| Dimension | Phase | Source | Rows |
|---|---|---|---|
| Stage (naming) | A | `mart_meta_campaign_perf` + dim | Prospecting / Retargeting / Retention / Unclassified |
| Market (naming) | A | same | extracted market token, else Unknown |
| Advantage+ segment | B | `mart_meta_segment_daily` | New audience / Engaged audience / Existing customers / Unknown |
| Age x gender | B | `mart_meta_demo_daily` | heat table: age rows by gender columns, cell = spend share, ROAS on hover |
| Platform / placement / device | B | `mart_meta_placement_daily` | publisher_platform > platform_position, device toggle |
| Country / region | B | `mart_meta_geo_daily` | country, expandable to region |

- Each list row shows a dual bar (share of spend vs share of purchase value), plus Spend, ROAS, CPA, CPM, Link CTR (Link CTR where the breakdown carries link clicks).
- Not-yet-ingested dimensions render as disabled segments with the tooltip "Not ingested". There is no card text.
- Reach is never summed across days in breakdowns.

**H. Link out.** One text link at the bottom: "Creatives", to `/creative` with the same query string. This avoids duplicating ad-level creative analysis.

### 1.5 Google tab (`/paid/google`)

- Currency is `client.gadsCurrency`. Data always ends D-1 (existing rule: `date < CURRENT_DATE()`).
- Gate: `!capabilities.googleAds` shows NotConnected.

**A. KPI row 1** (5 tiles)

| Tile | Formula |
|---|---|
| Spend | `SUM(spend)` |
| Conv. value | `SUM(conversions_value)` |
| ROAS | `SUM(conversions_value) / SUM(spend)` |
| Conversions | `SUM(conversions)` (fractional, 1 decimal) |
| CPA | `SUM(spend) / SUM(conversions)` |

The "conversions" scope follows Q3. Default: purchase-category columns `purchases` and `purchase_value`.

**B. KPI row 2** (8 compact tiles)

| Tile | Formula |
|---|---|
| Brand share | `SUM(spend where brand_class='brand') / SUM(spend)` |
| Non-brand ROAS | value / spend over `brand_class IN ('non_brand','shopping_pmax')` |
| Search IS | `SUM(is_impressions) / SUM(eligible_impressions)` over Search-network rows with IS reported |
| Lost IS (budget) | `SUM(lost_budget_impressions) / SUM(eligible_impressions)` |
| Lost IS (rank) | `SUM(lost_rank_impressions) / SUM(eligible_impressions)` |
| CTR | `SUM(clicks) / SUM(impressions)` |
| CPC | `SUM(spend) / SUM(clicks)` |
| Brand leakage | `SUM(spend of brand search terms in non-brand campaigns) / SUM(search-term spend in non-brand campaigns)` |

Impression-share components are computed in the view per campaign, day and network:
- `eligible_impressions = impressions / search_impression_share`, only where IS > 0;
- `lost_budget_impressions = eligible * search_budget_lost_impression_share`;
- the same pattern for lost to rank, top and absolute-top.

This is the only correct way to re-aggregate IS.

**C. Brand vs non-brand** (new `BrandSplit.tsx`, 3 or 4 columns: Brand, Non-brand, Shopping & PMax, Other)

- Per column: Spend, Share, Value, ROAS, Conversions, CPA, CPC, Search IS (where applicable). Each has a delta.
- Classification rules are in 2.4.

**D. Campaigns** (DataTable; column-set `Outcome | Auction | Budget`)

- Always: Campaign, Type (Search, Shopping, PMax, Demand Gen, Video, Display), Class, Spend, Δ Spend.
- Outcome: Value, ROAS, Δ ROAS, Conversions, CPA, CVR (`SUM(conversions)/SUM(clicks)`), CTR, CPC.
- Auction: Search IS, Top IS, Abs. top IS, Lost IS budget, Lost IS rank, Click share. Click share uses the same eligible-weighting where reported.
- Budget: Bid strategy (+ target ROAS from `campaign_maximize_conversion_value_target_roas`), Budget/day (latest `campaign_budget_amount_micros / 1e6`), Spend/day (`SUM(spend)/days with delivery`), Utilisation (spend/day ÷ budget/day). This needs no ingestion.
- Filter via `?class=`. Row click sets `?campaign=<id>`.

**E. Selected campaign detail**

- Search and Shopping: ad groups table (`mart_gads_adgroup_daily`): Ad group, Spend, Value, ROAS, Conversions, CPA, CTR, CPC.
- PMax: channel split bar for that campaign (see F), plus asset groups (Phase B).
- All types: device mini-split (Mobile, Desktop, Tablet, TV): spend share and ROAS from `mart_gads_campaign_daily.device`.

**F. PMax channel split** (only if any PMax spend)

- One row per PMax campaign: a 100% stacked bar of spend by network (Search incl. Shopping, YouTube, Display, Discover, Gmail, Search partners), with a value-share bar beneath.
- Hover shows spend, value and ROAS per network.

**G. Search terms** (DataTable, top 200 by spend in range; `?st=all|brand|nonbrand|waste`)

- Columns: Search term, Campaign, Match type, Brand (dot), Status (Added / Excluded / None), Spend, Clicks, Conversions, Value, ROAS, CPA, CPC.
- `waste` = spend > 0 AND conversions = 0, sorted by spend.
- Chip in the header: "Covers N% of spend", where N = search-term spend / spend of SEARCH-channel campaigns.
- A secondary SegmentedControl `Search terms | Keywords` switches to the keyword table: Keyword, Match type, QS (latest), Spend, Conversions, Value, ROAS, CPA, CTR, CPC.
- Phase B adds a third option, `PMax terms`: category label, impressions, clicks, conversions, value, and no cost if the API does not expose it.

**H. Products** (DataTable, top 200 by spend; group-by SegmentedControl `Product | Product type | Brand | Custom label 0`)

- Columns: Item (Phase A: item id + product type L1; Phase B: Merchant Center title + availability dot), Campaign type, Spend, Clicks, Conversions, Value, ROAS, CPA, CTR.
- Toggle "Zero-conversion spenders".
- Chip "Covers N% of spend", where N = product spend / spend of SHOPPING + PMAX campaigns. Rawbark PMax will show low coverage, which is true.

### 1.6 GA4 tab (`/paid/ga4`)

- Currency: client currency. GA4 revenue is assumed to be in property currency equal to shop currency (verify per property).
- Gate: `!capabilities.ga4` shows NotConnected. If the capability is set but `MAX(date) < today - 3`, show the stale state.

**A. KPI row** (5 tiles, delta)

| Tile | Formula |
|---|---|
| Paid sessions | `SUM(sessions)` where `platform != 'non_paid'` |
| Paid purchases | `SUM(purchases)` (distinct transaction ids per session) |
| Paid revenue | `SUM(revenue)` (last-click, session-scoped) |
| Paid CVR | `SUM(sessions_purchase) / SUM(sessions)` paid |
| Paid share of GA4 revenue | paid revenue / `SUM(revenue)` all channels |

**B. Attribution cross-check** (DataTable; the reason this tab exists)

| Column | Meta row / Google row | Total paid row |
|---|---|---|
| Spend | platform spend (`mart_daily_kpis`, client ccy) | `SUM(paid_spend)` |
| Platform value | `meta_revenue` / `google_revenue` | sum |
| GA4 revenue | GA4 revenue where `platform` = meta / google | GA4 paid |
| Platform ROAS | platform value / spend | |
| GA4 ROAS | GA4 revenue / spend | |
| Over-claim | platform value / GA4 revenue (x) | |

- Footer row "Shop": shop `SUM(revenue)`, GA4 all-channel revenue, and tracking coverage = GA4 all-channel revenue / shop revenue (tooltip notes VAT differences, for example Manami).

**C. Paid channels** (DataTable by `default_channel_group`, paid groups only: Paid Social, Paid Search, Paid Shopping, Paid Video, Cross-network, Display, Paid Other)

- Columns: Sessions, Engaged rate (`SUM(engaged_sessions)/SUM(sessions)`), ATC rate (`SUM(sessions_atc)/SUM(sessions)`), CVR, Purchases, Revenue, AOV (`SUM(revenue)/SUM(purchases)`).

**D. Funnel by channel** (existing `Funnel`; SegmentedControl `All paid | Paid Social | Paid Search | Paid Shopping | Cross-network`)

- Steps: Sessions, Sessions with view_item, add_to_cart, begin_checkout, purchase. Step rates are shown.

**E. Landing pages** (DataTable, paid sessions, top 50 by sessions)

- Columns: Landing path, Sessions, Meta share (sessions), Google share, Engaged rate, ATC rate, CVR, Revenue.
- Platform filter `?lp=all|meta|google`.

### 1.7 Sort defaults and drilldown summary

- Every table sorts by spend descending. GA4 tables sort by sessions. Period tables sort by period descending.
- Drill paths:
  - Overview campaign -> Meta or Google tab `?campaign=`.
  - Meta campaign -> adsets -> ads -> Creative (`focus=adId`).
  - Meta campaign icon -> Creative (`focus=campaignName`).
  - Google campaign -> ad groups / PMax channels / devices.
  - Spend mix segment -> tab filtered by `stage` or `class`.
- All links preserve `client, preset, from, to, compare` (`lib/paid/links.ts`).
- `lib/creative/vocabulary.ts focusLabel` gains labels for `adId` ("Ad") and `campaignName` ("Campaign"), so the Creative chip reads properly.

---

## 2. Data layer

### 2.1 Widget to source map

| Tab / widget | Source (mart) | Status |
|---|---|---|
| Overview A, B, C, D (platform rows), E | `mart_daily_kpis` (one query, Q-OV1) | exists |
| Overview D GA4 columns | `mart_ga4_sessions_daily` | NEW (A3) |
| Overview F, G | `mart_meta_campaign_perf` (+ `*_client_ccy`, stage) and `mart_gads_campaign_daily` (+ `*_client_ccy`, class) | CHANGED / NEW |
| Meta A, B, C, D, E, G (stage, market) | `mart_meta_campaign_perf` (CHANGED), `mart_meta_campaign_dim` (NEW) | A1 |
| Meta hook/hold, outbound, ads table | `mart_meta_ad_perf` (CHANGED: + outbound, quartiles) | A1 |
| Meta adsets | `mart_creative_adset_perf` | exists (fallback until B1) |
| Meta Freq (exact) | `mart_meta_reach_windows` | NEW (B) |
| Meta audience: segment / demo / placement / geo | `mart_meta_segment_daily`, `mart_meta_demo_daily`, `mart_meta_placement_daily`, `mart_meta_geo_daily` | NEW (B) |
| Google A to F | `mart_gads_campaign_daily`, `mart_gads_campaign_dim`, `mart_gads_adgroup_daily` | NEW (A2) |
| Google G | `mart_gads_search_terms_daily`, `mart_gads_keywords_daily` | NEW (A2) |
| Google G (PMax terms) | `mart_gads_pmax_search_terms` | NEW (B) |
| Google H | `mart_gads_products_daily` (+ GMC titles in B) | NEW (A2), CHANGED (B) |
| Google E (asset groups) | `mart_gads_asset_group_daily` | NEW (B) |
| GA4 A to E | `mart_ga4_sessions_daily`, spend from `mart_daily_kpis` | NEW (A3) |

### 2.2 Partition and filter rules for new views

- **DTS-based views:**
  - Expose `date = DATE(_PARTITIONTIME)` (verified equal to `segments_date`), so the dashboard's `date BETWEEN` prunes partitions.
  - Bound the view with `WHERE _PARTITIONTIME >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 25 MONTH)) AND DATE(_PARTITIONTIME) < CURRENT_DATE()`.
  - Map accounts to clients only via `ref.clients.gads_customer_id` with `has_gads`.
- **Entity tables** (`p_ads_Campaign_*`, `Keyword`, `AdGroup`, `Budget`, `AssetGroup`):
  - Take the latest row per id with `QUALIFY ROW_NUMBER() OVER (PARTITION BY customer_id, <id> ORDER BY _PARTITIONTIME DESC) = 1`.
  - Bound with `_PARTITIONTIME >= 400 days ago`, so removed campaigns keep their names.
- **Meta views:** filter `date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 MONTH)` (existing convention). Raw tables have `require_partition_filter`.
- **Dashboard queries:** always `WHERE client_id = @clientId AND date BETWEEN @from AND @to` (or `scanBounds`). All parameterised.
- **Currency columns:** every money column is in the native account currency, plus `*_client_ccy` computed per row with that month's `ref.fx_rates` rate (same pattern as `mart_daily_kpis`: factor applied before SUM; a missing rate gives NULL, never a wrong number).

### 2.3 New and changed BigQuery objects

Files go in `infra/bigquery/`, numbered after 226.

**227_paid_meta_marts.sql (Phase A, data in raw)**

1. **NEW `ref.naming_rules`**
   ```sql
   CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.naming_rules` (
     client_id   STRING NOT NULL,   -- '*' = global default
     platform    STRING NOT NULL,   -- 'meta' | 'google'
     entity      STRING NOT NULL,   -- 'campaign' | 'adset'
     dimension   STRING NOT NULL,   -- 'funnel_stage' | 'market'
     pattern     STRING NOT NULL,   -- RE2, matched case-insensitively on the lowercased name
     value       STRING,            -- NULL = use capture group 1, upper-cased (markets)
     priority    INT64  NOT NULL,   -- lower wins; client rules always beat '*'
     note        STRING,
     updated_at  TIMESTAMP NOT NULL
   ) CLUSTER BY client_id;
   ```
   Seed (`*`, meta, campaign):
   - funnel_stage `retargeting`: `\b(rt|rmk|retarget\w*|remarketing|warm|bof|mof)\b` (p10)
   - funnel_stage `retention`: `\b(retention|existing|loyal\w*|repeat)\b` (p20)
   - funnel_stage `prospecting`: `\b(prospect\w*|broad|tof|acq\w*|cold|lal|lookalike)\b` (p30)
   - market: `(?:^|[\s|_-])(us|ca|cz|sk|de|at|pl|hu|eu)(?:$|[\s|_-])` (p10)

   Whether `packs|cbo|asc` count as prospecting is Q1.
2. **NEW `ref.campaign_overrides`**: `client_id, platform, campaign_id, funnel_stage, brand_class, market, note, updated_at`. Manual fixes win over rules.
3. **NEW `mart.mart_meta_campaign_dim`**
   - Grain: (client_id, campaign_id).
   - Columns: `client_id, campaign_id, campaign_name` (latest by date), `first_date, last_date, funnel_stage` (override > client rule > global rule > 'unclassified'), `market, classified_by` ('override' | 'rule' | 'none').
   - Source: `stg.stg_meta_campaign_insights`, `ref.naming_rules`, `ref.campaign_overrides`.
4. **CHANGED `mart.mart_meta_campaign_perf`** (additive columns only; existing consumers are unaffected):
   - `view_content`: from the actions JSON, `omni_view_content`. Expression: `(SELECT SUM(SAFE_CAST(JSON_VALUE(a,'$.value') AS NUMERIC)) FROM UNNEST(JSON_QUERY_ARRAY(i.actions)) a WHERE JSON_VALUE(a,'$.action_type')='omni_view_content')`.
   - `add_payment_info`: same pattern, `add_payment_info`.
   - `funnel_stage, market`: join the dim.
   - `spend_client_ccy, revenue_client_ccy, client_currency`: FX by month, as in `mart_daily_kpis`.
5. **CHANGED `mart.mart_meta_ad_perf`**: add `outbound_clicks, unique_outbound_clicks, video_p25_watched, video_p50_watched, video_p75_watched, video_p95_watched, video_p100_watched, video_30s_watched, view_content, add_payment_info, adset_id` (adset_id already present).
6. Regression: zero-diff on existing columns in `mart_qa`, all clients and days (SOP).

**228_ref_client_brand_terms.sql (Phase A)**

```sql
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.client_brand_terms` (
  client_id     STRING    NOT NULL,
  term          STRING    NOT NULL,            -- as typed, for display ("RawBark", "raw bark")
  term_norm     STRING    NOT NULL,            -- lower(), diacritics stripped, whitespace collapsed; written by the INSERT helper
  match_type    STRING    NOT NULL,            -- 'contains' | 'word' | 'exact' | 'regex'
  is_exclusion  BOOL      NOT NULL,            -- TRUE = a match on this term makes the text NOT brand (e.g. a generic word containing the brand)
  applies_to    STRING    NOT NULL,            -- 'all' | 'search_term' | 'campaign'
  note          STRING,
  added_by      STRING,
  updated_at    TIMESTAMP NOT NULL
)
CLUSTER BY client_id
OPTIONS (description = "Per-client brand vocabulary. Classifies Google campaigns and search terms (incl. PMax search term insights) as brand or non-brand. One row per term variant; misspellings are separate rows.");
```

- Normalisation expression (inline in views, and in the runbook INSERT helper):
  `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(NORMALIZE(x, NFD)), r'\p{M}', ''), r'\s+', ' '))`
- Brand match for a normalised text `t`, client `c`, scope `s`:
  - EXISTS a non-exclusion term (applies_to IN ('all', s)) where:
    - contains: `STRPOS(t, term_norm) > 0`
    - word: `REGEXP_CONTAINS(t, CONCAT(r'(^|\W)', term_norm, r'(\W|$)'))`
    - exact: `t = term_norm`
    - regex: `REGEXP_CONTAINS(t, term_norm)`
  - AND NOT EXISTS a matching exclusion term.
- Seed now: manami (`manami`) and rawbark (`rawbark`, `raw bark`). Further variants are owner input (Section 5).

**229_gads_marts.sql (Phase A, data in raw)**

| Object | Grain | Columns | Raw sources |
|---|---|---|---|
| `mart.mart_gads_campaign_dim` (NEW) | client_id, campaign_id | `campaign_name, channel_type, channel_sub_type, status, serving_status, bidding_strategy_type, target_roas, budget_per_day` (amount_micros / 1e6 when period DAILY), `budget_shared, brand_class, market` (naming rule), `currency` (gads_currency) | `p_ads_Campaign_*`, `p_ads_Budget_*`, `ref.client_brand_terms`, `ref.naming_rules`, `ref.campaign_overrides` |
| `mart.mart_gads_campaign_daily` (NEW) | client_id, date, campaign_id, ad_network_type, device | `spend, impressions, clicks, conversions, conversions_value, view_through_conversions`; `purchases, purchase_value` (category PURCHASE, joined at campaign x date x network, placed on device = 'ALL' rows only; see note); `is_impressions, eligible_impressions, lost_budget_impressions, lost_rank_impressions, top_impressions, abs_top_impressions` (SEARCH network only); `spend_client_ccy, conversions_value_client_ccy, purchase_value_client_ccy, currency, client_currency`; dim columns denormalised (`campaign_name, channel_type, brand_class`) | `p_ads_CampaignBasicStats_*`, `p_ads_CampaignCrossDeviceStats_*`, `p_ads_CampaignConversionStats_*`, dim |
| `mart.mart_gads_adgroup_daily` (NEW) | client_id, date, campaign_id, ad_group_id | `ad_group_name, ad_group_type, spend, impressions, clicks, conversions, conversions_value` | `p_ads_AdGroupBasicStats_*`, `p_ads_AdGroup_*` |
| `mart.mart_gads_search_terms_daily` (NEW) | client_id, date, campaign_id, ad_group_id, search_term, match_type | `term_status` (search_term_view_status), `keyword_criterion, is_brand` (scope 'search_term'), `spend, impressions, clicks, conversions, conversions_value`, `campaign_brand_class` (for leakage) | `p_ads_SearchQueryStats_*`, `ref.client_brand_terms`, dim |
| `mart.mart_gads_keywords_daily` (NEW) | client_id, date, campaign_id, ad_group_id, criterion_id | `keyword_text, match_type, is_negative` (filtered out), `quality_score, predicted_ctr, creative_quality, landing_page_quality` (latest entity), `is_brand, spend, impressions, clicks, conversions, conversions_value` | `p_ads_KeywordStats_*`, `p_ads_Keyword_*` |
| `mart.mart_gads_products_daily` (NEW) | client_id, date, campaign_id, item_id | `channel_type` (from dim), `brand, product_type_l1, product_type_l2, category_l1, custom_label_0..2, product_country, spend, impressions, clicks, conversions, conversions_value` | `p_ads_ShoppingProductStats_*`, dim |

Notes for 229:
- **One grain per view.** In `mart_gads_campaign_daily`, the device dimension and the conversion-category join conflict, because `CampaignConversionStats` has no device. Simplest correct build:
  - Keep `mart_gads_campaign_daily` at campaign x date x network (device summed away). Purchase columns join cleanly there.
  - Add `mart_gads_campaign_device_daily` (campaign x date x device; spend, impressions, clicks, conversions, value) for the device mini-split.
  - Use this two-view layout; the table above lists device in the grain only for the second view.
- `conversions` keeps the account's primary-conversion definition. `purchases` uses category PURCHASE. Which one the UI shows is Q3.
- **Brand class rule (campaign):**
  1. override;
  2. channel SHOPPING or PERFORMANCE_MAX gives `shopping_pmax`;
  3. channel SEARCH and the normalised name matches `\bbrand\b` or any brand term (scope 'campaign') gives `brand`;
  4. SEARCH gives `non_brand`;
  5. else `other`.
- Never take spend from `p_ads_CampaignStats_*` (it is 12% under for rawbark).
- Add a regression query in the file: per client and month, `SUM(spend)` of `mart_gads_campaign_daily` must equal `mart_daily_kpis.google_spend` (native ccy).

**230_ga4_sessions.sql (Phase A, data in raw; needs Q5 approval)**

1. **NEW `ref.ga4_properties`**: `client_id, property_id STRING, dataset_id STRING, hostname_pattern STRING, is_primary BOOL, valid_from DATE, valid_to DATE, note, updated_at`.
   Seed:
   - dobias: 314809580, `analytics_314809580`, `peterdobias\.com`
   - manami: 343337695, `analytics_343337695`, `eshop\.manami\.cz`
   - venev: 324879665, `analytics_324879665`, `venev\.(eu|cz)` (stalled)
2. **NEW table `stg.ga4_sessions`**
   - Partitioned by `date`, clustered by `client_id`. It is a derived table, so it is written by a procedure, not n8n.
   - Grain: one row per session (client_id, date, session_key).
   - Columns:
     - `session_key` (FARM_FINGERPRINT of user_pseudo_id and ga_session_id; no PII);
     - `channel_group` (session_traffic_source_last_click.cross_channel_campaign.default_channel_group);
     - `source, medium, campaign_name, gads_customer_id, gads_campaign_id`;
     - `platform`: 'meta' if source matches `(facebook|fb|instagram|ig|meta)` and the channel group is paid; 'google' if gads_campaign_id is not null, or source = 'google' and medium in ('cpc','ppc'); 'other_paid' for remaining paid groups; else 'non_paid';
     - `landing_path` (path of the first page_view with entrances = 1, query string stripped);
     - `device, country, engaged` (session_engaged = '1');
     - `has_view_item, has_add_to_cart, has_begin_checkout, has_purchase`;
     - `purchases` (COUNT DISTINCT ecommerce.transaction_id), `revenue` (SUM ecommerce.purchase_revenue);
     - `loaded_at`.
3. **NEW procedure `ops.sp_load_ga4_sessions(days INT64)`**
   - Loops `ref.ga4_properties` with `FOR ... EXECUTE IMMEDIATE` over `<dataset>.events_*`, using `_TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', D-days) AND D-1`.
   - Deletes and re-inserts those dates (the table is derived, not raw).
   - This follows the `224_sp_rebuild_creative_tags.sql` pattern.
   - Scheduled query: `CALL ops.sp_load_ga4_sessions(3)` daily 07:00 UTC. Backfill with `CALL ...(70)`.
4. **NEW view `mart.mart_ga4_sessions_daily`**
   - Grain: client_id, date, channel_group, platform, source, medium, campaign_name, landing_path, device.
   - Columns: `sessions, engaged_sessions, sessions_view_item, sessions_atc, sessions_checkout, sessions_purchase, purchases, revenue, currency` (client currency).
5. Registry: `UPDATE ref.clients SET has_ga4 = TRUE` for dobias, manami, venev.

**231 to 236: Phase B (ingestion)**

| Object | Status | Needs |
|---|---|---|
| `raw.raw_meta_adset_insights` | table exists, empty | n8n change: add the adset-level insights call (time_increment=1, same fields as campaign + outbound_clicks) to `wf_meta_ads`. `mart_creative_adset_perf` switches automatically. |
| `raw.raw_meta_ad_breakdown_demo` | exists, empty | n8n: ad-level `breakdowns=age,gender`. ALTER ADD `link_clicks, landing_page_views, add_to_cart, initiate_checkout`. Backfill 90 days. |
| `raw.raw_meta_ad_breakdown_placement` | exists, empty | n8n: `breakdowns=publisher_platform,platform_position,impression_device`. Same ALTER. |
| `raw.raw_meta_adset_breakdown_segment` | NEW | n8n: adset-level `breakdowns=user_segment_key` (Advantage+ audience segments). Requires the existing-customer and engaged-audience definitions in Ads Manager advertising settings; verify per account. Columns: client_id, ingested_at, ingest_source, ad_account_id, campaign_id, adset_id, date_start, date_stop, user_segment_key, spend, impressions, reach, clicks, link_clicks, landing_page_views, add_to_cart, purchases, purchase_value, payload_json. Partition date_start, cluster client_id, campaign_id. |
| `raw.raw_meta_adset_breakdown_geo` | NEW | n8n: two calls (`breakdowns=country`, `breakdowns=region`), columns as segment plus `geo_level, geo_value`. |
| `raw.raw_meta_reach_windows` | NEW | n8n: daily, no time_increment, `time_range` for windows 7d, 28d, 30d, 90d, mtd, plus each window's previous period, at account and campaign level. Columns: client_id, ingested_at, snapshot_date, level, entity_id, window_key, date_from, date_to, reach, impressions, spend, payload_json. Partition snapshot_date. |
| stg views + `mart_meta_segment_daily`, `mart_meta_demo_daily` (ad to campaign rollup via ad_id to campaign_id from `stg_meta_ad_insights`), `mart_meta_placement_daily`, `mart_meta_geo_daily`, `mart_meta_reach_windows` (latest snapshot) | NEW | SQL only, after ingestion |
| `raw.raw_gads_api_pmax_terms` | NEW | n8n `wf_gads_api`: GAQL `campaign_search_term_insight` (category labels; one campaign per query; impressions, clicks, conversions, value; no cost). If the API version in use exposes term-level PMax search terms with cost, use that instead. Verify against current Google Ads API release notes before building. Needs a developer token on the MCC, an OAuth refresh token and the `login-customer-id` header (Q4). |
| `raw.raw_gads_api_asset_groups` | NEW | same workflow: GAQL `asset_group` with segments.date and cost, impressions, clicks, conversions, conversions_value, plus `asset_group.ad_strength`. |
| `raw_gmc.Products_<merchant_id>` | NEW | DTS change: Google Merchant Center transfer per merchant, and authorize `raw_gmc` for stg and mart. Add `ref.clients.gmc_merchant_id INT64`. Gives title, availability, price and product type for `mart_gads_products_daily` (CHANGED: + `title, availability, price`). |

Phase B classification upgrade: once `mart_meta_segment_daily` has rows, Overview Spend mix and Meta Audience use segment shares (New / Engaged / Existing) instead of naming stage for Meta. The naming stage stays as a filter.

### 2.4 Dashboard query modules (new files)

| Module | Functions (all take clientId, period or range; all have an `isDemo` branch) |
|---|---|
| `lib/queries/paidOverview.ts` | `getPaidDaily(clientId, period, displayCurrency)` (Q-OV1), `getCampaignsAcross(clientId, period, limit)` (Q-OV2, UNION of Meta and Google in client ccy), `getSpendMix(clientId, range)`, `getGa4PlatformTotals(clientId, range)` (Q-OV3) |
| `lib/queries/paidMeta.ts` | `getMetaTotals(period)` (+ daily series), `getMetaCampaigns(period, filters)`, `getMetaVideoRates(range, campaignId?)`, `getMetaAdsets(range, campaignId)`, `getMetaAds(range, campaignId, adsetId?)`, `getMetaAudience(range, dim)`, `getMetaReachWindow(range)` (B) |
| `lib/queries/paidGoogle.ts` | `getGadsTotals(period)` (+ series, IS components), `getGadsCampaigns(period, cls)`, `getGadsClassSplit(period)`, `getGadsPmaxSplit(range)`, `getGadsAdGroups(range, campaignId)`, `getGadsDevices(range, campaignId)`, `getGadsSearchTerms(range, mode)`, `getGadsKeywords(range)`, `getGadsProducts(range, groupBy)`, `getGadsCoverage(range)` |
| `lib/queries/paidGa4.ts` | `getGa4Kpis(period)`, `getGa4CrossCheck(range)` (GA4 + `mart_daily_kpis` spend), `getGa4Channels(range)`, `getGa4Funnel(range, channel)`, `getGa4LandingPages(range, platform)`, `getGa4LastDate(clientId)` |

---

## 3. Phasing and work packages

Rules: each package owns its files exclusively. Shared files are owned by A0 only. UI packages start after A0 merges; they can stub against the SQL column contracts in 2.3 and wire up when their SQL package lands.

### Phase A (this week, data already in raw)

**WP-A0 Foundation (merge first; about half a day)**
- New: `app/(app)/paid/layout.tsx` (role gate + `PaidTabs`), `components/paid/PaidTabs.tsx`, `components/dashboard/NotConnected.tsx`, `lib/paid/math.ts` (ratio, isLowVolume, IS helpers, bucketGrain), `lib/paid/links.ts` (tabHref, creativeHref), `lib/paid/types.ts`.
- Stub pages `app/(app)/paid/{meta,google,ga4}/page.tsx` containing only the capability gate and NotConnected.
- Edit:
  - `lib/nav.ts`: `internalOnly` on Paid, prefix match in `pageTitle` and `pageEyebrow`, `PAID_TABS`.
  - `components/shell/Sidebar.tsx`, `components/shell/MobileTopBar.tsx`: startsWith active state.
  - `lib/clients.ts`: `metaCurrency`, `gadsCurrency`, `capabilities.woocommerce` treating NULL as false.
  - `lib/format.ts`: `formatMoney(v, ccy, { decimals })`.
  - `components/dashboard/KpiTile.tsx`: optional `delta`, `goodWhen`, `metricKey` tooltip.
  - `components/controls/PageControls.tsx`: `hideCurrency` prop.
  - `lib/metrics.ts`: all new definitions (nCAC, CAC blended, Link CTR, Cost/LPV, Cost/ATC, ATC to purchase, Hook, Hold, Avg daily frequency, Search IS, Lost IS budget and rank, Brand share, Brand leakage, Over-claim, Tracking coverage, Coverage chips).
  - `lib/creative/vocabulary.ts`: `focusLabel` for `adId`, `campaignName`.

**WP-A1 Warehouse Meta**: `infra/bigquery/227_paid_meta_marts.sql`. Run `mart_qa` regression. No app files.

**WP-A2 Warehouse Google**: `infra/bigquery/228_ref_client_brand_terms.sql`, `infra/bigquery/229_gads_marts.sql`, `runbooks/17_google_ads_to_bigquery.md` (new section "Paid marts and brand terms", with the INSERT helper for brand terms). No app files.

**WP-A3 Warehouse GA4**: `infra/bigquery/230_ga4_sessions.sql`, new `runbooks/30_ga4_sessions.md` (scheduled query setup, backfill, adding a property). Registry `has_ga4` UPDATE is part of this file. No app files.

**WP-A4 Overview UI**
- Rewrite `app/(app)/paid/page.tsx`.
- New: `lib/queries/paidOverview.ts`, `lib/demo/paidOverview.ts`, `components/paid/overview/{SpendEfficiencyChart,PlatformTable,SpendMix,CampaignsAcross,PeriodTable}.tsx`.
- Delete once nothing imports them: `lib/queries/paid.ts`, `components/dashboard/ChannelSplit.tsx`, and the Paid functions in `lib/demo/media.ts`. Grep for importers first.
- Depends on A0. The campaign table and spend mix wire up after A1 and A2; until then they render the empty state.

**WP-A5 Meta tab UI**
- `app/(app)/paid/meta/page.tsx`, `lib/queries/paidMeta.ts`, `lib/demo/paidMeta.ts`, `components/paid/meta/{MetaKpis,MetaTrend,MetaCampaigns,CampaignDetail,AudienceBreakdown}.tsx`.
- Reuses `Funnel` and `DataTable` (read-only use).
- Depends on A0 and A1.

**WP-A6 Google tab UI**
- `app/(app)/paid/google/page.tsx`, `lib/queries/paidGoogle.ts`, `lib/demo/paidGoogle.ts`, `components/paid/google/{GoogleKpis,BrandSplit,GoogleCampaigns,GoogleCampaignDetail,PmaxSplit,SearchTerms,Products}.tsx`.
- Depends on A0 and A2.

**WP-A7 GA4 tab UI**
- `app/(app)/paid/ga4/page.tsx`, `lib/queries/paidGa4.ts`, `lib/demo/paidGa4.ts`, `components/paid/ga4/{Ga4Kpis,CrossCheck,Ga4Channels,Ga4Funnel,LandingPages}.tsx`.
- Depends on A0 and A3.

**WP-A8 Docs** (after A1 to A3 land): `METRICS.md` (new section "Paid section metrics" with every formula in 1.3 to 1.6, plus changelog amendment 18), `PROJECT_LOG.md` top entry. Docs only.

Parallelism: A1, A2, A3 and A0 can start at once. A4 to A7 start after A0 (all four in parallel). A8 goes last.

### Phase B (needs ingestion)

**WP-B1 n8n Meta breakdowns**
- `wf_meta_ads` gains branches for adset insights, demo, placement, segment, geo and reach windows.
- Add new workflow export JSON under `infra/n8n/`, and `infra/bigquery/231_raw_meta_breakdowns.sql` (new tables and ALTERs).
- Rule: do not change the live schedule. Backfill demo, placement, segment and geo for 90 days, and adsets for 12 months.

**WP-B2 SQL Meta breakdown marts**: `infra/bigquery/232_meta_breakdown_marts.sql`.

**WP-B3 Google API + Merchant Center ingestion**
- New n8n `wf_gads_api` (export to `infra/n8n/`).
- `infra/bigquery/233_raw_gads_api.sql`, `infra/bigquery/234_gmc_products.sql` (DTS dataset authorization, `ref.clients.gmc_merchant_id`, CHANGED `mart_gads_products_daily`, NEW `mart_gads_pmax_search_terms`, `mart_gads_asset_group_daily`).
- Secrets: `gads-mcc-developer-token`, `gads-mcc-refresh-token`, `gads-mcc-client-id/secret`.
- Blocked on Q4.

**WP-B4 Meta UI wiring**: owns the A5 files. Enables the Audience dimensions and exact frequency.

**WP-B5 Google UI wiring**: owns the A6 files. Adds PMax terms, asset groups, product titles and availability.

B1 runs parallel to B3. B2 follows B1. B4 follows B2. B5 follows B3.

### Phase C (nice to have)

- Google geo: `GeoStats` + seeded `ref.google_geo_targets` (country criterion ids) feeding a geo table on the Google tab.
- Day-of-week x hour heatmap from `p_ads_HourlyCampaignStats_*`.
- GA4 campaign view joined to platform campaign spend by normalised name (`campaign_name` = utm_campaign).
- Meta `daily_budget` ingest (enables budget utilisation for Meta).
- Data Health:
  - `ref.feed_sla` rows for google_ads, ga4 and the new Meta breakdowns;
  - a per-day gap check in `ops.v_gads_coverage` (would have caught rawbark 2026-09-17).
- Google `ad_strength` and asset performance labels for PMax; RSA asset performance (`p_ads_Asset*` tables exist).
- Auction insights: not available in the Google Ads API. Skip.

---

## 4. Wireframes (desktop, ASCII) and mobile behaviour

**Shared header**
```
Marketing · Manami                                   (eyebrow)
Paid                                                 (title)
[ Overview ]  Meta   Google   GA4                    (sticky tabs, query string kept)
[ Last 30 days v ] [ vs previous period | previous year | off ] [ CZK ]   (control bar)
```

**Overview**
```
+------------------+------------------+------------------+------------------+
| PAID SPEND    WH | NEW-CUST REV  WH | aMER          WH | nCAC          WH |
| CZK 92,918       | CZK 184,740      | 1.99x            | CZK 453          |
| +4.1%            | -6.2%            | -0.21x           | +9.8%            |
| ..::''::..:'     | ..::''::..:'     | ..::''::..:'     | ..::''::..:'     |
+------------------+------------------+------------------+------------------+
| MER 2.96x  +2%   | CAC 357  +5%     | Revenue 274,929  | New customers 205|
+---------------------------------------------------------------------------+
| SPEND AND EFFICIENCY                 [ aMER | MER | nCAC ]  [ Day | Week ] |
|   |##|    |##|  |##|          line = aMER, dotted = comparison           |
|   |MM|GG  |MM|  |MM|GG ...                                              |
+---------------------------------------------------------------------------+
| BY PLATFORM                                                               |
| Platform  Spend    Share  Purch  Value    ROAS   CPA    GA4 rev  GA4 ROAS |
| * Meta    79,600   86%    ...    ...      ...    ...    ...      ...      |
| * Google  13,318   14%    61     57,677   4.33x  218    ...      ...      |
| Total     92,918   100%   260    274,929  2.96x  357    ...      ...      |
+---------------------------------------------------------------------------+
| SPEND MIX                                                                 |
| Meta    [Prospecting 35% ][Unclassified 65%                      ]        |
| Google  [Shopping & PMax 100%                                    ]        |
+---------------------------------------------------------------------------+
| CAMPAIGNS                                                  top 15         |
|   Campaign                 Type          Spend  dSpend Value ROAS dROAS CPA|
| * PACKS CBO | CZ | 16JUN   Unclassified  ...                        >     |
| * Prospecting | CZ | ABO   Prospecting   ...                        >     |
| * PMax Manami              PMax          ...                        >     |
+---------------------------------------------------------------------------+
| PERIOD                                               (auto: Day/Week/Mo)  |
| Period  Paid spend  Meta  Google  Revenue  NC rev  MER  aMER  nCAC  NC     |
+---------------------------------------------------------------------------+
```

**Meta**
```
| SPEND | PURCHASE VALUE | ROAS | PURCHASES | CPA |              (delta each)
| CPM | LINK CTR | CPC | COST/LPV | COST/ATC | ATC>PURCH | FREQ | HOOK |
+---------------------------------------------------------------------------+
| FUNNEL  Impr > Link clicks > LPV > View content > ATC > IC > API > Purch   |
|         (count, step %, cost per step under each bar; broken scale)        |
+---------------------------------------------------------------------------+
| [ROAS] [CPA] [CPM] [LINK CTR] [COST/ATC]     small multiples + ghost line  |
+---------------------------------------------------------------------------+
| CAMPAIGNS     [ Outcome | Funnel | Delivery ]   Stage: (All)(Prosp)(Retarg)|
| Campaign              Stage   Spend dSpend Value ROAS dROAS Purch CPA AOV ^|
| PACKS CBO | CZ        Uncl.   ...                                  [C]   |
+---------------------------------------------------------------------------+
| > PACKS CBO | CZ | 16JUN                                           [x]    |
|   AD SETS   Ad set  Spend ROAS Purch CPA CPM LinkCTR Cost/ATC             |
|   ADS       Ad  Spend ROAS Purch CPA LinkCTR OutCTR Hook Hold   [Creative]|
+---------------------------------------------------------------------------+
| AUDIENCE  [ Stage | Market | Adv+ segment | Age x gender | Placement | Geo ]|
|   Prospecting  spend ######....  value #######...  ROAS  CPA  CPM  CTR     |
+---------------------------------------------------------------------------+
| Creatives >                                                               |
```

**Google**
```
| SPEND | CONV VALUE | ROAS | CONVERSIONS | CPA |
| BRAND SHARE | NON-BRAND ROAS | SEARCH IS | LOST IS BUDGET | LOST IS RANK | CTR | CPC | BRAND LEAKAGE |
+---------------------------------------------------------------------------+
| BRAND          | NON-BRAND        | SHOPPING & PMAX     | OTHER           |
| spend, share,  | ROAS, conv, CPA, | CPC, IS             |                 |
+---------------------------------------------------------------------------+
| CAMPAIGNS   [ Outcome | Auction | Budget ]   Class: (All)(Brand)(Non)(S&P)|
| Campaign            Type    Class   Spend dSpend Value ROAS dROAS Conv CPA |
| CZ - PMAX: Obsahova PMax    S&P     28,866 ...                            |
+---------------------------------------------------------------------------+
| > CZ - S: Granule    AD GROUPS table  |  DEVICES  Mobile ####  Desktop ## |
+---------------------------------------------------------------------------+
| PMAX CHANNELS                                                             |
| CZ - PMAX  spend [Search 44%|YouTube 37%|Display 14%|Discover 10%|...]     |
|            value [Search 90%|...]                                         |
+---------------------------------------------------------------------------+
| SEARCH TERMS  [ Search terms | Keywords | PMax terms(B) ]  Covers 63%     |
|               ( All | Brand | Non-brand | Waste )                         |
| Term           Campaign  Match  B  Status  Spend Clicks Conv Value ROAS CPA|
+---------------------------------------------------------------------------+
| PRODUCTS  [ Product | Type | Brand | Label 0 ]  [ ] Zero-conv   Covers 18%|
| Item         Type       Camp.type  Spend Clicks Conv Value ROAS CPA CTR    |
+---------------------------------------------------------------------------+
```

**GA4**
```
| PAID SESSIONS | PAID PURCHASES | PAID REVENUE | PAID CVR | PAID SHARE |
+---------------------------------------------------------------------------+
| CROSS-CHECK                                                               |
| Platform  Spend  Platform value  GA4 revenue  Plat ROAS  GA4 ROAS  Over-claim|
| Meta      ...                                                             |
| Google    ...                                                             |
| Paid      ...                                                             |
| Shop      shop revenue | GA4 all-channel revenue | coverage %             |
+---------------------------------------------------------------------------+
| PAID CHANNELS  Channel  Sessions  Engaged  ATC rate  CVR  Purch  Rev  AOV |
+---------------------------------------------------------------------------+
| FUNNEL  [ All paid | Paid Social | Paid Search | Paid Shopping | Cross-net ]|
+---------------------------------------------------------------------------+
| LANDING PAGES  ( All | Meta | Google )                                    |
| Path   Sessions  Meta%  Google%  Engaged  ATC  CVR  Revenue                |
+---------------------------------------------------------------------------+
```

**Mobile (375 px)**
- Tabs: a horizontally scrollable row, sticky under the mobile top bar (same offset variable `--header-h`). The active tab scrolls into view.
- Hero MetricCards: one per row (existing rule). Secondary and soft KpiTiles: 2-up. Delta stays under the value.
- Charts: full width, 180 px tall. Segmented controls wrap to a second line. The Overview chart drops the comparison line below 400 px wide, and the delta stays in the tiles.
- Tables: first column sticky, horizontal scroll inside the card. The column-set toggles are the main width control. The default set on mobile is Outcome with 4 numeric columns: Spend, ROAS, CPA, Purchases.
- Campaign detail (`?campaign=`) renders as a full-width block below the table, with the close control at top right.
- Age x gender heat table becomes a ranked list (age-gender pairs). PMax split bars stack vertically, one campaign per block.
- Spend mix bars keep their labels inside the segments only when the segment is wider than 15%. Otherwise the label goes in the hover/tap tooltip.

---

## 5. Risks and open questions

**Risks (no decision needed; the build handles them)**
- **`mart_daily_kpis` cost.** About 300 MB and 1.3M slot-ms per 30-day read. The Overview must issue one `scanBounds` query and derive everything in TypeScript. No per-widget queries.
- **FX.** `ref.fx_rates` ends 2026-09-01, so October Venev Meta spend and rawbark EUR revenue are NULL in `mart_daily_kpis`, and so is the Overview. Runbook 23 refresh is needed before this ships.
- **Coverage.** Google search terms cover about 63% of Search spend, and products cover 0% of rawbark PMax. Coverage chips make this visible. Do not scale numbers up.
- **Meta stage split.** Expect mostly "Unclassified" until Phase B segment data lands.
- **Previous-year comparison for Dobias.** Meta spend is missing Dec 2025 to Mar 2026, so year-over-year deltas over that span are wrong. The comparison delta should be null when comparison-period `meta_spend` is NULL on any day with shop orders (rule in `lib/paid/math.ts`).

**Open questions for the owner (each one changes the build)**

1. **Meta funnel stage seed.** Should `PACKS`, `CBO` and `ASC` campaigns (most Meta spend for dobias, manami and venev) be seeded as `prospecting`, or stay `unclassified` until the Advantage+ segment breakdown (Phase B) gives the real new / engaged / existing split? This changes the `ref.naming_rules` seed, and therefore the Overview Spend mix in Phase A.
2. **CAC definitions.** OK to show "nCAC = paid_spend / new_customer_orders" (identical to today's METRICS `CAC`) plus "CAC (blended) = paid_spend / orders"? The alternative is to show nCAC only and drop blended CAC. This changes the B row and the METRICS.md wording.
3. **Google conversion scope.** Should the Google tab use purchase-category conversions (`purchases`, `purchase_value`)? If yes, should `mart_daily_kpis.google_revenue` and `google_purchases` switch too? That switch is retroactive for all clients; today the numbers are identical because both accounts count only "Nákup".
4. **Google Ads API access (Phase B).** PMax search terms and asset-group performance need a developer token on the MCC (Basic access application) and an OAuth refresh token. Who applies, and which Merchant Center ids map to manami and rawbark? Without this, those two widgets and product titles stay out.
5. **GA4 pipeline shape.** Option (a), recommended: a BigQuery scheduled procedure writes a derived `stg.ga4_sessions` table. This is the first non-n8n, non-DTS pipeline, but it is cheap and needs no new authorized datasets. Option (b): live views over `analytics_*`, which require authorizing each GA4 dataset for stg and mart, at a higher scan cost per page view.
6. **Meta tab currency.** Should Meta tab money stay in the ad-account currency (matches Ads Manager; Venev shows CZK while the Overview shows EUR)? Or convert to client currency with `*_client_ccy` (consistent with the Overview, but no longer matches Ads Manager)?

---

### Critical files for implementation
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/app/(app)/paid/page.tsx
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/queries/paid.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/nav.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/clients.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/infra/bigquery/213_client_ad_currency.sql (pattern for mart_daily_kpis and Meta marts; new 227 to 230 files sit beside it)
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/infra/bigquery/202_stg_google_ads.sql (DTS mapping pattern for the new Google marts)