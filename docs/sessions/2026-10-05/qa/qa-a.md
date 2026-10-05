# QA report qa-a: Analytics product, desktop, all 5 clients

Tester: qa-a. Site: https://dashboard.oneeighty.cz (live, admin). Browser viewport 1512x712 (not resized). Date of run: 2026-10-05 (browser UTC date was Oct 4, so "yesterday" = Oct 3 is the latest selectable day).
Standard period used for cross-page checks: custom 2026-09-01 to 2026-09-30, compare = previous period, native currency. Source read from `/Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard` (read only). No reports created, no settings touched, nothing written. My tab was closed at the end.

Screenshot evidence lives in `/Users/matej/.claude/projects/-Users-matej-Documents--One-Eighty-OE-Second-Brain/0c0e05a0-ccdc-42e6-aecc-187108a3fbca/tool-results/` (file names given per finding as `T/<file>`).

Severity counts: blocker 0, major 5, minor 12, polish 9.

Pages covered per client (all loaded, all 200, no console errors, no 4xx/5xx resource entries seen): Snapshot, Goals, Growth, Orders, Products, Unit economics, Stock health, Catalogue, Buying plan (Dobias, Venev; "Shopify not connected." for Ethia, Manami, RawBark), Email (Dobias, Manami; "Email not connected." for Ethia, RawBark, Venev), Customers, Time between orders, Cohorts, Repurchase, Repeat timing, Data health (lives under Settings tabs, not in the sidebar by design).

---

## Findings

### A-01 (major) Orders: "Recent orders" table renders as a stacked list, not a table, for every client
- Page: /orders, all 5 clients, any period. Viewport 1512 wide.
- Repro: open https://dashboard.oneeighty.cz/orders?client=rawbark&preset=custom&from=2026-09-01&to=2026-09-30&compare=previous_period and scroll to "Recent orders".
- Expected: a 8 or 9 column table (Date, Order, Customer, Country, Revenue, Net sales, Margin, Discounts, Type).
- Actual: header labels (DATE, ORDER, CUSTOMER, COUNTRY, REVENUE, NET SALES, DISCOUNTS, TYPE) are stacked one under another and each order is a tall block of 8 to 9 lines. DOM check: 51 of 51 rows (Dobias, Ethia, RawBark), 7 of 7 (Venev) have their cells at different vertical positions, i.e. no grid applied. Sorting still works but is unusable visually. All other tables (Products, Customers, Email, Repurchase, Cohorts, Buying) are fine.
- Evidence: `T/mcp-claude-in-chrome-blob-1791154634670-tqxww2.jpg` (RawBark), `T/mcp-claude-in-chrome-blob-1791154617814-nbf437.jpg` (Manami), `T/mcp-claude-in-chrome-blob-1791154725274-m9b0ct.jpg` (Dobias).
- Likely cause: `app/(app)/orders/page.tsx:124` builds the grid class with a template literal (`grid-cols-[...repeat(${columns.length - 5},minmax(0,1fr))_0.85fr]`). Tailwind's scanner cannot see a class assembled at runtime, so the class is never generated. `components/reports/widgets/TableWidget.tsx:147` already uses the right pattern (`GRID_CLASS[n]`, a static map).
- Fix: replace with a static lookup by column count (8 and 9 as literal class strings) or pass `style={{gridTemplateColumns}}`.

