# WP1 report: UI foundation (capability model, empty states, glyph, controls, nav)

Branch `wp1-ui-foundation`, worktree `oe-dash-wt/wp1-ui-foundation`, one commit `0789402` on top of `e90c4c1`. Frontend only, no warehouse objects, no `mart_qa` objects, nothing to deploy to prod.

## API for wave 2 (one-line summary per export)

| Import | Use |
|---|---|
| `pageAvailability(client, href)` from `@/lib/capabilities` | `"available"` or `"not-connected"`. First guard on every page. |
| `missingSource(client, href)` | Source name for `<NotConnected>` ("Shop", "Shopify", "Ads", "Meta", "Google Ads", "GA4", "Email"), or null when available. |
| `hasShop(client)` | Any of Shopify, Shoptet, WooCommerce. |
| `NotConnected({source})`, `NoData()` from `@/components/ui/EmptyState` | "{source} not connected." / "No data in this range." No other props. The only `border-dashed` allowed. |
| `Value`, `NoValue` (same file) | `<Value>{formatMoney(v, ccy)}</Value>` mutes "n/a" inline. DataTable cells, MetricCard, KpiTile, Scorecard and StatLine mute it automatically. |
| `Notice({tone?: "info" \| "warning", children})` from `@/components/ui/Notice` | One line from the closed list. |
| `InfoTip({text, label?})` from `@/components/ui/InfoTip` | Focusable (i) tooltip; client component, usable from server pages. |
| DataTable column `info?: string` | (i) beside a heading. Default empty message is now "No data in this range." |
| `NO_VALUE`, `isNoValue` from `@/lib/format` | `"n/a"`. All four formatters return it for null/undefined/NaN. |
| `formatMoney(v, ccy, { unit: true })` | 2 decimals below 100, whole above (CPC, CPM, CPA, CAC, AUR). `{ decimals: n }` forces n. |
| `MetricState` (MetricCard, also KpiTile `state`) | `{kind:"no-account"}` -> "Not connected"; `{kind:"no-data", reason:"No cost data"}` -> reason (default "No data"); `partial`, `error` one line. `badge`/`jobId` fields removed (no callers). |
| `<PageControls client params compare currency />` | Both default false. FX coverage query only runs when `currency` is on. `scope` is accepted and ignored. |
| `<Header title />` | `eyebrow` accepted and ignored. |
| `navFor(isAdmin, client?)`, `railProducts(isInternal, client?)`, `activeNavHref(path)`, `pageTitle(path)`, `selectedClient(clients, id)` from `@/lib/nav` | Capability-filtered nav, prefix-based active state and titles. `pageEyebrow` kept (deprecated, WP9 deletes). |
| `Client.capabilities.woocommerce`, `Client.metaCurrency`, `Client.gadsCurrency` | From `has_woocommerce` (NULL = false), `meta_currency`, `gads_currency`. |

Deprecated wrappers kept so pages compile until their wave-2 owner switches: `NotIngested` (object set -> "Creative data not connected.", else NoData; `what`/`hint` ignored), `ThresholdsMissing` (now the Notice "No verdicts. Set thresholds in Settings."), `NoStockData` (NotConnected "Shopify").

