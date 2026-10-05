# PA0 report: Paid UI foundation

Branch `pa0-paid-foundation`, worktree `oe-dash-wt/pa0-paid-foundation`, one commit `06e7007` on top of `2fda856` (cleanup sprint merged). Frontend only. No warehouse objects, no `mart_qa` objects, nothing to deploy.

## API for the tab packages (A4 to A7)

| Import | Use |
|---|---|
| `app/(app)/paid/layout.tsx` | Role gate (admin, agency; client goes to `/snapshot`) plus `PaidTabs`. Pages do not render tabs. Each page keeps rendering its own `<Header title="Paid" />`, then `<PageControls .../>`, then `<main>`. The layout orders those siblings (header, tabs, controls, content) with CSS `order`, and moves the sticky control bar below the tabs (`--paid-tabs-h`, 44px). So: page root must be a fragment whose direct children are `header`, the ControlBar `div`, and `main`. Do not wrap them in another element. |
| Stub pages `paid/{meta,google,ga4}/page.tsx` | Gate (`pageAvailability` + `missingSource` + `NotConnected`), then `Header`, `<PageControls compare />`, `<NoData />`. Replace the `<NoData />` body, keep the gate. |
| `PAID_TABS`, `navFor(isAdmin, client?, isInternal = isAdmin)` from `@/lib/nav` | Tab list (key, label, href; href is also the capability key). `Paid` has `internalOnly`. |
| `tabHref(tab, query?, { drop? })`, `creativeHref(view, focus?)`, `PAID_TAB_HREF` from `@/lib/paid/links` | Pure. `tabHref` keeps the whole query string. `creativeHref(params, { field: "adId" \| "campaignName", value })` takes the parsed `ViewParams`, always writes `preset` (Creative defaults to `all`, Paid to `30d`), carries client, range (custom only), compare; no currency. |
| `ratio`, `sumOf`, `ratioOfSums(rows, num, den, where?)`, `perThousand`, `relativeChange`, `pointChange` from `@/lib/paid/math` | All rates as sum/sum. Null in, null out; zero denominator gives null. `relativeChange` returns a fraction for `KpiTile delta`; `pointChange` is for rates (pp). |
| `isLowVolume({spend, purchases}, totalSpend)`, `unlessLowVolume(value, low)`, `LOW_VOLUME_*` | Spend under 1% of table total or purchases under 3. Null figure never marks a row low. `unlessLowVolume` gives the null sort key. |
| `searchImpressionShare`, `lostBudgetShare`, `lostRankShare`, `topImpressionShare`, `absTopImpressionShare` | Take rows with the IS component fields (camelCase of the mart columns, see types). |
| `brandShare`, `nonBrandRoas`, `brandLeakage`, `overClaim`, `trackingCoverage` | Spec 1.5/1.6 formulas over typed rows. |
| `bucketGrain(range)`, `bucketStart(date, grain)` | day up to 45 days, ISO-Monday week up to 180, month beyond. |
| `@/lib/paid/types` | `MetaCampaignDim`, `MetaCampaignDaily`, `MetaAdDaily`, `GadsCampaignDim`, `GadsCampaignDaily`, `GadsCampaignDeviceDaily`, `GadsAdGroupDaily`, `GadsSearchTermDaily`, `GadsKeywordDaily`, `GadsProductDaily`, `Ga4SessionsDaily`, `ImpressionShareComponents`, `PaidTabKey`, `Grain`, `BrandClass`, `FunnelStage`, `Ga4Platform`. camelCase of the real columns in `240`, `242`, `243`; no `_per_day` field exists. `num()` / `isoDate()` at the query boundary. |
| `KpiTile` props `delta`, `goodWhen`, `metricKey` | Optional. `delta` is a fraction; chip hidden when null/omitted; `metricKey` adds the (i) tooltip from `METRIC_DEFINITIONS`. Existing callers unchanged. |
| `METRIC_DEFINITIONS` keys (use as `metricKey`) | `nCAC`, `CAC (blended)`, `Link CTR`, `Cost / LPV`, `Cost / ATC`, `ATC to purchase`, `Hook rate`, `Hold rate`, `Avg daily frequency`, `Search IS`, `Lost IS (budget)`, `Lost IS (rank)`, `Brand share`, `Brand leakage`, `Non-brand ROAS`, `Over-claim`, `Tracking coverage`. 40 words or fewer each, tenant-neutral, no dashes (asserted by the check script). |

