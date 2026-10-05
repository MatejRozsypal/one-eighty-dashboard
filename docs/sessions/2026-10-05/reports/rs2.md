# RS2 report: Compiler and runner (design WP2)

Branch `rs2-compiler`, worktree `oe-dash-wt/rs2-compiler`, one commit `01a6718` on top of `d727748` (Merge rs0-contracts). No `mart_qa` objects, nothing to deploy to the warehouse. All BigQuery access was read-only (MCP `execute_sql_readonly`, incl. dry runs).

## What changed

| File | Content |
|---|---|
| `dashboard/lib/reports/compile.ts` (new) | `createCompiler(registry)`, `compileWidgetWith(widget, registry, {projectId})`, `assertDatePredicates()`, `datePredicate()`, `componentAlias()`, `guardAlias()`, `BUCKET_SQL`, `GUARD_COLUMNS`. Contract export `compileWidget` (fails closed until the registry is bound, see Requests). |
| `dashboard/lib/reports/run.ts` (new) | `runCached` (contract `RunCached`), plus pure helpers `cacheTtlSeconds`, `maxBytesBilled`, `jobLabels`, `mapWarehouseError`, `normaliseRows`. |
| `dashboard/lib/bigquery.ts` | Added `queryJob()` (+ `QueryJobOptions`, `QueryJobResult`, `QueryJobParam`, `QueryJobParamType`): typed params incl. `["STRING"]` arrays, `maximumBytesBilled`, `labels` (validated), `jobTimeoutMs`, `dryRun`, returns rows plus `totalBytesProcessed`/`totalBytesBilled`/`cacheHit`. Demo guard also covers array params. `query()` untouched. |
| `dashboard/scripts/check-reports.ts` | RS0 stub taken over; all RS0 contract checks kept as section 1. Added compiler snapshots and validation, runner policy checks, BigQuery steps (b) and (c). |

### Compiler (design 2.8)
- SQL only from registry constants plus fixed literals; every identifier (mart id, `dataset.table` parts, date, currency and component columns, project id) is checked against `IDENTIFIER_RE` / a project regex before it is emitted. User values only as params: `@clientIds ARRAY<STRING>`, `@curFrom/@curTo/@cmpFrom/@cmpTo/@scanFrom/@scanTo DATE`, `@displayCurrency STRING`, re-validated (client id slug, ISO date, `^[A-Z]{3}$`). Unused params are not sent; a test asserts every `@param` is declared and every declared param is used.
- One CTE per mart, several marts joined `FULL OUTER JOIN ... USING (client_id, period, bucket)`. Aliases are mart-prefixed (`kpis__revenue__nat`, `kpis__revenue__disp`, `kpis__orders`, `kpis__n_rows`, `kpis__foreign_ccy_rows`, `kpis__fx_missing_rows`, `kpis__fx_missing_months`), so phase-2 marts cannot collide.
- FX through CZK in three CTEs: `fx_pairs` (scan months only), `fx_direct` (X to CZK), `fx` = direct, two-hop (`X -> Y -> CZK`, e.g. CAD via USD) and a CZK identity row, reduced to one rate per (month, ccy) with `QUALIFY ROW_NUMBER()`. Deviation from the design SQL, deliberate: the design's two-hop branch would have turned the live `CZK -> EUR` pair into a second CZK row (CZK -> EUR -> CZK) and doubled every CZK sum; the compiler excludes CZK from two-hop and keeps one row per month and currency. The FX CTEs and `@displayCurrency` are only emitted when a money component is present.
- Comparison in the same query via `CROSS JOIN UNNEST([STRUCT('cur', @curFrom, @curTo), STRUCT('cmp', @cmpFrom, @cmpTo)])` plus `date BETWEEN p.from_date AND p.to_date`. Deviation from the design's `IF(... 'cur', 'cmp')`: with previous year (364-day shift) on 12m or 60m the two ranges overlap, and the IF form would drop the overlap from `cmp`. Without a comparison the simpler variant is compiled (`'cur' AS period`, no cmp params).
- Every mart CTE carries `t.<dateColumn> BETWEEN @scanFrom AND @scanTo`; `assertDatePredicates()` re-parses the final SQL and throws if any mart CTE lacks it (tested with a tampered query).
- Key = sha256 of `{sv: SEMANTIC_VERSION, sql, params}`; client ids and components sorted and deduped, params in fixed order (tested: shuffled input gives the same key).

