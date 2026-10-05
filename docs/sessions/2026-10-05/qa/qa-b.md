# QA report qa-b: Marketing > Paid and Creative (desktop, live dashboard)

Tested 2026-10-05 in the owner's Chrome, own tab only (closed at the end). Clients dobias, ethia, manami, rawbark, venev (plus the "Lumen Botanicals (DEMO)" client for the Google UI, see B-01). Periods: last 30 days (Sep 4 to Oct 3) and September 2026, compare = previous period, plus one previous-year spot check. No reports created, nothing written, no settings touched.

Coverage note: the Google tab cannot render for any real client (B-01), so Google KPIs, brand split, PMax bars, search terms/keywords, products and Google drilldown were only checked on the DEMO client (invented data, so no number plausibility there). Verdict thresholds are not set for any client ("No verdicts. Set thresholds in Settings."), so winner/carrier/loser verdicts could not be exercised (I may not change Settings).

---

## Findings

### B-01 BLOCKER: Paid > Google crashes with a server error for every client that has Google (Manami, RawBark)
- Page: /paid/google, client manami or rawbark, any period, any compare (tried 30d + prev period, no params, 7d + compare none, rawbark 30d). 100% reproducible.
- Repro: open Paid, click the Google tab (or load /paid/google?client=manami directly).
- Expected: Google KPIs, brand split, campaigns, PMax split, search terms, products.
- Actual: after the skeleton the whole page is replaced by a bare white page: "Application error: a server-side exception has occurred (see the server logs for more information). Digest: 746746829". No app shell, no sidebar, no way back except the browser Back button. Network: document request returns 200 with the error body (so it is not even a 5xx).
- Evidence: Vercel runtime logs, deployment dpl_GTsE2iEKZECWUcWrwLRMtEuPjyKk, GET /paid/google at 22:25:08, 22:25:31, 22:25:45 etc: `ApiError: Aggregations of aggregations are not allowed at [7:17]` and `at [8:17]` (BigQuery 400 invalidQuery).
- Root cause (read-only source check): two queries in `dashboard/lib/queries/paidGoogle.ts` select `SUM(spend) AS spend` and then use `HAVING SUM(spend)`. In BigQuery the HAVING resolves `spend` to the SELECT alias, so it becomes SUM(SUM(spend)). Matches the error positions exactly:
  - `getGadsPmaxSplit` HAVING line ~329 (`HAVING SUM(spend) > 0 OR SUM(purchase_value) > 0`) = error at [7:17]
  - `getGadsProducts` HAVING line ~503 (`HAVING SUM(spend) > 0 ${zeroOnly ? "AND SUM(conversions) = 0" : ""}`) = error at [8:17]
  - Same pattern (unqualified columns, same-named aliases) in `getGadsAdGroups` (~358) and `getGadsDevices` (~384); these only run when `?campaign=` is set, so they will fail next. `getGadsKeywords` and search terms are fine because they qualify columns with `k.`/`s.`.
- Suggested fix: qualify the columns with a table alias in the HAVING (`HAVING SUM(t.spend) > 0`) or rename the aliases (`AS spend_sum`) in those four queries. Add a query-level test per getGads* function against the real mart. Also see B-02.

### B-02 MAJOR: a single failing query takes down the whole app shell (no error boundary)
- Same repro as B-01. The thrown error escapes to the root, so the user loses header, sidebar, client switcher and period controls and sees raw developer wording ("see the server logs", Digest). Dev-facing text on a user page.
- Suggested fix: add `app/(app)/error.tsx` (and ideally per-section boundaries, or catch inside `page.tsx` and render a small "Google data could not load. Try again" notice inside `<main>` so the other tabs and controls keep working). Wrap each query in the Promise.all so one failing panel does not blank the page.

