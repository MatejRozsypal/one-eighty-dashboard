# RS8 report: pickers and filter bar (design WP8)

Branch `rs8-pickers`, one commit on top of `d727748`. Frontend only: no warehouse access, no mart_qa objects, nothing to deploy.

## Files (all under dashboard/)
| File | Content |
|---|---|
| `lib/reports/url.ts` | Filter overrides <-> search params: `clients`, `preset`, `from`, `to`, `compare`, `ccy`, `bench`. `parseFilterParams`, `filterParamsToString`, `writeFilterParams`, `patchFilterParams` (drops a key equal to the saved default), `encodeFilters`, `normalizeOverrides`, `filtersEqual`, `diffFilters`, `withOverrides`. Validated with the zod schemas of `types.ts`; invalid params are dropped and reported in `ignored`. |
| `components/reports/pickers/MetricPicker.tsx` | Combobox. Prop `metrics: PickerMetric[]` = `{ id, label, group, unit, benchmarkable, requires, description?, aliases? }` (documented in the file with the registry mapping, `requires` = `meta.requires`). Exports `coverageOf`, `noCoverageReason`, `filterMetrics`. |
| `components/reports/pickers/ClientPicker.tsx` | Chip plus popover: All active, By vertical, per-client checkboxes with currency and platform dots. Exports `selectedClients`, `clientSelectionLabel`, `verticalsOf`, `humanizeKey`. |
| `components/reports/pickers/WidgetTypePicker.tsx` | Six icons, radiogroup, layouts `grid` (popover) and `row` (drawer). |
| `components/reports/pickers/WidgetConfigPanel.tsx` | Drawer content (controlled, emits only configs that pass `WidgetConfig`). Exports `changeWidgetType`, `autoTitle`, `hasFilterOverrides`. |
| `components/reports/ReportFilterBar.tsx` | Clients, `DateRangeControl`, compare `SegmentedControl` (both unchanged), currency `SegmentedControl` (param `ccy`), Industry switch, dirty dot plus "Save default". All write the URL via `url.ts` inside the shared navigation transition. |
| `scripts/check-reports-url.ts` | 193 pure checks. |

## Behaviour notes
- URL: `clients=all | ids:a,b | vertical:x,y` (bare `a,b` also reads as ids); `preset=custom&from&to` is exactly what `DateRangeControl` writes; `ccy=CZK|EUR|USD|native`; `bench=1|0`. Colons and commas stay readable in the query string.
- Combobox: type to filter (label, id, alias), Up/Down/Home/End, Enter toggles, Backspace on empty search removes the last chip (not below `min`, the panel uses 1), Esc closes and stops there (a second Esc reaches the drawer). Roles: combobox, listbox, option, group; `aria-activedescendant`, `aria-multiselectable`.
- Coverage hint "N of M clients" is shown when partial or zero; zero greys the row and the hover says "No selected client has Google Ads". Greyed rows stay selectable.
- ClientPicker in the bar commits once on close (one query per visit), holds the new value until navigation settles. Selecting every client collapses to `{ mode: "all" }`. Selection is never empty.
- Config panel reshapes on type change: ranked keeps one metric (sort desc, limit 10), scatter gets X/Y (adds a second metric from the pool if only one), KPI/ranked/scatter use grain total (matches the fixtures), line never total, ranked/scatter never combined split. Filters: "Use report filters" clears the four overrides; with it off each control sets or resets its own override (equal to report value = removed). Industry is its own row (override `benchmark`), disabled when no chosen metric is benchmarkable. Native currency disabled with "Mixed currencies".

## Verification
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0 (`scratchpad/rs8_build.log`). `npm run check:reports`: 206/206.
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-url.ts`: 193/193 (round trips of every enum, custom ranges incl. leap day, dedupe, 16 garbage cases, other params preserved, patch/prune, em dash and hex gates on the owned files).
- Grep gates on owned files: U+2014/U+2013 0, `bg-[#` 0, hex literals 0, client names 0, developer vocabulary 0, `toLocaleString()` 0.
- Interaction test in a browser against a throwaway demo page (deleted, not committed): typing "roas", Arrow+Enter toggle, Backspace chip removal, Esc, type picker arrows and Enter, client popover arrows, Esc focus return, By vertical, config overrides, and the filter bar writing `?clients=ids:...&compare=...&ccy=EUR&bench=1` and pruning a key back to the saved default. No console errors observed.

## Requests to orchestrator
1. `package.json` (RS0): add `"check:reports-url": "tsx --tsconfig scripts/tsconfig.json scripts/check-reports-url.ts"`.
2. WP9: build `PickerMetric[]` from `METRICS` (mapping in the MetricPicker header); pass `filters = withOverrides(report.filters, parseFilterParams(searchParams).overrides)` and `defaults = report.filters` to `ReportFilterBar`; wrap the bar in `NavigationPendingProvider` and a Suspense boundary (it uses `useSearchParams`). Cmd/Ctrl+S stays with the page.
3. WP9/WP1: KPI configs use grain `total` (as the fixtures). If the KPI sparkline needs a week query, the resolver should add it; the panel does not.
4. WP1: `mergeFilters` and `withOverrides` (url.ts) are the same rule; keep them in sync or have one call the other. `coverageOf` mirrors `evalCapExpr`; swap to the registry's once RS1 lands.
5. Design nit: "roas finds MER" depends on MER carrying the alias "roas" in the registry; the picker only searches label, id and aliases.
