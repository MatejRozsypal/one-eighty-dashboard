# QA round 2 report qa2-c: Reports (/reports) desktop + mobile re-test

Tester: qa2-c. Live https://dashboard.oneeighty.cz (deploy b5868b1), owner session. Run 2026-10-05.

Method notes
- My tab was a 606x667 background window (innerWidth 606, visibilityState hidden), so I could not use a real desktop viewport. For the desktop pass I loaded the app in a 1440 px wide same-origin iframe scaled to 0.42 (media queries see 1440), for mobile a 390 px iframe. Real mouse and key events (clicks, Delete, Escape, ?, Cmd+D) were used where it mattered, JS clicks elsewhere. Timings come from a fetch wrapper, a MutationObserver and Resource Timing (timers are throttled in hidden tabs).
- Other QA agents and the data agent were hitting prod at the same time, so absolute timings are a worst case. Server RSC render time for the report page varied 0.2 s to 16 s for identical requests.
- Reports created: "QA test portfolio r2" (13 widgets), "QA test paid r2", "QA test blank r2", plus two stray "Paid efficiency" copies (8 widgets, 1h old, created by my own delayed template clicks, see N-01). All five deleted at the end. Remaining list: the owner's 3 pre-existing reports (Paid efficiency 10 widgets, Portfolio overview x2), untouched.

## Verdict table (qa-c findings)

| Id | Verdict | Evidence |
|---|---|---|
| C-01 CM3 parity | FIXED | See below, CZK and USD equal Snapshot, EUR consistent with FX |
| C-02 toast off screen | FIXED | Toast fixed to viewport, rect top 755 / bottom 800 with innerHeight 800, scrollY 1030 on an 1845 px page. Undo restores widget (11 -> 12) |
| C-03 slow refetch, mixed state | PARTIAL | Mixed state fixed (all stale widgets dimmed within 0.6 s, never a full opacity old value). Speed target missed (see below) |
| C-04 added cells "n/a No data" | FIXED | Added Frequency to a table: zero "No data" at any moment, skeleton + pulse for 7.6 s, then 1.54 |
| C-05 rapid clicks race | FIXED | Prev year + CZK 60 ms apart, Prev period + USD 250 ms apart, Industry + EUR in the same tick: both landed every time |
| C-06 first click lost | NOT REPRODUCED | New report menu, template item and row "..." menu all worked on the first click after a fresh load (6 tries) |
| C-07 503 on report open | PARTIAL / unverified | Chrome network log still lists POST /reports/<id> (the touchOpened action) and many `_rsc` GETs as 503, but Vercel runtime logs for prod show 319 requests in 2 h, all 200, zero 503, and a manual RSC fetch returns 200. Looks like cancelled/aborted requests reported as 503 by the recorder, not a server fault. Cannot prove "last opened" is recorded |
| C-08 Copy link | FIXED | Share menu has "Copy link" (copies /reports/<id> only) and "Copy link with current filters" (clients, preset, compare, ccy; no edit=1) |
| C-09 leading partial week | FIXED | 30d preset: bucket Aug 31 (Sep 5-6 only) shaded grey like the trailing one. 28d now starts on a Monday so no partial bucket |
| C-10 coverage marker clipped on mobile | FIXED | "3 of 5" / "4 of 5" wrap below the value in the 390 px stack, nothing clipped |
| C-11 metric card overflow | FIXED | Snapshot 2-col cards at 390: delta shows without "vs prev period", no overflow, scrollWidth 390. Paid overview single column, no overflow |
| C-12 mobile menus | FIXED | Sections shown as 2x2 grid, Reports visible. Opening client chip closes the page menu (and the reverse) |
| C-13 date control mobile | FIXED | Bottom sheet, presets then "Custom range", one month, sticky Cancel / Apply visible at the bottom, "Presets" back link |
| C-14 Escape flow | FIXED | One Escape closes the metric dropdown and focus returns to the body, then "/" opens the add-widget menu |
| C-15 clipped axis labels | FIXED (mostly) | Line/bar Y and X labels no longer lose characters, "CZK 14M" fully visible. Bar category label still truncates ("Dr. Dobias Natu...") by design |
| C-16 "before" tooltip | FIXED | Tooltip reads "Previous period CZK 866.6K" |
| C-17 compare fragment | FIXED | Legend shows "Previous period ^" with title "Previous period incomplete" |
| C-18 sparkline behind n/a | FIXED | RawBark only: Paid spend and MER read n/a with no sparkline path |
| C-19 shortcut sheet / inspector | FIXED | "?" sheet is centred in the viewport, inspector starts below the account chip |
| C-20 smaller items | MOSTLY FIXED | KPI picker is single choice (picking Orders replaced Revenue, title "Orders"). Rename selects the existing text (0..15) and the sidebar updates at once. Duplicate title "Orders copy". Blank report empty state "No widgets yet. [Add your first widget] Start from a template". View-mode menu now says "Details". Orders show 4,164 not 4K. NOT fixed: Industry toggle with no benchmark data still shows nothing and no hint. Metric search kept typed text after switching widget type was not re-checked |