### B-03 MAJOR: "Open in Creative" on a Meta campaign lands on an empty grid
- Page: Paid > Meta, dobias, 30d, any campaign row's arrow link.
- Repro: Paid > Meta > click the arrow next to "CA I PACKS CBO I Broad I 2026-06 I OE" (also tried "CA I PACKS I CBO I 21JULY-26 I OE", the biggest campaign, $6,560 spend with 14 live ads).
- Expected: Creative grid filtered to that campaign's creatives.
- Actual: URL `/creative?client=dobias&preset=30d&compare=previous_period&focus=campaignName&is=CA+I+PACKS+CBO+I+Broad+I+2026-06+I+OE` shows the chip "Campaign: ..." with "0 of 48 creatives" and "No matches." The grid is empty even though that campaign spent $1,787 / $6,560. Manual deep link for Manami (`focus=campaignName&is=PACKS+CBO+%7C+CZ+%7C+16JUN`) also gives "0 of 47 creatives" (I constructed that URL, did not click the real Manami link).
- Compare: the ad-level arrow (Paid > Meta > drilldown > ad arrow) works correctly: lands on `focus=adId&is=...` with "1 of 48 creatives" and the right ad (FeelGood Omega I TOF I DYN I 21JUL-26 I v1 I CA).
- Likely cause: `components/creative/CreativeGrid.tsx` ~line 112 filters `ad[focus.field] === focus.value`; `AdView.campaignName` is probably null or differently spelled for the grid rows (`lib/creative/view.ts` ~187 maps `ad.campaignName`). Check what the warehouse returns for campaign_name on the creative mart.
- Suggested fix: match on campaign id, or normalise names (trim, case) and make sure the mart supplies campaign name; show "No creatives tagged to this campaign (N unmapped ads)" rather than a bare "No matches."

### B-04 MAJOR: toggling table filters or column sets scrolls the page back to the top
- Page: Paid > Meta (dobias, any period). The campaigns table sits below the funnel and KPI rows.
- Repro: scroll down to Campaigns, click "Funnel" (or "Delivery", or a stage/market chip).
- Expected: view stays at the table, only the table pulses and updates.
- Actual: the URL updates and the table updates, but the page jumps to the top (screenshot sequence: scrolled at table, after click scrollTop = 0). On a laptop screen the user has to scroll back down after every toggle. It also made my follow-up click miss (clicked empty area).
- Suggested fix: router.push/replace with `{ scroll: false }` for same-page query changes (Meta campaign filters and column sets, Google campaign filters and column sets, search source/mode, product group, GA4 channel/landing tabs). The compare toggle at the top is fine because it is already at the top.
- Related: Paid Overview "Spend mix" segment link (e.g. Prospecting 33%) sends you to /paid/meta?stage=prospecting at the top of the page; the filter only affects the campaign table far below and the KPI tiles/funnel stay account-wide (spend $19,673), so nothing visibly changes where you land. Either add `#campaigns` anchor + scroll, or label the page "Filtered: Prospecting".

### B-05 MAJOR: Ad detail "Breakdowns" tab says "Breakdown not loaded yet." and never loads
- Page: Creative grid, client dobias (ad "DYN I GutSense VSL I 6JUN I OE", $7,369) and client manami (ad "Nezna - 13MAR - OE", CZK 14,759), open detail panel > Breakdowns.
- Actual: "Delivery / Breakdown not loaded yet." after waiting 10+ s, no spinner, no retry, no explanation. Source: `components/creative/AdDetail.tsx` ~1235, shown when both age and placement arrays are empty, so it means "no data", not "not loaded". 2 of 2 ads tested.
- Also the modal changes height and jumps vertically when switching from Overview to Breakdowns/Notes (top at y=15 on Overview, y=144 on Breakdowns), so the close button and tabs move under the cursor.
- Suggested fix: reword to "No age or placement breakdown for this ad in this period." (or "not synced yet" if that is the real cause, with date); fix modal min-height so tabs do not jump.

### B-06 MAJOR: Outbound CTR shown as 0.0% (red dot) in ad detail
- Page: Creative > ad detail > Overview, dobias GutSense VSL and manami Nezna ads.
- Actual: "OUTBOUND CTR 0.0%" with a red status dot while Link CTR is 1.1 to 1.2% and the ad has 34 to 124 purchases. The Paid > Meta drilldown ads table shows the same metric as "n/a" for every ad. So missing data is rendered as a bad real value (red).
- Suggested fix: render "n/a" with a neutral dot when the warehouse has no outbound clicks; do not colour it.

