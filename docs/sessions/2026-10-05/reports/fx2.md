# FX2 report: account menu overlapping report header actions

Branch `fx2-header-overlap`, one commit on top of `cleanup/2026-10` base. Frontend only.

## Root cause
`AccountMenu` is `fixed` and aligns its right edge to a capped `page-frame` (max 1400px, centred in the area right of rail and nav, 32px gutter). Analytics, Paid and Creative headers sit in that same frame and reserve the corner inside it, so they line up. The report header (`ReportClient`) is full-bleed (no frame) and reserved a hardcoded `lg:pr-[336px]` from the viewport edge. Once the area is wider than 1400px the pill stops short of the viewport edge by (area - 1400) / 2, while the report actions stay put. Pill left edge = W/2 + 524, action right edge = W - 336, so they collide above about 1720px wide (measured at 1920: pill 1484..1656, Refresh and "..." ended at 1544 and 1584). Wider screens, longer pill, or more actions (View/Edit group from 1200px) make it worse. Below that, a second, latent risk: the actions group was a flex item that could not shrink next to a `flex-none` title, so SaveStatus text or "Read only" could push it into the corner.

## Fix (commit)
- `app/globals.css`: one token `--account-reserve: 336px`, documented.
- `components/shell/Header.tsx` and `components/reports/ReportClient.tsx` header: `lg:pr-[var(--account-reserve)]` instead of two private literals.
- `components/shell/AccountMenu.tsx`: on reports the inner row is `w-full` (hugs the viewport edge, matching the full-bleed header); everywhere else it stays in `page-frame`. Comment explains the contract: the menu sits in the same frame as the bar it shares the row with.
- `ReportClient.tsx`: title is `lg:shrink` (truncates first), actions `flex-none`, "Read only" no-wrap; `ReportParts.tsx` SaveStatus `flex-none whitespace-nowrap`.
No per-page hacks, no change to Header-based pages' layout (their frame and reserve are unchanged).

## Verification
Throwaway harness (route `app/fxtest/[[...slug]]` plus a temporary `rewrites` block in `next.config.js` and a probe script in `public/`) rendered the real ProductRail, Sidebar, MobileTopBar, AccountMenu, Header, PaidTabs, ReportListPanel, ReportListTable and ReportClient with fixture data; `npm run dev -- -p 3100`, built-in browser, geometry probe: for every visible button, link, input, h1, group and text node, does its rect intersect the pill rect. All of it deleted afterwards (git status clean apart from the five source files; `next.config.js` restored).
- Before (bug reproduced): report detail at 1920: overlap with Refresh and "...".
- After, overlap list empty and pill-to-actions gap 132px (constant) for: report detail view, edit mode (`?edit=1`), long title, read-only, at 2560, 1920, 1800, 1600, 1440, 1200, 1024; reports list at 2560, 1200; Paid (`/paid/meta`) at 2560, 1440, 1024; Creative (`/creative/breakdown`) at 2560, 1024, plus `/creative` at 1200. At 768 and 375 the pill is hidden (lg:block only) and MobileTopBar is used; 375 report header screenshot wraps cleanly.
- Config drawer starts at `--header-h` and the pill ends at 47px of 52, so no overlap there. Account dropdown is the intended overlay.
- Other pages scanned: every page uses `Header` (title only, reserve now from the token) or the report header; no other page puts controls in the top-right of the header row. `app/(app)/loading.tsx` skeleton has a left title only. Chat reserves `--header-h` via top padding.
- `npx tsc --noEmit` 0; `npm run build` exit 0 (`scratchpad/fx2_build.log`); `check:capabilities` 329/329; `check:reports-pages` 201/201. No em or en dash in the diff.

## Notes
- The harness measured the live bug at 1920 but I could not reproduce the exact "left half of Edit" screenshot (it needs an in-between width, roughly 1800 to 2140 depending on name length); the same mechanism, the fix covers it.
- Cosmetic, left as is: on `/reports` (list) the framed table and framed Header title sit centred in a 1400px column on very wide screens while the pill now hugs the viewport edge. No overlap. If wanted, the list page could drop its `page-frame` to match the rest of Reports.
- Not pushed.
