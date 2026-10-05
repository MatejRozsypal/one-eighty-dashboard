# r3-perf: server render latency, request dedupe, controls race

Branch `r3-perf` (worktree `oe-dash-wt/r3-perf`), on `b5868b1`. Three commits, not pushed, not merged:

| commit | content |
|---|---|
| `9162426` | getClients cache, per-request session, access lookup coalescing, BigQuery query() labels/wait cap/job mode, Postgres pool |
| `a869247` | controls merge onto the URL still in flight (QF2 request), check:loading assertions |
| `4b5d9a6` | orchestrator follow-ups from r3-reports: access answers reused 15 s across requests, user-store DDL skipped when the schema exists |

No BigQuery writes, no `mart_qa` objects, no prod changes.

## 1. Measurement

### BigQuery INFORMATION_SCHEMA.JOBS (read-only, `region-eu`, last 24 h to about 2026-10-05 09:00)
The connector was down for most of the package; these ran after it came back. "View jobs" = jobs whose referenced tables include the raw order tables behind `mart_daily_kpis` / `mart_monthly_kpis`.

| | value |
|---|---|
| `sa-frontend-reader` jobs | 4,868 (541 GB processed, 1,527,421 slot s, p50 974 ms, p95 6.2 s) |
| of which view jobs | **1,603 jobs, 457.8 GB (85 % of bytes), 1,455,812 slot s (95 % of slot time)**, avg 908 slot s per job |
| view job run time (start to end) | p50 4.1 s, p95 7.3 s |
| view job queue (creation to start) | p50 0.5 s, p95 0.8 s, max 6.4 s; 77 jobs of all kinds queued over 1 s |
| peak concurrency (1 s buckets, non-cache jobs) | **51 jobs, 45 of them view jobs**; p95 15 |
| BigQuery result cache hits on view jobs | 0 (the views use `CURRENT_DATE()`, which disables the cache) |
| `ref.clients` registry query (`getClients`) | **1,704 jobs in 24 h**, 1,700 of them result-cache hits, server time p50 122 ms, p95 321 ms (plus the HTTP round trip per job) |
| errors | 30, all `invalidQuery` (see requests) |

Top queries by bytes (`sa-frontend-reader`, non-cache, over 100 MB; fingerprint = start of the SQL, mapped to the code):

| query (code) | page | jobs | avg MB | avg slot s | p50 / p95 ms |
|---|---|---|---|---|---|
| Reports compiled kpis query (`feature=reports`) | Reports | 316 | 423 | 1,536 | 5,339 / 9,028 |
| `fetchPnlDays` native (pnl.ts) | Snapshot, Goals | 120 | 438 | 979 | 4,821 / 8,808 |
| `getExcludedCurrencies` (context.ts) | Snapshot and others | 113 | 412 | 1,389 | 4,904 / 9,921 |
| `SUM(paid_spend), SUM(new_customer_orders)` on daily kpis (lifetime/unit economics CAC) | Snapshot, Unit economics | 112 | 297 | 1,374 | 4,971 / 9,769 |
| `mart_meta_campaign_perf` | Paid | 70 | 473 | 59 | 1,575 / 2,081 |
| `customers_90d_complete` payback (lifetime.ts) | Snapshot | 99 | 314 | 518 | 4,961 / 7,940 |
| pnl variant `k.revenue, k.new_customer_revenue` (`getPaidDaily`) | Paid Overview | 48 | 441 | 2,271 | 4,677 / 6,208 |
| `mart_monthly_kpis` (growth.ts, yoy.ts) | Growth | 27 | 436 | 1,861 | 5,138 / 12,300 |
| `SUM(paid_spend) AS paid_spend` on daily kpis (unitEconomics.ts) | Unit economics | 34 | 282 | 1,560 | 6,137 / 11,959 |
| cohort grid | Cohorts | 22 | 210 | 1,558 | 5,770 / 9,275 |

Reading: every query on the kpis views costs 4 to 6 s at p50 and about 9 to 12 s at p95, whatever its range, because the view recomputes the whole order history (about 900 to 2,300 slot s each). Meta marts read as many bytes but need about 60 slot s and answer in 1.6 s. A Snapshot render fires 4 to 5 of these in parallel, so its floor is one view query (about 5 s) and its tail is the slowest of five (9 to 10 s), which matches QA's 6.3 to 9.5 s. At peak 45 view jobs ran at once (about 40,000 slot s of work in flight on the on-demand pool), which is the queueing QA's 6-render burst hit. `mart_monthly_kpis` reads the same 436 MB, so it sits on the daily view.