### B-07 MAJOR: ROAS is not the same number across Paid and Creative for the same ad, and the detail panel contradicts itself
- Dobias, last 30 days, ad "FeelGood Omega I TOF I DYN I 21JUL-26 I v1 I CA", spend $1,948 on both screens. Paid > Meta ad row: ROAS 1.83x. Creative card: ROAS 2.15.
- Dobias, all time, ad "DYN I GutSense VSL I 6JUN I OE": panel shows Spend $7,369, Revenue $18,803, ROAS 2.60. 18,803 / 7,369 = 2.55.
- Cause: Creative ROAS is shrunk toward the account mean (`lib/creative/model.ts` `read()` / `shrink`, with 95% CI) while Revenue/Spend are raw. This is intentional statistics but nothing in the UI says so (label is plain "ROAS", no hint), and the Paid tab shows the raw value.
- Suggested fix: label as "ROAS (adjusted)" with a tooltip, show raw ROAS next to it ("raw 2.55"), and keep Creative grid and Paid using the same default.

### B-08 MINOR: Meta ad sets are shown as raw numeric IDs
- Page: Paid > Meta > campaign drilldown, dobias (52547215215812 ...) and manami (120249508201360098 ...). Ad set names are not shown, so the table is unreadable and cannot be matched to Ads Manager by name.
- Fix: select adset_name in the drilldown query (already carried on `AdsetView.adsetName` in creative view); fall back to ID only when the name is missing.

### B-09 MINOR: Meta funnel and hook rate numbers that look broken
- Hook rate KPI deltas: ethia 82.2% "+55.4 pp", manami 29.7% "-48.7 pp", venev 56.4% "-30.6 pp" vs previous period. Hook rate swings of 30 to 55 points on a month are not credible; the definition probably flips (3 second plays over impressions vs video plays) when previous-period data is thin, or the video-play denominator differs.
- Dobias ad rows: hook 82.6% (FeelGood Omega), 71.3% (GutSense VSL); Venev top creative hook 98.2%. A 3-second hook rate near 100% is not plausible.
- Funnel steps: Dobias "Purchases 267.4% of previous" (345 purchases after only 129 payment-info events), manami "View content 151.6% of previous", ethia "View content 121.6%". The funnel assumes monotonic steps; pixel events are not. Consider showing "n/a (not sequential)" instead of >100%.

### B-10 MINOR: Meta tab shows ad-account currency while Overview shows client currency, unlabelled (Venev)
- Venev, 30d: Overview Meta row spend EUR 1,967, ROAS 0.12x, value EUR 243. Meta tab: spend CZK 47,814, value CZK 5,914 (and Creative also CZK). Checks out (47,814 / ~24.3) but a user comparing the "Meta tab total vs Overview Meta row" sees two different numbers and currencies. Source says it is by design (`app/(app)/paid/meta/page.tsx` lines 6-7, 75) but there is no label.
- Fix: put the currency in the page subtitle ("Meta ad account, CZK") or show the converted figure in a tooltip.

### B-11 MINOR: Dobias Overview "Total" row mixes bases
- Overview BY PLATFORM: Meta 345 purchases / $49,746, Google not connected, Total 1,404 purchases / $210,084 / 10.68x. Total purchases and value are shop-wide (whole shop), so Total does not equal Meta + Google for those columns while it does for Spend. Info icon exists but the row reads like a sum. Same on all clients. Consider renaming the row "Shop total (all sources)" and ROAS "MER".

### B-12 MINOR: shop revenue differs between Paid Overview and Paid GA4
- Dobias, 30d: Overview REVENUE $210,084; GA4 tab "SHOP REVENUE $217,869" (3.7% higher). Manami and others not compared. Likely different cut-off (orders vs gross, cancelled, time zone), but both are labelled revenue for the same client and period.
- Also GA4 funnel "Purchased" differs from KPI "Paid purchases": dobias 56 vs 57, manami 88 vs 90.

### B-13 MINOR: Creative > Breakdown banner contradicts the table
- Manami, 30d, Breakdown by Angle: banner "Only 55% of spend is tagged." while the table shows Untagged 56% of spend (so tagged is about 44%). Source: `getTagCoverage` in `lib/queries/creative.ts` ~line 607 reads an all-time, concept-level `pct_spend_tagged`, ignoring the selected period and dimension.
- Fix: compute coverage for the selected period and dimension, or word it "Only X% of all-time spend carries a concept tag".

### B-14 MINOR: Creative > Velocity chart axis and target line misaligned
- Manami (all clients with zero packs): y-axis labels "0, 2, 3" and the dashed "TARGET 2" line sits clearly above the "2" gridline (about 2.7). Cause in `components/creative/LaunchCadence.tsx`: gridlines at [0, maxY/2, maxY] = 0, 1.5, 3 with `Math.round` labels (1.5 shows as "2"), target drawn at true 2.
- Fix: integer ticks (0,1,2,3...). Also the chart is empty with no empty-state sentence ("No packs launched since May").

