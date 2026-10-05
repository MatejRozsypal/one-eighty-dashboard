# QA round 2 report qa2-b: Paid and Creative re-test (live, deploy b5868b1)

Tested 2026-10-05 in the owner's Chrome, own tabs only (closed at the end). Nothing written, no settings touched, no reports created.

IMPORTANT LIMITATION: the shared Chrome window was 606 x 667 px for the whole session (another agent controls the window and I may not resize), so this was NOT a true desktop-width pass. All checks were done on DOM text, hrefs, scroll positions and fetches, which do not depend on width, but pure layout items (modal height jump, skeleton width, column truncation) could not be judged and are marked "not verifiable".

The Chrome extension also dropped the connection whenever a single JS call ran longer than about 12 s, so long sweeps were run as background promises and polled.

## Re-test of qa-b findings

| id | verdict | evidence |
|---|---|---|
| B-01 /paid/google crash | FIXED | Manami: 30d, 7d, 90d, Sep 2026, Aug 2026, cols outcome/auction/budget, pg item/type/brand/label0, pg item + zero filter, src terms and keywords with st all/brand/nonbrand/waste, all return 200 with no digest, no "Application error", no "Could not load this view" (fetch of server HTML, 46 + 28 URLs). RawBark: same matrix incl. 3 campaign drilldowns (Ad groups table and Devices block render: "Mobile 70% of spend, 0.53x ..."). Real navigations confirmed for Manami 30d, Manami pg=type (products by type table, "Covers 26% of spend"), Manami st=brand, RawBark st=waste (search terms table, "Covers 63% of spend"), RawBark pg=type via in-page toggle, RawBark campaign drilldown. 5 fetches (Manami 7d and st brand/nonbrand/waste, RawBark campaigns 2 and 3 and pg=type) returned "Failed to fetch" in the first sweep or in one run, i.e. browser/extension network drops, not server errors; Manami st=brand was then loaded for real and rendered, the others passed in the second sweep. Console: no errors. |
| B-02 error boundary | FIXED (code verified, not triggerable live) | `app/(app)/paid/error.tsx`, `app/(app)/creative/error.tsx`, `app/(app)/error.tsx` and `components/ui/ErrorState.tsx` exist: renders inside the layout, text "Could not load this view." plus a "Retry" button (router.refresh + reset), role=alert. I could not make a live query fail: hand-edited params (client=zzz, invalid dates, quote and SQL-like campaign values, injection-like focus) all return 200 with a normal page, which is good robustness. I could not see the boundary render, so the visual part is unverified. |
| B-03 Open in Creative (campaign) | FIXED | Dobias 30d: arrow href is `focus=campaignId&is=<id>`; click lands on /creative with chip "Campaign: US I PACKS I CBO I 17JULY-26 I OE", "14 of 48 creatives", grid populated. Manami: arrow on "PACKS CBO | CZ | 16JUN" gives chip with campaign name, "12 of 28 creatives". |
| B-04 scroll jump on toggles | FIXED | Dobias Meta 30d: scrolled to the campaigns table (scrollY 1772), clicked Funnel, then Prospecting stage chip, then US market chip: scrollY stayed 1772 after each; URL updated (cols=funnel, stage=prospecting, market=US) and the table updated. Google (RawBark): clicked the Product Type group toggle at scrollY 13667, still 13667 afterwards, URL gained pg=type. Not re-tested: Overview "Spend mix" link (it navigates to another page so scroll-to-top is expected) and GA4 channel/landing tabs. |
| B-05 Breakdowns copy / modal jump | PARTIAL | Copy FIXED: Manami ad "Nezna - 13MAR - OE", Breakdowns tab now says "No age or placement data for this period." Modal height jump NOT VERIFIABLE (606 px viewport shows the dialog as a full-height sheet, top 0 and height 667 on both tabs). Note the Breakdowns tab still shows no data for this ad, so whether the breakdown data truly does not exist or the query returns nothing cannot be told from the UI. |
| B-06 outbound CTR 0.0% | FIXED | Creative ad detail (Manami Nezna): no Outbound CTR tile any more, "CTR (LINK) 1.1%" only. Paid > Meta drilldown still lists an OUTBOUND CTR column with "n/a" for every ad, which is correct and neutral. |
| B-07 adjusted ROAS | FIXED | Grid cards and panel say "ROAS (adj.)" (e.g. 2.14x with "95% CI 1.30x to 2.98x"); Breakdown tables have "ROAS (ADJ.)" plus a RAW column (Untagged 2.15x adj vs 2.19x raw) and a 95% interval column; same "x" formatter as Paid. |
| B-08 ad set names | PARTIAL | Dobias campaign drilldown: ad set shows "RecipeMaker I 16JUN I OE" (name). Manami campaign 120246928041830098: of 5 ad sets, 3 show names ("PACK6 | 4SEP-26 | CZ", "PACK I 1JULY I CZ", "PACK5 I 14JAUG-26 I CZ") and 2 still show raw IDs (120249865328400098, 120249942414030098). Probably ad sets that are not in the creative mart name list; fall back to the ad set name from the Meta insights source. |
| B-09 hook rate and funnel > 100% | FIXED (one watch item) | Meta tab, Sep 2026 (custom 1 to 30 Sep): Dobias 17.3%, Ethia 25.9%, Manami 11.2%, Venev 18.8%, all equal to the expected values. Funnel: Dobias "Purchases n/a of previous" (was 267.4%), Ethia and Manami and Venev "View content n/a of previous". Per-ad cross-check Dobias 30d: Meta drilldown "Why do dogs smell" Hook 24.0%, Hold 5.4% vs Creative card Hook 24.1%, Hold 5.4% (window differs by about 1 day). Watch item: Ethia delta is still "+20.4 pp" and Venev "-16.1 pp" vs previous period; plausible but large, probably thin video volume in the previous period. Note the Creative page has no account-level hook tile, so the "Meta equals Creative" check was only possible per ad. |
| B-10 currency label | FIXED | Venev Sep: subtitle "Ad account currency: CZK" under the date bar, KPIs in CZK (spend CZK 50,574). Not shown for Dobias/Ethia/Manami (same currency), correct. |
| B-11 Total row | FIXED | Dobias Overview BY PLATFORM: row now "Shop total" with "MER 10.64x" and "CAC $14.11". Extracted text runs the label and value together ("MER10.64x"); not verified visually whether there is a gap, check at desktop width. |
| B-12 GA4 vs shop revenue | not re-tested (deferred by plan) | |
| B-13 concept coverage | FIXED | Manami 30d Breakdown by Angle: banner "Only 44% of spend in this period is tagged." matches the table (Untagged 56% of spend). Concepts page separately says "UNTAGGED SPEND 49%" for the concept dimension, which is consistent (different dimension). |
| B-14 Velocity chart | FIXED | Manami: axis ticks "0, 1, 2, 3", "TARGET 2" line, empty-state line "No packs launched in these months." |
| B-15 CTR label | FIXED | Grid cards "CTR (all)"; panel "CTR (LINK)" and Diagnosis text "CTR (all) 2.2%". ROAS format "2.14x" in both. |
| B-16 creative filters not in URL | not re-tested (deferred) | |
| B-17 persona strings | PARTIAL | Persona select options on Manami Creative: no em dash, no code suffix ("Mladsi zena, co nechce vonet jako kazda druha", etc.), max select width 317 px. BUT the ad detail panel header still prints the raw concept code "MAN_SENSITIVESWITCHER_CONTRARIANTRUTH_V1" and the Concepts page shows concept titles with the raw code and no space ("MAN_SensitiveSwitcher_ContrarianTruth_v1Parfem nema byt ..."). Em dashes exist only inside customer ad copy (data), none in UI labels. |
| B-18 landing pages | FIXED | Dobias GA4 30d landing pages: no /orders/ and no /checkouts/ rows, no "GOOGLE SHARE" column (header is "META SHARE"); rows are products, collections, blogs. |
| B-19 skeleton width | NOT VERIFIABLE | 606 px viewport; skeleton flashes too briefly to compare. |
| B-20 polish list | PARTIAL | Lock emoji gone and no stray "Creatives" label on Manami Meta (page text ends with the Audience table). Diagnosis text now reads "Judge on CTR. No video metrics. CTR (all) 2.2%. Iteration type 2." but the Retention block directly below still says "Static ad: judge on CTR." (mild repetition). Creative default period still all time? Not re-checked: both Creative pages I opened used the 30d preset. |