### Runner (design 3.4, 3.5)
- Gate: `assertReportsAccess()` before any cache read. It is looked up on the `@/lib/authz` namespace because WP3 adds it in parallel; absent, the runner throws "Not authorised." (fails closed). `next build` prints one expected warning until WP3 lands ("assertReportsAccess is not exported from @/lib/authz").
- In-flight dedupe: `Map<key, Promise>`, removed on settle; joiners report `cached: true`.
- `cacheThrough()` is the single swappable function: `unstable_cache(load, ["rpt", SEMANTIC_VERSION, key], { revalidate: ttl, tags: ["reports", "bq"] })`; `cached` is true when the loader did not run. Falls back to an in-memory LRU (200 entries, TTL) outside a Next request context; `REPORTS_CACHE=memory` forces it.
- TTL: 15 min when the range ends within 2 days of yesterday, 1 h within 7 days, 6 h older.
- `REPORTS_MAX_BYTES_BILLED` (default 2 GiB, junk values fall back), `jobTimeoutMs` 20000, labels `app=dashboard, feature=reports, widget_type, user=sha1(lowercased email)[0:8]`.
- Errors: `bytesBilledLimitExceeded` / "bytes billed" -> `over_budget` (422, suggestion "Shorter period or week grain"); job or client timeout -> `timeout` (504); anything else (permissions included) -> `warehouse_error` (500). Messages are short and never contain BigQuery text; the original error is the `cause` and is logged with `[reports]`.
- `normaliseRows()`: NUMERIC (Big), INT64, FLOAT64 -> number; DATE -> `YYYY-MM-DD`; NULL stays null (never 0); NULL fx months -> []; money detected by the `__nat` column, non-money gets `nat === disp`.
- The route still sets `Cache-Control: private, no-store` (WP3).

## Verification
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0 (log `scratchpad/rs2/build.log`). A temporary probe route importing `compileWidget` and `runCached` also built (only the expected authz warning); the probe was deleted, never committed.
- `npm run check:reports`: 277/277 passed (RS0 contract checks plus 72 new). BigQuery steps print `SKIP BigQuery steps (b, c): no GCP credentials ...` locally, as required. `--offline` forces the skip, `--print-sql` dumps the snapshot SQL.
- The snapshot test caught a real bug during development (missing commas between the FX CTEs) before any SQL reached BigQuery.
- Snapshots: the design 2.8 MER/CAC weekly query is pinned as full SQL text plus exact params and types; three more (total EUR without comparison, day counts-only without FX, two-mart month USD) pinned by sha256.

### Read-only MCP runs (compiled SQL with params inlined)
3-client weekly MER/CAC widget (dobias, manami, rawbark; week; current 2026-07-06 to 2026-10-03; previous year 2025-07-07 to 2025-10-04; CZK). Sums over the 13 weekly buckets per series, 90 rows each, 0 fx_missing rows, 0 foreign-currency rows:

| client | period | revenue (native) | revenue CZK | paid spend CZK | new orders | MER | CAC CZK |
|---|---|---|---|---|---|---|---|
| dobias | cur | 618,838 USD | 13,028,626 | 1,002,900 | 917 | 12.99 | 1,094 |
| dobias | cmp | 551,137 USD | 11,555,134 | NULL | 751 | n/a | n/a |
| manami | cur | 764,110 | 764,110 | 287,990 | 628 | 2.65 | 459 |
| manami | cmp | 253,179 | 253,179 | 40,444 | 208 | 6.26 | 194 |
| rawbark | cur | 5,032,038 | 5,032,038 | 320,934 | 350 | 15.68 | 917 |
| rawbark | cmp | 6,737,606 | 6,737,606 | 612,983 | 1,038 | 10.99 | 591 |

