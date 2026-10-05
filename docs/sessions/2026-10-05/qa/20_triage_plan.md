# Implementation plan: QA round 1 triage for the One Eighty dashboard

Base: `main` @ `92ac505` (prod, includes hf1). B-01 and B-02 are fixed and deployed (hf1), so they are out of scope.

Before planning I checked the findings against the code. I also ran read-only BigQuery queries (mostly dry runs, plus a few small reads):
- `mart.mart_daily_kpis` is a VIEW. A full scan is 449.8 MB; a 90-day filtered read is still 415.7 MB, so date pruning does not happen (C-03 confirmed).
- `mart_meta_campaign_perf` reads 22 MB and `mart_meta_ad_perf` reads 96 MB for 90 days with only the columns they need. The Meta marts already prune by column and are not the bottleneck.
- Dobias' first Meta spend is **2026-04-20**, not June as QA thought. Every day since 2023 has revenue, and the new/returning split is complete for every quarter of 2025 and 2026 (this matters for A-04 and A-05).
- Dobias September 2026 has no CAD rows, so the A-15 mismatch is not a currency effect.
- `ops.feed_freshness`: `shopify_products` is stale for Dobias (3,323 h) and Venev (1,495 h) (A-12 confirmed).
- Meta ad mart, Sep 2026: `video_play_actions` is about 3x `video_views`. Hook rate with plays as the numerator gives 52 / 81 / 34 / 68 %; with `video_views` it gives 17 / 26 / 12 / 23 %. The ingest maps `video_views` from `actions[video_view]`, and `video_play_actions` is Meta's "video starts" field, even though comments in `223_mart_creative.sql` and `lib/creative/model.ts` call it "3s+". So the hook-rate numerator is most likely wrong everywhere (B-09, C suspicious list). See Decision 2.

---

## 1. Verified findings

Severity is re-rated. "Code" means I confirmed it by reading the source; "MCP" means I confirmed it by a BigQuery query; "per QA" means I did not re-check the line.

### Analytics (qa-a)

