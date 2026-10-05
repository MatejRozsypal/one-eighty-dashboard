# QF2 report: Reports UI fixes

Branch `qf2-reports-ui` (worktree `oe-dash-wt/qf2-reports-ui`), one commit `d18efc0` on `main` @ `92ac505`. Frontend only, no BigQuery, not pushed.

## Findings covered and what changed
- C-02 (and C-19 both parts): `app/globals.css` `.product-enter` fill mode `backwards`. Same root cause made the shortcut sheet bottom aligned and the inspector (`fixed`, top `--header-h`) drift under the account chip when the page was scrolled.
- C-03 (stale state): new `.oe-pulse-stale` variant of the same keyframes with tokens `--pulse-stale-hi .55`, `--pulse-stale-lo .35`, `--pulse-stale-static .45` (reduced motion). `WidgetCell` applies it to every widget that is loading with an older result on screen. Same `oe-pulse` class is kept (check:loading pins the string).
- C-04: `WidgetProps.pending` + `PendingCell` (Skeleton). Table, KPI and ranked draw a skeleton per cell when the metric is not in the old result yet; charts draw a whole-widget skeleton. Settled results still show n/a No data.
- C-05: `ReportFilterBar` merges each change onto the newest URL (ref of the last navigated href, then `pendingHref`, then `searchParams`). Compare and currency pills are now a local `FilterSegments` (same look) so they also go through that patch.
- C-06: not reproduced (see below). Hardened `create` and `duplicate` in `ReportListTable` against a rejected server action (toast instead of a lost click).
- C-07: see below. `touchOpened` retries once after 3 s and then `console.warn`s; still swallowed.
- C-08: Share menu has "Copy link" (`<origin>/reports/<id>`) and "Copy link with current filters" (saved path plus only the filter params, never `edit`).
- C-09: Line widget shades every partial bucket (leading and trailing); Bar already did; tooltip already says "(partial)".
- C-10: KPI value row `flex-wrap`, marker drops under the figure; `.report-stack .kpi-value` 22px (`grid.css`).
- C-14: MetricPicker Escape closes the list and lets the key through, so the inspector closes and focus returns to the canvas in one press.
- C-15: chart axes sized from the labels they print (`axisWidth`, `edgeMargin`, `axisProbe` in `chartTheme.ts`): line and bar Y width, horizontal bar right margin, scatter right margin and Y width. Bar series names cut at 16 chars with the full name in a native title (`categoryTick`). Scatter labels cut at 16 chars, with a collision pass (right, below, above, then left) so neighbours no longer overlap.
- C-16: tooltip "Previous period" instead of "before". The "(4 of 5)" explanation was not added (see open items).
- C-17: Line widget legend entry "Previous period" with a NotesMark "Previous period incomplete" when the previous series has fewer populated buckets than the current one or no comparable total.
- C-18: KPI draws no sparkline unless the value is ok.
- C-20: KPI picker limited to one metric (single mode, `changeWidgetType` trims to the first, auto title names one metric); metric search resets on type change (`key={type}`); duplicated widget title gets " copy"; list rename input also selects on focus; table counts below 100k written out, money compact keeps one decimal from 100k ("CZK 13.0M"), whole units below 100k; blank report empty state ("No widgets yet", "Add your first widget", "Start from a template" to `/reports?new=1`); view-mode menu item "Details" instead of "Open" and the read-only inspector body is dimmed; sidebar and switcher update at once after rename, pin and delete (overlay in `ReportsDirectory` via `useDirectoryActions`, replaced by the next server snapshot).

## C-07 investigation (Vercel runtime logs, read-only)
Project `prj_W9g11ueFm8bdgLQIp84RbNInvozd`, production, retention is 1 day on this plan. In that window: no 5xx at all (status mix 200/304/307/405), and `POST /reports/<id>` appears twice, both 200 (22:01 and 22:27). The only 405 is `POST /` (static), unrelated. The app code never returns 503 (grep), `touchOpened` swallows its own errors, so a 503 on that POST can only come from the platform (throttle or cold start under the parallel QA load) and the QA-day logs are gone. Cannot be confirmed or root-caused from logs; the cause is most likely load, not a bug. Mitigation as above.

## C-06 investigation
Dev server, real clicks on a throwaway list page: the row menu opened on the first click and Rename selected the whole text (0..12). Not reproduced; most likely hydration lag on a heavy cold page (a click before hydration does nothing). The `New report` entry is a Popover, not a link; the sidebar plus is a link to `/reports?new=1`, which is intended. No change beyond the hardening above.

## Verification
- `npx tsc --noEmit` 0 errors; `npm run build` exit 0.
- check:reports-widgets 662/662 (7 new: counts, money compact, pending skeletons), -canvas 98, -pages 203 (2 new: KPI single metric), -url 193, -eval 333, -authz 37, -store 286, check:reports 315 (BigQuery steps skipped, no credentials), check:loading 203, check:capabilities 329.
- Browser harness (throwaway routes outside `(app)`, deleted before the commit; dev server stopped), real Chrome pane:
  - toast: 2,500+ px page, scrolled to 1200: toast bottom 752 <= innerHeight 768 (inside `.product-enter`, whose computed transform is now `none`).
  - shortcut sheet centred in the viewport (top 98, bottom 670 of 768); inspector top 52, bottom 768 (viewport anchored).
  - filters: Industry, then EUR 120 ms later, then Prev period None 100 ms later: URL `?compare=none&ccy=EUR&bench=1` (all three). Reverse order (USD, then Industry off) also correct.
  - stale widget opacity sampled by driving the animation clock: 0.548 at 200 ms, 0.350 at 900 ms, 0.550 at 1650 ms (<= .55); the non-loading widget has no animation.
  - added metrics: 4 `oe-skeleton` cells in the CAC column while loading; chart gets a whole skeleton; settled table shows n/a.
  - charts screenshot: axis labels intact ("CZK 4500", "CZK 13.5M"), names cut with hover, scatter labels clear of each other, leading and trailing partial weeks shaded, "Previous period ^".

## Open items / not done
- C-16 second half (explain per-bucket coverage next to the KPI "3 of 5"): only the tooltip rename was done.
- C-20: table widget default height too tall (`WIDGET_SIZE` in `lib/reports/limits.ts`, not owned) and "No benchmark data yet" hint for an empty Industry overlay were not done.
- C-11, C-12, C-13 belong to other packages (shell and shared controls), untouched.

## Requests to orchestrator
- QF4 (nav state, owns `NavigationPending`, `SegmentedControl`, `DateRangeControl`): those shared controls still build their next URL from the committed `searchParams`, so the same race exists for Snapshot/Paid filters and for the Reports date control. Suggest they merge onto `pendingHref ?? current`. Reports compare and currency no longer depend on it.
- `scripts/check-loading-pulse.ts` matches the string `loading ? "oe-pulse"` in `ReportParts.tsx`; kept satisfied on purpose (the stale class is a second conditional). If that check is ever relaxed, the two can be merged.
- ShareMenu now needs `reportId` (only `ReportClient` uses it).
- Deploy: frontend only, no SEMANTIC_VERSION change from this package.
