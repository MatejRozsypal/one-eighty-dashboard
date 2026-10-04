# lib/reports: Reporting Suite

Cross-client report builder for internal staff (admin and agency roles on an internal email domain; never the client role). Design: `11_reporting_suite_design.md` in the orchestrator scratchpad. This file records module boundaries and which package owns which file.

## Request path

```
POST /api/reports/query
  reportsAccessOrNull()          404 if null           (WP3, lib/authz.ts)
  ReportQueryRequest.parse()     400 invalid           (RS0, types.ts)
  getReportClients()                                   (WP3, clients.ts)
  resolveWidget()                413 too_large         (WP1, resolve.ts)
  compileWidget()                                      (WP2, compile.ts)
  runCached()                    422 / 504 / 500       (WP2, run.ts)
  getBenchmarks()  -> matchBenchmarks()                (WP3 benchmarks.ts, WP1 benchmarkMatch.ts)
  evaluateWidget() -> WidgetResult                     (WP1, evaluate.ts)
```

Every signature and intermediate type on this path is declared in `contracts.ts`. Implement against it (`export const resolveWidget: ResolveWidget = ...`) and do not change a contract file in your own package: ask the orchestrator.

## Module boundaries

| File | Pure (browser-safe) | Purpose |
|---|---|---|
| `registry/ids.ts` | yes | `METRIC_IDS` (30 phase-1 ids, the only queryable ones), reserved `PHASE2_METRIC_IDS`. Append only. |
| `registry/types.ts` | yes | Marts, components, metrics, caveats, capabilities, `ReportClient`, `SEMANTIC_VERSION`. |
| `registry/*.ts` (others) | yes | Registry data and `evalCapExpr`. No `server-only`, no project id. |
| `types.ts` | yes | zod request contracts (`ReportFilters`, `WidgetQuery`, `WidgetView`, `WidgetConfig`, `LayoutItem`, `ReportQueryRequest`) and the result shape (`WidgetResult`, `MetricCell`, `BenchmarkMatch`). |
| `limits.ts` | yes | Every limit, TTL, cache tag, grid constant and widget default size. |
| `contracts.ts` | yes | Function signatures, intermediate types, `REPORTS_ROLES`, `ReportsError`, store and action interfaces. |
| `fixtures.ts` | yes | Typed fixtures: every cell status, all three splits, with and without benchmarks. Fictional clients and figures. |
| `resolve.ts`, `evaluate.ts`, `benchmarkMatch.ts` | yes | Pure logic, unit-testable without BigQuery. |
| `compile.ts`, `run.ts`, `clients.ts`, `benchmarks.ts`, `store.ts` | no (`server-only`) | Warehouse and Postgres access. `run`, `clients`, `store` call `assertReportsAccess()` internally so a misuse fails closed. |

Rules that hold everywhere:
- No data is not zero. A value that cannot be computed is `null` and renders as `NO_VALUE` (`"n/a"`, `lib/format.ts`) with the cell status as the reason. The design text's "em-dash glyph" means `n/a`.
- No user text reaches SQL. Identifiers come from the registry only; user values travel as typed params.
- Metric formulas are evaluated in TypeScript from summed components, never averaged.
- Reports never call `resolveClient()`; they use `getReportClients()`.
- Default display currency is CZK. Manami VAT is flagged with the `revenue_incl_vat` caveat, not recalculated. CM3 is the mart definition: `mart_daily_kpis.cm3` = revenue - COGS - fulfillment_cost - paid_spend (fulfilment and paid spend coalesced to 0), so the registry needs a `kpis.fulfillment_cost` component (design 2.3 omits it).
- Since migration 228 (deployed 2026-10-05) WooCommerce fee lines are netted and Woo COGS is NULL, not 0, when no costed line exists. `woo_fees_not_netted` no longer applies; a NULL COGS sum on positive revenue is `not_measured`, like a 0.
- No em dash anywhere (`npm run check:reports` enforces it for this folder).

## Packages and file ownership

Each package owns its files exclusively. Paths are under `dashboard/` unless noted.

