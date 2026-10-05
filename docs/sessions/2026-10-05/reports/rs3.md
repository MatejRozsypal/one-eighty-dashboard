# RS3 report: Gate, reference data, API (design WP3)

Branch `rs3-gate-api`, worktree `oe-dash-wt/rs3-gate-api`, one commit `5fcf505` on top of `d727748` (Merge rs0-contracts). Frontend/library only. Warehouse: read-only queries on `ref.clients`, `ref.fx_rates` and a probe of `ref.client_verticals` (not found). No `mart_qa` objects, nothing to deploy.

## What changed

| File | Content |
|---|---|
| `dashboard/lib/authz.ts` | Re-exports `REPORTS_ROLES` from `lib/reports/contracts.ts` (admin, agency). `canUseReports(access)`: pure, true only when role is in REPORTS_ROLES, `clientId` is null, and the email has exactly one `@`, a non-empty local part and a domain that equals (case-insensitive, exact) one entry of `ALLOWED_EMAIL_DOMAIN` (comma list, default `oneeighty.cz`, read per call). `requireReportsAccess()` (no session: `/auth/signin`; refused: `/snapshot`), `reportsAccessOrNull()` (null on failure), `assertReportsAccess()` (throws `Not authorised.`). Refusals of an identified account log `console.warn [authz]` plus an `access_log` row `event=refused, detail=reports:page|api|lib`. |
| `dashboard/lib/reports/clients.ts` | `getReportClients: GetReportClients`. `ref.clients` status active, NULL flags false, derived `shop` and `email`, `shopPlatform` from `shop_platform` else the first shop flag, currency upper-cased, ids outside `/^[a-z0-9_]{1,40}$/` and the demo id skipped, sorted by id, `slot = index mod 6`. Vertical: open `ref.client_verticals` row (`valid_to IS NULL AND valid_from <= today`, latest wins); region = vertical row region, else `ref.clients.country`. `isTableNotFound(error, table)`: only "Not found: Table ...<table>" counts as "no rows"; any other error (missing dataset, permission) is re-thrown. `unstable_cache` 5 min, tag `reports-ref`, read only after `assertReportsAccess()`. |
| `dashboard/lib/reports/benchmarks.ts` | `getBenchmarkRows`, `getFxRates`, `getBenchmarks` (contract types). Active `ref.industry_benchmarks` rows camel-cased; rows missing a required field, with an unknown `stat`, a null value or `period_end < period_start` are dropped. Missing table = `[]`. `ref.fx_rates` all rows (207 today, CAD/USD, CZK/EUR, EUR/CZK, USD/CZK), rate > 0. Both 6 h; rows tagged `reports-ref` + `benchmarks`, FX `reports-ref`. `getBenchmarks` returns `[]` when the switch is off or there are no rows, then calls WP1's `matchBenchmarks`. |
| `dashboard/app/api/reports/query/route.ts` | `POST` per design 3.2 (flow below), `runtime nodejs`, `force-dynamic`, `maxDuration 30` (literal, Next reads it statically). `GET/PUT/PATCH/DELETE/OPTIONS` (and HEAD via GET) answer the same empty 404. |
| `dashboard/scripts/check-reports-authz.ts` | 33 checks: admin/agency allowed; client role (with and without a client), wrong domain, look-alike suffix/prefix, subdomain, two `@`, empty local part, no `@`, empty email, internal role with a client id, unknown and null role, null and undefined session refused; `ALLOWED_EMAIL_DOMAIN` unset / other / list with spaces and case / empty entries; `isTableNotFound` positive and negative cases; type-level `ReportsAuthzModule` conformance. |

### Route flow and error mapping
1. `reportsAccessOrNull()`; null: `404`, empty body. Nothing else runs, the body is not read, no cache is touched.
2. Body read as text, capped at 32 KB, `JSON.parse`, `ReportQueryRequest.safeParse`: `400 {code:"invalid", issues}` (max 20 issues).
3. `reportId` present: `getReport(id)` (WP4); null or `!canView`: 404.
4. `getReportClients()`, `resolveWidget()`; `ok:false`: `413 {code:"too_large", message, suggestion}`.
5. `compileWidget()`, then `runCached()` and `getBenchmarks()` in parallel.
6. `evaluateWidget()`, access log, `200` with `Cache-Control: private, no-store` (every response carries it, errors and 404 too).
7. Errors: `ReportsError` `not_found`/`forbidden` 404; `invalid` 400; `too_large` 413; `over_budget` 422; `timeout` 504; `warehouse_error`, `conflict` and anything unknown: `500 {code:"warehouse_error", message:"Warehouse error"}` with the cause only in `console.error`. An `Error("Not authorised.")` from a lib-level assert (role revoked mid-request) maps to 404.
8. Every dependency is bound through its contract type (`const resolveFn: ResolveWidget = resolveWidget`, etc.), so signature drift in WP1/WP2/WP4 fails the build in the route.

