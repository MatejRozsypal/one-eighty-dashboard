# FX3 report: loading pulse everywhere

Branch `fx3-loading-pulse`, worktree `oe-dash-wt/fx3-loading-pulse`, one commit `d422dcd` on top of `9b49428`. Frontend only (`dashboard/`), no warehouse access, nothing to deploy, not pushed.

## The one animation (app/globals.css, local extensions block)
- Tokens: `--pulse-dur 1.5s`, `--pulse-in` (= `--dur-fast`), `--pulse-hi .82`, `--pulse-lo .5`, `--pulse-static .6`, `--skeleton-bg` (= gray-150). Keyframes `oe-pulse-in` (1 to hi in 120 ms, so it starts at once) and `oe-pulse` (hi to lo to hi).
- `.oe-pulse` for existing content, `.oe-skeleton` for placeholder blocks, `[data-pending="true"] main:not([aria-busy="true"])` for the page body while a route change is pending (a skeleton `main` is excluded so it never pulses twice).
- Reduced motion: `animation: none`, content held at `--pulse-static` (dimmed), skeleton blocks solid.
- Removed: the `oe-shimmer` keyframes and all four inline shimmer gradients, every `animate-pulse`/`opacity-40/60` ad hoc state. Tailwind's stock `animate-pulse` is redefined to the shared pulse so a stray one cannot bring back a second definition.

## Primitives (new)
- `components/ui/Skeleton.tsx`: `Skeleton` plus `SkeletonMetric/KpiRow/Chart/Table/Cards/List`, `SkeletonHeader/Tabs/Controls`, `SkeletonPage({blocks, tabs, controls})`. Header, controls and `<main>` are siblings exactly like the real pages, so the Paid layout's flex ordering works on a skeleton.
- `components/ui/AppLink.tsx`: wraps `next/link`; a plain click goes through `useNavigation().navigate`. Modified click, non-left button, target, download, external, hash-only, same-URL and "outside the provider" fall through to plain `next/link`.
- `components/ui/PendingSubmit.tsx`: `useFormStatus` submit button that pulses.

## Every loading path and what now happens
| Path | Before | Now |
|---|---|---|
| Sidebar, rail, mobile menu, account menu, Paid tabs, Creative tabs, Settings tabs, Reports list panel, in-page links (23 files, ~35 links) | bare `next/link`: no pending state at all | `AppLink`: progress bar + `main` pulses from the click, the clicked link pulses, until the new payload commits |
| Date range, compare, currency, market filter, client switch (account menu, mobile bar, report client picker) | already via `navigate`; pulse was the stock 2 s `animate-pulse` | same path, shared fast pulse; picked control keeps its optimistic state and pulses |
| Creative `DimensionPicker` | `router.push` direct (bypassed) and the controlled `<select>` snapped back until the server answered | `navigate` + optimistic value + pulse |
| Reports list: open / create / duplicate, "deleted" cleanup | own `useTransition`, only the table pulsed | `navigate` (whole page pulse), table-level pulse removed (it would stack) |
| Report page: duplicate, delete, save default (replace + refresh), conflict reload, gate-threw refresh | direct `router.push/replace/refresh` | `navigate` / `refresh` from the provider, so the canvas pulses |
| Report page quiet resyncs (rename, pin, visibility, list pin/rename/delete after an optimistic update) | `router.refresh()` | unchanged on purpose: the screen already shows the new state, pulsing would be noise |
| Navigation between page segments | one generic skeleton at `(app)` | page-shaped `loading.tsx` for 24 segments (below) |
| Groups of sibling pages (Paid overview/Meta/Google/GA4, Creative x5, Inventory x3, Repurchase x2, Reports list/report) | shared one boundary, so no fallback ever showed: old page stayed frozen | `loading.tsx` at the group (and per leaf where the shape differs) |
| Search-param-only changes on the same page | `[&_main]:animate-pulse` | `data-pending` on `PendingRegion`, `main` pulses at once (fast ramp), progress bar |
| Report widgets, first load | shimmer block | `Skeleton` pulse |
| Report widgets, filter change / Refresh / retry | previous figures pulse, but only after an effect ran (one frame where an old figure looked fresh); Refresh did nothing visible during the server action | `loading` is derived at render from the request the stored result answers (`forKey`), so the first frame with new filters already pulses; Refresh pulses from the click (during the server action and the refetch); stale figures stay until new ones land |
| Assistant "Thinking..." | static text | pulses (`role=status`) |
| Server-action forms (settings: Save/Remove/Reset password, create user, creative Record/Confirm) | spinner or disabled only | also pulse while in flight |
| Back / forward | n/a | not intercepted: Next 14.2 restores history entries without a round trip (checked in the browser, also after >30 s), nothing is in flight |

