# RS9 report: Pages and state + integration glue (design WP9)

Branch `rs9-integration`, worktree `oe-dash-wt/rs9-integration`, two commits (`e8e0beb` glue and palette, `8cbd893` pages) on top of `3a00961` (all RS packages merged). Frontend/library only. BigQuery: read-only (one widget query via MCP). No `mart_qa` objects, nothing to deploy to the warehouse.

## 1. Glue (RS requests resolved)

| Request | Done |
|---|---|
| RS2: bind registry in the compiler | `compile.ts`: `compileWidget = createCompiler({ marts: MARTS, components: COMPONENTS })`. The "fails closed" check in `check-reports.ts` became "bound to the real registry". |
| RS2: direct gate import | `run.ts` imports `assertReportsAccess` from `@/lib/authz`; namespace lookup removed. |
| RS3: `getReport` vs store export | Already matched (store exports `getReport`, the route binds it through `ReportStore["getReport"]`); verified by tsc. |
| RS8/RS1: alias "roas" on MER | `METRICS.mer.aliases = ["roas"]`; `findMetricId("roas")` is checked. |
| RS1/RS3: `toReportCapabilities` | `clients.ts` builds capabilities through it (its own copy of the derivation is gone). `matchBenchmarks` was already used by `benchmarks.ts`. |
| npm scripts | `check:reports-eval`, `-authz`, `-store`, `-url`, `-widgets`, `-canvas`, plus new `check:reports-pages`. |
| RS4: conflict message, template picker | "Updated by JK, reloaded"; list and "New report" use `listTemplates()`. |
| RS3: gate in layout and pages | `requireReportsAccess()` in layout and in both pages. |
| RS6: CSS order | Layout imports `react-grid-layout/css/styles.css` then `./grid.css`. |
| RS7: map `METRICS` to `WidgetMetric`, `WidgetBody` only | `lib/reports/pageData.ts` (server) builds `PickerMetric[]`, `WidgetMetric` map, caveat texts; the page uses `WidgetBody`, no chart widget imported (checked). |
| RS8: filter bar needs provider + Suspense | The app layout already wraps every page in `NavigationPendingProvider` (a second one would double the progress bar), so only Suspense was added (`FilterRegion`). Filters = `withOverrides(saved, parseFilterParams(url))`, defaults = saved. |
| RS8: KPI sparkline needs a week query | KPI configs stay grain `total`; the data hook fetches them at week grain when the range fits (`fetchGrain`, <= 159 weeks) and retries at total on 413. Same total plus weekly points. |
| Design 3.1 point 6 / RS4 request 3 (touchOpened) | Called once per mount from the client. |

Extra glue found while integrating: **the store generated widget ids, but the canvas needs the id before the save returns** (and undo of a removal restores a widget). `NewWidget` gets an optional client uuid (`contracts.ts`, `store.ts` insert `COALESCE($8::uuid, gen_random_uuid())`, store check extended: 286 checks).

### Deliberately skipped (not integration work, or not needed now)
- RS1 open issue 2: COGS guard for partially NULL buckets (needs an additive `MartGuards` field in contracts, compiler, runner, evaluator). No live client has mixed rows today.
- RS1 open issue 1 (CM3 on paid-only days differs from `SUM(cm3)` of Snapshot): owner decision, see below.
- RS4/RS3: memoising `assertReportsAccess` per request (React `cache`) and a 30 s session memo: only if latency shows.
- RS5: domain check in the rail (role-only by design; the domain gate is enforced server side).
- RS4: "list deleted" Trash view. Delete shows an Undo (restore) toast instead.
- RS0: recharts 3 migration (Paid owner).
- RS2 request 5: `npm run check:reports` with credentials (dry-run table): no GCP credentials here. The compiled SQL was run through the MCP instead (section 4).
- RS10 items (docs, DDL deploy): nothing for RS9.

## 2. Pages and state

