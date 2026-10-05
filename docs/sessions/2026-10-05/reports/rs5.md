# RS5 report: Shell integration

Branch `rs5-shell`, one commit on top of `d727748` (Merge rs0-contracts). Frontend only, no warehouse objects, nothing to deploy. No `/reports` pages created (RS9).

## What changed
- `lib/products.ts`: `ProductId` gains `reports`; new `Product.roles?`; Reports entry (`/reports`, internalOnly, `roles: REPORTS_ROLES` imported from `lib/reports/contracts`, which is client-safe: type imports plus constants). `productFor("/reports" | "/reports/...")` returns `reports`. `productsFor(role: Role)` replaces `productsFor(isInternal: boolean)`: client role gets chat and analytics only; admin and agency get all four.
- `lib/nav.ts` (outside the owned list, required by the signature change): `railProducts(role, client?)` instead of `(isInternal, client?)`; Reports is never client-filtered; `/reports` added to `OTHER_TITLES` so the mobile bar reads "Reports" (prefix match covers sub-routes).
- `ProductRail.tsx`: `role: Role` prop replaces `isInternal`; Reports icon (page with bars).
- `MobileTopBar.tsx`: new required `role` prop feeds `railProducts`; the client switcher in the bar is hidden on `/reports`. The sections sheet already lists only products when the active product is not analytics, so no page list shows on Reports.
- `Sidebar.tsx`: returns null on reports (same as creative).
- `AccountMenu.tsx`: on `/reports` the trigger shows the user and the menu lists no clients (same account-only treatment as Chat); the bar's left offset is the rail width only (`--rail-w`) because no panel exists there. Creative's offset is untouched.
- `app/(app)/layout.tsx`: passes `role={session.user.role}` to ProductRail and MobileTopBar (role is non-null after the earlier redirect).
- `scripts/check-capabilities.ts`: call sites updated to `railProducts("admin", c)`; 11 new assertions (rail ids per role and per client, `productFor`, titles). Nav counts unchanged (internal 16 / client 15).

## Verification
- `npx tsc --noEmit` exit 0; `npm run build` exit 0 (`scratchpad/rs5_build.log`).
- `npm run check:capabilities` 329/329 (was 318, +11 new rail/product/title checks); `npm run check:paid` 190/190.
- Grep gates on the diff: em/en dash 0, `bg-[#` 0, `[#hex]` 0, `toLocaleString()` 0, `border-dashed` 0.
- Visual check not done (no login).

## Notes for the orchestrator and RS9
1. Rail visibility is by role only (`REPORTS_ROLES`). The email domain check is not applied in the rail; an agency account on another domain would see the icon and get RS3's 404. Presentation only, as specified. If wanted, the layout can compute `canUseReports` server side and pass a boolean.
2. `--nav-w` stays 252px in CSS on `/reports` (as on Creative). The reports layout must not rely on it: its own left list panel sits beside the rail, and the fixed AccountMenu already ignores `--nav-w` there.
3. The nav collapse toggle is still rendered by the rail only when collapsed; on `/reports` there is no panel to collapse, same as Creative.
4. Anyone else calling `productsFor`/`railProducts` with a boolean breaks at compile time; only nav.ts, ProductRail, MobileTopBar and the check script did.