## loading.tsx added (all built from `SkeletonPage`)
Page-level: snapshot, orders, products, customers, cohorts, growth, unit-economics, goals, gaps, email, health (tabs), settings (tabs), chat (message blocks + composer), `reports/[reportId]`. Group-level: reports (list), paid, creative (tabs), inventory, repurchase. Leaf: creative/breakdown, concepts, production, velocity, inventory/buying, catalogue, repurchase/timing. Rewritten: `(app)/loading.tsx`. Not added: `admin` (redirect only), `channels` (one-line page, root fallback is its shape).

## Verification
- `npx tsc --noEmit`: 0 errors. `npm run build`: exit 0, no warnings (`scratchpad/fx3_build.log`).
- Checks: `check:loading` 203 (new), `check:reports` 306 (BigQuery steps skipped: no credentials), `-eval` 274, `-authz` 37, `-store` 286, `-url` 193, `-widgets` 655, `-canvas` 98, `-pages` 201, `check:capabilities` 329, `check:paid` 190, `check:creative` all match. Not run: `check:warehouse`, `check:queries`, `check:clickup` (need credentials).
- `check:loading` pins: one pulse definition and tokens, reduced-motion rule, no stray `animate-pulse`/shimmer/keyframes, no `next/link` outside AppLink (and sign-in pages), no `router.push/replace` outside the provider, no own `useTransition` outside the two server-action buttons, every page segment covered by a `loading.tsx`, skeletons render and pulse, AppLink renders a plain anchor outside the provider, widget hook derivation, no em dash, no hex in the files this change owns.
- Real browser (throwaway route outside `(app)` with a 2.5 s server delay and a faked 3 s report query, dev server; removed afterwards, `.next` rebuilt, tree clean):
  - segmented control click: provider pending + progress bar true at <= 30 ms, until the page committed (about 2.9 s); animation on `main` is `oe-pulse-in, oe-pulse`; sampled by driving the animation clock (the pane is hidden so the timeline is frozen): 1.00 at 0 ms, 0.83 at 60 ms, 0.82 at 120 ms, 0.66, 0.50 at 870 ms, back to 0.82 at 1620 ms.
  - AppLink to another segment: bar + pending + the link's own pulse at 40 ms; skeleton from about 1 s (first dev compile), real page after 2.5 s.
  - AppLink between siblings under a group `loading.tsx`: pending at 41 ms, skeleton (51 pulsing blocks) at 202 ms.
  - Widgets: both skeleton on first load; filter toggle: figures kept and pulsing at 22 ms until data landed; Refresh: pulsing at 23 ms through the 1.5 s server action and the 3 s refetch, static only after the data.
  - History back/forward: committed within 30 ms (no stuck pending).
- Not verifiable here: the real `(app)` shell (no login), reduced-motion in a browser (the rule is asserted in the stylesheet, and the pane has no emulation), a real touch device.

## Notes for the orchestrator / owner
1. `package.json` got `check:loading` (the only non-feature file touched outside components/app/scripts, plus `tailwind.config.ts` for the `pulse` override).
2. ReportClient/ReportListTable/ReportParts/useWidgetData belong to RS9; the changes are presentation only (provider `navigate`/`refresh`, derived `loading`, `refreshing` prop). `WidgetState` gained an optional internal `forKey`; `planWidget` and all data paths are untouched.
3. `MetricCardSkeleton` was dead after the rewrite and is removed (it was only used by `(app)/loading.tsx`).
4. Dev-mode caveat: with no prefetch in `next dev`, a cross-segment click shows the pulse on the old page until the first compile, then the skeleton; in production the Links prefetch their loading boundary and the skeleton is immediate.
5. Open choices: pulse strength is one place (`--pulse-hi/lo/dur`); quiet `router.refresh()` after optimistic edits intentionally does not pulse.
