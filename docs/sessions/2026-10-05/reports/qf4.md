# QF4 report: navigation state

Branch `qf4-nav-state`, worktree `oe-dash-wt/qf4-nav-state`, one commit `cf97e28` on `main` @ `92ac505`. Frontend only, no BigQuery, nothing to deploy, not pushed.

## Findings covered
| id | fix |
|---|---|
| A-02 | Client switch (AccountMenu, MobileTopBar) calls `navigate(href, { kind: "client" })`. `PendingRegion` sets `data-pending="client"`, hides the page `main` with static Tailwind classes (`[&_main:not([aria-busy=true])]:invisible` + `:relative`, visibility so layout and scroll hold) and portals `ClientSwitchSkeleton` into that `main` from a layout effect (mounted before paint). The skeleton re-shows itself with `visible`, clips with `overflow-clip` and its block is `sticky top-[var(--header-h)]`, so it is where the user is looking even when scrolled far down. `pendingKind` is derived from `isPending`, so it drops in the commit render itself. The chip shows the new client and pulses (unchanged). No `globals.css` edit; `data-pending="client"` does not match the pulse rule, so the hidden body does not pulse. |
| A-21 | `DateRangeControl` holds `{range, label}` while pending: the chip shows the pending preset ("Last 7 days" / "Custom") and pulses with the trigger until commit. |
| B-04 | `navigate` resolves scroll through the pure `scrollFor(href, explicit, location)`: same origin + same path + no hash means `scroll:false` unless the caller set it. AppLink already routes plain clicks through `navigate`, so every query-only AppLink (Paid table filters, column sets, chips) and every control (segments, market filter, range, client) keeps the position. Other paths and hash links keep Next's default. |
| C-12 | MobileTopBar: one `menu` state (`"pages" | "client" | null`), so the two can never be open together; Escape closes either; Sections row is a 2-column grid (Reports no longer behind a hidden horizontal scroll). |
| C-13 | Below `sm` the date popover is a fixed bottom sheet (max 88dvh, safe-bottom padding, backdrop, body scroll locked on phones only): presets first, "Custom range" opens the calendar with one month (the recent one) and a "Presets" back link, Cancel/Apply in a non-scrolling foot. `sm` and up: same popover as before. |

Files changed: `components/shell/NavigationPending.tsx`, `components/shell/AccountMenu.tsx`, `components/shell/MobileTopBar.tsx`, `components/ui/AppLink.tsx` (doc only), `components/controls/DateRangeControl.tsx`, `scripts/check-loading-pulse.ts` (the plan says `check-loading.ts`; this is the file behind `npm run check:loading`). `SegmentedControl` and `MarketFilter` needed no change: they get the scroll default through `navigate`.

## Verification
- `tsc --noEmit` clean; `npm run build` exit 0, no warnings (`scratchpad/qf4_build.log`). Generated CSS contains `.\[\&_main\:not\(\[aria-busy\=true\]\)\]\:invisible main:not([aria-busy=true]){visibility:hidden}`.
- `check:loading` 248/248 (was 203). New: region states rendered without a router (idle / view / client), skeleton markup (visible, aria-hidden, >= 8 skeleton blocks, sticky, overflow-clip), pendingKind derived from isPending, layout-effect portal, `scrollFor` table (query-only false, client switch false, other path / hash / other origin undefined, explicit wins), both switchers pass `kind: "client"`, chip pending label, bottom sheet classes, one-month rule, exclusive mobile menu state, Escape, sections grid, no dash / no hex in owned files.
- Also green: check:paid 190, creative, capabilities 329, reports-eval 333, -url 193, -widgets 655, -canvas 98, -pages 201, -store 286, -authz 37.
- Harness (throwaway route `app/qf4-harness`, 3 s server delay, dev server on 3114, own browser tab; deleted before the commit, `.next` rebuilt, tree clean):
  - Desktop 1280, scrolled to y=1000, AccountMenu Alpha to Beta: at 4, 17, 31, 51, 101, 301 ms up to 2,801 ms `data-pending="client"`, 0 visible text nodes containing the old client name (14 before the click; probe = TreeWalker + `checkVisibility({visibilityProperty})` + viewport intersection), chip "Beta Shop", skeleton top at 52 px (sticky under the header), scrollY 1000 throughout. Committed at about 3.2 s, skeleton gone, new figures shown, scrollY still 1000.
  - Mobile 390, MobileTopBar chip at y=600: same result at 5 / 50 / 1,000 / 2,500 ms, committed by 3.6 s, scrollY 600 kept.
  - Query-only AppLink at y=1500: scrollY 1500 at 5, 50, 300, 1,500, 3,500 ms; page pulsed (`data-pending="true"`) and committed with the new query.
  - Range preset "Last 7 days": at 40 ms trigger "Sep 27, 2026 to Oct 3, 2026" and chip "Last 7 days", both pulsing; after commit same text, no pulse.
  - 390 px menus: pages then client gives client only; client then pages gives pages only; Escape closes either. Sections: 2x2, row scrollWidth = clientWidth (234), no page overflow-x.
  - 390 px date sheet: presets view 410 px tall pinned to the bottom (0 to 390 wide); custom view 485 px, Apply at y 791 to 830 of 844 (visible), one month (October 2026), no horizontal overflow, Escape closes and restores body scroll.
- Not verifiable here: the real `(app)` shell with login, real BigQuery latency, a real touch device, a screenshot (the pane was hidden, so the evidence is the DOM probe).

## Notes and requests to the orchestrator
1. ControlBar (not owned) stays visible during a client switch, including the currency segment label "Native (USD)" of the old client and the "vs <compare dates>" text. Neither is a figure, but the compare dates are server text that updates only at commit (A-21 residue). If wanted: ControlBar could wrap the compare span in a client component that pulses on `isPending`, or hide the currency group while `pendingKind === "client"` (now exposed by `useNavigation()`).
2. Report-level client pickers (ReportFilterBar, ReportSwitcher) were left as "view" navigations: report widgets already pulse per widget with their own stale state handling. They can opt in with `{ kind: "client" }` if QA wants the same blanking there.
3. QF7 does not need to touch Paid call sites for B-04: every Paid filter and column link is an AppLink on the same path, so it now keeps the scroll position. `GoogleCampaigns` and `GoogleCampaignDetail` already pass `scroll={false}` explicitly; harmless.
4. A Paid Overview "Spend mix" link to `/paid/meta?stage=...` is a different path, so it still lands at the top (B-04 related note); a `#campaigns` hash would now be honoured (hash links keep Next's default scroll), but that link is QF7's.