## What changed (files)
- New: `lib/capabilities.ts`, `components/ui/{EmptyState,Notice,InfoTip}.tsx`, `scripts/check-capabilities.ts`.
- `lib/clients.ts`, `lib/demo/client.ts`: woocommerce capability, ad currencies, both SELECTs.
- `lib/format.ts`: NO_VALUE, unit/decimals options.
- `lib/nav.ts`: Channels and `NOT_BUILT` removed, `href` required, `note` removed, capability filter, longest-prefix active/title (so `/repurchase/timing` no longer also lights `/repurchase`; `/paid/meta` lights Paid). Paid sub-routes `/paid/meta|google|ga4` are already in the requirements table (Meta / Google Ads / GA4), so the Paid package needs no edit to capabilities.ts, nav.ts, Sidebar or MobileTopBar.
- `lib/params.ts`: custom `to` clamped to yesterday; `rangeLabel` uses "to" instead of an en dash.
- Controls: Compare/Currency opt-in; scope chip, "Includes today" warning (hex + em dash) and the runbook path in the FX reason removed; "Today" preset removed; today not selectable; ranges print "X to Y".
- Shell: Header title only; Sidebar, MobileTopBar, ProductRail derive the selected client from `?client=` and filter by capability; "Soon" branches removed; rail tooltips no longer carry the hint text with a dash.
- `app/(app)/layout.tsx`: passes `clients` to ProductRail; error copy cut to "Client is not active." and the dev paragraph under "No active clients" removed.
- Badge/MetricCard woocommerce dot; DataTable `info` (header restructured so the (i) button is not nested inside the sort button); MetricCard/KpiTile one-line states, no dashed border, `bg-notice-negative` token; MetricTooltip `text-warning-300` token.
- Tokens: `--shoptet`, `--ecomail` moved from globals.css to `styles/tokens/colors.css`; added `--woocommerce` (#7F54B3, vendor approximation like the other two), `--notice-warning`, `--notice-negative`, `--warning-300`; tailwind `platform.woocommerce`, `notice.{warning,negative}`, `warning.300`.
- Em dashes removed from every owned file, comments included (mechanical ", " in comments).

## Verification
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0 (log `scratchpad/wp1_build.log`).
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-capabilities.ts`: 323/323 passed. Covers the requirements table for manami, dobias, venev, ethia, rawbark, demo (registry flags from 03 section 1), nav never lists Channels, nav lists only available pages, RawBark nav has no Inventory/Email/Channels/Creative, Creative hidden from RawBark's rail, Paid sub-routes, prefix active state and titles, `formatMoney(0.62,"USD",{unit:true})` = "$0.62", all formatters null -> "n/a".
- Grep gates on owned files: em dash 0, `bg-[#` 0, any `[#hex]` 0, `toLocaleString()` 0. Remaining hits, all outside the gate's intent or owned by wave 2:
  - `border-dashed`: EmptyState.tsx (allowed) and `components/creative/primitives.tsx` VERDICT_STYLES (unjudged, needs-more-data, not-separable) and the `Tag` missing placeholder. Left for WP7 (owns `components/creative/*` in wave 2); changing chip styling is a creative design call.
  - Dev vocabulary / client names only in `lib/clients.ts` comments and SQL, `lib/demo` comments, and the check script; none are UI strings and `lib/clients.ts` is outside the gate's directories.
- Visual check on the dev server: NOT done (OAuth login not possible from this agent). Orchestrator to check: RawBark sidebar and mobile menu without Inventory/Email/Channels, rail without Creative; Ethia without Inventory/Email; Venev without Email; Compare/Currency absent on all pages until wave 2 opts in; DataTable headers still sort and resize.

## Behaviour changes worth knowing before merge
- Until wave 2 opts in, NO page shows Compare or Currency (Snapshot included). Pages still compute deltas from the URL's `compare` value (default `previous_period`).
- Venev: registry has `email_platform = ecomail` but `has_ecomail = FALSE`, so Email is hidden (matches DoD "NC (#12)"). Manami, Dobias keep Email.
- Pages hidden from the nav are still reachable by URL and render as before until each page adds its guard in wave 2.
- `formatNumber/formatPercent/formatRatio/formatMoney` now also return "n/a" for `undefined` and non-finite numbers (previously "NaN"/"Infinity" strings).

## Requests to orchestrator
1. Optional: add `"check:capabilities": "tsx --tsconfig scripts/tsconfig.json scripts/check-capabilities.ts"` to `dashboard/package.json` (not an owned file, so not edited).
2. WP7: replace `border-dashed` in creative `VERDICT_STYLES` and `Tag`; switch `NotIngested`/`ThresholdsMissing` call sites to `NotConnected`/`NoData`/`Notice` directly.
3. WP8: inventory pages can drop `NoStockData` for the page guard + `NotConnected`; `clientName` props are now ignored.
4. Paid redesign: use `client.metaCurrency` / `client.gadsCurrency`; `/paid/meta|google|ga4` already gated and titled.
