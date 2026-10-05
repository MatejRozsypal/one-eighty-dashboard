# RS0 report: Reporting Suite contracts and deps (design WP0)

Branch `rs0-contracts`, worktree `oe-dash-wt/rs0-contracts`, one commit `d8d886c` on top of `3488eb3` (reporting-suite base incl. cleanup and Paid redesign). Frontend/library only. No warehouse reads or writes, no `mart_qa` objects, nothing to deploy.

## What changed

| File | Content |
|---|---|
| `dashboard/package.json`, `package-lock.json` | `react-grid-layout ^2.2.4` (lock 2.2.4); `check:reports` script. `zod` already present (^3.23.8, installed 3.25.76). `recharts` NOT bumped (see deviations). |
| `lib/reports/registry/ids.ts` | `METRIC_IDS` (30 phase-1 ids from design 2.4, the only ones `z.enum` accepts), reserved `PHASE2_METRIC_IDS` (5), `REGISTRY_METRIC_IDS`, `MetricId`, `Phase2MetricId`, `RegistryMetricId`, `isMetricId`, `isRegistryMetricId`. Append-only rules in the header. |
| `lib/reports/registry/types.ts` | Design 2.2 types verbatim plus: `ReportClient`, `ReportCapabilities`, `ShopPlatform`, `CaveatDef`, `RegisteredMetric`, `MetricRegistry`, `ComponentRegistry`, `MartRegistry`, `CaveatRegistry`, `METRIC_GROUP_ORDER`, `IDENTIFIER_RE`. `SEMANTIC_VERSION = 1`. |
| `lib/reports/types.ts` | zod: `IsoDate`, `ClientSelection`, `PeriodSpec`, `ReportFilters`, `WidgetQuery`, `WidgetView`, `WidgetConfig`, `LayoutItem`, `ReportName`, `Visibility`, `ReportQueryRequest`. Result: `WidgetResult`, `ResultSeries`, `MetricCell`, `CellStatus`, `CELL_STATUS_PRECEDENCE`, `CELL_STATUS_LABEL`, `BenchmarkMatch`, `ResultWarning`. Errors: `ReportErrorCode`, `REPORT_ERROR_STATUS`, `ReportErrorBody`. `DEFAULT_REPORT_FILTERS` (all clients, 90d, previous_period, CZK, benchmark off). Series id helpers. |
| `lib/reports/limits.ts` | `MAX_SPAN` per grain, `MAX_POINTS` 1500, 8 metrics/widget, 24 widgets/report, `WAREHOUSE_MONTHS` 60, bytes budget 2 GiB, job timeout 20 s, TTLs, cache tags, browser LRU 100 and concurrency 6, `BENCHMARK_POLICY` (all_ecommerce fallback, region fallback EU then GLOBAL, 18-month lookback, 12-month staleness), `GRID`, `WIDGET_SIZE` (design 1.13), autosave 800 ms, undo 50. |
| `lib/reports/contracts.ts` | Signatures and module interfaces: authz gate (`REPORTS_ROLES = ["admin","agency"]`), capabilities, `getReportClients`, `mergeFilters`/`resolveWidget` (+ `ResolvedWidget`, `LimitViolation`), `compileWidget` (+ `CompiledQuery`, `TOTAL_BUCKET`), `runCached` (+ normalised `ComponentRow`, `RunContext`), `getBenchmarkRows`/`getFxRates`/`getBenchmarks`, `matchBenchmarks` (+ `BenchmarkRow`, `FxRate`), `evaluateWidget`, `ReportStore`, `ReportActions`, templates (`TEMPLATE_KEYS`), `StoreResult`. Runtime: `ReportsError` class. |
| `lib/reports/fixtures.ts` | Fictional clients alpha/bravo/charlie/delta, `FIXTURE_FILTERS`, a valid `FIXTURE_CONFIGS` per widget type, `FIXTURE_RESOLVED`, `FIXTURE_ROWS`, `FIXTURE_BENCHMARK_ROWS`, `FIXTURE_FX`, and 4 `WidgetResult`s: client weekly (all 5 statuses, partial bucket, comparison, no benchmarks), combined total with benchmarks ok/stale/no_fx and coverage 1 of 2, combined monthly fx_missing without comparison, vertical monthly with pp deltas and the unassigned vertical. Gaps are null, never 0. |
| `lib/reports/README.md` | Request path, module boundaries (pure vs server-only), house rules, WP table from design 6.3 with migrations renumbered 250/251/252 and WP3's done-when updated for the agency decision, implementer notes. |
| `scripts/check-reports.ts` | Stub handed to WP2: 205 contract checks (ids, sizes, zod accept/reject cases, fixture invariants, status/split/benchmark coverage, em dash gate on `lib/reports`). |