| id | sev | real? | root cause | fix summary |
|---|---|---|---|---|
| A-01 | major | yes (code) | `app/(app)/orders/page.tsx:124-126`: grid class built from a template literal, so Tailwind never generates it | Static map `GRID_BY_COLS[6|7|8]` with literal class strings |
| A-02 | major | yes (code) | `components/shell/AccountMenu.tsx:125-133`: the optimistic label flips to the new client at once; `PendingRegion` (`NavigationPending.tsx:131-137`) only pulses the old body | Client change becomes a distinct pending kind: the body is hidden behind a skeleton until commit, and the chip shows the new name with a pulse |
| A-03 | major | yes (code) | `lib/goals/progress.ts:106-140` `rollUp`: actuals summed over every month, targets only over months that have one | Attainment only over targeted months, plus "Target covers N of M months" |
| A-04 | major | yes (MCP: Dobias Meta from 2026-04-20) | `lib/queries/pnl.ts:298-309` `sum()` treats NULL spend days as 0 once any day has spend; `aggregate` (316-374) divides by partial spend | Leading spend gap rule (Decision 3): MER, aMER, CAC and Ad spend share become "n/a, Missing days"; one Notice line "Ad spend from Apr 20, 2026." |
| A-05 | minor | partial | Data is complete (MCP) and `RevenueMix` gets every row, so the "Jun to Oct only" axis could not be reproduced from code. The visible problem is the same as A-07: index-based x positions over about 1,600 points | Folded into the A-07 fix (date-based axis, weekly or monthly buckets on long ranges) |
| A-06 | minor | yes (code) | `components/dashboard/RevenueMix.tsx:164-185`: shading and caption are always drawn | Add `partialLast` prop from `includesToday(range)` (`lib/period.ts:~207`) |
| A-07 | minor | yes (code) | `RevenueMix.tsx:50-81`: drops days without revenue, x by index | Fill the date range (a shop NULL is a zero day), position by date, bucket weekly over 120 days and monthly over 730 |
| A-08 | minor | yes (code) | `components/ui/DataTable.tsx:90-98` compares nulls last; `:176` negates the whole comparison for desc | Apply the null rule after the direction flip |
| A-09 | minor | yes (code) | `components/dashboard/BottomLine.tsx:94` prints "CAC unknown" when `recovery30` is null, whatever the cause | Say "No cost data" when LTGP is null; "CAC unknown" only when CAC is null |
| A-10 | minor | yes (intentional, unlabelled) | `BottomLine.tsx:10` and the snapshot page `discounts` (native only) | Label the lifetime/payback block "in USD" (native code); discounts in a converted view say "USD only" instead of "n/a" |
| A-11 | minor | yes (per QA) | Growth: the average uses every MoM delta, "Cumulative" only the last transition | Same month set for both; partial month MoM shown as "n/a" |
| A-12 | minor | yes (MCP feed_freshness) | Ops: Shopify products feed stopped (Dobias since May, Venev since Aug). The UI shows verdicts as current | Decision 5; UI: suppress Buying plan actions when the snapshot is more than 30 days old, plus one Notice line |
| A-13 | minor | yes (code) | `lib/inventory/model.ts:224` uses `n()` for money | Use the money formatter; cap the cover text at ">5 years" |
| A-14 | minor | yes (code: `products/page.tsx:72` `slice(0,40)`) | Silent 40-row cap; missing COGS shown as 100% margin; "N/A" uppercase LINE column | "40 of 49" caption; margin "No cost data" when line COGS is null; hide LINE when no product has a line. Non-product lines (insurance, payment) stay (data, not code) |
| A-15 | polish | real, definitional | Cohort size (first order by customer across history) vs the Shopify `is_returning` flag. Not currency (MCP) | Defer: investigate in round 2 with one SQL comparison; no code now |
| A-16 | polish | yes | Four "repeat" labels without their windows | Add the window to each label ("Repeat rate, lifetime", "90-day") |
| A-17 | minor | yes (per QA) | `app/(app)/growth/loading.tsx` shape (4 KPI tiles) does not match the page; cold load time is fixed by speed work, not here | Skeleton = chart plus table |
| A-18 | polish | yes (data) | Klaviyo flow names contain an em dash | Normalise U+2014 to a hyphen at render in the Email tables |
| A-19 | polish | yes (code: `components/ui/InfoTip.tsx` onClick toggle) | Clipping and click toggling closed | Click opens (never closes when open via hover); flip the side near the edges |
| A-20 | polish | yes | Mixed U+2212 and hyphen | One rule in `lib/format.ts`: U+2212 for every negative money value; "-0" never shown |
| A-21 | polish | yes | Date label updates before the data | Fixed by QF4 (label and chip pulse together until commit) |
| A-22 | polish | yes | "n/a" for zero discounts | "none" when the platform reports discounts and the value is 0 |
| A-23 | polish | yes | Date picker on range-independent pages | Muted "Not affected by date range" caption (one line) |
| A-24 | polish | yes (mixed) | Copy items (Ecomail flows, Venev repeat timing, Data health "Pipeline log not readable" at `app/(app)/health/page.tsx:219`, products feed not listed) | Copy fixes; Data health lists `shopify_products` freshness. Volume-aware STALE thresholds deferred |

### Paid and Creative (qa-b)