## C-01 detail (Dobias, 90d, Jul 7 to Oct 4)
- CZK: Snapshot CM3 CZK 7,643,986, CM3 % 58.7%, delta -8.2%, fulfilment -1,797,530. Reports KPI CM3 "CZK 7.6M -8.2%", table CM3 % 58.7% (-5.1 pp = -8.0% relative, same as Snapshot), MER 12.89x equal. Round 1 showed 9.46M / 72.6%. Portfolio CM3 for 5 clients now CZK 7.9M "4 of 5" (was 9.8M).
- USD: Snapshot CM3 $363,000 -8.8%, Reports KPI $363.0K -8.8%.
- EUR: Snapshot has no EUR option (Native USD or CZK only). Reports EUR CM3 EUR 315.4K = 7.64M / 24.2, revenue EUR 536.8K, MER 12.89x identical.
- Hook rate, Dobias 30d: Reports KPI 17.5% (0.0 pp) = Paid > Meta tab "HOOK RATE 17.5% 0.0 pp". Equal. (Old definition gave 54.5%, new 3-second-play definition gives plausible 15 to 18%.)

## C-03 detail (13 widgets, no materialised table yet, expected)
Instrumented with fetch wrapper + MutationObserver, report "QA test portfolio r2", 5 and 1-2 clients.
- Cold open, 13 widgets, 5 clients, 90d CZK: 13 POST /api/reports/query. First wave of 6 starts at 1.6 s and returns 5.2 to 11.7 s, second wave returns 10.4 to 13.7 s, one outlier (a Meta metric) finishes at 19.7 s. 12 of 13 widgets settled by about 14 s, last at about 20 s. Target was under 6 s: NOT met. A 7 widget report (cached signature) settled in about 6 s.
- Filter change (13 widgets, Prev year): all 13 widgets flagged stale (pulse, opacity 0.35 to 0.55) at 596 ms; widgets switch to the new value one by one as queries return (7.7 s to 13.4 s). Total settle 13.4 s (round 1: 15 to 25 s). Target was under 4 s: NOT met. 7 widgets, currency change: 13.1 s.
- Mixed-period check: at every sample the widgets still showing the old value were flagged stale. "Old value at full opacity" count was 0 (round 1: table and bar at near full opacity for 15 s). One caveat: during the first 0 to about 17 s of one slower run (page RSC fetch took 16.6 s, load related) the old data stayed fully visible and unflagged because the dim only starts once the new request exists. A navigation-pending cue on the widgets themselves would close that gap.
- Query sharing: network still shows one POST per widget (13 for 13), the first 6 each take 7 to 9 s in parallel (each is its own BigQuery job), later widgets often return in 0.7 to 1.5 s (shared/cached). Concurrency gate (6) still produces a second wave; a lone 7th request then waits for a free slot (5 s extra on the 7 widget report). Sharing helps only after the first wave completes. The materialised table switch is the remaining lever.

