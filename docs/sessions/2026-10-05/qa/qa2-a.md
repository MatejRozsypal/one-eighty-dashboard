# QA round 2, qa2-a: Analytics re-test on prod (deploy b5868b1), desktop

Tester: qa2-a. Site: https://dashboard.oneeighty.cz (admin). Date of run: 2026-10-05 (prod "yesterday" = Oct 4, so every range ends Oct 4 at the latest).
Nothing was written or changed in the app (no reports, no settings, no goals). My tab was closed at the end.

## Method and limits (read first)

- During the whole run the shared Chrome window was 606x667 px (another agent had put it into a narrow size; I did not resize it). The tab was also in the background (`document.hidden = true`). Real screenshots would have shown the mobile shell, so I did NOT take desktop screenshots.
- Instead I loaded each page in a same-origin, 1400 px wide hidden iframe inside my own tab and read the real rendered DOM (text, geometry, computed style, scroll position), plus plain `fetch` of the server HTML for text-only checks. Everything below is a DOM/geometry observation, not a pixel check.
- Timing caveat for A-02 and A-21: timers in a background tab are throttled, so I could not sample at wall-clock 0/300/1000 ms. I sampled right after the click (same JS tick, microtask) and then until the page settled. That is the strictest possible "0 ms" sample.
- Load caveat: when I fired 6 or more page requests in parallel (iframes or fetches), a few requests (Dobias Snapshot all-time in an iframe, /growth?client=venev, /snapshot?client=dobias&preset=30d, /growth?client=dobias&preset=12m) never answered and died with a network error after 250 to 320 s. Every one of them answered in 5 to 19 s when re-requested alone. I attribute this to my own burst plus the other QA agents sharing the backend, but see N-06.
- Console: no errors in my tab. All fetches that completed returned 200.

Counts for round 2: of 24 original findings FIXED 21, PARTIAL 2 (A-10, A-20), NOT FIXED 0, DEFERRED as planned 1 (A-15). REGRESSED 0. New findings: 0 blocker, 0 major, 4 minor (N-01, N-02, N-03, N-06), 2 polish (N-04, N-05).

---

## Part 1: verdict per original finding

| id | verdict | evidence (short) |
|---|---|---|
| A-01 Orders grid | FIXED | all 5 clients, details below |
| A-02 client switch | FIXED | details below |
| A-03 Goals | FIXED | details below |
| A-04 spend gap | FIXED (one residual, see N-01) | details below |
| A-05 all-time chart | FIXED | 61 monthly points, ticks Oct 2021, Jan 2023, Apr 2024, Jul 2025, Oct 2026 |
| A-06 partial caption | FIXED | no "Shaded day is partial." on Sep 1 to Sep 30 for any client |
| A-07 sparse axis | FIXED | Venev Sep: 30 daily points, ticks Sep 1, 8, 16, 23, 30 |
| A-08 null sorting | FIXED | details below |
| A-09 "CAC unknown" | FIXED (tiny residual) | RawBark: "90-day LTGP : CAC n/a / No cost data" |
| A-10 currency block | PARTIAL | block now labelled "in USD", discounts still "n/a" |
| A-11 growth avg vs cumulative | FIXED | consistent, partial month n/a |
| A-12 stale stock | FIXED | details below |
| A-13 inventory money | FIXED | "$14,147", "€8,918", ">5 years of cover" |
| A-14 products table | FIXED | details below |
| A-15 cohort vs new | DEFERRED, unchanged | Dobias still 327 vs 317 |
| A-16 repeat labels | FIXED | "Repeat rate, lifetime", "of customers came back, lifetime" |
| A-17 growth skeleton | FIXED per source, not observed live | `growth/loading.tsx` is now chart + table |
| A-18 em dash | FIXED | em dash becomes hyphen, en dashes kept |
| A-19 tooltips | FIXED | details below |
| A-20 minus signs | PARTIAL | money uses U+2212 now; "−€0" and "-575.4%" remain |
| A-21 label before data | FIXED | details below |
| A-22 discounts n/a | FIXED | "none" on Ethia, Venev, RawBark |
| A-23 range caption | FIXED | "Not affected by date range." |
| A-24 copy | FIXED | all copy items, details below |

