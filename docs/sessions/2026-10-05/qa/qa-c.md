# QA report qa-c: Reports (/reports) desktop + mobile pass

Tester: qa-c. Live site https://dashboard.oneeighty.cz, owner session (admin). Date of run 2026-10-05.
Created 4 reports (QA test portfolio, QA test paid, QA test retention, QA test blank), all deleted at the end. List verified: only the owner's pre-existing "Paid efficiency" and two "Portfolio overview" remain, untouched. Deleted report URL returns 404. Delete is a soft delete (restoreReport exists in actions.ts), the report disappears from the list as expected.

Source paths are relative to dashboard/ in the repo.

Counts: blocker 0, major 3, minor 9, polish 7.

## Findings

### C-01 major: Reports CM3 for Dobias ignores fulfilment, does not match Snapshot (CM3 overstated by about 1.8M CZK)
- Page: /reports (any report with CM3 or CM3 %), client Dobias, 90d, CZK.
- Repro: add KPI CM3 and Table with CM3 % by client (the Portfolio overview template has both). Compare with /snapshot?client=dobias&preset=90d&currency=CZK.
- Expected: same CM3 as Snapshot, "Revenue minus COGS, fulfilment and paid spend" (metric description in registry/metrics.ts:209).
- Actual: Reports Dobias CM3 % = 72.6% (13.03M - 2.56M COGS - 1.00M spend = 9.46M). Snapshot Dobias CM3 = CZK 7,664,008, 58.8%, because it also subtracts FULFILMENT -CZK 1,800,591. Portfolio KPI CM3 shows CZK 9.8M (9.46M + Manami 251K + Ethia 121K), real combined is about 8.0M. Manami (251,328, 32.9%) and Ethia (121,417, 43.6%) match Snapshot exactly, so only Dobias is off. Likely `kpis.fulfillment_cost` is null for Dobias in the mart, and the term has nullMeans "zero" so it silently counts as 0 instead of being flagged or sourced from the same place as Snapshot.
- Evidence: numbers above, read via DOM text on both pages.
- Suggested fix: lib/reports/registry/metrics.ts:104-109 (CM3_TERMS) and registry/components.ts:126. Source Dobias fulfilment from the same place Snapshot uses, or make a missing fulfilment term a gap ("No cost data"/coverage marker) instead of zero when the client has fulfilment configured.

### C-02 major: "Widget removed / Undo" toast (and every Reports toast) is positioned at the bottom of the whole page, off screen on any long report
- Page: report in edit mode, report longer than the viewport.
- Repro: select a widget, press Delete. Toast element exists ("Widget removed" + Undo) but its rect.top is 1680 to 2296 px with innerHeight 1233, so it is below the fold. On the short /reports list the same toast shows correctly at the bottom of the viewport.
- Expected: toast fixed to the viewport bottom (the code says `fixed inset-x-0 bottom-[calc(1rem+...)]`).
- Actual: a `fixed` element inside `.product-enter` (identity transform matrix left by `animation: ... both`) is positioned relative to that transformed ancestor, i.e. the whole page. The only undo affordance for Delete is therefore invisible unless the user scrolls to the page bottom within 6 s (ttl). Cmd+Z does work.
- Evidence: JS ancestor walk: `DIV.product-enter ... tf=matrix(1, 0, 0, 1, 0, 0)`; toast rect.top=1680.19, scrollY=559, vh=1233.
- Suggested fix: app/globals.css:338-339, use `animation-fill-mode: backwards` (or `none`) so no transform remains, or render ToastRegion through a portal to document.body (components/reports/Toasts.tsx:69). Same issue affects "Copied"-style feedback only if it uses toasts (ShareMenu uses an inline label, fine).

### C-03 major: slow refetch, 15 to 25 s to settle after any filter change on a 13 widget report
- Page: QA test portfolio (13 widgets), 5 then 3 clients.
- Repro: change compare to Prev year, or period to Last 28 days, or client set. Widgets fade and pulse (good), but KPIs update first (about 8 s), the table and bar widgets several seconds later (about 20 to 25 s total). During the gap the page shows mixed periods: KPI/line already on 28d while table and bar still show the 90d numbers at near full opacity (Dobias $618.8K next to KPI $217.2K).
- Expected: either one consistent state or all stale widgets clearly dimmed until the new data lands.
- Actual: partial update, inconsistent numbers on screen for up to ~15 s. Other QA agents were loading the site at the same time, so part of this may be load, but template creation (8 to 10 s to fill) and 6 sequential POST /api/reports/query calls per load are consistent with it.
- Evidence: screenshots during the 28d switch; network shows 6+ POST /api/reports/query per load, all 200.
- Suggested fix: batch widget queries into one request or cap concurrency; dim every widget whose query key differs from the current filters (components/reports/useWidgetData.ts).