| id | sev | real? | root cause | fix summary |
|---|---|---|---|---|
| B-01, B-02 | n/a | fixed (hf1) | | Re-test only |
| B-03 | major | yes (code) | `lib/queries/creative.ts:270-283`: `campaignName` comes only from `mart_creative_adset_perf`, which returns 0 rows (hf1), so it is always null; the filter in `components/creative/CreativeGrid.tsx:113-117` matches nothing | Link with `focus=campaignId` (populated from ad totals); also fill names from `mart.mart_creative_asset` |
| B-04 | major | yes (code) | `NavigationPending.tsx` `navigate` passes `scroll: undefined`, so Next scrolls to top; AppLink links in Paid tables do the same | AppLink and `navigate`: same pathname with only a query change means `scroll:false` by default |
| B-05 | minor | yes (code: `components/creative/AdDetail.tsx:1235`) | Copy means "no data", not "not loaded"; modal height jumps | "No age or placement data for this period."; fixed `min-height` on the modal body |
| B-06 | minor | yes (code) | `lib/creative/model.ts:196` with `n0()` coercion: `outbound_clicks` is 100% NULL (pa1), so 0/impr = 0.0% with a red dot (`AdDetail.tsx:1078-1086`) | Keep NULL through `num()`; hide the row when null |
| B-07 | minor | yes (intentional shrinkage, `lib/creative/model.ts`) | Unlabelled adjusted ROAS | Label "ROAS (adj.)" with a hover giving the raw value; same `x` formatter as Paid |
| B-08 | minor | yes (hf1 note) | `lib/queries/paidMeta.ts:205` fallback selects `CAST(NULL AS STRING) AS adset_name` | Left join names from `mart.mart_creative_asset` (has `adset_name`) |
| B-09 | major (re-rated) | yes (MCP) | Hook numerator `video_play_actions` (video starts, about 3x the 3-second views); funnel steps above 100% | Decision 2 numerator; funnel step above 100% shows "n/a" |
| B-10 | minor | yes (per QA, by design) | Meta tab in ad-account currency, unlabelled | Subtitle "Ad account currency: CZK" when it differs from the client currency |
| B-11 | minor | yes | Total row mixes bases | Rename "Shop total"; ROAS column header there reads "MER" |
| B-12 | minor | data | GA4 vs shop revenue definitions | Defer (GA4 data reconciliation, not a UI bug) |
| B-13 | minor | yes (code: `creative.ts:607-625`, `creative/breakdown/page.tsx:193`) | All-time concept coverage shown as period coverage | Compute coverage from the period rows on the page (tagged spend / total) |
| B-14 | minor | yes (code: `components/creative/LaunchCadence.tsx:42-68`) | Gridlines at maxY/2 with rounding | Integer ticks; empty-state line |
| B-15 | minor | yes | All-clicks CTR labelled "CTR" | Grid label "CTR (all)" |
| B-16 | polish | yes | Creative filters not in the URL | Defer |
| B-17 | minor | yes (data) | Persona strings with an em dash and internal code suffix | Display helper: strip the `_CODE` suffix, U+2014 to hyphen |
| B-18 | minor | yes | Order and checkout token URLs listed as landing pages | Filter `/orders/`, `/checkouts/`, `/cart` in the landing-pages query; hide the Google share column without Google |
| B-19 | polish | yes | `app/(app)/paid/loading.tsx` skeleton narrower than the page | Match frame and tile count |
| B-20 | polish | yes | Lock emoji, stray "Creatives" label, duplicated diagnosis text | Icon set, remove the stray label, dedupe the text |

### Reports (qa-c)

| id | sev | real? | root cause | fix summary |
|---|---|---|---|---|
| C-01 | major | yes (code) | Snapshot subtracts the Postgres `client_settings.fulfilment_per_order` and `other_cm1_per_order` × orders (`lib/queries/pnl.ts:229-283`). Reports uses only the mart columns: `lib/reports/registry/metrics.ts:104-109` (CM3_TERMS) and `components.ts:126`. The mart `fulfillment_cost` is 0 for Shopify and Shoptet and only filled for Woo. Dobias is the only client with a stated rate | Owner decision applied: per-client stated costs in Reports, exactly as Snapshot (design in QF1) |
| C-02 | major | yes (code) | `app/globals.css:338-339` `.product-enter { animation ... both }` leaves a transform, so `fixed` toasts in `components/reports/Toasts.tsx:71` are positioned against the page | `animation-fill-mode: backwards`. AdDetail's existing workaround stays |
| C-03 | major | yes (MCP: 416 MB per 90-day widget, view) | View does not prune; 13 widgets in waves of 6 (`useWidgetData.ts:110`, limit 6); stale widgets pulse at 0.82 opacity, which reads as current | Materialise (QF3), superset compile per mart so widgets share one cached query (QF1), stronger stale dim (QF2) |
| C-04 | minor | yes (code: `ReportParts.tsx:64-91`) | Old result lacks the newly added metric, so its cells read "n/a No data" | While loading, a metric missing from the result renders a skeleton cell |
| C-05 | minor | yes (code: `ReportFilterBar.tsx:67-80`) | `patchFilterParams(searchParams)` reads a stale snapshot before commit | Patch on top of `pendingHref ?? current` from `useNavigation` |
| C-06 | minor | unverified | Possibly Popover hydration | Investigate in the harness; fix only if reproduced |
| C-07 | minor | partial | `ReportClient.tsx:584` `touchOpened` server action answers 503 (per QA); errors swallowed | Read Vercel runtime logs (Vercel MCP) for the action, fix the cause, keep the swallow |
| C-08 | minor | yes (code: `ShareMenu.tsx:32`) | Copies `window.location.href` | Copy `/reports/<id>`; "Copy with current filters" as a second item |
| C-09 | minor | yes (per QA) | Leading partial ISO week not flagged | Shade and flag the leading partial bucket too |
| C-10 | minor | yes (per QA) | Coverage marker clipped in `canvas/MobileStack.tsx` | Wrap the marker below the value in the stack tier |
| C-11 | minor | yes (per QA) | `components/dashboard/MetricCard.tsx` and `KpiTile.tsx`: delta line overflows at 390 px | Drop "vs prev period" text below the sm breakpoint (tooltip keeps it) |
| C-12 | minor | yes (per QA) | `components/shell/MobileTopBar.tsx`: Sections row overflows; two menus open at once | Wrap Sections; opening one menu closes the other; Escape closes both |
| C-13 | minor | yes (per QA) | `components/controls/DateRangeControl.tsx` mobile popover about 1,100 px tall | Bottom sheet below sm with sticky Cancel/Apply; one month on mobile |
| C-14 | polish | yes | Escape handling in the inspector | One Escape closes the dropdown and returns focus to the canvas |
| C-15 | polish | yes | Axis and label clipping in report charts | Chart margins from measured label width; truncate category labels with a hover |
| C-16 | polish | yes | Tooltip "before" | "Previous period" |
| C-17 | polish | yes (consistent with the gap rule) | Compare series partial | Legend marker "Previous period incomplete" via the existing NotesMark |
| C-18 | polish | yes | Sparkline drawn behind an n/a value | Hide the sparkline when the value is not ok |
| C-19 | polish | yes | Shortcut sheet alignment; account chip over the inspector | Centre the sheet; inspector top offset `--header-h` |
| C-20 | polish | yes (list) | Rename select, sidebar staleness, KPI multi-metric, duplicate title, empty state, rounding | KPI picker limited to 1 metric; table counts unabbreviated below 100k; the rest as listed |

