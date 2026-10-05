# Reporting Suite: security and correctness review

Branch `reporting-suite` (worktree `oe-dash-wt/reporting-integration`), diff `main...HEAD -- dashboard`. Read-only review, 2026-10-04.
Scope: design 3.1 to 3.5, rs1 to rs9, `TENANCY_ISOLATION_ASSESSMENT.md`, `METRICS.md` (Reporting registry section).

## Verdict: ship after fixes

The access-control design holds. I found no path through which a client-role session can reach cross-client data: not by direct POST, server action id, RSC payload or any cache layer. SQL construction is sound. Two findings should be fixed before production:

- **F1 (High, correctness):** partial sums over NULL components produce inflated MER, aMER and CAC, plus partial spend totals. Live data triggers it today (Dobias).
- **F2 (Medium, access):** a temporary-password session bypasses the forced password change and reaches Reports data.

F3 to F6 are Low or Info and can follow.

---

## Findings (ranked)

### F1. High: NULL gap components become partial sums in totals, coarser buckets and rollups ("no data is not zero" broken)

**Where**
- `lib/reports/compile.ts:225-228`: `SUM(col)` / `SUM(IF(...))` per (client, period, bucket). BigQuery SUM skips NULL rows, so a week, month or total bucket that mixes NULL days and valued days returns the sum of the valued days only.
- `lib/reports/evaluate.ts:75-79` (`addN`, "null + x = x") is used in `addRow`/`mergeAggs` (85-115) and in the rollup loop in `outcome` (215-227). A client or bucket whose component is NULL drops out of that component's sum while still contributing to the other components.
- `lib/reports/evaluate.ts:161-175` (`evalTerms`): `nullAs: "gap"` is honoured only when the whole aggregated sum is NULL. A partially NULL sum passes as a value.