### B-15 MINOR: Creative grid "CTR" differs from detail panel "CTR (LINK)"
- Manami "Nezna - 13MAR - OE": grid card CTR 2.2%, detail "CTR (LINK) 1.1%" and Diagnosis text "Judge on CTR 2.2%". Dobias GutSense VSL: grid CTR 3.3% vs panel 1.2%. Different metric (all clicks vs link clicks) under the same short label. The user asked that panel numbers match the grid formatting: money and counts do (CZK 14,759 identical), but ROAS format is "2.60" in the grid and "2.60 x" in the panel, and the CTR label differs.
- Fix: label the grid "CTR (all)" or switch both to link CTR; use the same ROAS formatter ("2.60x" like Paid).

### B-16 MINOR: Creative filters are not in the URL and do not drive the KPI tiles
- Selecting Angle = Contrarian truth works (grid narrows) but URL stays unchanged (not shareable, lost on reload) and the KPI tiles (Spend CZK 79,600, ROAS 1.97) still show the whole account. Cosmetic confusion, since the tile says "47 creatives".

### B-17 MINOR: internal codes and an em dash in persona labels
- Creative filters and chips show persona strings like "Mladsi zena, co nechce vonet jako kazda druha — MAN_NicheScentLover_AntiMainstream_20s" (note the em dash, and the internal tag code appended). The long option stretches the Persona select to about 370 px and the card chips truncate the text ("ZENA S CITLIVOU KUZI, CO UZ ..."). Ad panel header also prints "MAN_SENSITIVESWITCHER_CONTRARIANTRUTH_V1 ..." raw. These strings come from ClickUp/warehouse data, not UI code, but no em dash is allowed in output: strip code suffix and normalise "—" at display.

### B-18 MINOR: Paid GA4 (Dobias) shows a 9.9x "over-claim" and order-status URLs as landing pages
- Dobias 30d: Meta platform value $49,746 vs GA4 $5,047 (GA4 ROAS 0.26x, over-claim 9.86x, tracking coverage 70.1%). A 10x gap is either a GA4 purchase-tracking fault for Meta traffic or a mapping issue; worth a data-health flag rather than only a number.
- Landing pages table lists `/orders/<token>` and `/checkouts/cn/<token>` paths (post-purchase pages with unique tokens) as landing pages. Filter `/orders/`, `/checkouts/`, `/cart` out or group them as "Checkout / order status". Dobias also has a "GOOGLE SHARE" column although Google is not connected.

### B-19 POLISH / MINOR: speed
- Paid Overview 5.0 to 6.7 s (Manami 6.7 s, Dobias 5.1 s), GA4 6.0 s, Meta 2.2 s, Creative 2.2 s, measured by fetch while other QA agents were also loading (so inflated). Skeleton shows, so it is not frozen, but the skeleton frame is narrower than the final layout (it shows 4 KPI tiles; the page has 8, header and control strip start at the page edge instead of the content column), so content shifts when it lands.

### B-20 POLISH list
- Lock emoji in the Meta Audience tab ("Advantage+ segment 🔒 Age x gender 🔒 Placement 🔒 Geo 🔒") and in Google "PMax terms 🔒". Emoji do not match the rest of the icon set; also unclear why locked or how to unlock.
- A lone muted word "Creatives" sits below the Meta Audience card on every Meta tab (looks like a stray label or empty section).
- Campaigns table CLASS column truncates ("Shopping & ...") on Google (demo).
- Diagnosis text repeats itself: "Judge on CTR. No video metrics. Judge on CTR 2.2%. Iteration type 2."
- Creative default period is ALL TIME, shown as "Oct 3, 2021 to Oct 3, 2026" with compare "vs Oct 2, 2016 to Oct 2, 2021" (a five-year window that predates the data, compare label meaningless; purchases tile says "vs prev period" with no delta).
- Spend Mix on Overview: 67% (Dobias), 73% (Manami) and 100% (Ethia, Venev) of Meta spend is "Unclassified", which makes the donut mostly grey; a stage taxonomy prompt or "classify campaigns" link would help.
- Not-connected pages (e.g. GA4 not connected for Venev/Ethia/RawBark) drop the date and compare control bar, so the layout shifts between tabs.

---