## New issues (exploratory)

### N-01 major: creating a report from a template takes 10 to 16 s with no immediate feedback, and a second click creates a duplicate
- Repro: /reports > New report > Paid efficiency (or Blank). Nothing visibly happens for 7 to 16 s (only a thin progress bar at the top; first time it took about 3 s, later 12 to 16 s under load). I clicked again (and once via JS) thinking the click was lost: two extra "Paid efficiency" reports appeared later (8 widgets, 1h old in the list) next to the one I wanted.
- Expected: item disabled and a spinner / "Creating..." on the clicked entry; double submit ignored.
- Suggested fix: disable the New report menu and show a pending state while the create action runs (components/reports/ReportListPanel.tsx / ReportsDirectory.tsx), and make the create action idempotent per click.
- Note: round 1 already measured 8 to 10 s for template creation; this round 12 to 16 s.

### N-02 minor: widgets "Could not load / Retry" on the first open of a freshly created report
- First open of the new report right after creation: 6 of 7 widgets showed "Could not load" with Retry (the table loaded). A reload a minute later loaded everything in about 6 s with no errors. Probably function timeouts on the first uncached queries under load. Retry would be needed by a user; consider an automatic single retry before showing the error.

### N-03 polish: combined series label says "All clients" when a single client is selected
- Weekly line tooltip for a Dobias-only report: "All clients CZK 1.0M". With one client selected the label should be the client name (or "Total").

### N-04 polish: Industry toggle with no benchmark data still gives no feedback
- (carry over from C-20) toggling Industry on changes nothing and shows no "No benchmark data yet" hint.

### N-05 minor: report page server render time is erratic (0.2 s to 16.6 s) and widgets show the old data undimmed meanwhile
- The page route only reads Postgres (getReport, getReportClients), yet identical RSC requests took 0.2 s, 0.6 s, 6 s, 13.3 s and 16.6 s during the session (other QA agents active). Because the stale dim is driven by the new query request, there is up to 16 s of old data at full opacity after a filter click. Use the navigation pending flag (useNavigation().isPending) to dim all widgets immediately.

## Mobile pass (390 px iframe)
- Reports read-only stack: works, KPI cards two columns, filter summary collapses to "5 clients, 90d, vs prev, CZK", no horizontal overflow (scrollWidth 390 on Reports list, report, Snapshot and Paid), table scrolls horizontally inside its card (1260 px inner width, no scroll cue).
- Mobile top bar menus exclusive, date picker bottom sheet with sticky Apply, metric cards without overflow, Reports visible in Sections: all verified above.
- Remaining small thing: Paid overview date chip "Sep 5, 2026 to Oct 4, 2026 >" looks tight against the chevron at 390 px.

## Worked well
- Dobias CM3, CM3 %, MER, revenue, hook rate match Snapshot / Paid Meta in all tested currencies.
- Stale widgets dim hard and immediately; added metrics show a pulse, not "No data".
- Undo toast, Cmd+D "copy" titles, rename select-all, empty state, Copy link options, one-Escape flow, centred shortcut sheet.
- Leading partial week shading, "Previous period incomplete" marker, no sparkline for n/a KPI.
- Delete is immediate and soft; cleanup left the three pre-existing reports intact.

## Numbers that look suspicious
- Dobias Reports EUR revenue delta "0.0%" (flat arrow) while CZK is -0.3% and USD -0.9%: FX effect of the previous-period rate, plausible but easy to misread.
- Hook rate Dobias 30d 17.5% with delta "0.0 pp" on both Reports and Paid Meta: identical, but a delta of exactly 0.0 pp looks like a missing compare. Check that the previous period value is real.
- Venev revenue CZK 12.5K with CM3 % hugely negative (carry over, small store).
- Manami revenue +17.2% vs previous period in the 90d table, Venev +76.0%: low volume.