---

## 2. Work packages

Eight packages. Worktrees under `oe-dash-wt/<branch>` from `main` @ `92ac505` (this overrides `cleanup/2026-10` in `00_agent_rules.md`). All other agent rules apply: no em dash, own files only, BigQuery writes only in `mart_qa` with the package prefix, report in `reports/<id>.md`. Nobody edits `package.json`. If a check script needs a change, it is owned below.

### QF1: Reports semantic layer (CM3 parity, hook-rate unification, shared queries, table switch)
- Model: **opus**. Branch `qf1-reports-semantic`.
- Findings: C-01, C-03 (query sharing and registry switch), B-09 (Reports side).
- Files owned: `lib/reports/registry/components.ts`, `registry/metrics.ts`, `registry/types.ts`, `registry/ids.ts`, `lib/reports/compile.ts`, `lib/reports/evaluate.ts`, `lib/reports/contracts.ts`, `lib/reports/types.ts`, new `lib/reports/costRates.ts`, `app/api/reports/query/route.ts`, `lib/reports/README.md`, `METRICS.md`, `scripts/check-reports.ts`, `scripts/check-reports-eval.ts`.
- Design:
  1. **CM3 parity.** New money component `kpis.orders_fx` (column `orders`, `money: true`, new field `perClientRate: "fulfilment" | "otherCm1"`, `nullMeans: "zero"`). Relax the "column override needs a row filter" check for this field only. The compiler emits `__nat` (orders in native-currency rows) and `__disp` (Σ orders × monthly FX). That makes rate × `orders_fx` identical to Snapshot's `m("(k.orders * @rate)")`, including the native-currency filter.
     - Two registry components share the column: `kpis.fulfilment_stated` and `kpis.other_cm1_stated`.
     - `readComponent` in `evaluate.ts` multiplies by `client.costRates?.[rate] ?? 0`. A null rate counts as 0, exactly like Snapshot's `drop2`.
     - `CM3_TERMS` adds both with sign -1. `cm1_pct` adds `other_cm1_stated`.
     - Rates are loaded per request in `route.ts` with `listClientSettings()` (Postgres, server-only) and merged into `ReportClient` as an additive optional `costRates`. They never enter SQL, so cached rows stay valid and a Settings edit shows up immediately.
     - Note for the report: a Woo client with a stated rate would have both the mart Woo fulfilment and the stated rate subtracted, on both pages. That is parity, but flag it.
  2. **Hook rate per ad over the whole period.**
     - New mart option `filterScope: { key: "ad_id" }` for `meta_ad.video_impressions` (and the hold denominator).
     - The compiler adds a pre-CTE `meta_ad_video` with `(client_id, period, ad_id, LOGICAL_OR(video_play_actions > 0))`. It carries the same date predicate (extend `assertDatePredicates`) and the same period tagging. The meta_ad CTE joins it and filters on the flag instead of the row-level `> 0`.
     - Numerator per Decision 2: `meta_ad.video_views` if yes (add the component), else keep `video_play_actions`.
  3. **Shared queries.** For the `kpis` mart only, compile selects every phase-1 `kpis.*` component instead of the widget's subset. Widgets with the same grain, clients, period and currency then produce byte-identical SQL, so the same key is shared through the run.ts in-flight dedupe and `unstable_cache`. Evaluation is unchanged (it reads only the metric's components). A batch endpoint is not built now. It would add a new route (security surface: gate, zod, audit) and rework of the hook's abort and concurrency handling. Revisit only if p95 settle time stays above 5 s after QF3.
  4. **Registry switch** as a separate last commit: `MARTS.kpis.table = "mart.rpt_kpis_daily"`. Merge only after migration 253 is live (orchestrator holds this commit).
  5. `SEMANTIC_VERSION` 5 to 6, once.