### C-04 minor: Frequency, CAC and other newly added columns show "n/a No data" before data arrives instead of pulsing
- Page: report, Table widget, add metrics (Meta ROAS, Cost per LPV, Hook rate, Link CTR, Frequency, CAC) in the inspector.
- Actual: right after adding metrics the table showed "n/a No data" in Frequency and CAC for Dobias/Ethia/Manami; about 20 s later the same cells filled with 1.54 / 1.75 / 1.28 and CZK 1,094 / 659 / 458. During the wait it looks like missing data and violates the "loading must pulse" requirement for cells.
- Expected: skeleton pulse per cell (or the whole table) until resolved.
- Suggested fix: components/reports/widgets table rendering: treat "metric added but not yet fetched" as pending, not as a null result.

### C-05 minor: rapid successive control changes drop the first one (filter race)
- Repro: click the Industry toggle, then within about a second click a currency pill (or the reverse). Result: URL ends with only the second change (`ccy=USD&bench=1` stayed on although I clicked Industry off first). In the first run clicking Industry then EUR left Industry off. Isolated clicks work.
- Likely cause: both handlers build the next search params from a stale `searchParams` snapshot, last write wins.
- Suggested fix: use a functional/ref-based URL update in ReportFilterBar.tsx so each change merges onto the latest URL.

### C-06 minor: first click after a page load is ignored (New report menu and row "..." menus)
- Repro: navigate to /reports, wait 3 to 4 s, click "New report" then a menu item. Three out of three times on a fresh load nothing was created (menu closed or click lost); the same actions on a second try worked. Same for the row "..." menu after a fresh load (first click only highlighted the button).
- Expected: first click works once the page is visible.
- Suggested fix: check hydration of the Popover (components/reports/Popover.tsx) and that the "New report" control is not a plain link to /reports?new=1 that reloads the page (the sidebar plus button is `href="/reports?new=1"`).

### C-07 minor: every report open fires a POST on the page route that returns 503
- Network: after the /api/reports/query calls, `POST /reports/<id>?edit=1` (and `POST /reports/<id>?clients=...&preset=7d`) returns 503 on both loads I inspected. Almost certainly the `touchOpened` server action (components/reports/ReportClient.tsx:584, errors swallowed by `.catch`). Nothing visible breaks, but recency ordering ("Recent" in the sidebar, "last opened" in the list) may not be recorded.
- Suggested fix: look at the Vercel function logs for that action; add retry or log a visible warning.

### C-08 minor: Copy link copies the current URL with `edit=1` and the sender's local filter overrides
- ShareMenu.tsx:32 uses `window.location.href`. A recipient opening the link lands in edit mode (if allowed) with the sender's unsaved clients/currency/period instead of the saved default. Suggest copying `/reports/<id>` plus only an explicit "include current filters" option.

### C-09 minor: partial first week is not marked in weekly charts, so short periods draw a misleading ramp
- Page: any weekly line widget, preset Last 28 days (Sep 6 to Oct 3) and Last 7 days.
- Actual: first bucket "Aug 31" contains only Sep 6 (one day), plotted near 0 USD and connected by a steep line to Sep 7; on 7d the "weekly" chart is two points with a straight diagonal. Only the trailing partial week is shaded.
- Suggested fix: shade/flag the leading partial bucket as well, or switch grain to Day for periods under 5 weeks.

### C-10 minor: KPI "n of m" coverage marker is clipped on mobile report cards
- Page: report on 390 px wide viewport (2 column KPI grid). "3 of 5" next to MER and aMER is cut ("3 of 5" runs to the card edge), CAC shows "3 o".
- Suggested fix: allow the marker to wrap under the value or shrink the value font in the stack tier (components/reports/canvas/MobileStack.tsx).

### C-11 minor: Snapshot/Paid small metric cards overflow: "vs prev period" runs past the card edge on mobile
- Pages: /snapshot (AOV, MER, AMER, CAC, Ad spend share) and /paid Overview (MER, CAC, Revenue, New customers), 390 px. The delta line "▼ 66.1% vs prev period" is wider than the 2-column card and crosses its right border; "AD SPEND SHARE" label wraps to three lines next to the source tag.
- Suggested fix: hide "vs prev period" or wrap it to a second line below 400 px.

### C-12 minor: mobile nav menu hides the Reports section tab, and the page/client menus can be open at once
- Page: any page, mobile top bar. The page switcher panel is 233 px wide with a 287 px wide "SECTIONS" row (Assistant, Analytics, Creative, Reports): Reports is off screen behind an invisible horizontal scroll (scrollWidth 287 vs clientWidth 233). On this viewport the user cannot see that Reports exists.
- Also: opening the client chip while the page menu is open stacks both panels over each other (Escape did not close the page menu; the chevron stayed up). One panel should close the other.