### A-01 FIXED: Orders "Recent orders" is a real grid for all 5 clients
Sep 1 to Sep 30, compare previous period, 1400 px iframe. For every row the cells share one grid (computed `grid-template-columns` has 8 or 9 tracks, row cell tops differ by at most 3 px from `items-center`, 0 broken rows).
- Dobias: 51 grid rows (header + 50), 9 columns Date, Order, Customer, Country, Revenue, Net sales, Margin, Discounts, Type. Row 1: `2026-09-30 | #182152-U | c••••k@yahoo.com | CA | $595 | $595 | $429 | −$105 | Returning`.
- Ethia: 9 columns, `CZK 635 | CZK 595 | CZK 491 | none | New`.
- Manami: 8 columns (Currency instead of Country, no Discounts column), `EUR | CZK 727 | CZK 600 | CZK 420 | New`.
- RawBark: 8 columns (no Margin, as intended for no cost data), `CZK 3,836 | CZK 3,836 | none`.
- Venev: 6 orders (header + 6 rows), 9 columns.
KPI strip and market split unchanged.

### A-02 FIXED: client switch no longer shows old figures under the new name
Dobias orders page, open the client menu, click Ethia, then Manami; also Venev inventory to RawBark.
- Before click: chip "Client: Dr. Dobias Natural Pet Health", main text `ORDERS 1,399 ... $209,932`.
- Immediately after the click (microtask, i.e. the first moment React has flushed): chip is "Client: Ethia" (later "Manami s.r.o.", "RawBark"), `main` has `visibility:hidden`, text is empty, `data-pending="client"` is set and 39 skeleton nodes exist. There was no moment where new name and old figures were visible together.
- It stays hidden until the new data commits (observed hidden for 8+ s on a slow load), then the new page appears; Venev to RawBark inventory ended on "Shopify not connected." and the Venev EUR 23,780 stock was never shown under the RawBark label.
- Not measurable here: real wall-clock samples at 300 and 1000 ms (background tab). The DOM state is the same at every moment between click and commit, so I expect the same at 300 and 1000 ms.

### A-03 FIXED: Goals roll-ups cover targeted months only
- Manami /goals: "2026 Jan to Dec · Target covers 2 of 12 months", Revenue CZK 292.7K of CZK 540K, 54% of target, 50% of period elapsed; Orders 272 of 623 (44%); New customers 214 of 651 (33%); CM3 CZK 105.4K of CZK 121.7K (87%). Q4: "Target covers 1 of 3 months". The old 331% / 507% nonsense is gone.
- Dobias: "Target covers 4 of 12 months", $263.1K of $896K, 29% vs 28% elapsed. Ethia: 4 of 12, CZK 112.5K of CZK 609K, 18% vs 28%. RawBark: "No targets set." with every tile "No target set", no fake numbers.
- Counts are unabbreviated now: "187", "of 1,351", "1,766 of 5,807" (was "3K of 1K").
- Residual polish: the coverage line says how many months are targeted but not which ones. Manami THIS MONTH (Oct) says "No target set" while Q4 says it covers 1 of 3 months; a reader has to open the month table to see it is Nov or Dec.

### A-04 FIXED: Meta spend gap on long ranges, Dobias (first spend Apr 20, 2026)
All with the notice "Ad spend from Apr 20, 2026." at the top of the page.
- All time (compare none): MER, aMER, CAC, Ad spend share all "Missing days". Paid spend $64,705.
- Last 12 months: all four "Missing days".
- Year to date: all four "Missing days".
- Last 90 days (Jul 7 to Oct 4, fully after Apr 20): ratios are shown and are correct: MER 12.90x, aMER 2.29x, CAC $52.47, Ad spend share 7.8%. This is right, because there is no leading gap. The task text expected "Missing days" here, but the range does not start before the spend; I treat this as correct.
- September (Sep 1 to Sep 30) unchanged versus round 1: MER 10.36x, aMER 1.91x, CAC $62.50, Ad spend share 9.6%, Revenue $205,352, CM3 $116,424, Paid spend $19,812.
- Last 30 days: MER 10.62x, aMER 1.99x, CAC $65.44, share 9.4%, Paid spend $19,763 +6.6%.
- Other clients: Manami 12m shows MER 3.16x, aMER 2.41x, CAC CZK 380, share 31.6% (spend from May 7, 2025, before the range); Venev Sep unchanged MER 0.15x, CAC EUR 416, share 655.4%, notice "Ad spend from Aug 18, 2026."
- Residual: see N-01 (stale delta in the margin stack) and N-02 (Ethia 12m blanks for a 2 day gap, notice date changes with the compare toggle).