| File | Content |
|---|---|
| `app/(app)/reports/layout.tsx` | `requireReportsAccess()`, CSS in RS6's order, list panel, switcher, directory of reports. |
| `app/(app)/reports/page.tsx` | List page. `?new=1` opens the picker, `?deleted=<id>` shows the Undo toast. |
| `app/(app)/reports/[reportId]/page.tsx` | Gate, `getReport` (not visible = `notFound()`, same answer as missing), clients, picker metrics, hands over to `ReportClient`. |
| `app/(app)/reports/loading.tsx` | Skeleton under the layout. |
| `components/reports/ReportClient.tsx` | Canvas + widgets + drawer + filter bar; edit/view; one ordered write queue; autosave; conflicts; global keys; undo toast. |
| `components/reports/ReportParts.tsx` | Widget cell (loading, error with Retry, outdated with Reset/Remove), config drawer (360 px right, bottom sheet below lg, read-only via `fieldset disabled`), filter region (bar, or mobile chip + sheet), save status, add button. |
| `components/reports/useWidgetData.ts` | POST `/api/reports/query`, LRU 100 (key = request, not the server key), concurrency 6 FIFO, abort, stale-while-revalidate, KPI week grain. |
| `ReportSwitcher.tsx` (+ `ReportsDirectory.tsx`) | Title dropdown and Cmd/Ctrl+K palette (pinned, recent, all), keeps URL filter params. |
| `ShareMenu.tsx`, `ShortcutSheet.tsx` (`?`), `ReportListPanel.tsx`, `ReportListTable.tsx` (Mine/Team/Templates, search, pin, rename, visibility, duplicate, soft delete), `Popover.tsx`, `Toasts.tsx`, `listFormat.ts` | as named. |
| `lib/reports/pageData.ts`, `widgetHelpers.ts` | Registry views for the client (server only) and registry-free helpers (default configs, `fetchGrain`, override chip). |
| `scripts/check-reports-pages.ts` | 201 checks. |

Write model (documented at the top of `ReportClient.tsx`): every action goes through one FIFO queue reading the latest version token, so an add always precedes a layout that names the widget; the canvas's changes are reconciled against the ids the server will have (adds and removes queued, undo of a removal re-adds under the same id); layout saves only name server-confirmed widgets. A conflict drops the queue, refreshes the page data, replaces local state and remounts the canvas with "Updated by XX, reloaded". Config edits debounce 800 ms per widget and flush on tab hide.

Visual check: a throwaway route (deleted, not committed) with a mocked query response at 1440 and 375 px: view/edit toggle, `/` add picker then new widget at first free slot with the drawer and metric picker focused, drawer reflow, Cmd+K palette, `?` sheet, Share menu, row actions menu, mobile stack and filter chip. Findings fixed (duplicate drawer header, filter strip under the drawer, Esc with focus outside the drawer, mobile title truncation). Server actions and the real route could not be exercised (no login, placeholder env), so every write path is verified by the store fake and static checks only.

First load JS of `/reports/[reportId]`: 166 kB (target < 200 kB gz), `/reports`: 117 kB; recharts only in the three dynamic chart chunks.

## 3. Series palette (dataviz validator)

The design's six slots failed (ink-900 and growth-300 outside the lightness band, ink-900 and gray-400 below the chroma floor, gray-400 vs warning-700 dE 11.7). Re-stepped by enumerating orderings of brand-near hues and validating on white and on gray-50:

`--series-1 growth-600 #0E9F5D`, `-2 #7F54B3` (purple, new), `-3 warning-700 #8A5B0A`, `-4 #D6409F` (pink, new), `-5 info #0866FF`, `-6 #0B8FA3` (teal, new). `--benchmark` stays gray-300.