## Verification
- `npm ci` in `dashboard/` (no node_modules in this worktree), then `npm install react-grid-layout@^2.2.4`.
- `npx tsc --noEmit`: exit 0. A probe confirmed tsc covers `lib/reports` (deliberate type error was caught, probe deleted).
- `npm run build`: exit 0 (log `scratchpad/rs0_build.log`).
- `npm run check:reports`: 205/205 passed.
- Fixtures typecheck against the contracts (`FIXTURE_RESOLVED: ResolvedWidget`, `FIXTURE_ROWS: ComponentRow[]`, `FIXTURE_BENCHMARK_ROWS: BenchmarkRow[]`, results `satisfies Record<string, WidgetResult>`), and every fixture config passes `WidgetConfig.parse`.
- react-grid-layout 2.2.4 probe under @types/react 18: `GridLayout` with `gridConfig`/`compactor` compiles; uses only useState/useEffect/useRef/useMemo/useCallback; README compat table says React 18+.
- No U+2014 or U+2013 in any changed file.

## Deviations from the design
1. **recharts not bumped to ^3.** The condition failed: `components/paid/overview/SpendEfficiencyChart.tsx` (Paid redesign) imports recharts, so design section 0 item 5 and 5.2 ("nothing imports it") is no longer true. Stays at ^2.13.0 (installed 2.15.4).
2. **react-grid-layout on 2.x, not 1.5.x.** 2.2.4 is `latest` (1.5.4 is tagged `legacy`), TypeScript rewrite with bundled types, so no `@types/react-grid-layout`. The design allows v2 when stable. One friction for WP6: `useContainerWidth().containerRef` is `RefObject<HTMLDivElement | null>`, which @types/react 18 rejects as a `ref`; cast or measure with an own ResizeObserver (noted in README).
3. **Metric ids split.** `METRIC_IDS` holds only the 30 phase-1 ids (as asked), so `WidgetQuery` rejects phase-2 ids; the 5 phase-2 ids are reserved in `PHASE2_METRIC_IDS` and `MetricBase.id` is `RegistryMetricId` so WP1 can still define them.
4. **`cells` is `Partial<Record<MetricId, MetricCell>>`** (design wrote `Record`, which would force all 30 keys). Added cell fields `missing` (capabilities) and `fxMonths`; series `clientIds` for rollups; `BenchmarkMatch` gets `metricId`, `vertical`, `region`, `status` (ok/stale/no_fx) and `benchmarkId`.
5. **New CaveatId `foreign_currency_rows`.** Design 2.9 says "add a caveat" for `foreign_ccy_rows > 0` but defines no id.
6. **WidgetConfig cross-field rules** (design 1.6 prose made explicit): scatter needs X and Y from `query.metrics`; ranked takes exactly one metric. `PeriodSpec` rejects `from > to`, impossible dates and the `today` preset.
7. **Run returns normalised rows** (`ComponentRow` keyed by `ComponentId` with `{nat, disp}` and per-mart guards) instead of raw SQL aliases, so column naming stays inside WP2 and phase-2 marts cannot collide (`kpis.revenue` vs `email_campaign.revenue`).
8. **Store functions take no actor**; each calls `assertReportsAccess()` itself (design 3.1 point 5). `StoreResult` failure codes: conflict, not_found, forbidden, invalid.
9. **`n/a` everywhere** the design says em-dash glyph; `CELL_STATUS_LABEL` = Not connected / No FX / No cost data / No data.
10. **Access:** `REPORTS_ROLES = ["admin","agency"]` (owner), exported from `contracts.ts` so `lib/authz.ts` (WP3) and the rail (WP5) share one constant. WP3 done-when in the README now says client role and non-internal domains get 404.

## Facts that changed since the design (affect WP1, flagged in README)
- **228 is deployed (2026-10-05):** Woo fee lines are netted, so `woo_fees_not_netted` no longer applies (id kept, append-only; WP1's rule should return false). Woo COGS is now NULL, not 0, when no costed line exists (RawBark COGS and CM1 to CM3 NULL on all days): the evaluator must treat a NULL COGS sum on positive revenue as `not_measured`, not `no_data` (documented on `CellStatus`).
- **Mart CM3 includes fulfilment:** `mart_daily_kpis.cm3 = revenue - cogs - COALESCE(fulfillment_cost,0) - COALESCE(paid_spend,0)`. Owner chose the mart definition, so WP1 needs a `kpis.fulfillment_cost` component (nullAs zero) in `cm3` and `cm3_pct`; design 2.3/2.4 omit it.
- **FX now reaches 2026-10-01** (231 to 233), so "No FX Oct 2026" in the QA checklist will not reproduce. Fixtures use their own FX table that stops at 2026-09.

## Open issues
- None blocking. `npm ci` printed the usual allowScripts warning for esbuild/fsevents install scripts; tsx and next build work.

## Requests to orchestrator
1. Pass the "Facts that changed" section to WP1 (CM3 fulfilment component, NULL COGS status, obsolete Woo caveat) and the QA checklist owner (FX Oct 2026).
2. WP2 takes over `scripts/check-reports.ts`; ask it to keep the RS0 contract checks.
3. WP3: import `REPORTS_ROLES` from `@/lib/reports/contracts` in `lib/authz.ts` rather than redefining it.
4. WP6: use the react-grid-layout v2 API (`react-grid-layout`) or `react-grid-layout/legacy`; see the ref-type note in the README.
5. If recharts 3 is still wanted, it needs a migration check of `SpendEfficiencyChart.tsx` by the Paid owner.