### Access log
- Per widget query that returned data: one `view` row per client in `widget.queryClientIds` (the ids actually sent to BigQuery), `client_id` set, `detail = "report:<id|adhoc> clients=<ids> range=<from>..<to>"`. Per-client rows (instead of the design's single `clientId: null` row) so `listAccessLog({ clientId })` answers "who saw this client" for Reports too.
- Deduplicated per lambda for 10 minutes on (email, report, clients, range), so a report open with 8 widgets over the same clients and period writes one set of rows, not eight.
- Written in the route rather than only in `store.touchOpened`, because the route is the only place that also sees ad-hoc queries (builder before save, direct API calls). `touchOpened` (WP4) can still write its "report opened" row; the two do not conflict.
- Uses the existing `recordAccess()` unchanged (`clientId` nullable, `detail` free text, never throws).

## Where the gate is enforced (design 3.1) and why

| # | Place | Function | Owner | Status |
|---|---|---|---|---|
| 1 | `app/(app)/reports/layout.tsx` | `requireReportsAccess()` | WP9 | to do (function ready) |
| 2 | each reports page | `requireReportsAccess()` | WP9 | to do |
| 3 | `app/api/reports/query/route.ts` | `reportsAccessOrNull()`, first statement | RS3 | done |
| 4 | each server action in `app/(app)/reports/actions.ts` | `assertReportsAccess()` | WP4 | to do |
| 5 | `lib/reports/clients.ts`, `benchmarks.ts` | `assertReportsAccess()` before any cache read | RS3 | done |
| 5 | `lib/reports/run.ts`, `store.ts` | `assertReportsAccess()` | WP2, WP4 | to do (per contract) |
| 6 | rail and nav | `canUseReports()` / `REPORTS_ROLES` | WP5 | presentation only |

- Why both role and domain: `app_users` is the allow-list and an admin can give any address the agency role. Single-client pages are scoped and logged by `resolveClient`; a report hands over the whole roster at once, so it also requires an address on the agency's own domain. Exact domain match (no suffix or subdomain match), exactly one `@`.
- Why `clientId === null`: internal roles never carry a client (`lib/users/store.ts` writes NULL), so a row that does is inconsistent and refused (fail closed).
- Why lib-level asserts: a future client-role page that imports `lib/reports/*` by mistake throws instead of serving data. The cached loaders are module-private and only reachable through the asserting exports; the cache is only read after the gate in the same request, and cached data is role-independent (internal only).
- The gate reads the role from the server-verified session, which `lib/auth.ts` re-resolves from Postgres on every JWT refresh, so revoking or downgrading a user takes effect on their next request.

## Why 404, not 401/403
- A 403 confirms "this exists, you are not allowed". For the route, 404 tells a client-role user or an outsider nothing about the Reports feature. For report ids, one 404 covers missing, deleted and private-to-someone-else, so ids cannot be probed or enumerated.
- Consistency: every non-POST method also answers 404. Without that, Next would answer 405 to GET and an automatic `OPTIONS` with `Allow: OPTIONS, POST`, confirming the route to anyone.
- Limit, stated honestly: the 404 has an empty body, while an unknown path gets Next's HTML not-found page, so a determined prober could still tell them apart. The 404 is obscurity on top of the gate, not the control; the control is the gate in five places.

## Verification
- `npx tsc --noEmit` with the branch alone: 6 errors, all `Cannot find module` for files RS1/RS2/RS4 have not written yet (`resolve`, `compile`, `run`, `evaluate`, `benchmarkMatch`, `store`). Their worktrees were still at the RS0 merge when I checked.
- With contract-conformant stubs of those six files copied in (not committed; kept in `scratchpad/work/rs3_stubs/` for reuse): `tsc` exit 0, `npm run build` exit 0 (`/api/reports/query` listed as dynamic; log `scratchpad/rs3_build.log`), `check:reports` 213/213, `check:capabilities` 318/318. Stubs removed afterwards; working tree clean apart from the `node_modules` symlink.
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-authz.ts`: 33/33.
- Warehouse: `ref.clients` has the 5 active clients with the expected flags (`has_woocommerce` FALSE, not NULL, today; the NULL rule stays). `ref.client_verticals` and `ref.industry_benchmarks` do not exist yet (error text matched by `isTableNotFound`). `ref.fx_rates` 4 pairs, up to 2026-10-01 (CAD/USD to 2026-05-01).
- No U+2014 / U+2013 in any changed file.
- Not done: "matches Snapshot for one client and range on revenue, MER and CAC" needs RS1 and RS2; no dev-server login, so no live 404/400 request test. Run both at integration.

## Open issues
1. The branch does not typecheck on its own until RS1 (`resolve`, `evaluate`, `benchmarkMatch`), RS2 (`compile`, `run`) and RS4 (`store`, `getReport`) are merged. Merge RS3 after them, or drop the stubs in from `scratchpad/work/rs3_stubs/` temporarily.
2. Session cost: one widget request makes about 3 to 4 session lookups (route gate, `getReportClients`, `runCached`, `getBenchmarks` when on, `getReport` when a report id is sent), each a small Postgres read through the `jwt` callback. Accepted in design 3.1; if latency shows it, add the 30 s memo keyed by token `jti`.
3. The audit dedupe is per lambda and in memory, so a cold lambda can write a duplicate set of rows; harmless.

## Requests to orchestrator
1. Add `"check:reports-authz": "tsx --tsconfig scripts/tsconfig.json scripts/check-reports-authz.ts"` to `dashboard/package.json` (RS0 owns it), or have WP2 call it from `check:reports`.
2. WP4 (`store.ts`): export `getReport` with the `ReportStore["getReport"]` signature (the route imports it by that name), return null for not visible, and call `assertReportsAccess()` inside. If WP4 also logs in `touchOpened`, keep `clientId: null` with `detail "report:<id> opened"` so it does not duplicate the route's per-client rows.
3. WP9: call `requireReportsAccess()` in `app/(app)/reports/layout.tsx` and in each page.
4. WP10: the TENANCY addendum can cite the route header comment and the table above (single exception, 404 policy, per-client audit rows).