### C-13 minor: mobile date control is a very tall popover, Apply is below the fold
- Page: any page with the date control, 390x844. Presets list plus a two month calendar make the popover about 1100 px tall; Cancel/Apply sit at y 1203 to 1242, so the user must scroll the page behind the popover to apply a custom range. Presets apply immediately, but custom range needs the buttons. Suggest a bottom sheet with sticky Apply, and a horizontal scrollbar also appears while it is open.

### C-14 minor: Keyboard "add widget" flow right after adding a widget goes into the inspector search
- After a widget is created the inspector auto focuses its metric search. Pressing Escape once only closes the metric dropdown; "/" typed next then lands in the search box ("//" ended up in the field and the picker said "No match"). Need Escape twice before "/" works. Not wrong per se, but it ate my first attempt and could surprise a keyboard user. Consider closing the inspector or moving focus to the canvas on a single Escape.

### C-15 polish: chart axis labels clipped at the card edges
- Weekly line widgets: the Y labels lose their first character ("ZK 2.7M", "ZK 1.8M"); Bar widgets: right edge label "CZK 14M" and bar category labels ("Manami s.r...."); Scatter widgets: point labels cut off at the plot edge ("Dr. Dobias Natur") and Ethia / Manami labels overlap each other. Screens: Portfolio overview template, desktop 1568 wide frame.

### C-16 polish: tooltip says "before" for the previous period series, and "All clients (4 of 5)" does not match the KPI "3 of 5"
- Hover on weekly MER line, Aug 10: "All clients (4 of 5) 16.98x / before 21.35x". Rename "before" to "Previous period". Coverage differs per week which is fine, but a one-line explanation (per bucket coverage) would avoid confusion next to the KPI.

### C-17 polish: compare line for MER/aMER/Platform ROAS on 90d is a two-point floating dotted fragment
- Paid efficiency template: previous period MER only exists for about two weeks (the rest has missing days), so the dotted line is a tiny segment at 20 to 21x floating near Aug 3 to Aug 10, and MER/CAC KPIs show no delta. Snapshot shows MER delta (-66.1%) and CAC delta (+163.2%) for the same client and period, so Reports is stricter. Add a caveat line ("Previous period incomplete") so it does not look broken.

### C-18 polish: MER KPI shows "n/a No data" but still draws a faded sparkline (RawBark)
- RawBark only, Pet food vertical: MER n/a with a greyed trend line behind it. Either hide the sparkline or label it ("partial data"). The reason ("Missing days") is only in the hover, the cell says "No data" which sounds like zero rows rather than gaps.

### C-19 polish: shortcut sheet is bottom aligned and the inspector overlaps the profile chip
- "?" sheet appears flush with the bottom of the viewport instead of centered, and the Matěj Rozsypal chip in the top right sits on top of the inspector header when the page is scrolled (inspector title "Widget" and first metric chips hidden under the chip).

### C-20 polish: smaller things
- Rename flow: the inline rename field does not select the existing text on open (typing appends); sidebar "Recent" keeps the old name (or "Untitled report") until a later refresh; after deleting a pinned report the sidebar "Pinned" entry stays until the next navigation.
- KPI widget accepts multiple metrics in the picker, builds the title "Revenue, Meta ROAS" but only renders the first metric. Either limit KPI to one or show both.
- Metric search input keeps its typed text after switching widget type (shows "roas" next to the chip).
- Duplicated widget keeps the identical title (no "copy" suffix); table widget with 3 rows keeps a large empty area (default height too tall).
- Blank report empty state is just faint "No widgets" text at top left with a + far away; add a prompt ("Add your first widget") and templates link.
- View mode: widget menu has one item "Open" which opens a read-only inspector whose Type pills and metric search look editable (only some controls are greyed). Rename to "Settings" or "Details" and grey everything.
- Orders count in tables is rounded to "4K", "3K" (Dobias 4,172 orders); revenue "CZK 13M". Precision lost for an agency report, consider 4,172 and CZK 13.0M.
- Industry toggle with an empty benchmark table draws nothing and shows no message. As expected per brief (nothing drawn, no error), but a small "No benchmark data yet" hint would help.

## Drag, resize, drop (needs a human re-check)
- Drag with the mouse via automation (`left_click_drag` on the header handle): the widget moved and neighbours reflowed, but the dashed green placeholder stayed on screen and after reload the layout had NOT persisted (both attempts), console had no errors. This may be an automation artifact (synthetic mouseup), so I did not file it as a bug; please verify one real drag. Keyboard move (Arrow), resize (Shift+Down), duplicate (Cmd+D), delete (Delete), undo (Cmd+Z), redo (Cmd+Shift+Z) all worked and persisted (14 widgets after reload).

