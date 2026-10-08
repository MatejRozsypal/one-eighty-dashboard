# Navigation shell: spacing fix vs one sidebar (proposal, 2026-10-08)

Owner request: "Move the icons to the top, similarly as in Shopify UI." Reference: `reference-shopify-sidebar.png`.
All three screenshots are 1440 x 900, Snapshot page, admin, fixture client, with a x3 zoom of the top-left corner.
Mockups were static markup with the real tokens, icons and nav tree, rendered on a throwaway page that has been deleted. Nothing in the shell code has changed.

## Current (`nav-current.png`)

Measured in the browser (css px from the top of the viewport):

| What | Position |
|---|---|
| Header bar | 0 to 52, title centred at 26 |
| Logo row in the panel | 22 to 52, centred at 37 (11 px lower than the header title) |
| Rail top | 0 to 72 empty: 22 padding + 28 slot kept for the expand toggle (empty while the panel is open) + 22 margin |
| Rail icons | 36 px squares at 72, 112, 152, 192, 232 (40 px pitch) |
| Panel rows | 40 px rows at 99, 142, 185, 227 (about 43 px pitch, plus 24 px group labels) |
| Rail below the last icon | 268 to 900, 632 px of empty black |
| Panel list | 824 px of content in an 808 px box, so it scrolls by 16 px and Repurchase is cut at the bottom |

The problem: the rail has nothing in the header row and starts its icons 20 px below the header line, on a 40 px pitch, while the panel starts its rows at 99 px on a 43 px pitch. The two columns never share a line: icon to row offsets drift 27, 30, 33, 35 px, the active Analytics icon sits beside Goals rather than anything it relates to, and the paddings (22 px) are off the 4/8 grid. Read together that is the "negative spacing": an empty block at the top of the rail, mismatched rhythm beside the panel, and a long empty black strip under five icons.

## A. Two columns, fixed spacing (`nav-proposal-a.png`)

Same structure (rail + per-product panel), one grid.

- One 52 px header row across both columns with a hairline under it: brand mark in the rail, product name ("Analytics") and the collapse toggle in the panel. It lines up with the page header and its bottom border.
- Below it everything steps on a 36 px pitch (32 px control + 4 px gap) starting at 64: rail icons 32 px at 64, 100, 136, 172, 208; panel rows 32 px, and group labels take exactly one step, so every rail icon edge lands on a panel row edge.
- Panel 240 px (was 252). The full Analytics list (4 groups, 17 pages) now fits 900 px without scrolling.
- Settings gear at the rail foot (internal roles), so the bottom is used. Account menu stays in the top-right corner.
- Collapsed: panel hides, the expand toggle takes the rail header slot (no reserved empty slot when open).

Pros: smallest change, keeps every behaviour (rail never collapses, product panels, Chat history, Reports list panel, mobile sheet untouched). Fixes exactly what was called out. Denser, closer to Shopify's rhythm.
Cons: still two columns, so not literally the Shopify layout; product names only appear as tooltips in the rail.
Effort: about half a day. Files: `ProductRail.tsx`, `Sidebar.tsx`, `NavCollapseToggle.tsx`, nav block in `globals.css`. No change to `lib/nav.ts` rules or checks.

## B. One Shopify-style sidebar (`nav-proposal-b.png`)

- One 248 px dark sidebar: logo and collapse toggle on top, then Home, Assistant, Analytics, Creative, Reports as icon + label rows.
- The active product opens in place: its groups as small muted headers, pages indented under the label, no icons; Paid and Repurchase keep a chevron for their children (third level). Others stay one row each. Settings at the foot.
- Collapsed: an icon-only column of the five products with tooltips.

Pros: matches the reference one to one; product names always visible; one column of chrome instead of two.
Cons: the open product pushes the others down. With Analytics open, Creative and Reports start at about 770 and 805 px on a 900 px screen and drop below the fold on a 768 px laptop or when Paid's children are open. Page icons disappear on desktop (still used in the mobile sheet). Chat history and the Reports list panel have to move into the sidebar (the Reports list is rendered inside the Reports layout, so it needs a portal or a lifted data source). Mobile sheet, account menu offsets and two check scripts change.
Effort: about 1.5 to 2 days. Rewrite of `Sidebar.tsx`, delete `ProductRail.tsx`, changes to `MobileTopBar.tsx`, `AccountMenu.tsx`, `HistoryList.tsx`, `ReportListPanel.tsx`, `app/(app)/reports/layout.tsx`, `globals.css`, `scripts/check-capabilities.ts`, `scripts/check-loading-pulse.ts`.

## Recommendation

A first: it removes the spacing problem in half a day without moving anything people already know. B stays open if the owner still wants labels on the products after seeing A live.

## Notes for whoever builds either

- `npm run check:capabilities` already fails 5 assertions on origin/main: the rail expectations predate Home (`railProducts` now returns `home` first). `npm run check:loading` already fails 6 on Home variant and Creative files. Neither is caused by this work.