## Files
New: `app/(app)/paid/layout.tsx`, `app/(app)/paid/{meta,google,ga4}/page.tsx`, `components/paid/PaidTabs.tsx`, `lib/paid/{math,links,types}.ts`, `scripts/check-paid-math.ts` (`npm run check:paid`).
Edited: `lib/nav.ts` (`internalOnly`, `PAID_TABS`, `navFor` third arg), `components/dashboard/KpiTile.tsx`, `lib/metrics.ts`, `package.json` (`check:paid`), `scripts/check-capabilities.ts` (nav-count assertion split into internal 16 / client-role 15).
Edited outside the stated list, minimal, needed for the `internalOnly` filter to treat agency correctly: `components/shell/Sidebar.tsx` (new optional `isInternal` prop, defaults to `isAdmin`), `components/shell/MobileTopBar.tsx` (passes its existing `isInternal`), `app/(app)/layout.tsx` (passes `isInternal` to Sidebar).

## Skipped (already covered)
- `PageControls hideCurrency`: not needed. WP1 made `currency` opt-in (default false), so Meta, Google and GA4 simply omit it and Overview passes `currency`. Nothing to add.
- Not redone: prefix active state, capability rows for `/paid/*`, `metaCurrency`/`gadsCurrency`, `formatMoney` options, `NotConnected`/`NoData`/`Notice`/`InfoTip`, `focusLabel`. Note `NotConnected` lives in `components/ui/EmptyState.tsx` and renders "{source} not connected." (the spec's `components/dashboard/NotConnected.tsx` and its "Data health" link were superseded by WP1).

## Verification
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0 (log `scratchpad/pa0_build.log`); `/paid/meta|google|ga4` build as dynamic routes. Built CSS contains the layout's order and sticky-offset rules.
- `npm run check:capabilities`: 318/318.
- `npm run check:paid`: 190/190 (sum/sum vs mean-of-ratios, null handling, low volume boundaries, IS re-aggregation and components summing to 1, brand metrics, grain boundaries 45/46/180/181, ISO week starts, tabHref/creativeHref encoding, internalOnly nav for client/agency/admin, tab availability, the 17 definitions: existence, 40 words, no dashes, no snake_case, no client names).
- Grep gates over app, components, `lib/metrics.ts`, `lib/nav.ts`, `lib/paid`, scripts: em/en dash 0, `bg-[#` 0, dev vocabulary 0, client names 0, `toLocaleString()` 0, `pageEyebrow(` 0. `border-dashed` only in EmptyState and the unused `ChannelSplit.tsx` (deleted by A4).
- Visual check not done (no login). To check on the dev server: tab bar sits between the title header and the control bar on desktop, control bar sticks below the tabs and nothing overlaps while scrolling; tabs scroll sideways at phone width; a Google-only client (RawBark) shows Meta and GA4 muted but clickable; client-role user opening `/paid/meta` is redirected to `/snapshot`; Paid absent from the client-role sidebar, present for agency.

## Open issues and notes for the orchestrator
1. Ordering relies on the page root being a fragment of `header`, `div` (ControlBar), `main`. If A4 to A7 wrap content in extra elements, order breaks. The existing Overview page already follows it.
2. `/paid` (Overview) is untouched and still the old page; it now sits under the new layout, so it shows tabs and keeps its own Header. Its Overview not-connected branch has no PageControls, which is fine.
3. Stub pages register no deltas or queries; A5 to A7 own `lib/queries/paid*.ts`.
4. `lib/paid/links.ts` is imported by `lib/nav.ts`; keep it free of server imports (it uses `import type` from `lib/params` only).
5. Spec Q2 (nCAC and blended CAC) is assumed approved: both definitions exist. If blended is dropped, delete the `CAC (blended)` entry; the check script lists the keys.