Cross-checked against a hand-written query straight on `mart_daily_kpis` (same ranges): identical revenue, row counts and new orders; Dobias revenue in CZK identical via `USD -> CZK` monthly rates; Dobias current spend 47,651 USD = 1,002,900 CZK. Dobias `paid_spend` is NULL for the whole comparison quarter in the mart (consistent with the known Dobias Meta gap), so the evaluator will show No data there, not 0. Rawbark MER is revenue over Google-only spend (`google_only_paid` caveat applies). 422 MB processed.

Also run: total grain, EUR, no comparison (dobias, venev, 12m): dobias 2,429,513 USD = 2,093,466 EUR; venev EUR nat equals disp (identity path); `fx_missing_months` comes back as an empty array.

### (b) Dry-run bytes (MCP `dryRun: true`, all 5 active clients, all 22 phase-1 kpis components, previous year)
| window / grain | totalBytesProcessed | share of 2 GiB |
|---|---|---|
| 60m total | 442,558,575 | 20.6% |
| 90d day | 442,558,575 | 20.6% |

Bytes do not depend on range or grain: `mart_daily_kpis` is a view over the stg dedupe windows, which read their full history regardless of the date predicate (a 3-client 15-month real run processed 422 MB, a 2-client run 402 MB). Grain only changes the bucket expression and the window only changes literals, so every combination is about 442.6 MB, well under the 50% (1 GiB) gate. Day at 60m (1,826 days) and week at 60m (261 weeks) exceed `MAX_SPAN` and are skipped by the script (resolve answers 413). The script runs all 12 combinations itself once credentials exist.

### (c) Live columns (MCP INFORMATION_SCHEMA.COLUMNS)
Fixture registry (design 2.3 plus `kpis.fulfillment_cost`): `mart_daily_kpis` 25/25 (client_id, date, currency and all 22 components), `mart_meta_campaign_perf` 5/5, `mart_email_campaign_perf` 8/8. Note `google_spend`, `google_revenue`, `google_purchases` are FLOAT64 while the rest are NUMERIC; the SQL handles both. The real registry check is skipped until RS1 is merged (`registry/components.ts not present`).

## mart_qa objects
None.

## Ready for prod
Nothing for the warehouse. Code is ready to merge after RS1 (registry) and with RS3 (authz).

## Open issues
- Cold cost and latency: every widget query processes about 420 to 445 MB regardless of range, because the mart view does not prune by date. At about $6.25 per TiB that is roughly $0.0026 per cold widget; fine for cost, but it is the main latency driver. The design's phase-2 option (materialised `mart.rpt_client_daily`, open question 5) would cut both.
- `ARRAY_AGG(DISTINCT ... IGNORE NULLS)` returns an empty array, not NULL, on the live engine; the normaliser handles both.
- BigQuery steps of `check:reports` were exercised through MCP only; the script path itself needs one run on a machine with credentials (`gcloud auth application-default login`, then `npm run check:reports`).

## Requests to orchestrator
1. After merging RS1, bind the registry in `lib/reports/compile.ts` (the integration note at the bottom of the file): replace the fail-closed `compileWidget` with
   `import { COMPONENTS, MARTS } from "./registry/components";`
   `export const compileWidget: CompileWidget = createCompiler({ marts: MARTS, components: COMPONENTS });`
   and drop the "compileWidget fails closed" check in `check-reports.ts` (the script then also runs (b) and (c) against the real registry automatically). RS1 must export `COMPONENTS` and `MARTS` under those names and include `kpis.fulfillment_cost`.
2. After merging RS3, `run.ts` can import `assertReportsAccess` directly (`import { assertReportsAccess } from "@/lib/authz"`) instead of the namespace lookup; the build warning disappears either way once RS3 exports it.
3. RS3 (route): map `ReportsError.code` with `REPORT_ERROR_STATUS`; `runCached` throws only `over_budget`, `timeout`, `warehouse_error` (plus a plain "Not authorised." Error if the gate fails). Pass `widgetType` in `RunContext` for the job label.
4. RS1 (evaluator): money component values come as `{nat, disp}`; `disp` is the raw sum and must be nulled when `guards.kpis.fxMissingRows > 0`. Comparison rows can share dates with current rows on long previous-year ranges (both are present, by design).
5. Run `npm run check:reports` once with credentials after integration to record the script's own dry-run table.