- Acceptance:
  - `tsc` and `build` clean; check:reports, -eval, -widgets, -pages, capabilities all pass.
  - New eval assertions: a stated rate multiplies only that client; a null rate equals mart CM3; a CZK display of a USD client converts per month; a superset-compiled widget evaluates identically to a subset-compiled one; ad-level video classification excludes zero-play ads but keeps zero-play days of video ads.
  - Live without login, following the `bugfix_reports_gaps` harness pattern: compile → inline params → MCP `execute_sql_readonly` → `normaliseRows` + `evaluateWidget` with injected rates.
    1. Dobias, 90d ending 2026-10-03, CZK, CM3 equals the Snapshot-equivalent MCP query `SUM(cm3 fx) - SUM(orders × rate fx)` to the unit. The owner supplies Dobias' Settings rates, or a throwaway server script reads `client_settings` through `lib/users/settings.ts` without printing anything but the two numbers. The QA reference is CZK 7,664,008 (58.8%).
    2. Manami and Ethia unchanged.
    3. Hook rate Sep 2026 per client equals `getMetaVideoRates` SQL output summed over campaigns (Venev 55.25% with the current numerator).
  - Dry-run bytes per Portfolio template widget recorded before and after the switch.
- Prod BigQuery: none (read-only MCP). Order: develop now; merge commits 1 to 3 any time; commit 4 after QF3 is deployed.