### A-08 FIXED: null sorting
/products?client=dobias Sep, click "Margin %" twice.
- First click (high to low): GutSense 89%, JointButter H+ 88%, SoulFood 86% first; the three no-cost rows ("Pawsome Shipping Insurance", "Payment for items", "Dr. Dobias Healthy Dog Bed") are the last three.
- Second click (low to high): Perfect Fit Harness 51%, 52%, 53% first; the no-cost rows are again last.
- Margin cells for the no-cost rows now read "No cost data" (before: "n/a").

### A-09 FIXED, tiny residual: RawBark Customer payback
"90-day LTGP : CAC n/a / No cost data", "LTGP 30d No cost data", "LTGP 90d No cost data", "Gross margin No cost data", Blended CAC CZK 818. The wrong "CAC unknown" is gone. Remaining inconsistency: the lifetime "LTGP" line still says "n/a" while its siblings say "No cost data".

### A-10 PARTIAL: currency toggle
/snapshot?client=dobias&currency=CZK, Sep. Now labelled: "Customer payback ⓘ in USD", "LTV in USD", "LTGP in USD" (values still $97, $118, $19.85, $511, $393). That part of the fix is in. Not done: "Discounts given" in the CZK view still reads "n/a" (the plan said "USD only"). Blended CAC reads $19.85 here, $19.84 on the all-time page and $19.60 in round 1 (the cohort based number drifts with time, fine).

### A-12 FIXED: stale stock snapshot
- Stock health, Catalogue and Buying plan (Dobias, Venev) show one notice line: "Stock as of 2026-05-19. Buying suggestions off: over 30 days old." (Venev: "Stock as of 2026-08-03. ...").
- Buying plan (Dobias and Venev) renders only that notice and the cost coverage line ("Cost known for 66% of SKUs", "15 SKUs with negative stock"); no reorder actions, no unit counts, no "OUT OF STOCK" verdicts. Stock health still shows the mark-down suggestions (these do not depend on current on-hand in the same way; they carry the same notice).
- /health lists the missing feed: "Dr. Dobias Natural Pet Health | SHOPIFY PRODUCTS | Stock count | May 19 | Weekly | STALE" and "Venev | SHOPIFY PRODUCTS | Stock count | Aug 3 | Weekly | STALE". Venev SHOPIFY (orders) is still "Sep 30 | STALE" (volume-aware threshold was deferred).

### A-14 FIXED: products table
- Manami Sep: KPI 49 products, caption "Top 40 of 49 by revenue", LINE column gone (columns Product, Units, Revenue, Margin, Margin %).
- Ethia Sep: no LINE column; "Anti-age sérum s trojí kyselinou hyaluronovou | 11 | CZK 6,304 | No cost data | n/a" (was 100% margin).
- Dobias: LINE column kept (canine / human exist). Non-product rows (shipping insurance, payment for items) remain, as agreed (data).

### A-19 FIXED: tooltips
- Catalogue "Sell-thr." ⓘ sits at x=1214 in a 1400 px viewport. On hover the tooltip flips to right alignment: left 964, right 1224, fully inside the viewport (before: cut off).
- Hover then click keeps the tooltip open (before: the click closed it).

### A-21 FIXED: date label and chip agree
Ethia orders, Last 30 days to Last 7 days: right after the click the control reads "Sep 28, 2026 to Oct 4, 2026" and the range chip reads "LAST 7 DAYS" in the same render (round 1: label new, chip still "LAST 30 DAYS"). The date control, chip and mode pulse together and the thin progress bar runs. I did not see the main body dim during the transition (only the header region carries `data-pending`); that is a change from round 1, where the body also pulsed, but not a defect since the header pulse plus bar show activity.

### A-24 FIXED: copy items
Manami Email flows: "Flows are not available for Ecomail." Venev Repeat timing: "Too few repeat orders." Data health: "No read access to the pipeline log." (was "Pipeline log not readable."), and `shopify_products` is listed.