Validator (light, surface #FFFFFF): lightness band PASS, chroma floor PASS, CVD separation PASS (worst adjacent 14.5, target 8), normal-vision floor PASS (worst 19.2, floor 15), contrast PASS (all >= 3:1). Adjacent pairs only: scatter and small multiples with more than three series still need their labels (the widgets already carry them). No dark theme exists in the app, so no dark mode validation. `check-reports-widgets` now pins the new slot order and hexes (650/650).

## 4. End-to-end sanity check (read-only BigQuery)

Integrated pipeline: `resolveWidget` -> `compileWidget` (real registry) -> SQL run through the MCP (422 MB processed, same as RS2) -> `normaliseRows` -> `evaluateWidget`. Widget: MER and CAC, week grain, split by client, dobias (USD), manami, rawbark, display CZK, 2026-08-31 to 2026-10-03 vs previous year (5 ISO weeks, last one partial), `today` pinned to 2026-10-04.

| client | MER total | MER prev year | delta | CAC total (CZK) | CAC prev year | weekly MER points |
|---|---|---|---|---|---|---|
| dobias | 10.55 | n/a (no spend rows) | n/a | 1,339.97 | n/a | 8.89, 10.51, 10.37, 11.84, 11.26 |
| manami | 2.83 | 5.25 | -46.0% | 471.02 | 227.37 | 1.97, 2.72, 2.69, 5.11, 2.15 |
| rawbark | 19.73 | 3.99 | +394.3% | 847.39 | 1,674.82 | 19.10, 22.04, 18.70, 20.64, 18.13 |

Status ok everywhere, no warnings, partial bucket index [4], `google_only_paid` on rawbark, `revenue_incl_vat` on manami. Hand check: manami MER = 316,323.25 / 111,631.89 = 2.8337; dobias CAC = 473,010.6 CZK / 353 new = 1,339.97. Dobias previous-year spend is NULL in the mart (known Meta gap): the evaluator gives n/a, not 0.

## 5. Verification

- `npx tsc --noEmit`: 0 errors. `npm run build`: exit 0, no warnings (`scratchpad/rs9_build.log`); the old "assertReportsAccess is not exported" warning is gone.
- check scripts: `check:reports` 291 (BigQuery steps skipped, no credentials; runs against the real registry), `-eval` 228, `-authz` 33, `-store` 286, `-url` 193, `-widgets` 650, `-canvas` 98, `-pages` 201, `check:capabilities` 329, `check:paid` 190. All pass.
- Grep gates on `app`, `components`, `lib/reports`, `styles`, check scripts: U+2013/U+2014 0, `border-dashed` 0, `bg-[#` 0, hex literals in reports files 0, developer vocabulary 0, client names 0, `toLocaleString()` 0, `pageEyebrow(` 0.

## 6. Owner decisions and open issues

1. **CM3 on paid-only days** (RS1): Reports subtracts spend on days with no orders; Snapshot's `SUM(cm3)` drops it (Ethia -4,734 CZK, Venev -2,674 EUR over 90 days). Accept, or fix the mart with COALESCE.
2. **Real Postgres** has never run the store SQL (RS4): first prod use must be the smoke test below. Points to watch: `unnest(...)` in `saveLayout`, `CASE WHEN $3::boolean` in `pinReport`, the new `COALESCE($8::uuid, gen_random_uuid())`.
3. Vertical taxonomy (RS10) is still the owner's call; until `ref.client_verticals` exists every client is Unassigned and the Industry switch shows nothing.
4. Each write runs `assertReportsAccess` twice (action and store); each widget request 3 to 4 times. Memoise only if latency shows.
5. The tenancy black-box test (RS10 addendum) is still to be run.

## 7. Manual QA checklist for the owner on prod (design 6.3 plus additions)

Prerequisites: migrations 250 and 251 applied (otherwise benchmarks and verticals are simply empty).

Access
- [ ] Client-role account: `/reports` redirects to `/snapshot`, no rail icon, `POST /api/reports/query` answers 404 with an empty body, `/reports/<id>` redirects.
- [ ] Agency account on `@oneeighty.cz`: has Reports. Agency or admin on another domain: 404 on the route, redirect on pages.
- [ ] A private report of another user: opening its URL is a 404 page, same as a random uuid.

Real Postgres smoke test (first run creates the tables lazily)
- [ ] New report from each template; reload; it persists.
- [ ] Add a widget, drag it, reload: position and config saved. Remove it, Undo, reload: back with the same config. Stale save: open the same report in two tabs, edit in one, then the other: "Updated by XX, reloaded".
- [ ] Rename, pin, duplicate, change visibility (owner), team member sees it; delete, Undo from the toast, restore works.

Data
- [ ] Combined MER for a period equals a hand-written SQL check (use the section 4 query shape).
- [ ] RawBark: MER shows the `^` with "Paid spend is Google only"; CM3 and CM3 % show "No cost data".
- [ ] Dobias (USD) in a CZK report converts; switch to Native with mixed clients: disabled "Mixed currencies".
- [ ] Manami revenue shows the VAT caveat on hover.
- [ ] FX: rates reach 2026-10, so "No FX Oct 2026" will not reproduce; to see the state pick a month beyond the table or temporarily test with a currency pair that has no rate.
- [ ] A KPI tile shows its weekly sparkline; a KPI over All time shows no sparkline (total only).
- [ ] Industry switch with an empty table: nothing drawn. After inserting one benchmark row: hover shows source and as-of date.
- [ ] Too wide a request (Day grain, All time): the widget shows "Too much data" plus the suggestion, the other widgets still load.

UI
- [ ] 375 px: filter chip opens the sheet, stack order, KPI 2-up, charts show tooltips on tap, no edit controls.
- [ ] 1000 px: six-column display only. 1440 px: edit with mouse and with keyboard only (`/`, arrows, Shift+arrows, Enter, Cmd/Ctrl+D, Delete, Cmd/Ctrl+Z, `?`, Cmd/Ctrl+K, `E`, Cmd/Ctrl+S).
- [ ] Filter change: figures pulse and old numbers stay until new ones arrive; "Save default" saves and clears the URL params; Copy link reproduces the view.
- [ ] Refresh button refetches (rate limited server side to one per minute).
- [ ] Series colours: the same client has the same colour in every widget; view the line chart with a colour-blindness simulation.
- [ ] Speed: first load of an 8-widget report under about 1.5 s warm.

## 8. Requests to orchestrator

1. Merge note: `contracts.ts` (`NewWidget.id`), `store.ts` and `check-reports-store.ts` were touched by RS9 for the client widget id; RS4's owner should know.
2. Run `npm run check:reports` once with GCP credentials to record the dry-run table.
3. Decide the CM3 question (section 6.1) and the vertical taxonomy before the owner QA.
4. Run `npx vercel --prod --yes` only after the owner QA above; the session cannot log in, so none of the page flows were exercised against the real session, route or Postgres.
