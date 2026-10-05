# r3-reports

Branch `r3-reports`, worktree `oe-dash-wt/r3-reports`, one commit on top of `b5868b1` (9b6728c). Not pushed.

## Findings covered

| Id | Result |
|---|---|
| N-01 | Fixed (server cost, pending state, repeat click guard, idempotency). |
| N-02 | Mitigated: automatic retry with backoff, cheaper per-widget request. Root cause is only partly provable (see below). |
| N-05 | Fixed: widgets dim on the click, driven by the pending navigation target. |
| N-03 | Fixed in the UI layer (evaluator label left alone, see requests). |
| N-04 / C-20 | Fixed: one muted line "No benchmarks yet". |

## N-01 why it was slow

Read from code, plus Vercel runtime logs (read-only):

1. `ensureTable()` runs `CREATE INDEX IF NOT EXISTS`, `ALTER`-style DDL and three `CREATE TABLE IF NOT EXISTS` on every cold lambda. `CREATE INDEX IF NOT EXISTS` takes a SHARE lock on the table even when it changes nothing, so it queues behind any open write transaction and every later writer queues behind it. Logs show how often that happens: of 590 `/api/reports/query` requests in the last 24 h, 274 carry the pg "SECURITY WARNING" line that is printed once per new pg pool, i.e. roughly every second request ran on a cold lambda (no Fluid concurrency: one request per instance). Each cold instance also runs the users DDL (`lib/users/db.ts`, not mine).
2. `createReport` ran BEGIN, one INSERT for the report, one INSERT per widget (8 to 13 sequential round trips for the templates), COMMIT, on a pool of max 3 connections.
3. The action called `revalidatePath("/reports")`, so its response also re-rendered the list page and the layout (4 `listReports` queries) before the browser learned the new id and could navigate.
4. Every `assertReportsAccess()` is a Postgres lookup (the NextAuth `jwt` callback calls `resolveAccess` on every `getServerSession`), and create did it twice.

What changed (`lib/reports/store.ts`, `app/(app)/reports/actions.ts`, `components/reports/ReportListTable.tsx`, `Popover.tsx`):
- `ensureTable()` first runs a lock-free probe (`SCHEMA_PROBE`: `to_regclass` for all 3 tables and 4 indexes plus the new column); the DDL only runs when something is missing.
- `createReport` is ONE statement (CTE: INSERT report ON CONFLICT DO NOTHING, INSERT widgets from `jsonb_to_recordset`), one round trip, atomic without BEGIN/COMMIT.
- Idempotent per click token: new nullable column `reports.create_token` plus partial unique index `reports_create_token_idx (owner_email, create_token) WHERE create_token IS NOT NULL`. The action takes an optional `clientToken` (8 to 64 chars, `[A-Za-z0-9_-]`, zod); a repeat with the same token returns the first report (`reports.create.existing` read). The browser makes one `crypto.randomUUID()` per click.
- The create action no longer revalidates `/reports`. The client opens the new report, then calls `router.refresh()` (same navigate-then-refresh pattern `saveDefault` already uses), so the list and left panel refresh off the critical path. `duplicateReport` still revalidates (not in scope).
- UI: the menu stays open after the click (Popover got a `locked` prop), the clicked template shows a spinner and "Creating", then "Opening" once the id is back; other templates and the "New report" trigger are disabled; the trigger itself shows "Creating". Same for "Use template" in the Templates tab. The guard is a ref set synchronously in the click handler, so a fast second click cannot get through. If the navigation fails (pending ends without unmount) the controls are released; on an action failure they are released and the error toast shows. Duplicate (row menu and report menu, Cmd+D included) got the same one-at-a-time guard and a "Duplicating" toast.

Real-Postgres check of the new SQL (PGlite in the scratchpad, not in the repo): old schema probe false, DDL, probe true, DDL twice is a no-op, legacy rows keep a NULL token, first call returns 1 row with 3 widgets, same token returns 0 rows (and the existing-row read finds the first id), NULL tokens always create, same token for another owner creates, blank template (empty widget array) works, widget order by (y, x) preserved.

I could not measure the production create time (no login, no prod DB access). Expect the action to drop from the 10 to 16 s seen under load to roughly: 2 auth lookups + 1 insert statement (+ a cold start if any). The remaining variable part is the cold lambda start and the render of the new report page, which are outside this package (see requests).

## N-02 cause

Evidence:
- Runtime logs (prod, last 24 h, the retention limit): 3173 responses 200, 0 responses 5xx, one 404 (a GET on the query route), no `[reports] run failed`, `[reports] query failed` or `user store unreachable` line. The only error-level lines are the pg SSL warning.
- `ERROR_COPY` in `useWidgetData.ts` shows "Could not load" only for `warehouse_error`, `conflict` (both would have been logged by the route, and were not) or a failed `fetch` / a non-JSON non-ok response. So the failures QA saw never reached the handler as errors: they were network-level or platform-level (503 from the platform with no function log), which matches QA's 503s on `POST /reports/<id>` and the `_rsc` GETs that the runtime logs also do not contain.
- Trigger: first open of a fresh report sends 6 simultaneous queries, each landing on its own cold lambda (the 274/590 cold ratio above). Not a commit race (the report row is committed before the action returns, and a 404 would read "Not available") and not a BigQuery timeout (that reads "Timed out" and would be logged).
- I cannot prove the exact platform error from here; the retry covers the class.