### A-18 / A-22 / A-23 / A-16 / A-13 / A-11
- A-18: Dobias Email flow now reads "Allergy Webinar AUGUST V2 - Registration Confirmation"; no U+2014 left in the page text. En dashes in campaign names stay.
- A-22: Orders Discounts column shows "none" for zero (Ethia, Venev, RawBark), "−CZK 299" and "−$105" for real discounts.
- A-23: "Not affected by date range." shown on Cohorts, Customers, Repurchase and Repeat timing.
- A-16: Customers "Repeat rate, lifetime", Repurchase "of customers came back, lifetime".
- A-13: "Clearing to 180 days frees about $14,147." (Dobias), "€8,918", "€4,822" (Venev), ">5 years of cover at 0.01 units/day."
- A-11: Dobias Growth (Sep): "Avg monthly growth: -12.8%, Cumulative: -12.8%", Oct row "n/a ... Partial". Dobias 12m (13 months): "Avg monthly growth: 1.0%, Cumulative: 13.2%": consistent, no more contradiction.

### A-20 PARTIAL: minus signs
Costs and discounts use U+2212 consistently in the margin stack ("−CZK 856,248", "−$27,660"). Still open: Venev "Discounts given −€0" (the "never -0" rule is not applied), and percentages use a hyphen ("CM3 % -575.4%", "Avg monthly growth: -12.8%") next to arrows that already show direction.

### A-15 DEFERRED, unchanged
Dobias cohorts: Sep 2026 327 vs Snapshot / Growth / Unit economics new customers 317; Aug 353 vs 336; Oct 41 vs 40. Others match.

### Scroll position kept on toggles FIXED
Cohorts (Dobias) in the 1400 px iframe, scrolled to Y=500: metric toggle (Active customers), window toggle (25 months) and country toggle (Canada) each left `scrollY` at 500 after commit (300 on the first toggle test). Note: the country chip is not optimistic; it stays on "All" for the whole 3 to 20 s round trip with only the pulse as feedback.

---

## Part 2: cross-page consistency, September 2026, native currency (Sep 1 to Sep 30, compare none)

| Client | Snapshot revenue | Orders revenue | Growth Sep | Orders count (Orders / Snapshot) | New customers (Snapshot / Growth / Unit econ / Cohort) |
|---|---|---|---|---|---|
| Dobias | $205,352 | $205,352 | $205,352 | 1,391 / 1,391 | 317 / 317 / 317 / 327 (mismatch, A-15) |
| Ethia | CZK 103,290 | 103,290 | 103,290 | 105 / 105 | 57 / 57 / 57 / 57 |
| Manami | CZK 292,728 | 292,728 | 292,728 | 272 / 272 | 214 / 214 / 214 / 214 |
| RawBark | CZK 1,732,982 | 1,732,982 | 1,732,982 | 901 / 901 | 104 / 104 / 104 / 104 |
| Venev | EUR 318 | 318 | 318 | 6 / 6 | 5 / 5 / 5 / 5 |

Identical to round 1 (no regression). Other cross-page numbers: Manami Products revenue CZK 287,517 (Shoptet line items) vs Snapshot revenue CZK 292,728 as before (revenue includes shipping), Ethia Products revenue CZK 100,716 = Net sales.

---

## Part 3: new findings (exploratory pass)

### N-01 (minor) Snapshot: Dobias 90d margin stack still prints a Paid spend delta that the top tile hides
- Page: /snapshot?client=dobias&preset=90d&compare=previous_period.
- Actual: the Paid spend tile shows "$47,904" with no delta (correct, the previous 90 days contain the pre-Apr 20 gap), but the margin stack row "− Paid spend −$47,904 ▲185.1%" and the CM3 row delta still compare against the partial previous period.
- Expected: same rule everywhere (no delta when the comparison has a leading gap).
- Fix: reuse the tile's `leadingSpendGap` flag for the comparison column of the margin stack.