## Worked well
- Not-connected states render a clean one-liner and keep the tab strip: "Google Ads not connected." (Dobias, Ethia, Venev), "Meta not connected." (RawBark), "GA4 not connected." (Ethia, RawBark, Venev). Tab stays visible, muted. RawBark Overview also tags tiles that depend on Meta with "META NOT CONNECTED" (aMER, nCAC, MER, CAC), and the platform table says "Meta: Not connected".
- Overview paid spend equals Meta + Google everywhere checked: Manami 30d CZK 79,600 + 13,318 = 92,918 (Overview and tab), Manami Sep 87,547 + 12,915 = 100,462; Dobias 19,673 and Sep 19,812 equal the Meta tab; Ethia 32,724 / 30,012; RawBark Google only 85,136 / 85,883. Meta tab KPI row equals the Overview Meta row (spend, value, ROAS, purchases) for Dobias, Ethia, Manami (30d + Sep), Venev (after currency conversion).
- Campaign table sums are consistent: Manami Sep campaign spends sum to 87,547; Dobias ad spends in the first campaign sum to $6,559 (campaign $6,560); Dobias Prospecting segment (3 campaigns) sums to $6,559 = Spend Mix 33%.
- Creative Breakdown by angle: spend 79,600, revenue 156,484 and purchases 169 across Untagged, Contrarian truth, Problem agitation and Curiosity gap tie exactly to the Meta tab; Creative KPI tiles for Manami (CZK 79,600, ROAS 1.97, CPA 471, 169) equal the Meta tab.
- Column-set toggles on Meta (Outcome, Funnel, Delivery) work and persist in the URL (`cols=funnel`, `cols=delivery`), as does `stage=prospecting`; `?campaign=<id>#campaign-detail` opens the drilldown with ad sets and ads and a close button.
- Loading feedback is visible: compare toggle on Meta gave 3 seconds of the dim and breathing pulse (`data-pending` with oe-pulse animation, opacity 0.73 to 0.50), column-set toggle dimmed the page, tab switches to Google showed 53 skeleton blocks. Nothing froze (apart from the crash in B-01 where the skeleton is replaced by an error).
- Ad-level "Open in Creative" arrow lands on the exact ad; the Creative grid, panel, concept coverage and Breakdown pages render for Dobias, Ethia, Manami, Venev; RawBark Creative says "Meta not connected." correctly.
- No console errors and no 4xx/5xx subresource requests on the Creative and Paid pages I sampled (thumbnails from storage.googleapis.com signed URLs all 200). No em dashes in UI code or labels (only in data-driven persona names, B-17). No dev/TODO text other than B-01/B-02.
- Prev-year compare works (Manami 30d vs last year: spend +399%, MER -39.9%, flagged "vs last year"); compare = none works.

## Numbers that look suspicious
- Hook rate: ethia 82.2% (+55.4 pp), manami 29.7% (-48.7 pp), venev 56.4% (-30.6 pp), Venev creative 98.2%, Dobias ads 82.6% and 71.3% (B-09).
- Dobias Meta funnel: 129 payment-info events but 345 purchases ("267.4% of previous"); Manami view content 151.6% of link-landing views.
- Dobias GA4 paid revenue $5,228 vs Meta-reported $49,746 (9.5x over-claim) and GA4 "shop revenue" $217,869 vs Overview revenue $210,084 (B-12, B-18).
- Venev: MER 0.16x, aMER 0.13x, nCAC EUR 393, spend EUR 1,967 for 4 Meta purchases / 6 orders in 30 days; Sep and last-30-days show identical revenue (EUR 318) and new-customer revenue (EUR 265) with identical deltas (+59.8%, +93.1%), probably because all sales fall inside both windows. Likely a very new store, but MER < 1 should carry a "low volume" tag.
- RawBark: MER 19.9x and blended CAC CZK 96.5 (about 882 orders on CZK 85k Google-only spend) vs aMER 1.36x and nCAC CZK 819; only 104 of about 880 orders are new customers. Consistent with the "Meta not connected" notice (spend is Google only), but headline MER is not meaningful until Meta spend is in.
- Creative ROAS 2.60 vs revenue/spend 2.55 (shrinkage, B-07); Dobias ad ROAS 2.15 in Creative vs 1.83 in Paid.
- Ethia: Overview Meta purchases 53 vs Total purchases 103 and 61 new customers, i.e. about half of orders have no paid attribution, plausible but worth confirming against shop data.