What changed:
- `useWidgetData.ts` `post()` retries quietly before showing an error: network error, 408, 425, 429, 5xx without a known code: 2 retries after about 0.7 s and 2 s (+ up to 30 % jitter); our own `warehouse_error` 500: one retry; a 404: one retry (an auth lookup that fails under load answers 404); never for `timeout`, `invalid`, `too_large`, `over_budget`, or a 504 (a retry would burn the same 20 s again). The backoff is outside the 6-slot concurrency gate and abortable. The widget keeps its skeleton or dimmed old figure meanwhile; the manual Retry button stays.
- The query route now asks `canViewReport` (one statement) instead of `getReport` (3 statements and every widget config) on every widget request: 2 fewer Postgres queries per widget on a 3-connection pool.

## N-05, N-03, N-04

- N-05: `ReportClient` reads `isPending` and `pendingHref` from the shared navigation. When a navigation to the same report with different filters is in flight (compared with `parseFilterParams` + `withOverrides` + `filtersEqual` against the effective filters), `filtersChanging` is passed as `refreshing`, so every widget dims with the existing `oe-pulse oe-pulse-stale` look at once. Navigations to other pages or with identical filters do not dim.
- N-03: `nameSingleClientRollups()` in `components/reports/widgets/format.ts`, applied in `WidgetCell`: a combined series whose cells have `coverage.of === 1` is labelled with that client's name (falls back to the `excluded` name when the only client was left out). Several clients keep "All clients". The label source is `lib/reports/evaluate.ts` (not mine), left unchanged.
- N-04: when Industry is on, every widget has settled without error and no result has a benchmark row, one muted `No benchmarks yet` line (role status) shows under the filter bar.

## Verification

- `npx tsc --noEmit`: clean.
- `npm run build`: passes.
- `check:reports` 327/327 (BigQuery steps skipped, no credentials), `check:reports-eval` 359/359, `check:reports-authz` 37/37, `check:reports-store` 315/315 (new: single statement create, token idempotency, per owner tokens, invalid tokens, `canViewReport`, probe coverage), `check:reports-url` 193/193, `check:reports-widgets` 684/684 (new: single-client labels, retry classes and delays), `check:reports-canvas` 98/98, `check:reports-pages` 216/216 (new static checks for guard, pending text, dim, no-benchmarks line, route), `check:loading` 248/248.
- Not done: browser verification (no login). The UI parts are covered by static checks and tsc/build only.
- No em or en dash in the diff.

## Deploy notes

- Schema change, applied lazily by `ensureTable()` on the first request after deploy: `ALTER TABLE reports ADD COLUMN IF NOT EXISTS create_token TEXT` (nullable, metadata only) and `CREATE UNIQUE INDEX IF NOT EXISTS reports_create_token_idx`. Both are idempotent; existing rows keep NULL. If it fails, `ensureTable` logs `[reports] could not create report tables` and the store reports unavailable, same failure mode as before. Worth a look at the first prod request after deploy. To apply by hand instead, run the two statements above.
- No BigQuery objects, no env changes.

## Requests to orchestrator (files not in this package)

1. `lib/authz.ts` / `lib/auth.ts` (r3-perf): `getServerSession` runs `resolveAccess` (a Postgres query) on every call, and Reports calls the gate 6 to 8 times per widget request (route + clients + run + benchmarks + store). A per-lambda cache of `resolveAccess` for about 30 s would cut most Postgres traffic of the first open and of every create. Also `ensureSchema()` in `lib/users/db.ts` runs `CREATE UNIQUE INDEX IF NOT EXISTS` on `app_users` for every cold lambda: same lock pattern as the reports DDL, a probe like `SCHEMA_PROBE` fixes it.
2. Cold lambdas: 274 of 590 widget requests were cold starts, so a first open of 6 widgets pays 6 cold starts. Fluid compute (or a single batch endpoint that returns several widgets from one lambda, which also shares the clients read and the auth lookup) is the real lever for C-03 and the N-01 render of the new report page. A batch endpoint is a bigger change than this package.
3. `lib/reports/contracts.ts`: `ReportStore.createReport` does not know `clientToken` and the store has no `canViewReport`. I typed both as `ReportStoreExtras` in `store.ts` instead. If contracts should own them, add `clientToken?: string` to `createReport` and `canViewReport(id): Promise<boolean>`.
4. `lib/reports/evaluate.ts` line 415: the combined series label "All clients" is hardcoded. If you would rather fix it at the source (name the client when `widget.clients.length === 1`), the UI helper becomes a no-op and can stay as a safety net.
5. `lib/reports/limits.ts`: nothing needed. If the retry delays should be tunable, `RETRY_DELAYS_MS` lives in `useWidgetData.ts` and can move there.