## Mobile pass method note
- The `resize_window` tool reported success to 390x844 but `innerWidth` stayed 2560, so the real window was not resized (and I did not touch it). I tested mobile by loading each page in a 390 px wide same-origin iframe in my own tab, which triggers the same CSS breakpoint (stack tier, mobile top bar). Touch emulation / pointer:coarse behaviour was not covered, tap target sizes are measured from CSS pixels (nav rows 44 px, Share/Refresh about 35 px, MER/aMER toggle about 30 px, mobile calendar day cells about 40 px).
- Pages covered: Snapshot, Paid Overview (daily table is 30 rows, tables scroll horizontally with only a thin scrollbar as hint, campaign names truncated), Creative grid (single column cards, page is about 40,000 px tall for 48 creatives, sticky tab strip is translucent so image text ghosts through it), a Report (read-only stack works, filter summary collapses into "5 clients, 90d, vs prev, CZK"), Reports list, top bar, page switcher, client switcher (lists Lumen Botanicals (DE...) USD, a sixth client that is not in the Reports picker), date control sheet. No horizontal page overflow (scrollWidth 373 vs 388).

## Worked well
- Loading pulses: skeletons use `oe-skeleton` with `oe-pulse 1.5s`; during refetch widgets dim and 7 pulse elements were animated.
- Coverage markers: CM3 "4 of 5 clients. RawBark: No cost data", MER "3 of 5 clients. RawBark: Missing days. Venev: Missing days"; Venev MER includes itself again in the 7d period when its data is complete (no marker). RawBark vertical view: CM3 "n/a No cost data", MER "n/a No data" with the Missing days reason.
- Metric picker: "roas" returns MER, Meta ROAS (4 of 5), Google ROAS (2 of 5); "cost per landing" finds Cost per LPV; "hook", "link", "freq", "cac" all find the metric. Soft Meta metrics plausible: Cost per LPV Dobias CZK 16, Ethia 21, Manami 22, Venev 96; Hook rate 54.5% / 54.7% / 45.7% / 76.4%; Link CTR 2.17% / 0.97% / 1.47% / 1.50%; Frequency 1.54 / 1.75 / 1.28 / 1.31; RawBark "Not connected" everywhere on Meta metrics.
- Cross checks that match Snapshot: Dobias revenue 13,028,626 (CZK 13M), MER 12.99x, CAC CZK 1,094, orders 4,172, new customers 917; Manami and Ethia revenue/CM3/CM3 %/MER/CAC identical. EUR conversion consistent (13.0M CZK -> 537.6K EUR, about 24.2).
- Client picker: All active, subset (3 clients, URL `clients=ids:dobias,ethia,manami`), By vertical (Fragrance, Pet food, Pet supplements, Skincare; Pet food = RawBark) and the combined/total math for 3 clients (14.1M) is right.
- Templates (Portfolio overview, Paid efficiency, Retention mix) and Blank all create and open; widgets of all six types added with + and with `/` (type menu has arrow key navigation); Share (Private / Team can view / Team can edit, switched and restored), Pin (sidebar "Pinned" section), Save default (persisted across reload), E toggles edit, Cmd+K switcher, `?` shortcut sheet, undo/redo, reload persistence, deleted report 404.
- View mode is read only; Industry toggle on with empty benchmarks shows nothing and no errors; console errors on Reports pages: none from the app (only a Chrome extension "message channel closed" exception).

## Numbers that look suspicious
- Dobias CM3 in Reports vs Snapshot (see C-01): 9.46M vs 7.66M, 72.6% vs 58.8%.
- Venev CM3 % -573.2% (CZK 12.5K revenue, mostly ad spend) and -557.6% over 7d; probably real, but it dominates tables and sorting.
- Hook rate 45 to 76% for all clients is much higher than the usual 25 to 35% benchmark; swings like Ethia -22.5 pp and Manami +24.4 pp vs previous period with cost per LPV -56% / +69% suggest the video-only filter ("ad days with plays") changes the mix between periods. Dobias per-creative hook rates on the mobile Creative grid are 80 to 83%. Worth confirming the definition (video_play_actions vs 3 second plays).
- Venev Cost per LPV CZK 96 is 4 to 6 times the others (EUR native, tiny spend) and Frequency 1.31 with no delta; low volume.
- Aug 10 week spike (Dobias revenue about 2.0M vs about 1.0M typical, weekly MER 17x, Meta ROAS 4.3x vs 2 to 3x). Probably a promo, but visible on every portfolio chart.
- Dobias Meta ROAS 2.65x vs MER 12.99x (5x apart): consistent with attribution share, but easy to misread; the Paid efficiency template puts them side by side.
- Manami revenue +202% vs Prev year with orders +197% (advent calendar season ramp, memory note says 2025 sold 29 calendars); fine but outsized.
- Dobias paid spend +191% vs previous period (Snapshot) while the Reports table hides the MER and CAC delta for the same client (C-17).