### N-02 (minor) Snapshot: a 2 day leading gap blanks a whole 12 month MER/CAC; the notice date flips with the compare toggle
- Page: /snapshot?client=ethia&preset=12m.
- Repro: compare=none gives MER, aMER, CAC and Ad spend share all "Missing days" with the notice "Ad spend from Oct 7, 2025." (the 12m range starts Oct 5, 2025, so 2 of 365 days are NULL). With compare=previous_period the same period shows the notice "Ad spend from Feb 20, 2025." and still "Missing days". Ethia 90d and YTD are fine (MER 3.15x, 2.58x).
- Expected: a 2 day gap at the start of a year range should not blank the year, and the notice date should not change with the compare mode. "Ad spend from Feb 20, 2025" next to a range that starts Oct 2025 reads as a bug.
- Likely cause: `lib/queries/pnl.ts` `firstSpendDate(rows)` takes the first non-null day inside the rows (current plus comparison rows when a comparison is loaded), and any `range.from < spendFrom` is a gap, however small.
- Fix: tolerate a small leading gap (for example under 7 days, or under 2 percent of the range, show the ratio with a "2 days without spend" note), and compute the notice date once from the current range only.

### N-03 (minor) Buying plan: page is empty apart from one notice
- Page: /inventory/buying for Dobias and Venev. After the A-12 fix the page shows only "Stock as of 2026-05-19. Buying suggestions off: over 30 days old. Cost known for 66% of SKUs. 15 SKUs with negative stock". Correct, but no explanation of what the user could do (ask for the feed to be restarted) and no empty-state title. Add one line: "Re-sync the Shopify products feed (see Settings, Data health)."

### N-04 (polish) Revenue mix: duplicate x tick label on short ranges
- Page: /snapshot?client=ethia&preset=mtd (Oct 1 to Oct 4). Axis labels read "Oct 1, Oct 2, Oct 3, Oct 3, Oct 4": two ticks for Oct 3, one is probably Oct 3.x rounded. Use date-aligned ticks (one per day when under 8 days).

### N-05 (polish) Cohorts: country chip gives no immediate feedback
- Page: /cohorts?client=dobias. Metric and window toggles flip at once, but a country chip stays on "All" for the whole 3 to 20 s round trip (only the page pulse shows activity), so users click again. Make the chip optimistic like the other segmented controls.

### N-06 (minor, needs owner check) Page requests can hang until the platform timeout under parallel load
- What I saw: with 6 or more parallel page renders from one session (while other QA agents were also active), 4 requests hung 250 to 320 s and then failed (`Failed to fetch`): /growth?client=venev, /snapshot?client=dobias&preset=30d, /growth?client=dobias&preset=12m, and Dobias Snapshot all-time in an iframe. The same URLs answered in 5.6, 9.5 and 18.7 s when requested alone, one at a time, so I cannot call it a defect in the page. But a hang that long means a request can be stuck on an upstream query queue, and a user with several tabs open could hit it. Worth looking at whether `/growth` and `/snapshot` renders queue behind each other (BigQuery slot or connection pool limits), and whether Next route handlers have a timeout shorter than the 300 s platform limit.
- Single page timings today (cold, one at a time): Snapshot 6.3 to 9.5 s (all-time 7.7 s, Ethia 12m 18.7 s with compare), Growth 5.3 to 18.7 s, Unit economics 4.8 to 8.7 s, Cohorts 6.4 to 10 s, Products 3.5 to 4.5 s, Inventory 2.7 to 2.9 s.

---

## Worked well in round 2

- Orders grid, null sorting, products caption and no-cost wording, inventory money formatting, stale-stock handling, Data health coverage, Goals coverage line and attainment, Meta gap notice and "Missing days", date-based revenue mix axis, tooltip flip, scroll kept on toggles, client-switch masking, label/chip sync.
- No console errors, no non-200 responses for any page that completed.
- Cross-page figures unchanged and consistent.

## Numbers that still look suspicious

- Dobias cohort size 327 vs new customers 317 (A-15, deferred).
- Venev Sep: CM3 % -575.4%, Ad spend share 655.4%, MER 0.15x (tiny base, real).
- Dobias "Blended CAC" $19.84 / $19.85 vs "CAC" $52.47 to $65.44 on the same page (different definitions, still not explained beside each other).
- Ethia Products margin CZK 70,035 vs Orders "Gross profit" CZK 75,871 for Sep (different scope, not explained).