## New issues (exploratory pass, narrow viewport caveat)

### N-01 major (performance): RawBark Paid > Google is very slow and very heavy
- RawBark Google tab server-rendered HTML is 1.1 to 1.3 MB per load (Manami 0.16 to 0.58 MB) and took 4.3 to 9.6 s typically, one load 27.7 s and one 36.7 s (other QA agents were also loading, so inflated). Manami Google: 3.3 to 6.2 s.
- Repro: /paid/google?client=rawbark&preset=custom&from=2026-09-01&to=2026-09-30, measure with fetch.
- Suggested fix: paginate/limit search terms, keywords and products server-side (top N by spend, "show more"), do not embed the full tables in the RSC payload; cache per client/period.

### N-02 minor: zero-value ROAS shown as "0.00x" in Google tables
- RawBark search terms (waste mode) and ad groups, Manami products: rows with value 0 show ROAS "0.00x" next to CPA "n/a". Meta tables use "n/a" for the same case. Use n/a (or "-") when value is 0 and spend > 0 is not meaningful, or keep 0.00x consistently in both.

### N-03 minor: Manami Meta ad sets still partly unnamed
- See B-08 (2 of 5 ad sets show raw numeric IDs).

### N-04 polish: sub-views in the ad set table render "ADS" row labels glued to names
- Meta campaign drilldown text extraction shows "... CZK 25,112 1.67x 39 ... ADS PACK I 1JULY I CZ ..." (the expander label "ADS" runs into the next ad set name). Probably only an artefact of text extraction in a narrow layout; check at desktop width.

### N-05 polish: Ethia and Venev hook rate deltas still look large (+20.4 pp, -16.1 pp)
- Not wrong per se, but worth a low-volume tag when the previous period has few video impressions.

## Worked well (round 2)
- No server errors, console errors or failed document requests in any tested Paid or Creative page.
- Google tab now renders for every period and mode tested, including drilldown with ad groups and devices and the product group-by toggles.
- Scroll position is retained on all tested toggles (Meta column sets, stage, market; Google product group).
- Both campaign "Open in Creative" deep links (Dobias, Manami) land on the right filtered grid with a readable chip.
- Hook rates match the expected September values for all four Meta clients; funnel no longer shows impossible >100% steps.
- Robust to garbage query params (invalid client, dates, injection-like strings): always a normal 200 page.

## Numbers that look suspicious
- RawBark campaign names include bid targets in parentheses, e.g. "CZ - PMAX: Obsahova - MIX (ROAS 450>120 %)" while the campaign delivers ROAS 0.70x on the page; not a bug, but the title suggests a 450 % target that is not being met. Not a dashboard issue.
- Manami Google (30d) has 100% Shopping and PMax, BRAND SHARE 0.0%, SEARCH IS 10.2% with LOST IS (RANK) 89.8%: valid data but extremely low impression share; may deserve a note.
- Ethia hook delta +20.4 pp, Venev -16.1 pp (see N-05).