| WP | Depends on | Files | Done when |
|---|---|---|---|
| **WP0 (RS0) Contracts and deps** | none | `package.json`, `package-lock.json` (react-grid-layout, `check:reports` script); `lib/reports/types.ts`; `lib/reports/registry/types.ts`; `lib/reports/registry/ids.ts`; `lib/reports/limits.ts`; `lib/reports/contracts.ts`; `lib/reports/fixtures.ts`; this README; stub `scripts/check-reports.ts` (handed to WP2) | `tsc` passes; fixtures typecheck against the contracts |
| **WP1 Semantic layer** | WP0 | `lib/reports/registry/components.ts`, `metrics.ts`, `caveats.ts`, `capabilities.ts`; `lib/reports/resolve.ts`; `lib/reports/evaluate.ts`; `lib/reports/benchmarkMatch.ts`; `scripts/check-reports-eval.ts` | Fixture assertions pass: ratio from summed components; combined across currencies; FX bucket nulling; COGS zero guard; not_connected exclusion and coverage; pp vs relative deltas; partial buckets |
| **WP2 Compiler and runner** | WP0 | `lib/reports/compile.ts`; `lib/reports/run.ts` (unstable_cache wrapper, in-flight dedupe, TTL policy, error mapping); `lib/bigquery.ts` (add `queryJob()` with array param `types`, `maximumBytesBilled`, `labels`, `jobTimeoutMs`, `dryRun`; leave `query()` unchanged); `scripts/check-reports.ts` | Dry run of every metric and grain within budget; column check green against the live warehouse; the compiler asserts a date predicate per CTE; snapshot test of compiled SQL text |
| **WP3 Gate, reference data, API** | WP0 (integrates WP1, WP2) | `lib/authz.ts` (`canUseReports`, `requireReportsAccess`, `reportsAccessOrNull`, `assertReportsAccess`, using `REPORTS_ROLES` from `contracts.ts`); `lib/reports/clients.ts`; `lib/reports/benchmarks.ts`; `app/api/reports/query/route.ts` | Client-role sessions and non-internal domains get 404; admin and agency on the internal domain get data; a bad body gets 400; matches Snapshot for one client and range on revenue, MER and CAC |
| **WP4 Persistence and actions** | WP0 | `lib/reports/store.ts` (DDL, `withTransaction`, CRUD, permission helpers); `lib/reports/templates.ts`; `app/(app)/reports/actions.ts` | Version conflict returns `{ ok: false, code: "conflict" }`; every action fails without access; soft delete and restore work |
| **WP5 Shell integration** | WP0 | `lib/products.ts` (add `reports`, `productsFor(role)`); `components/shell/ProductRail.tsx`; `components/shell/MobileTopBar.tsx`; `components/shell/Sidebar.tsx` (null for reports); `components/shell/AccountMenu.tsx` (hide client switcher on reports); `app/(app)/layout.tsx` (pass role) | Rail shows Reports only for allowed users; other products unchanged |
| **WP6 Canvas** | WP0 | `components/reports/canvas/ReportCanvas.tsx`, `WidgetFrame.tsx`, `MobileStack.tsx`, `useGridKeyboard.ts`, `useLayoutHistory.ts`, `useAutosave.ts`; `app/(app)/reports/grid.css` | Drag, resize and keyboard move/resize at 60 fps; undo/redo; autosave calls an injected `onSave`; stacked layout below 768px |
| **WP7 Widgets** | WP0 (renders `fixtures.ts`) | `components/reports/widgets/KpiWidget.tsx`, `LineWidget.tsx`, `BarWidget.tsx`, `TableWidget.tsx`, `RankedWidget.tsx`, `ScatterWidget.tsx`, `BenchmarkHover.tsx`, `CellStatus.tsx`, `chartTheme.ts`, `format.ts` (FormatSpec to string with `smallDecimals`; does not edit `lib/format.ts`); `styles/tokens/colors.css` (`--series-1..6`, `--benchmark`) | Every fixture renders every status; Recharts loaded only through `next/dynamic`; no hex literals |
| **WP8 Pickers and filter bar** | WP0, registry ids | `components/reports/pickers/MetricPicker.tsx`, `ClientPicker.tsx`, `WidgetTypePicker.tsx`, `WidgetConfigPanel.tsx`; `components/reports/ReportFilterBar.tsx`; `lib/reports/url.ts` (`clients`, `preset`, `from`, `to`, `compare`, `ccy`, `bench`) | Keyboard-complete combobox; capability coverage hints; URL round-trip |
| **WP9 Pages and state** | WP3, WP4, WP6, WP7, WP8 | `app/(app)/reports/layout.tsx`; `app/(app)/reports/page.tsx`; `app/(app)/reports/[reportId]/page.tsx`; `app/(app)/reports/loading.tsx`; `components/reports/ReportClient.tsx`; `components/reports/useWidgetData.ts`; `components/reports/ReportSwitcher.tsx`; `ShareMenu.tsx`; `ReportListPanel.tsx`; `ReportListTable.tsx`; `ShortcutSheet.tsx` | Full flow works end to end; 8-widget report meets the warm targets |
| **WP10 Warehouse and docs** | none | `infra/bigquery/250_ref_industry_benchmarks.sql`; `infra/bigquery/251_ref_client_verticals.sql`; `infra/bigquery/252_ops_v_benchmark_issues.sql` (phase 2); `runbooks/30_reporting_benchmarks.md`; `TENANCY_ISOLATION_ASSESSMENT.md` addendum; `METRICS.md` "Reporting registry" section; `PROJECT_LOG.md` entry | DDL applied by Matej; runbook explains the INSERT flow |

Migrations are 250 to 252 (the design's 227 to 229 are taken). `ref.industry_benchmarks` starts empty; the overlay hides itself until rows exist. Benchmark region preference: the client's market, then EU, then GLOBAL (`BENCHMARK_POLICY` in `limits.ts`).

## Notes for implementers

- **Charts.** `recharts` stays on 2.15.x: the Paid redesign (`components/paid/overview/SpendEfficiencyChart.tsx`) already imports it, so the design's "bump to ^3 costs nothing" no longer holds. Load chart widgets with `next/dynamic` either way.
- **Grid.** `react-grid-layout` is on the 2.x line (TypeScript rewrite, ships its own types, React 18+). Its `useContainerWidth()` returns a `RefObject<HTMLDivElement | null>`, which `@types/react` 18 does not accept as a `ref` prop; cast it (`containerRef as React.RefObject<HTMLDivElement>`) or measure with your own ResizeObserver. CSS: `react-grid-layout/css/styles.css`. The v1 API is available at `react-grid-layout/legacy` if needed.
- **Conformance.** Where a module is integrated (the route, or a check script), assert the whole module: `import * as m from "@/lib/reports/resolve"; const _c: ResolveModule = m;`.
- **Phase 2 metrics.** To ship one, move its id from `PHASE2_METRIC_IDS` to the end of `METRIC_IDS` in the same change that adds its mart to the compiler.
