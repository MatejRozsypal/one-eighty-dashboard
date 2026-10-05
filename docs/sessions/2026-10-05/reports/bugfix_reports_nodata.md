# Bugfix: every Reports cell "n/a No data" (2026-10-04)

## Symptom
Portfolio overview, 5 clients, Last 90 days (2026-07-06 to 2026-10-03), Prev period, CZK:
every KPI, chart, bar and table cell shows "n/a No data". `POST /api/reports/query` answers 200, no errors in Vercel logs.

## Root cause
`lib/bigquery.ts` `queryJob()` passed the compiled params straight to `@google-cloud/bigquery` 7.9.4
together with `types` (`curFrom: "DATE"`, etc.). With a provided type of DATE/DATETIME/TIME/TIMESTAMP the
library's `BigQuery._getValue()` returns `value.value` (`_isCustomType`). For a plain string
`"2026-07-06"` that is `undefined`, so the parameter is serialised as `parameterValue: {}`, which BigQuery
reads as NULL. All six date params (`curFrom, curTo, cmpFrom, cmpTo, scanFrom, scanTo`) were NULL, so
`t.date BETWEEN @scanFrom AND @scanTo` matched nothing. The job succeeds and returns 0 rows,
`evaluateWidget` turns 0 rows into status `no_data` for every series and metric, and the route answers 200.

Why it slipped through: earlier validation ran the SQL through the BigQuery MCP with literal dates, and
`check:reports` step (b) only dry-runs (a query with NULL params is valid and has the same cost estimate).
No step ever looked at the wire encoding of the params.

## Evidence (offline repro, script deleted after use)
1. Built the exact request bodies of the `portfolio_overview` template through `planWidget` (KPIs fetched at
   week grain by `fetchGrain`), zod-parsed them, resolved against `ReportClient[]` built from the live
   `ref.clients` rows (dobias USD, ethia CZK, manami CZK, rawbark CZK, venev EUR), compiled.
   `queryClientIds` = all 5 clients for all 7 widgets (resolve and capabilities fine).
2. `BigQuery.valueToQueryParameter_(param, type)` for every compiled param: `clientIds` and
   `displayCurrency` encode correctly, every DATE param encodes as `{}` (NULL).
3. BigQuery MCP: the bar widget SQL with the dates inlined returns 10 rows (5 clients x cur/cmp), e.g.
   manami cur revenue 764508.35, rawbark cur 5032038.33 CZK. The same predicate with NULL dates: COUNT(*) = 0.
4. The 10 MCP rows converted to Node client shapes (BigQueryDate `{value}`, `Big` for NUMERIC, numbers for
   INT64, array of DATE) through `normaliseRows` + `evaluateWidget`: all 5 series `status: ok` with correct
   totals, compare totals and deltas. With 0 rows: all 5 `no_data`. So normalise and evaluate are correct;
   the rs11 partial-NULL gap logic is not involved (revenue is `nullMeans: "zero"`; venev has 38 NULL revenue
   days in the current period and still evaluates `ok`).
5. Client side: `useWidgetData` maps a 200 body straight to the result; an error body would render
   "Could not load" / "Too much data", not "n/a No data". The UI copy matches a 200 with `no_data` cells.

## Fix
`lib/bigquery.ts`: new exported `toJobParams(params, types)` used by `queryJob()`. String values whose
provided type is DATE, DATETIME, TIME or TIMESTAMP (scalar or array element) are wrapped in the library's
own classes (`BigQuery.date()` etc.), which carry `.value`. Everything else is passed through unchanged.
`query()` (used by the existing pages, no `types`) is untouched.

## Regression check
`scripts/check-reports.ts`, section "Wire params": compiles a week widget with previous-period compare and
encodes every param with the library's own `valueToQueryParameter_`. Asserts that all six DATE params arrive
as their `YYYY-MM-DD` value, that raw strings would be NULL (pins the library assumption), that
ARRAY<STRING>/STRING are untouched and that ARRAY<DATE> items are wrapped. With the fix disabled it fails
(`curFrom={} ...`); with the fix 303/303 pass.

## Verification
- `npx tsc --noEmit`: clean
- `npm run build`: ok
- check:reports 303/303 (BigQuery steps skipped, no local credentials), reports-eval 255/255,
  reports-authz 37/37, reports-store 286/286, reports-url 193/193, reports-widgets 650/650,
  reports-canvas 98/98, reports-pages 201/201, capabilities 329/329, paid 190/190, creative ok.
- check:queries and check:warehouse exit 1 with "Could not load the default credentials" (no GCP
  credentials locally; they need the warehouse, unrelated to this change).

## After deploy
Server-side caches hold only successful payloads, and the empty ones were cached too (`unstable_cache`,
TTL 15 min for a range ending yesterday, tags "reports" and "bq"). The cache key does not change with this
fix, so stale empty results can persist up to the TTL (6 h for older ranges) unless the "reports" tag is
revalidated or the deploy clears the data cache. The browser LRU is per tab: reload the page.