**Concrete failure (verified against the warehouse, read-only)**
`mart.mart_daily_kpis`, 2025-06-01..2026-10-03, rows with `paid_spend IS NULL AND revenue > 0`: dobias 323, rawbark 103, venev 40, ethia 39. Dobias has `has_meta = true`, so MER is "connected" for it.
- Dobias, April 2026, month grain or a custom April range: 19 of 30 days have NULL spend. SUM(revenue) = 210,447 and SUM(paid_spend) = 1,724, so **MER is about 122x, shown with status ok**. The same widget at day grain correctly shows "No data" on those 19 days, so the figures contradict each other depending on the grain.
- Dobias `12m`, `ytd` or `90d` totals: the revenue of every month is divided by the spend of the months that exist. MER and aMER are inflated, and CAC and `paid_spend` are understated. All of them show status ok.
- Combined or vertical rollups, for example "All clients" MER for Jan 2026: Dobias revenue (Dobias's own cell shows a gap) is summed into the numerator, while its NULL spend adds nothing to the denominator. The combined MER is inflated and coverage still reads "5 of 5".
- Ethia, Sep 2025: 17 of 24 days NULL. Monthly MER = 45,244 / 9,511 = 4.76 from 7 days of spend.
- The same mechanism hits `cm1_pct`/`cogs` once partial-COGS days appear (METRICS "Partial COGS days (Woo)", expected when RawBark costs land). `guardFails` only inspects bucket-level sums, so a month that mixes costed and NULL days passes, and `innerGuardFail` cannot see inside a `total` bucket. The comment in `evaluate.ts:18-21` ("a total never silently covers uncosted days") holds only at bucket granularity.

This violates the locked rules in METRICS.md ("Gaps are NULL, never 0", "never a partial sum") and the design 2.9 rollup rule.

**Minimal fix**
1. Compiler: for every non-money component (and the `__disp` and `__nat` of money components), also emit `COUNTIF(<col> IS NULL) AS <alias>__nulls`. `run.ts normaliseRows` carries it on `ComponentSum` (`nulls`). Alternatively, emit it only for components used with `nullAs: "gap"`.
2. Evaluator:
   - In `addRow`/`mergeAggs`, keep `nulls`.
   - In `readComponent`, return `{ value: null }` (a gap) when `nulls > 0` for a gap-term component.
   - In `outcome`, null the rollup cell (or exclude the member from **all** components and lower `coverage.included`) when any present member has a gap on a gap term. That is the same rule already applied to fx_missing and not_measured.
   - Apply `guardFails` with the null count too: `cogs nulls > 0` on rows with revenue > 0 means not_measured.
3. Add a fixture to `check:reports-eval`: a two-day bucket with spend [100, NULL] and revenue [1000, 1000] must give MER = null (or the agreed status), never 20.
4. Owner decision, if NULL spend on some days really means "no ads ran" (possible for Ethia and venev): COALESCE it to 0 in the mart and mark the term `nullAs: "zero"`. The current code is inconsistent either way: a day bucket says gap and the week containing it says value.

### F2. Medium: `mustChangePassword` is not part of the Reports gate

**Where:** `lib/authz.ts:33-39` (`currentAccess` drops `mustChangePassword`) and `lib/authz.ts:164-170` (`canUseReports`). The only enforcement is the redirect in `app/(app)/layout.tsx:58`. That covers rendered pages, but not route handlers or server actions.

**Failure:** an admin creates a credentials account `newhire@oneeighty.cz` (role agency) with a temporary password. `verifyPassword` (`lib/users/store.ts`, about line 242) signs in regardless of `must_change_password`. Whoever holds the temporary password (a forwarded email, a Slack DM, a shoulder-surf) can POST `/api/reports/query` and call every action in `app/(app)/reports/actions.ts` without ever setting a password. This returns every client's figures. Before Reports there was no data API route, so this is a new exposure, and the stakes are higher on the first cross-tenant endpoint.

**Minimal fix:** add `mustChangePassword` to `Access` (from `session.user.mustChangePassword`) and refuse it in `canUseReports`: `if (access.mustChangePassword) return false;`. Add a case to `scripts/check-reports-authz.ts`.

### F3. Low: no server-side concurrency or rate limit per user; cache key space is unbounded

**Where:** `app/api/reports/query/route.ts:128-195`, `lib/reports/run.ts:272-292`. The only concurrency cap is in the browser (`MAX_CONCURRENT_WIDGET_REQUESTS = 6`, `useWidgetData.ts`). In-flight dedupe and the refresh limiter (`actions.ts:182-193`) live in per-lambda memory.

**Failure:** a compromised or scripted internal session varies `period.custom.from` by one day per request. Every request gets a distinct cache key, so each runs a fresh job of up to 2 GiB (about 0.4 GB per job observed on `mart_daily_kpis` for 16 months, because the mart is a view and its bytes are not pruned by the date predicate). At high fan-out, Vercel spreads the requests across lambdas, so no limit applies. In addition, `refreshReportData` evicts the `reports` tag for **all** users, and the 60 s limit holds per lambda only. Financial exposure is bounded (about $6.25 per TiB) but uncapped per day.

**Minimal fix:** a per-email in-flight counter in the route that answers 429 above 8. Also set a BigQuery custom quota ("query usage per day per user") on the dashboard service account, which is the real hard cap. Optionally key the refresh limiter in Postgres.

### F4. Low: Postgres pool pressure from repeated session reads and per-client audit inserts

**Where:** every `assertReportsAccess()` calls `getServerSession`. In next-auth v4 that runs the `jwt` callback (`lib/auth.ts:149-156`), which means `findUserByEmail`. One widget request does this 4 to 5 times: route gate, `getReport` actor, `getReportClients`, `runCached`, and `getBenchmarks` when on. Add the `getReport` queries (3) and `auditRead` (one INSERT per client, `route.ts:119-121`). That is roughly 8 + N statements per widget, against `max: 3` connections (`store.ts:137`). With 6 concurrent widgets that is about 50 statements queued on 3 connections.

**Failure:** report opens queue behind the pool. A Postgres hiccup turns into widget 500s. Sign-in on the same lambda shares the pool and slows down. Design 3.1 assumed one lookup per request.

**Minimal fix:** memoise `currentAccess()` per request. Use React `cache()` in RSC, and in the route pass the `Access` resolved by the gate into an internal variant of the lib functions, keeping the asserts in the exported versions. Or use the 30 s `jti` memo the design proposes. Batch the audit insert into one multi-row INSERT.

### F5. Info: native-per-client mode silently drops foreign-currency rows

**Where:** `evaluate.ts:140` (`mode === "native"` returns `v.nat`), `compile.ts:225` (`__nat` = `SUM(IF(ccy = c.currency, col, NULL))`). Ratio and percent metrics in a client split read `nat`, so rows in another currency are excluded rather than converted. The attached caveat `foreign_currency_rows` says they were "converted with the monthly rate". Verified: 0 foreign-currency rows today, so there is no live impact. **Fix:** when `agg.foreignRows > 0` in native mode, use the display path for both terms, or flag the cell. Also fix the caveat text.

### F6. Info: body cap checked after full buffering, counted in characters

**Where:** `route.ts:136-140`. `request.text()` buffers the whole body before the 32 KB check, and `raw.length` counts UTF-16 units, not bytes. This runs only after the gate (internal users), and Vercel caps request bodies at 4.5 MB, so there is no real exposure. **Fix if desired:** check the `content-length` header first.

---

## Verified, no finding

**Gate layering (3.1)**
- Layout, both pages, the route (before reading the body), all 14 server actions, and lib `run.ts`, `store.ts` (every export through `actor()`), `clients.ts` and `benchmarks.ts` all call the gate before any cache read.
- `loading.tsx` is static.
- No other `"use server"` module reaches `lib/reports`, and `fixtures.ts` and `CanvasDemo` are not imported by production code.

**Role freshness**
- `getServerSession` runs the `jwt` callback, which re-reads `app_users` on every call. Deactivation and role changes therefore apply on the next request.
- `role: null` fails the gate.

**Domain check**
- `emailDomain` matches the domain exactly and lower-cased.
- It rejects a second `@`, an empty local part, look-alike domains and subdomains.
- `clientId` must be null.

**No client-role path**
- The route returns 404 with an empty body for every refused case and for GET, PUT, PATCH, DELETE and OPTIONS.
- Action failures throw "Not authorised.".
- RSC props (clients roster, report) render only after `requireReportsAccess`, which the page itself calls, so it does not depend on the layout, which renders in parallel.

**Caches**
- Results: `unstable_cache` is reached only inside `runCached` after `assertAccess()`. The key is `sha256({sv, sql, params})`, and params include the sorted `clientIds`, every date and the display currency, so no two different queries can share an entry.
- The client roster and benchmark/FX caches are global reference data, read only after the gate.
- The browser LRU is per tab, and responses are `private, no-store`.

**SQL injection**
- Every identifier comes from the registry and passes `IDENTIFIER_RE` (`^[a-z_][a-z0-9_]*$`).
- The project id is checked by `PROJECT_RE`.
- Grain is a fixed map, and the only literals (`CZK`, `TOTAL_BUCKET`) are constants.
- User values are typed params only: `ARRAY<STRING>`, `DATE`, and `STRING` for the currency. They are re-validated in the compiler.
- `assertDatePredicates` runs on the final SQL text.
- zod: metric ids form a closed enum, and slugs match `^[a-z0-9_]{1,40}$`. Arrays are capped: 8 metrics, 30 ids, 10 verticals, 24 layout items. Dates are real calendar dates.
- Unknown keys are stripped (not strict), which is harmless because the stripped output is what is stored and compiled.

**Store**
- canView, canEdit and owner checks are enforced in one guarded UPDATE.
- Private and deleted reports both answer `not_found`, so ids cannot be probed. Every report-level read excludes `deleted_at`.
- Widget writes are scoped by `report_id`. The widget-count limit is serialised by the row lock.
- Restore is owner-only. Duplicate requires view permission.
- Version conflicts return the current version.

**Cost**
- `maximumBytesBilled`, `jobTimeoutMs` and `labels` reach the job configuration. Verified in `@google-cloud/bigquery` 7.9.4 `createQueryJob`: `maximumBytesBilled` stays in `configuration.query`, and `jobTimeoutMs` and `labels` are lifted to `configuration`.
- Span and point limits apply.
- `not_connected` clients are excluded from `@clientIds`.

**Math**
- Ratios are computed as SUM/SUM per bucket, total and rollup. The exception is F1, where some rows inside a SUM are NULL.
- FX nulling is per row group, and its months are reported.
- The same-currency path skips the rate.
- Deltas are pp for percent metrics and relative otherwise, with a zero baseline giving null.