Queries for a rerun after deploy (page jobs then carry `labels.app = 'dashboard'`, `labels.feature = 'page'`, `labels.src = '<first table>'`; Reports keep `feature = 'reports'`):

```sql
SELECT (SELECT value FROM UNNEST(labels) WHERE key = 'src') AS src,
       (SELECT value FROM UNNEST(labels) WHERE key = 'feature') AS feature,
       COUNT(*) AS jobs, COUNTIF(cache_hit) AS cache_hits,
       ROUND(SUM(total_bytes_processed) / 1e9, 1) AS gb, ROUND(SUM(total_slot_ms) / 1000) AS slot_s,
       APPROX_QUANTILES(TIMESTAMP_DIFF(end_time, creation_time, MILLISECOND), 100)[OFFSET(50)] AS p50_ms,
       APPROX_QUANTILES(TIMESTAMP_DIFF(end_time, creation_time, MILLISECOND), 100)[OFFSET(95)] AS p95_ms
FROM `region-eu`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
  AND user_email LIKE 'sa-frontend-reader@%' AND job_type = 'QUERY'
GROUP BY 1, 2 ORDER BY gb DESC;
```
Note: short-query-mode answers that create no job may not appear in JOBS; the registry query is the only expected one, and it is now cached in the app.

### Vercel runtime logs (read-only, production, last 24 h)
- About 3,450 entries: 200 = 3,173, 304 = 275, 307 = 4, 404 = 1, 405 = 1. **No 5xx and no "timed out" lines** in the retained window (retention is 1 day, so QA's 250 to 320 s hangs from the earlier QA day are no longer visible).
- Top paths: `/api/reports/query` 590, `/snapshot` 217, `/reports` 214, `/creative` 181, `/paid/google` 141, `/orders` 116, `/paid/meta` 103, `/paid` 93, `/growth` 88, `/unit-economics` 84, `/goals` 79.
- 274 entries are the pg "SSL modes ... aliases for verify-full" warning, which Node prints once per process when the first Postgres connection opens. So roughly 1 request in 12 started a fresh instance with a fresh pool (cold path: TLS handshake, schema DDL, access_log DDL before the first page query).
- The logs API exposes no request duration field, so **no render durations from Vercel**. Single-render timings stay QA's: Snapshot 6.3 to 9.5 s (12 m with compare 18.7 s), Growth 5.3 to 18.7 s, Unit economics 4.8 to 8.7 s, Reports widget 7 to 9 s cold.

### What the code shows (per navigation, before this branch)
- `getClients()`: called by the app layout AND the page, which Next renders in parallel: **2 BigQuery jobs per navigation** on `ref.clients`, uncached.
- Session: next-auth runs the `jwt` callback on every `getServerSession` call, and that callback reads Postgres (`resolveAccess` -> `findUserByEmail`). Per page render: layout 1 + `resolveClient` 1 (+1 for `/paid/*` and `/creative/*` section layouts) = **2 to 3 Postgres lookups**, plus the access-log INSERT. Per Reports open: 1 lookup per widget request (13 for the QA portfolio).
- Postgres pool: `max: 3` per instance, **no connection timeout** (pg default 0 = wait forever), no statement timeout, **no `error` listener** on the pool. Under Fluid compute one instance serves many concurrent requests on that pool. A dropped idle connection without a listener is an unhandled `error` event, which kills the instance and every request it is serving.
- BigQuery `query()`: already on the jobs.query fast path, but with no wait cap: a queued job kept the render waiting until the 300 s platform limit. No labels, so page cost could not be attributed in JOBS. `maxResults` is irrelevant (page results are small), location EU is set on both the client and the call.
- kpis-view reads per render (each 300 to 440 MB and 900 to 2,300 slot s, table above): Snapshot 3 to 4 (`fetchPnlDays`, `getExcludedCurrencies`, the paid-spend/new-orders CAC read, payback), Goals 1 (`fetchPnlDays`), Paid Overview 1 (`getPaidDaily`), Unit economics 2, Growth 2 on `mart_monthly_kpis` (436 MB per read, so it is built on the daily view).

Cause of the slowness: the kpis views (95 % of slot time, 4 to 6 s p50 per query, no result cache). Most likely cause of the N-06 multi-minute hangs: a burst of renders on one instance contending for a 3-connection Postgres pool with unbounded waits, with BigQuery jobs that had no wait cap behind it (BigQuery itself never took longer than about 23 s for any page job in the window, max_ms column). The code changes below remove the unbounded waits and the redundant registry/session work; only the switch to `rpt_kpis_daily` (section 4) removes the 5 s floor.

## 2. What changed

### `lib/clients.ts`
- `getClients()`: one promise per render (React `cache`, falls through outside a render) plus Next's data cache across requests (`unstable_cache`, key `ref-clients-active-v1`, `revalidate: 60`, tag `ref-clients`). Outside Next (the check scripts) the data cache does not exist and `unstable_cache` throws an invariant; only that error falls back to a direct read, a BigQuery error still propagates. The demo client is still appended after the cache, and the caller gets a copy of the array.
- `resolveClient` reads the session through `getSession()` (shared with the layout).
- Freshness tradeoff: a client set active in `ref.clients` appears in the switcher within 60 s.
- Verified `dynamic = "force-dynamic"` does not bypass `unstable_cache` in Next 14.2.35 (it only sets `forceDynamic`; the bypass is `fetchCache === "force-no-store"`, which no page sets).

### `lib/auth.ts`, `lib/authz.ts`, `app/(app)/layout.tsx`
- New `getSession()`: per-request memo of `getServerSession(authOptions)`. Layout, `resolveClient` and `currentAccess` (all Reports gates) use it.
- `resolveAccess()` (commit `4b5d9a6`, per the orchestrator's r3-reports input: Reports ran the lookup 6 to 8 times per widget request):
  - concurrent lookups for the same email share one Postgres query (in flight);
  - a settled answer is reused across requests for `ACCESS_TTL_MS` = 15 s (owner limit 30 s). A revoked account, a changed role or client, or a newly issued temporary password takes effect within 15 s instead of on the next request;
  - never reused: a failed lookup (the outage fail-closed null is not remembered as a refusal), and any answer with `mustChangePassword: true`, so a user who has just replaced their temporary password is let through on the next request instead of being bounced back to the change page;
  - role and `mustChangePassword` checks are unchanged (same values, same callers); `forgetAccess(email?)` exported for code that changes an account.
  - Route handlers and server actions have no render scope, so `getSession()`'s per-request memo does nothing there; the in-flight sharing plus the 15 s reuse is what collapses the 6 to 8 per widget request to at most one query per user per 15 s per instance.

### `lib/bigquery.ts` (`query()` only; `queryJob()` unchanged)
- Labels `app=dashboard`, `feature=page`, `src=<first mart/ref/ops/stg table in the SQL>`.
- `timeoutMs: 60_000` (`PAGE_QUERY_WAIT_MS`): jobs.query long-polls up to 60 s, then the call fails with "The query did not complete before 60000ms" and the page shows its error state, instead of waiting for the 300 s platform kill. The job itself is not cancelled. Also removes the extra getQueryResults poll for 10 to 60 s queries (default wait was 10 s).
- Short query optimized mode (`JOB_CREATION_OPTIONAL`) via the library's documented `QUERY_PREVIEW_ENABLED` switch, set before the client is constructed unless already set. Opt out with `BQ_JOB_CREATION_OPTIONAL=0`. Helps small queries (`ref.clients`, settings-like lookups), not the 420 MB view reads.

### `lib/users/db.ts`
- `max: 5` per instance (`PG_POOL_MAX` env overrides), `connectionTimeoutMillis: 10_000`, `query_timeout` and `statement_timeout` 15 s, `keepAlive: true`.
- `pool.on("error")` listener: a dropped idle connection is logged instead of crashing the instance.
- `ensureSchema` (commit `4b5d9a6`, same pattern as r3-reports' store): a lock-free `SCHEMA_PROBE` (`to_regclass` on `app_users`, `app_users_email_key`, `client_settings`) runs first and the `CREATE ... IF NOT EXISTS` DDL only runs when something is missing. Previously every cold instance took the DDL locks before its first query, including the session lookup that gates every page (about 1 request in 12 in the last 24 h was a cold start). A probe that cannot answer falls back to the DDL.
- Every caller already handles a thrown query (auth refuses, access log skips, pages show their error state). Note: a pool wait over 10 s now refuses that request's session (role null, AccessDenied page) instead of hanging; with coalescing and 5 connections this should not happen in normal use.

### Controls race (QF2 request) `components/shell/NavigationPending.tsx`, `components/controls/{SegmentedControl,DateRangeControl,MarketFilter}.tsx`, `components/shell/{AccountMenu,MobileTopBar}.tsx`
- The provider records the newest href synchronously in `navigate` (ref, cleared when the transition commits, and on `refresh`) and exposes `baseQuery(pathname, committed)`; pure helper `baseQueryFor` exported. A pending navigation to another path is ignored.
- Compare, currency (SegmentedControl), date presets and custom ranges, market toggles and both client switchers now patch that base. MarketFilter also reads the pending market set, so two quick toggles both land.
- The Reports date control (DateRangeControl inside ReportFilterBar) is covered too, since ReportFilterBar navigates through the same provider.

### `scripts/check-loading-pulse.ts` (the `check:loading` script; the brief's `scripts/check-loading.ts` does not exist)
- 12 new assertions: `baseQueryFor` cases, the compare-then-currency race, provider records/clears the newest href, each of the 5 controls builds on `baseQuery` and no longer on `new URLSearchParams(searchParams.toString())`.

## 3. Verification
- `npx tsc --noEmit`: 0 errors. `npm run build`: exit 0.
- check:loading 260/260 (was 248), check:capabilities 329/329, check:paid 203/203 (a pre-existing Funnel stack line in the output, not from this branch), check:reports 327/327 (BigQuery steps skipped, no credentials), reports-eval 359/359, reports-authz 37/37, reports-store 286/286, reports-url 193/193, reports-widgets 662/662, reports-canvas 98/98, reports-pages 203/203.
- Second throwaway probe (deleted): a second `resolveAccess` within the TTL returns the same answer object in 0 ms, `forgetAccess` forces a new lookup, `SCHEMA_PROBE` covers all three relations. After `4b5d9a6`: tsc 0, build exit 0, and all checks above rerun with the same counts.
- Throwaway tsx probe (deleted): `unstable_cache` outside Next throws "Invariant: incrementalCache missing" (the fallback branch matches it); `sourceLabel` gives `mart_daily_kpis`, `other`, `clients`; two concurrent `resolveAccess` calls for differently cased emails return the same promise.
- No em or en dash in the diff.
- Not verified in a browser or against prod (no login, no BigQuery).

### Before / after (counted from code, not timed)
| item | before | after |
|---|---|---|
| BigQuery jobs for the client registry per navigation | 2 | 0 on a warm cache, at most 1 per 60 s per region |
| Postgres session lookups per page render | 2 (3 on /paid, /creative) | at most 1, and 0 when the same user was looked up in the last 15 s on that instance |
| Postgres lookups for a 13-widget Reports open | 13 x 6 to 8 = about 80 to 100 | 1 per user per 15 s per instance |
| User-store DDL on a cold instance | always (table and index locks) | only when a relation is missing |
| Longest a render waits on one BigQuery query | until the 300 s platform limit | 60 s |
| Longest a request waits for a Postgres connection | unbounded | 10 s, queries 15 s |
| Pool connections per instance | 3 | 5 |
Before numbers are in section 1 (JOBS). After numbers need the deploy: rerun the query in section 1 after 24 h. Expected: the `clients` src drops from about 1,700 jobs per day to about 1 per minute per region at most; view-job counts and per-job latency are unchanged until section 4.

## 4. Proposal: analytics pages from `mart.rpt_kpis_daily` (after migration 253 is deployed)

Reference numbers (QF3, QF1, measured on the `mart_qa` candidate): view read 419.5 to 443 MB, about 1,644 slot s, 3.0 s per query regardless of range; table read 23 KB (one column) to 194 KB (all 34 columns, 5 clients, 90 days), 8 slot s, about 0.5 s. Billed bytes have a 10 MB minimum per referenced table, so a table query with the FX join bills about 20 MB.

1. **Precondition.** 253 deployed, refresh active, QF3 deploy steps 1 to 7 green (24 successful hourly refreshes), QF1 commit 4 merged (Reports on the table). Then a one-week soak as the triage plan's default (decision 1 in `20_triage_plan.md`).
2. **One switch, one place.** Add to `lib/bigquery.ts` (r3-perf owned): `export const KPIS_DAILY = process.env.KPIS_SOURCE === "view" ? "mart.mart_daily_kpis" : "mart.rpt_kpis_daily"`. Default to the table after the soak; `KPIS_SOURCE=view` in Vercel env plus a redeploy of the same commit is the rollback, no code change.
3. **Swap the literal** `mart.mart_daily_kpis` for `${KPIS_DAILY}` in (owners: r3-analytics, r3-paid-creative):
   - `lib/queries/pnl.ts` `fetchPnlDays` (Snapshot, Goals)
   - `lib/queries/context.ts` `getExcludedCurrencies` (Snapshot and other pages)
   - `lib/queries/lifetime.ts` `getPayback` (Snapshot)
   - `lib/queries/unitEconomics.ts` line 90 (Unit economics)
   - `lib/queries/paidOverview.ts` `getPaidDaily`, `lib/queries/paid.ts` `getTopAds`, `getChannelTotals`, `lib/queries/paidGa4.ts` `getGa4Kpis` (Paid)
   - **Keep on the live view:** `lib/queries/health.ts` `getSourceFreshness` (it measures pipeline freshness, the table would hide a stall for an hour) and `lib/clients.ts` `detectRegistryDrift`.
   - `context.ts` `getDataThrough`: read `MAX(date)` from the same source as the figures (the table), so the stamp never claims a day the figures do not contain.
4. **Growth / YoY** read `mart.mart_monthly_kpis`, which JOBS shows reads the same 436 MB and 1,861 slot s as the daily view (so it is built on it). Either (a) compute the monthly rows in the query from `${KPIS_DAILY}` (`GROUP BY DATE_TRUNC(date, MONTH)` plus the LAG columns in SQL), or (b) add `rpt_kpis_monthly` to the same procedure (a second CTAS from the daily table, about 1 s). (a) needs no warehouse change and is preferred.
5. **Parity before the switch** (per page, in `mart_qa`, read-only on prod): for each client, run each swapped query against the view and against the table for `date < CURRENT_DATE() - 1` (inside the refreshed window), compare with EXCEPT DISTINCT both ways on `TO_JSON_STRING`, FLOAT64 `google_*` columns rounded to 6 decimals (QF3 R4 showed 0/0 on that basis). Required: 0 rows both directions for every page query.
6. **Expected per page after the switch** (bytes from the measurements above, per-query latency 3.0 s -> about 0.5 s; page totals are estimates since other marts remain):

| page | kpis reads per render | processed before (measured avg) | processed after | billed after (10 MB min per table) | slowest kpis query before (measured p50 / p95) | expected after |
|---|---|---|---|---|---|---|
| Snapshot | 4 (pnl 438 MB, excluded currencies 412, CAC 297, payback 314 on its own mart) | about 1.15 GB on the view | under 0.5 MB | about 60 MB | 4.9 s / 9.9 s | about 0.5 s per kpis read; render then bound by payback/lifetime marts (3.7 to 5.0 s p50) |
| Goals | 1 (pnl 438 MB) | 0.44 GB | under 0.2 MB | about 20 MB | 4.8 s / 8.8 s | about 1 s |
| Paid Overview | 1 (`getPaidDaily` 441 MB) + Meta mart | 0.44 GB + 0.47 GB Meta | under 0.2 MB + same Meta | about 20 MB + same | 4.7 s / 6.2 s | about 1.6 s (then bound by the Meta mart) |
| Unit economics | 2 (282 to 297 MB) | about 0.58 GB | under 0.3 MB | about 40 MB | 6.1 s / 12.0 s | about 1 s plus `mart_unit_economics` |
| Growth | 2 on `mart_monthly_kpis` (436 MB each, on the daily view) | about 0.87 GB | under 0.3 MB with option (a) | about 20 to 40 MB | 5.1 s / 12.3 s | about 1 s |

   Slot time drops from 900 to 2,300 slot s per kpis read to under 10. Over the last 24 h that is 1.46 M of the dashboard's 1.53 M slot s (95 %) and 458 of its 541 GB, and it is what removes the queueing under parallel load (peak 45 concurrent view jobs; 6 parallel Snapshot renders alone are about 24).
7. **Freshness tradeoff.** The table is refreshed hourly at :10 (CALL about 13 s), so figures can lag the view by up to about 70 min. Every range already ends yesterday, so the lag only matters for (a) yesterday's late-arriving rows (ad spend, late orders) and (b) restatements and backfills. Mitigations, in order of value:
   - Chain `CALL mart.sp_refresh_rpt_kpis()` at the end of the daily ingest workflows, so the morning numbers are fresh within minutes of landing, and keep the hourly run as the safety net.
   - Data health: one row "KPI table refreshed <time>", flagged when `MAX(refreshed_at)` is older than 2 h (read from the table, cheap).
   - A failed refresh keeps the previous table (the procedure ASSERTs before the swap), so the failure mode is "an hour older", never "empty".
8. **Rollout order.** Constant + `KPIS_SOURCE=view` (no behaviour change) -> merge the literal swaps -> parity run (step 5) -> set the env to table on Preview, QA re-times Snapshot/Growth/Unit economics and re-runs the N-06 burst (6 parallel renders) -> Production -> JOBS query A after 24 h: expect `src = rpt_kpis_daily` with p95 under 1 s and no `mart_daily_kpis` page jobs except health and drift.
9. **Rollback.** Set `KPIS_SOURCE=view` and redeploy the same commit; no code revert needed.
10. **Cost.** Refresh about 325 GB per month (about USD 2, QF3). Page and Reports reads drop by about 0.3 to 0.44 GB per kpis read: measured 457.8 GB per day of view scans in the last 24 h (QA-heavy day, so an upper bound) against about 11 GB per day for hourly refreshes.

## 5. Requests to orchestrator
1. **Rerun the JOBS query in section 1** 24 h after deploy for the after numbers.
1a. **Broken page queries in prod (30 errors / 24 h, from JOBS):** `ops.pipeline_log` has no `workflow_name` column, so the Data health pipeline-runs query in `lib/queries/health.ts` line 292 fails every time (10 jobs) -> r3-analytics. Two Google Ads queries fail with "Aggregations of aggregations" (`HAVING SUM(spend) > 0` where `spend` is also the `SUM(spend)` alias; `mart_gads_products_daily` and PMax `mart_gads_campaign_daily`, 10 jobs each): not present in the round-3 base code any more, so the prod deployment predates the fix; confirm it ships -> r3-paid-creative.
2. **r3-paid-creative:** `app/(app)/paid/layout.tsx` and `app/(app)/creative/layout.tsx` (and `creative/actions.ts`) call `getServerSession(authOptions)` directly. Switch to `import { getSession } from "@/lib/auth"; const session = await getSession();` so `/paid/*` and `/creative/*` renders do one session lookup instead of two.
3. Not owned, same change optional: `app/(app)/admin/actions.ts`, `app/api/chat/route.ts`, `app/auth/change-password/page.tsx` (server actions and route handlers gain nothing from the per-request memo, but it keeps one entry point).
4. **`lib/users/accessLog.ts` (not in any round-3 package's list):** its `ensureTable` runs `CREATE TABLE` plus 4 `CREATE INDEX IF NOT EXISTS` on every cold instance, the same lock pattern. Apply the `to_regclass` probe there too (relations `access_log`, `access_log_at_idx`, `access_log_client_idx`, `access_log_email_idx`, `access_log_refused_idx`). Also: whoever owns `app/(app)/admin/actions.ts` / `lib/users/store.ts` may call `forgetAccess(email)` after changing a user, so admin changes apply at once instead of within 15 s (optional).
5. **r3-reports:** `lib/reports/store.ts` line 137 comment says the pool has max 3; it is now 5 (`PG_POOL_MAX`). N-05 (dim widgets on `useNavigation().isPending`) is still theirs.
6. **Owner/ops:** confirm the Postgres connection limit allows 5 x the concurrent instance count (or set `PG_POOL_MAX`), and whether `DATABASE_URL` is the provider's pooled endpoint. The pg SSL warning in the logs comes from `sslmode=require` in the connection string; harmless today, worth setting explicitly before pg 9.
7. Sidebar and ProductRail links still carry the committed query string while a control change is in flight (a link clicked in that window drops the pending change). Minor; can use `pendingHref` if wanted (r3-perf can do it in a follow-up).
8. Proposal section 4 needs owner OK after the 253 deploy and the one-week soak.