### QF2: Reports UI fixes
- Model: **sonnet**. Branch `qf2-reports-ui`.
- Findings: C-02, C-03 (stale state), C-04, C-05, C-06 (investigate), C-07, C-08, C-09, C-10, C-14 to C-20.
- Files owned: `app/globals.css`, `components/reports/**` (ReportClient, ReportParts, ReportFilterBar, ShareMenu, Toasts, Popover, ShortcutSheet, useWidgetData, widgets/*, canvas/*, pickers/*), `app/(app)/reports/**` except `error.tsx` and `loading.tsx`, `lib/reports/store.ts` (touchOpened only), `scripts/check-reports-widgets.ts`, `scripts/check-reports-canvas.ts`, `scripts/check-reports-pages.ts`.
- Specs:
  - `.product-enter` fill mode `backwards`.
  - Stale widgets (forKey mismatch with a result present) get a deeper dim: new tokens `--pulse-stale-hi .55` and `--pulse-stale-lo .35`, a variant of the same keyframes. No new animation.
  - Pending metric cells render `Skeleton`.
  - Filter patches merge onto `pendingHref`.
  - Copy link without `edit` or overrides.
  - Leading partial week flagged.
  - KPI picker limited to 1 metric.
  - Copy: "Previous period".
  - touchOpened 503: read Vercel runtime logs (Vercel MCP `get_runtime_logs`, path `/reports/`), fix the root cause.
- Acceptance: checks pass. Throwaway harness route plus probe, as in fx2 and fx3, deleted afterwards:
  - toast `getBoundingClientRect().bottom <= innerHeight` on a 2,500 px page;
  - two filter clicks within 300 ms both land in the URL;
  - the stale widget computed opacity is ≤ .55 while another widget has already updated;
  - added-metric cells show `oe-skeleton`.
- No BigQuery. Merge any time.

### QF3: Materialise the KPI mart for Reports
- Model: **opus**. Branch `qf3-rpt-kpis`.
- Findings: C-03 (server side).
- Files owned: `infra/bigquery/253_rpt_kpis_daily.sql`, `infra/bigquery/qa/253_regression.sql`, `infra/bigquery/live/mart.rpt_kpis_daily.sql`, `infra/bigquery/live/mart.sp_refresh_rpt_kpis.sql`, `infra/bigquery/live/README.md`, `infra/n8n/wf_rpt_kpis_refresh.json`, `PROJECT_LOG.md`.
- Design (cheapest robust option):
  - Table `mart.rpt_kpis_daily`: the same 34 columns plus `refreshed_at TIMESTAMP`, `PARTITION BY date CLUSTER BY client_id`. That is about 1,830 partitions, under the 4,000 limit.
  - Procedure `mart.sp_refresh_rpt_kpis()`:
    1. `CREATE OR REPLACE TABLE mart.rpt_kpis_daily__next ... AS SELECT *, CURRENT_TIMESTAMP() FROM mart.mart_daily_kpis`
    2. `ASSERT` row count > 0.9 × the current table's and `MAX(date) >= CURRENT_DATE()-2`
    3. `CREATE OR REPLACE TABLE mart.rpt_kpis_daily COPY mart.rpt_kpis_daily__next` (atomic swap, copy is free). If the view breaks, the old table stays.
  - Cost: about 450 MB per run, hourly about 325 GB per month, roughly USD 2 per month at on-demand prices, likely within the free TiB.
  - Scheduler (recommended): an n8n workflow "BQ: refresh rpt_kpis_daily", Schedule trigger hourly at :10, a BigQuery node running `CALL mart.sp_refresh_rpt_kpis()` with the existing BigQuery credential. The ClickUp workflow already CALLs a procedure the same way. Created via the n8n MCP (`create_workflow_from_code`), left **inactive** until owner OK, JSON exported to `infra/n8n/`.
  - Why n8n over a scheduled query: an agent can create and version it after owner OK. A scheduled query needs the owner in the console. Fallback: paste the CALL as a scheduled query (text included in the migration header).
- Meta marts: **do not materialise**. They already prune (22 MB and 96 MB per 90 days).
- Acceptance:
  - Candidate `mart_qa.qf3_rpt_kpis_daily` and `mart_qa.qf3_sp_refresh` (writing into `mart_qa`). Regression `EXCEPT DISTINCT` both directions on `TO_JSON_STRING` (minus `refreshed_at`) vs the view, `date < CURRENT_DATE()`: 0 rows for all clients.
  - Dry-run of a compiled 90-day, 5-client widget against the candidate below 25 MB (versus 416 MB). Job duration from `INFORMATION_SCHEMA.JOBS` recorded.
  - The n8n test execution (after deploy) succeeds and `refreshed_at` advances. Confirm the n8n credential's service account can write to `mart` before activating.
- Prod BigQuery: **yes, owner OK needed** (Decision 1). Order:
  1. 253 deploy (table, procedure, first CALL).
  2. Activate the n8n workflow.
  3. Merge QF1 commit 4.
  4. Re-run QF1's harness against prod.

### QF4: Navigation state (client switch, pending labels, scroll, mobile shell)
- Model: **opus**. Branch `qf4-nav-state`.
- Findings: A-02, A-21, B-04, C-12, C-13.
- Files owned: `components/shell/NavigationPending.tsx`, `components/shell/AccountMenu.tsx`, `components/shell/MobileTopBar.tsx`, `components/ui/AppLink.tsx`, `components/controls/DateRangeControl.tsx`, `components/controls/SegmentedControl.tsx`, `components/controls/MarketFilter.tsx`, `scripts/check-loading.ts`.
- Specs:
  - `navigate(href, { kind: "client" })` sets `data-pending="client"` on `PendingRegion`. `main` is visually replaced by a skeleton overlay built from static Tailwind classes in `NavigationPending.tsx` (no `globals.css` edit). The chip shows the new client and pulses. No old figure is ever visible under the new name.
  - Range and compare labels show the new value with a pulse until commit (the label already pulses; the chip gets the same pending text).
  - `navigate` and AppLink default to `scroll:false` when only the search string changes on the same pathname.
  - Mobile menus are mutually exclusive.
  - Date popover becomes a bottom sheet below the sm breakpoint.
- Acceptance: check:loading (extended: client kind hides `main`, same-path query links do not scroll). Harness route with a 3 s server delay: after a client click, within 50 ms no text node from the old client is visible (geometry and visibility probe); scrollY is unchanged after a query-only AppLink click; at 390 px both menus never open together.
- No BigQuery. Merge any time.

### QF5: Snapshot and Goals data honesty
- Model: **sonnet** (specs are exact). Branch `qf5-snapshot-goals`.
- Findings: A-03, A-04, A-05/A-07, A-06, A-09, A-10, A-11, A-17, Goals count formatting.
- Files owned: `lib/queries/pnl.ts`, `app/(app)/snapshot/page.tsx`, `components/dashboard/RevenueMix.tsx`, `components/dashboard/BottomLine.tsx`, `components/dashboard/AcquisitionEconomics.tsx`, `lib/goals/progress.ts`, `app/(app)/goals/**`, `components/goals/**`, `app/(app)/growth/**`, `components/growth/**`.
- Specs:
  - **A-04**: `PnlTotals.spendFrom` is the first date in the range with non-null `paidSpend`. `leadingSpendGap` is true when the client has meta or googleAds and `range.from < spendFrom` (or no spend at all while the client is paid-capable). Then `mer`, `amer`, `cac` and ad spend share are null with reason "Missing days" (the Reports wording), and the paid spend delta is null when the comparison has the gap. One `Notice`: "Ad spend from Apr 20, 2026." Interior NULL days are not touched (Decision 3).
  - **A-03**: rollUp per metric over targeted months only, plus `coverage {targeted, of}`. One muted line "Target covers 2 of 12 months"; counts shown unabbreviated.
  - **RevenueMix**: date-positioned, zero-filled, bucketed; `partialLast` only when `includesToday`.
- Acceptance:
  - `tsc` and `build`; a scratch tsx assertion script (not committed) for `rollUp` fixtures (Manami 2026: 1 targeted month gives attainment on that month only) and `aggregate` fixtures (leading NULL days make MER null; all spend days give MER unchanged).
  - MCP: confirm Dobias `spendFrom` = 2026-04-20 for preset all.
  - Harness render of RevenueMix with Venev-like sparse data (ticks evenly spaced by date).
- No BigQuery writes. Merge any time.

### QF6: Analytics tables and formatting
- Model: **sonnet**. Branch `qf6-analytics-tables`.
- Findings: A-01, A-08, A-12 (UI), A-13, A-14, A-16, A-18, A-19, A-20, A-22, A-23, A-24, C-11.
- Files owned: `app/(app)/orders/**`, `app/(app)/products/**`, `app/(app)/inventory/**`, `lib/inventory/model.ts`, `components/inventory/**`, `components/ui/DataTable.tsx`, `components/ui/InfoTip.tsx`, `lib/format.ts`, `components/dashboard/MetricCard.tsx`, `components/dashboard/KpiTile.tsx`, `app/(app)/email/**`, `components/email/**`, `app/(app)/health/**`, `lib/queries/health.ts`, `app/(app)/customers/**`, `app/(app)/repurchase/**`, `app/(app)/cohorts/**`.
- Acceptance:
  - grep gate: no template-literal Tailwind classes (`grid-cols-\[.*\$\{`) anywhere in `app` or `components`.
  - Scratch assertion for DataTable null ordering in both directions.
  - Money formatting check on the inventory evidence strings.
  - MetricCard at 390 px in the harness: no element wider than its card.
  - Health lists `shopify_products` as stale (MCP confirms the source rows).
- No BigQuery. Merge any time.

### QF7: Paid fixes
- Model: **sonnet**. Branch `qf7-paid`.
- Findings: B-04 (Paid call sites only if needed after QF4), B-08, B-09 (Paid tab numerator and funnel), B-10, B-11, B-18, B-19, B-20 (Paid part).
- Files owned: `lib/queries/paidMeta.ts`, `lib/queries/paidGa4.ts`, `lib/queries/paidOverview.ts`, `lib/paid/**`, `components/paid/**`, `app/(app)/paid/**` except `error.tsx`, `scripts/check-paid.ts`.
- Acceptance:
  - check:paid.
  - MCP runs of the changed SQL: adset names non-null for Dobias and Manami campaigns from the hf1 list; landing pages without `/orders/` and `/checkouts/`; hook per campaign with the Decision 2 numerator for Sep 2026 equals QF1's Reports value per client.
  - Funnel steps above 100% render "n/a" (fixture).
- No BigQuery writes.

### QF8: Creative fixes
- Model: **sonnet**. Branch `qf8-creative`.
- Findings: B-03, B-05, B-06, B-07, B-09 (Creative hook), B-13, B-14, B-15, B-17, B-20 (Creative part).
- Files owned: `lib/queries/creative.ts`, `lib/creative/**`, `components/creative/**`, `app/(app)/creative/**` except `error.tsx`, `scripts/check-creative.ts`.
- Note: the Paid side builds the deep link in `lib/paid/links.ts` (owned by QF7). QF8 accepts `focus=campaignId` on the Creative side. QF7 switches the link and merges after QF8, or both land in one release.
- Acceptance:
  - check:creative.
  - MCP: Dobias campaign "CA I PACKS I CBO I 21JULY-26 I OE" id resolves 14 ads via `campaign_id` in the creative totals.
  - Harness: AdDetail with null outbound shows no Outbound row; LaunchCadence ticks are integers.
- No BigQuery writes.

### Merge order
QF2, QF4, QF5, QF6 any time. Then QF8, then QF7. QF1 commits 1 to 3 any time. QF3 deploy after owner OK, then QF1 commit 4. Deploy the dashboard once after all are merged; the `SEMANTIC_VERSION` bump clears Reports caches.

---

## 3. Owner decisions still needed

1. **Prod BigQuery for QF3** (create `mart.rpt_kpis_daily` and `mart.sp_refresh_rpt_kpis`, plus an hourly n8n workflow calling it; about USD 2 per month). Default: **approve; n8n hourly at :10, 24/7**. Reports may lag the view by up to 1 h, the same order as the existing 15-minute cache. Also say whether Snapshot, Goals and Paid should read the table later (default: a follow-up after one stable week, not in this round).
2. **Hook-rate numerator.** The warehouse uses `video_play_actions` (Meta "video starts", about 3x the 3-second plays), which explains 50 to 98% hook rates. Default: **switch Paid, Creative and Reports to `video_views` (actions[video_view], 3-second plays)**, with video ads classified per ad over the whole period. Owner spot-checks one Dobias ad-day in Ads Manager ("3-second video plays") against `mart_meta_ad_perf.video_views` first.
3. **Snapshot spend-gap rule.** Default: **leading gap only.** When the range starts before the first ad-spend day, MER, aMER, CAC and Ad spend share show "n/a, Missing days", plus the line "Ad spend from Apr 20, 2026." Alternative: the full Reports rule (any NULL spend day voids the ratios), which would also blank RawBark September because of 2026-09-17.
4. **Goals with partial targets.** Default: **attainment over targeted months only, with "Target covers N of M months"**. Alternative: show n/a unless every month has a target.
5. **Stale Shopify products feed** (Dobias since 2026-05-19, Venev since 2026-08-03). Default: the owner restarts or re-runs the products ingest; meanwhile the UI hides Buying plan actions when the snapshot is more than 30 days old and shows one Notice line.

---

## 4. Re-test plan (QA round 2, after one combined deploy)

- **qa-a (Analytics, desktop)**
  - A-01: Orders grid for all 5 clients.
  - A-02: client switch, screenshots at 0, 300 and 1,000 ms: no old figures under the new name.
  - A-03: Goals Manami, Dobias, Ethia.
  - A-04: Dobias preset all, 12m, YTD, 90d: ratios n/a plus the notice; September unchanged.
  - A-06 and A-07: Venev September.
  - A-08 to A-14, A-16 to A-24.
  - Repeat the cross-page consistency table.
- **qa-b (Paid and Creative)**
  - B-01 regression on /paid/google for Manami and RawBark (campaign, product groups, term modes).
  - B-03: campaign deep link shows that campaign's creatives.
  - B-04: toggles keep scroll.
  - B-05 to B-08, B-13 to B-15, B-17, B-18, B-20.
  - Hook rate on the Meta tab equals Reports and Creative for the same client and period.
- **qa-c (Reports, desktop and 390 px iframe)**
  - C-01: Dobias CM3 and CM3 % in Reports equal Snapshot (90d, CZK; also USD and EUR).
  - C-03: 13-widget report. Target: cold settle under 6 s, filter change under 4 s, no mixed-period state at full opacity.
  - C-02, C-04, C-05, C-07 (network: no 503), C-08 to C-20.
  - Mobile C-10 to C-13.
  - Create only "QA test" reports and delete them.
- **qa-data (new, MCP only, no browser)**
  - `INFORMATION_SCHEMA.JOBS` with label `feature=reports` before vs after: median `total_bytes_processed` per job (target under 25 MB) and median duration.
  - Count of distinct job keys per report open (shows the shared-query effect).
  - `rpt_kpis_daily.refreshed_at` advancing hourly over 24 h; the n8n execution history is clean.
  - CM3 parity SQL for every client with a stated rate.
  - Hook rate per client: Reports, Paid and Creative SQL agree.
  - Feed freshness for `shopify_products` after the owner's fix.

### Critical files for implementation
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/reports/compile.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/reports/evaluate.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/reports/registry/components.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/queries/pnl.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/components/shell/NavigationPending.tsx