### A-02 (major) Switching client shows the OLD client's numbers under the NEW client's name for 3 to 5 seconds
- Page: any (reproduced on /orders and /inventory). Client switcher top right.
- Repro: open /orders?client=dobias&preset=30d, open the client menu, click Ethia, take screenshots immediately.
- Expected: either the old page stays labelled with the old client until the new data arrives, or the content is visibly blanked.
- Actual: header flips to "Ethia" at once, while the body still shows Dobias figures (1,404 orders, $210,084) for about 3 to 4 seconds (a thin progress bar and a faint pulse run, but the figures read as Ethia's). In the second run, switching Venev to RawBark on /inventory showed Venev stock (EUR 23,780) under the "RawBark" label, and then flipped to "Shopify not connected." Anyone screenshotting or reading quickly can attribute one client's numbers to another.
- Evidence: `T/mcp-claude-in-chrome-blob-1791154315835-0g8pv3.jpg` (Ethia label, Dobias data), `T/mcp-claude-in-chrome-blob-1791154242468-hz03be.jpg` (RawBark label, Venev data).
- Fix: keep the switcher label on the old client until the transition commits (like the segmented controls do with `optimistic`, but for the opposite purpose), or blank/skeleton the main region on client change instead of the soft pulse used for range changes.

### A-03 (major) Goals: quarter and year progress compare full actuals against a partial sum of targets (331%, 507%, 199% nonsense)
- Page: /goals, Dobias, Ethia, Manami (any client with only some monthly targets set).
- Repro: /goals?client=manami. "2026 Jan to Dec": Revenue CZK 1.8M "of CZK 540K", 331% of target, 76% of period elapsed; CM3 507%. Dobias 2026: 199% / 206% / 195% / 210%. Ethia 263% on CM3.
- Expected: either "n/a, targets set for 2 of 12 months", or compare only the months that have a target.
- Actual: actuals are summed for all 9 elapsed months, targets only for the 1 to 3 months where a target exists. The headline implies the year target is CZK 540K and that it is already smashed.
- Related noise: the month table shows "n/a" in 40+ cells and RawBark and Venev show "No target set" 12 times plus "No targets set." banner; Manami "THIS MONTH" says "No target set" while Q4 shows a target.
- Likely file: `lib/goals/progress.ts` `rollUp` (line 106) and `app/(app)/goals/page.tsx` (periods at about line 186).
- Fix: when fewer than all months in the roll-up have targets, label "target covers N of M months" and compute attainment only over targeted months.

### A-04 (major) Meta spend only exists since about June 2026, so MER, AMER, CAC and Ad spend share are wildly inflated on longer ranges, with no warning
- Page: /snapshot, Dobias.
- Repro: preset=all, 12m, ytd all show Paid spend $64,068 (identical), because Meta data starts around June. All time: MER 108.14x, AMER 23.50x, CAC $5.39, Ad spend share 0.9%. 12 months: MER 37.92x. YTD: MER 27.69x. 90 days: Paid spend +190.3% vs prev period, MER -66.1%, CAC +162.1%, because the previous 90 days had almost no spend. September alone: MER 10.36x, CAC $62.50.
- Expected: a notice such as "Meta spend available from Jun 1, 2026" or the acquisition tiles showing "n/a" when spend does not cover the period.
- Actual: numbers shown as if real. A user choosing "Last 12 months" will read MER 38x.
- Fix: store first-spend-date per source and add a Notice when range start < that date; null the ratios.

### A-05 (major) "All time" revenue-mix chart only draws Jun 1 to Oct 3 for an Oct 2021 to Oct 2026 range
- Page: /snapshot?client=dobias&preset=all&compare=none, "Revenue mix over time".
- Actual: x axis ticks "Jun 1, Jul 3, Aug 2, Sep 2, Oct 3" while the range label reads Oct 3, 2021 to Oct 3, 2026 and the headline totals ($6.9M, 48,994 orders) cover all five years. The new-vs-returning split is also empty before about Aug. 12 months and YTD charts draw their full range correctly. Chart silently covers about 4 months of a 5 year total.
- Evidence: `T/mcp-claude-in-chrome-blob-1791153813290-qnohbq.jpg`.
- Fix: find where the daily series is capped for long ranges (probably the series query or a limit for ranges over 365 days) and either extend, bucket weekly/monthly, or label the truncation.

---

### Minor

### A-06 (minor) "Shaded day is partial." is hard-coded onto the last day of every range, even ranges that ended days ago
- Page: /snapshot all clients, e.g. Sep 1 to Sep 30 (today is Oct 4/5). Sep 30 is shaded orange and labelled partial.
- Cause: `components/dashboard/RevenueMix.tsx:164` always shades `W - step` and line 185 always prints the caption; it never checks whether the last day is today.
- Fix: only shade and caption when `range.to >= today` (see `includesToday` in `lib/period.ts:207`).

### A-07 (minor) Revenue-mix chart (and sparklines) plot only days that have data, so sparse clients get a distorted time axis
- Page: /snapshot?client=venev (6 orders in Sep). X ticks read "Sep 6, Sep 13, Sep 15, Sep 22, Sep 30": uneven spacing, line drawn straight between order days, no zero days, range starts Sep 6 not Sep 1.
- Cause: `RevenueMix.tsx:50-81` uses `series.filter(revenue !== null)` and index-based x positions.
- Evidence: `T/mcp-claude-in-chrome-blob-1791153409981-jptkmu.jpg`.
- Fix: fill missing dates with zero (or position by date).

### A-08 (minor) Sorting puts "n/a" rows at the TOP when sorted high to low
- Page: /products?client=dobias, click "Margin %" once (desc): rows "Pawsome Shipping Insurance", "Payment for items", "Dr. Dobias Healthy Dog Bed" (all n/a) come first; click again (asc): they come last. The file header says "nulls sort to the bottom in both directions".
- Cause: `components/ui/DataTable.tsx:90-98` returns nulls-last, then line 176 negates the whole comparison for `desc`, which flips the nulls to the top.
- Fix: apply the null rule after the direction flip. Affects every table with n/a (RawBark margin columns, Email flows, Catalogue, Buying plan).

### A-09 (minor) RawBark Customer payback says "CAC unknown" right beside a known CAC
- Page: /snapshot?client=rawbark. Card shows "90-DAY LTGP : CAC n/a", "CAC unknown", "LTGP 30D n/a", "BLENDED CAC CZK 819", and the tile above shows CAC CZK 826.
- Actual cause: LTGP is unknown (no cost data), not CAC. `components/dashboard/BottomLine.tsx:94`.
- Fix: say "No cost data" (the same wording the rest of the page uses) when ltgp is null. Same card uses "n/a" for LTGP and "No cost data" for Gross margin: inconsistent.

### A-10 (minor) Currency toggle leaves part of the Snapshot in the original currency
- Page: /snapshot?client=dobias&currency=CZK. Revenue CZK 4,330,865, CAC CZK 1,318 etc. converted (rate about 21.09), but "Customer payback" (LTGP 30D $97, LTGP 90D $118, Blended CAC $19.60) and LTV $511 / LTGP $393 stay in USD in the same card column; "Discounts given" becomes "n/a". Currency label is not shown on those values besides the symbol. The deltas also shift when converting (Revenue -10.7% in USD vs -9.7% in CZK, Paid spend +12.6% vs +13.8%) because conversion is per day: confusing without a note.
- Cause (intentional per comment): `components/dashboard/BottomLine.tsx:10`, discounts `app/(app)/snapshot/page.tsx` (`discounts = display === "native" ? ... : null`).
- Fix: label the block "Shown in USD" or convert it; replace the discounts "n/a" with "USD only".

### A-11 (minor) Growth: "Avg monthly growth" and "Cumulative" contradict each other
- Dobias: Avg monthly growth +1.7%, Cumulative -12.8%. RawBark: Avg -1.2%, Cumulative +5.9%. Manami: Avg 3.3%, Cumulative 24.1%. Cause: average uses all shown MoM deltas, "Cumulative" is only the last transition.
- Also the partial month shows "-86.9% PARTIAL" (Dobias Oct, 4 days vs 30) in red; the chip helps, but the number is meaningless.
- Fix: define both over the same set of months; show "n/a" instead of the MoM for the partial month.

### A-12 (minor) Stock snapshot is months old
- Page: Stock health, Catalogue, Buying plan. Dobias "Stock as of 2026-05-19" (4.5 months), Venev "Stock as of 2026-08-03". Reorder suggestions (Dobias: 8 products, 4,576 units, $42,922, "OUT OF STOCK LiverTune") are computed on May stock. The notice is there, but the page presents verdicts as current. Suggest suppressing "Buying plan" actions when snapshot age > 30 days or showing a red banner. Also check why the Shopify products snapshot stopped (Data health does not list it).

### A-13 (minor) Pages with "n/a"/wrong money formatting in inventory copy
- "Clearing to 180 days frees about 14,147." (Dobias) and "frees about 8,918." / "4,822." (Venev) have no currency symbol. `lib/inventory/model.ts:224` uses `n()` instead of the money formatter.
- Also "100+ years of cover" (Venev) reads oddly; consider ">5 years".

### A-14 (minor) Products table: line item rows that are not products, 100% margin rows, and a silent 40 row cap
- Dobias: "Pawsome Shipping Insurance" (74 units), "Payment for items" listed as products with n/a margin; long marketing name "FeelGood Omega(R) Dr. Dobias' #1 Best-Selling Supplement" as product name.
- Ethia: "Anti-age serum s trojí kyselinou hyaluronovou" shows margin 100% (CZK 6,304 revenue, CZK 6,304 margin): missing COGS shown as 100%, not "No cost".
- Manami: KPI says 49 products, table shows 40 with no "showing 40 of 49" (`app/(app)/products/page.tsx:72`).
- "LINE" column shows uppercase "N/A" for Ethia, Manami, RawBark, Venev (all rows), while every other empty is "n/a"; the column is useless there, hide it when no product line exists.

### A-15 (minor) Cohort size does not equal "new customers" for Dobias
- Dobias Sep 2026 cohort: 327 customers vs Snapshot / Growth / Unit economics "New 317". Oct: 34 vs 33. Aug cohort 353 vs Growth 336. For Ethia (57), Manami (214), RawBark (104), Venev (5) cohort size and new customers match exactly, so this is Dobias specific (country filter All? multiple first orders?). Should be explained or fixed.

### A-16 (minor) Three different "repeat rate" numbers per client with similar names
- Dobias: Customers "Repeat rate 50.5%", Repurchase "59.8% of customers came back", Cohorts "Mature cohorts repeat rate 45.9%", Repeat timing "22.9% came back" (90 days). Ethia: 24.7 / 27.4 / 28.0 / 15.0. RawBark: 47.8 / 49.3 / 43.5 / 30.1. Different windows are the reason, but the labels do not say which window; a team member will ask which one is right.

### A-17 (minor) Skeleton for Growth does not match the loaded page
- /growth shows 4 KPI tiles plus chart plus table in the loading state; the real page has no KPI tiles (chart and table only). The content jumps when it lands. Also cold 12m load took about 13 s on Growth before anything appeared (cached ranges: 1 to 4 s; cold fetch timings I measured: Snapshot 7.2 s, Growth 5.6 s, Unit economics 7.7 s, Orders 4.1 s, Products 3.2 s). Currency and compare toggles take 6 to 7 s to land on an already-visited page.

---

### Polish

### A-18 (polish) Em dash in client data
- Dobias Email, flows table: "Allergy Webinar AUGUST V2 [em dash] Registration Confirmation" (name from Klaviyo). En dashes also present in campaign names ("Africa – Nail Trims & Rhinos") and Manami product names. No em dash anywhere in the app's own copy (scanned HTML of 80 page/client combinations plus source). If the rule is "never in output", normalise on ingest or at render.

### A-19 (polish) Tooltips get clipped
- Tooltip near the right edge of the Catalogue header (SELL-THR. ⓘ) is cut off by the viewport; the Fulfilment ⓘ tooltip in the Margin stack at the page bottom is cut off because the page cannot scroll further. Clicking an ⓘ that is already open from hover toggles it closed (`components/ui/InfoTip.tsx` onClick `setOpen(v => !v)`). Evidence: `T/mcp-claude-in-chrome-blob-1791154141211-j25fq4.jpg`, `T/mcp-claude-in-chrome-blob-1791154010416-re0tcd.jpg`.

### A-20 (polish) Minus signs are inconsistent
- Discounts use U+2212 ("−$27,660") while costs in the margin stack use hyphen ("-$40,600", "-CZK 24,845"); Venev shows "−€0" for zero discounts.

### A-21 (polish) During a range or compare change the date label updates before the numbers
- After picking "Last 7 days" the control reads "Sep 27 to Oct 3" with the chip still saying "LAST 30 DAYS" and old numbers for about 5 to 8 seconds (pulse is visible, so not frozen, but the label and data disagree).

### A-22 (polish) Orders table "Discounts" shows "n/a" on every row for Ethia and Venev, and for no-discount orders on RawBark
- "n/a" should be "none" or a dash when the platform reports discounts and the value is zero. Orders for Manami: row 20261935 shows Revenue CZK 1,680 below Net sales CZK 1,800 (revenue lower than net sales, no discount column).

### A-23 (polish) Date picker is shown on pages that ignore the range
- Cohorts, Time between orders, Repurchase, Repeat timing, Stock health, Catalogue, Buying plan, Customers (and Goals, which uses only the year). Some say so in a tooltip, most do not. Add a short "Not affected by date range" caption next to the picker on those pages.

### A-24 (polish) Misc copy and states
- Manami Email: flows section says "No data in this range." even though Ecomail flows are not ingested; "not available for Ecomail" would be truer.
- Venev Repeat timing: "No data in this range." although the page ignores the range and the client has repeat orders; say "Too few repeat orders".
- Data health: "Pipeline log not readable." shown in "Recent pipeline runs" (`app/(app)/health/page.tsx:219`), Klaviyo subscribers and Manami Ecomail are "BLOCKED" while Email pages for both load campaigns; Venev Shopify "STALE" (last landed Sep 30, a 6 orders/month store; Venev has had real staleness before so keep, but make the threshold volume-aware).
- Venev Snapshot: "Ad spend share 655.4%" and "CM3 % -575.4%": real but alarming; consider capping or a note for tiny bases.
- Growth chart has no value labels or tooltips on bars.
- Dobias Snapshot shows "CAC $62.50" in Acquisition economics and "BLENDED CAC $19.60" in Customer payback; the two CAC values are not explained next to each other.

---

## Checked and as expected (the brief's specific items)

- RawBark Snapshot: CM3 and CM3 % tiles say "No cost data", Margin stack shows "No cost data" for COGS, CM1, CM2, CM3, "Paid spend is Google only." notice present, Paid spend tile source "GOOGLE". Products and Unit economics margin cells also say "No cost data". Orders page hides Gross profit. OK.
- Ethia and RawBark have Customers (1,257 / 14,489 customers), Cohorts (914 / 1,952 in the 13-month grid), Repurchase (27.4% / 49.3%), Time between orders and Repeat timing data. OK.
- Venev Email is hidden in the sidebar (and "Email not connected." by URL). Ethia and RawBark too. OK.
- Manami Email shows 14 Ecomail campaigns, totals reconcile (campaign revenue CZK 31,256 = sum of rows, recipients 12,335 = sum). OK.
- Dobias Email loads Klaviyo: 18 campaigns, $96,083 (sum of rows reconciles) and 9 flows $17,383 (sum reconciles). OK.
- Sidebar per client: Dobias = full set incl. Inventory (3) and Email; Ethia = no Inventory, no Email; Manami = no Inventory, with Email; RawBark = no Inventory, no Email; Venev = Inventory but no Email. Paid shown (internal). Sections with all pages hidden disappear. OK.
- Not-connected states are one clean line ("Shopify not connected.", "Email not connected."), no dev text.
- Date presets (7d, 28d, 30d, 90d, MTD, YTD, 12m, all), custom range via picker, Escape closes the picker, compare Prev period / Prev year / None, currency toggle (locked with lock icon on "All time"), URL carries all state, back button restores, reload restores. Prev year labels the compared range (e.g. "vs Sep 28, 2025 to Oct 4, 2025" for Sep 27 to Oct 3, a weekday aligned 364 day shift).
- Loading state: `data-pending` pulse (opacity 0.5 to 0.8, `oe-pulse`) was active on every range, compare and currency change I sampled, a thin progress bar runs during client switches, skeletons show on first load. I saw no frozen screen. Caveat: A-02 and A-21.
- Tooltips: MER (name, formula, source, caveat), Fulfilment ("Orders x per-order rate", source Settings, caveat), Catalogue ABCD and sell-through all explain their metric.
- Sorting works on Products (Units, Margin %), Catalogue, Customers, Email tables (apart from A-08).
- Cohort grid metric and country toggles work (each is a server round trip of 3 to 6 s), Repeat timing 90/180/365 works.

## Numbers that look suspicious

- Dobias Snapshot Sep 2026: Products revenue $203,813 vs Snapshot Revenue $205,352 vs Net sales $196,950 (none match). Products margin $162,470 vs CM1 $164,752. Ethia: Products revenue CZK 100,716 = Net sales (ok) but margin CZK 76,340 vs CM1 CZK 78,445. Manami: Products CZK 287,517 vs Revenue CZK 292,728. RawBark: CZK 1,688,606 vs CZK 1,732,982. Venev matches. Products "Revenue" delta vs Snapshot "Revenue" delta disagree for the same current number (Venev +45.1% vs +59.8%; Dobias -12.3% vs -10.7%).
- Dobias cohort 327 vs 317 new (A-15).
- Dobias all-time MER 108x, YTD 28x, 12m 38x (A-04).
- Venev: MER 0.15x, CM3 % -575.4%, Ad spend share 655.4%, CAC EUR 416 (tiny base, real but should be flagged).
- Goals 331% / 507% / 199% (A-03). Goals order counts rendered as "1K", "5K", "12K", "3K of 1K" (1 significant digit): "NEW CUSTOMERS 3K of 1K" cannot be read.
- Dobias "Days active 543", Customers top row "k••••e@gmail.com ... Days 1,600" fine; Customers table in Dobias includes B2B/clinics (millgrovevet.com, goodhopecannery.com).
- Manami Orders: Revenue lower than Net sales on one order (A-22).
- Manami and RawBark "Unit economics" returning column "Paid spend applied CZK 0" and "Contribution margin % = Gross profit %" for returning customers (spend is fully allocated to first-time customers: intended, but returning contribution margin ignores fulfilment).

## Cross-page consistency (September 2026, native currency)

| Client | Snapshot revenue | Orders revenue | Growth Sep | Orders count | New customers (Snapshot / Growth / Unit econ / Cohort) |
|---|---|---|---|---|---|
| Dobias | $205,352 | $205,352 | $205,352 | 1,391 | 317 / 317 / 317 / 327 (mismatch) |
| Ethia | CZK 103,290 | 103,290 | 103,290 | 105 | 57 / 57 / 57 / 57 |
| Manami | CZK 292,728 | 292,728 | 292,728 | 272 | 214 / 214 / 214 / 214 |
| RawBark | CZK 1,732,982 | 1,732,982 | 1,732,982 | 901 | 104 / 104 / 104 / 104 |
| Venev | EUR 318 | 318 | 318 | 6 | 5 / 5 / 5 / 5 |

Margin stack arithmetic checks out for all clients (CM1 = Revenue - COGS, CM2 = CM1 - fulfilment, CM3 = CM2 - paid spend), MER = Revenue / paid spend, CAC = spend / new customers, Orders market split sums to revenue, gaps histogram sums to gaps measured, email row sums equal the tiles.

## Worked well

- Sidebar hides pages for missing sources per client; not-connected states are clean one-liners.
- RawBark "No cost data" handling is consistent across Snapshot, Products, Unit economics, Customers (LTGP) and Goals (CM3 n/a).
- Pulsing loading state on range, compare and currency changes; progress bar on client switch.
- State lives in the URL: shareable, back and forward work, reloads restore.
- Source badges on every KPI (SHOPIFY, WAREHOUSE, META), compare labels explicit ("vs Aug 2, 2026 to Aug 31, 2026").
- MetricTooltip content is concise and gives formula, source and caveat.
- Revenue figure agrees across Snapshot, Orders and Growth for all five clients.
- Cold page loads 3 to 8 s, cached 1 to 4 s, no 4xx/5xx, no console errors.
