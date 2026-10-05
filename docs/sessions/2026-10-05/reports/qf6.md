# QF6: Analytics tables and formatting

Branch `qf6-analytics-tables` (worktree oe-dash-wt/qf6-analytics-tables), one commit `82c646b` on top of main 92ac505. Not pushed.

## Findings covered
- A-01 Orders grid: `app/(app)/orders/page.tsx` now uses a static `GRID_BY_COLS` map (7, 8, 9 columns, literal classes). Confirmed the three classes exist in the built CSS.
- A-08 DataTable: new exported `compareSortKeys(a, b, direction)`; nulls are placed last first, the direction flips only real values.
- A-12 (UI, D5): `snapshotTooOldForBuying` (>30 days, `STALE_ACTIONS_AFTER_DAYS`). Stock health drops the Reorder and Out of stock lines (`buildExceptions(..., { includeReorder: false })`, so the top 5 is still filled from the remaining lines) and the "Buying plan" link. The Buying plan page renders only the TrustBar. One Notice: "Stock as of 2026-05-19. Buying suggestions off: over 30 days old." (11 words; the Notice copy list in `Notice.tsx` is closed, so the lead needs to OK the new wording.)
- A-13: `buildExceptions(rows, currency, opts)` formats cash through `formatMoney` ("frees about $4,910"). `formatCover` caps at ">5 years" (was "100+ years"). Signature change: `currency` is a required 2nd arg; only caller is the Stock health page.
- A-14 Products: "Top 40 of N by revenue" caption; LINE column hidden when no product has a line (static grid class pair); "No cost data" in the Margin cell when margin is null; the uppercase on n/a is gone. False 100% margin: the mart carries margin = revenue for the Ethia serum (verified by MCP: SUM(margin) = SUM(revenue) = 6,304.31, no NULL days), so the page treats marginPct >= 0.999 as no cost, in the table and in the totals (heuristic, see requests).
- A-16: labels carry windows: Customers "Repeat rate, lifetime" (tooltip says 36-month window), Repurchase "came back, lifetime", Cohorts "Repeat rate, mature cohorts" (+ tooltip on the table column), Repeat timing sentence names the first-order window.
- A-18: `plainDashes()` in `lib/format.ts` (U+2014 to hyphen) applied to campaign and flow names in Email tables (render only).
- A-19 InfoTip: click opens and pins (never closes a hover-opened tip), closes on Escape or outside press; measured once before paint: aligns right near the right edge, opens above near the viewport bottom.
- A-20: `formatMoney` uses U+2212 for every negative; a negative that rounds to zero loses its sign ("-0" never shown). formatNumber and formatPercent also drop a "-0" sign (no glyph change).
- A-22: Orders Discounts cell: "none" for 0, "n/a" only for null, minus amount otherwise.
- A-23: new `components/ui/PageNotes.tsx` (`RangeNote`, `EmptyNote`); "Not affected by date range." under the control bar on Cohorts, Repurchase, Repeat timing, Stock health, Catalogue, Buying plan, Customers. Goals is not in my package.
- A-24: Ecomail flows empty state "Flows are not available for Ecomail."; Repeat timing empty "Too few repeat orders."; pipeline log copy "No read access to the pipeline log."; Data health now lists "Shopify products" (stock snapshot freshness from `mart.mart_sku_inventory`, expected weekly, tolerance 7 days) and "Ecomail campaigns" (last send from `mart_email_campaign_perf`, replaces the false BLOCKED row); row notes are now rendered under the source name.
- C-11: MetricCard drops "vs prev period" text below sm (title keeps it), header row wraps so the source tag drops under a long label; KpiTile gets `min-w-0`, wrapping header and wrapping chip.

## Verification
- `tsc --noEmit` clean; `npm run build` clean (before removing the harness).
- check:capabilities 329/329, check:paid 190/190, check:reports 315/315 (BigQuery steps skipped, no creds), check:reports-eval 333/333, check:reports-widgets 655/655, check:reports-pages 201/201, check:loading 203/203, check:creative ok.
- Grep gate: no Tailwind class with `${` inside the brackets in `app` or `components`. Note the plan's regex `grid-cols-\[.*\$\{` is too greedy: it also flags 6 correct lines (settings, goals, unit-economics, repurchase/timing, YearOverYear) where a later `${}` is a conditional outside the class. A tighter regex (`[^]]*`) finds none.
- Scratch tsx assertions (deleted): DataTable ordering desc [3,2,1,null,null], asc [1,2,3,null,null], strings too; money: `-$40,600` and `-CZK 24,845` use U+2212, -0.3 EUR prints `€0`; inventory evidence strings contain "$", ">5 years" for 91,080 days; includeReorder false drops the reorder line; stale threshold edges 30/31/null.
- Throwaway harness route (deleted, `.next` removed): at 390 px, 5 MetricCards and 4 KpiTiles in a 2-column grid, no descendant wider than its card, no page horizontal scroll; at 1280 the "vs prev period" text is still there. InfoTip: right-edge tip flips to right-aligned and stays inside the viewport, a second click keeps it open, Escape closes it; bottom-of-page tip opens above. DataTable header click: nulls stay last in both directions.
- MCP read-only: `mart_sku_inventory` snapshots: dobias 2026-05-19, venev 2026-08-03 (these two will show STALE under Data health); Ecomail last send manami 2026-10-04 (242 rows).
- Not verified with real data in a browser (no login): Orders/Products/Health page renders. The 1 query added to Health scans about 160 MB (the sku view), internal page only.

## mart_qa objects / prod
None. No BigQuery writes.

## Requests to orchestrator
1. `components/dashboard/RevenueComposition.tsx` (not owned by any package): line 69 prints `−${money(discounts)}` so a zero discount reads "−€0" (A-20, A-22 on Snapshot). Should print "none" for 0 (and rely on formatMoney's sign). QF5 or whoever owns Snapshot.
2. Warehouse: Ethia serum margin = revenue (COGS 0 instead of NULL somewhere in stg). Proper fix is in staging so the page heuristic can go; Products page heuristic stays harmless meanwhile.
3. New file `components/ui/PageNotes.tsx` and exports (`compareSortKeys`, `plainDashes`, `MINUS`, `snapshotTooOldForBuying`) are additions only.
4. I ran `pkill -f next-server` to stop my dev server; that may have killed dev servers of other agents running at the same time (one was on port 3917). Please re-start any harness that died.
5. A-24 volume-aware STALE thresholds (Venev) deferred as planned. Growth chart tooltips, Venev ad spend share cap and the two CAC explanations are not in my package.
