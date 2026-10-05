# One Eighty dashboard: "clean slate" sprint plan (week of 2026-10-05)

Scope: get Ethia and RawBark fully onboarded and remove the UI annoyances (too much text, dev notes, dashes, "No data", misleading zeros). Out of scope: the Paid section redesign and the cross-client Reporting Suite. Paid only gets the minimum fix below, and `components/dashboard/ChannelSplit.tsx` stays untouched for the redesign agent.

Evidence keys: **01** = docs digest, **02** = code map, **03** = onboarding audit, **04** = UI copy inventory (all in the scratchpad). **live** = read-only `INFORMATION_SCHEMA` queries I ran today against `oneeighty-warehouse`. Paths are relative to `one-eighty-dashboard-repo/` unless they say otherwise.

## 0. What I checked live today (changes how the plan is built)

1. **The live warehouse and the repo DDL have drifted apart.** Eight live views read Woo data: `stg.stg_woo_orders`, `stg.stg_woo_order_items`, `mart.mart_daily_kpis`, `mart_orders`, `mart_product_perf`, `mart_sku_perf`, `mart_unit_economics` and `mart_cm3_monthly`. A search for "woo" in `infra/bigquery/*.sql` finds nothing. These are also missing from the repo: `mart_customer_daily`, `mart_customer_market_daily`, `mart_profit_share_monthly`, the `ops.v_*` views and the `ref.feed_sla`, `ref.contracts` and `ref.product_costs` tables. Any view change has to start from the live definition, not from the repo.
2. **Woo revenue ignores fee lines (confirmed in the live SQL).** `stg_woo_orders.net_revenue = (subtotal_ex_tax + shipping - refunds*net_ratio) * fx_rate`, so `fees_total` (the negative loyalty-discount lines) is left out.
3. **RawBark's missing cost data shows up as zero.** The Woo branch of `mart_daily_kpis` has `COALESCE(c.cogs, 0) AS cogs`, so RawBark gets COGS = 0 and CM1 to CM3 come out as revenue. This breaks the locked rule that no data is not zero.
4. **No customer mart reads Woo.** That covers `mart_customer_*` and `mart_order_gaps`. `mart_customer_daily` and `_market_daily` read Shopify only.
5. **Every live view uses a 60-month window** (`mart_order_gaps` uses 24). The UI copy that says "36-month window" is wrong in 9 places.
6. **`ref.feed_sla` has a `flag_column` column**, so Woo rows can point at `has_woocommerce`. `ref.product_costs` is keyed on `sku` only, but 44% of RawBark lines have a blank SKU.
7. **The frontend does not know WooCommerce exists.** `ClientCapabilities` in `dashboard/lib/clients.ts:35-44` has no `woocommerce`, and neither SELECT reads `has_woocommerce`. The Badge dots (`components/ui/Badge.tsx:92`) and the Data Health shop row (`lib/queries/health.ts:143`) only know Shopify and Shoptet.

## 1. Prioritised backlog

### P0 (must land this sprint)

| ID | Problem | Evidence | Fix | Verification |
|---|---|---|---|---|
| P0-1 | GA4 export is not linked for Ethia or RawBark, and Venev's export stalled on 2026-08-19. GA4 cannot backfill, so every day is lost for good. | 03 §6 | Owner links them (checklist #1). WP2 then sets `has_ga4` for each linked client. | `analytics_<propertyId>` exists in EU with an `events_YYYYMMDD` table dated the day after linking. |
| P0-2 | Woo revenue overstated because fee lines are ignored: RawBark about +7.5%, Ethia about +1.3%. | 03 §5; live `stg_woo_orders` | WP3 | Order identity holds: `net_revenue + tax = total - refunds`, within 1 CZK per order. The before/after delta per day equals the summed fee lines exactly. |
| P0-3 | RawBark COGS shows as 0, so CM1, CM2, CM3 and CM3% are nonsense. | live `mart_daily_kpis` Woo branch; 03 §5 | WP3 makes COGS NULL when no cost exists. WP5 adds a "No cost data" card state. The owner sends the cost list (checklist #3). | RawBark CM cards read the "No cost data" state. Ethia's numbers are unchanged. |
| P0-4 | Ethia and RawBark are missing from the customer marts, so Customers, Cohorts, Repurchase, Repeat timing and Time between orders are empty. | 03 §3, §7; live | WP4 | New Woo rows reconcile to `stg_woo_orders`. Diff for non-Woo clients is zero. |
| P0-5 | `ref.fx_rates` ends at 2026-09-01. RawBark's October EUR orders (17 so far) have NULL revenue, and the USD to CZK toggle is disabled for October. | 03 §2b, §5; RB23 | WP2 refreshes the table: September final, October provisional. **Do NOT add the "fall back to the latest rate" view change the audit suggests:** it breaks the locked rule that a missing rate is NULL, never a silently wrong rate. | The RB23 coverage query shows `last_month = 2026-10-01` for all pairs. RawBark has 0 rows with NULL revenue. |
| P0-6 | Paid cannot show "Meta not connected": RawBark gets four dashes plus "No Meta data in this range". There is also an always-on dev banner, and Meta `connected` is hard-coded to true. | `paid/page.tsx:85-96,198-247`; `lib/queries/paid.ts:220`; 02 §3 | WP6 (minimum fix only) | RawBark Paid shows Google totals plus the single line "Meta not connected." and no banner. |
| P0-7 | Pages have no capability model. Empty pages blame the date range or show a misleading 0. | 02 §2; `orders/page.tsx:89`; `email/page.tsx:67-70`; `customers/page.tsx:51` | WP1 builds the capability helper and primitives. WP5 to WP8 apply them. | DoD matrix (§7) passes for all 5 clients. |
| P0-8 | Too much text and dev vocabulary: 9,220 visible words, 56 strings with dev vocabulary, 50 footnotes of 20+ words, table names in section headings. | 04 §1, §2 | WP5 to WP8 apply the copy policy (§4) and the 04 tags. | Recount with the scratchpad `extract.py`/`classify.py`: 3,100 visible words or fewer. Grep gates (§4) are clean. |
| P0-9 | Em dashes: 131 visible strings, plus 114 em dash literals across 45 files used as the "no value" glyph. | 04 §3a; `lib/format.ts:25,39,51,64`; `AdDetail.tsx:833`; `creative/primitives.tsx:26-37` | WP1 swaps the glyph. Copy packages remove the rest. WP9 sweeps. | `grep -rn "—" dashboard/app dashboard/components dashboard/lib` returns 0. |
| P0-10 | A dead Woo sync would never alert: there are no `feed_sla` rows for Woo, and Google Ads coverage is not part of the alerts. | 03 §4 | WP2 | `ops.v_feed_health` has Woo rows for both clients with status `ok`. |
| P0-11 | Live view definitions are missing from the repo (the drift in §0.1). | live; 02 §2 | WP2 exports them into `infra/bigquery/live/`. | Re-running the export produces no diff. |
| P0-12 | RawBark Google Ads has no data for 2026-09-17 (an account-level hole in the DTS transfer, about 3k to 5k CZK). | 03 §2b | WP2 prepares a DTS backfill run for that one date. Runs with owner OK. | Raw `p_ads_AccountBasicStats_9406261058` has 2026-09-17, and the September `google_spend` in `mart_daily_kpis` rises by that day. |

### P1 (this sprint if the packages hold their scope)

| ID | Problem | Evidence | Fix | Verification |
|---|---|---|---|---|
| P1-1 | The currency toggle and Compare control do nothing on most pages. | 02 §7.2 | WP1: both controls default to off. WP5 to WP7 opt in only where the page uses them: Compare on Snapshot, Growth, Products, Unit economics and Creative; currency on Snapshot only. | Orders, Paid and Email show no Compare or currency control. |
| P1-2 | The "Today" preset silently falls back to 30 days. | `DateRangeControl.tsx:29`; `lib/params.ts:26` | WP1 removes the option (locked rule: ranges end yesterday). | No "Today" option is offered. |
| P1-3 | Email headline totals only cover the top 30 campaigns. | `email/page.tsx:33`; `lib/queries/email.ts:66,100-110` | WP6: a separate summary query with no LIMIT. | Totals equal a SUM over the mart for the same range. |
| P1-4 | Manami's Email campaign block is empty: the page reads a Klaviyo-only mart. | 02 route table; 03 §3 | WP6: read `mart_email_campaign_perf` for Ecomail clients. | Manami shows campaign revenue and send counts. |
| P1-5 | Unit costs are rounded to whole units ($0.62 shows as "$1"). | `lib/format.ts:31` | WP1 adds a `unit` option (2 decimals below 100). WP5 and WP6 use it for CPC, CPM, CPA, CAC and AUR. | Dobias CPC shows 2 decimals. |
| P1-6 | Snapshot's paid-source label is inconsistent ("Meta" for both channels, lowercase "google"). | `snapshot/page.tsx:80-85` | WP5 | Both channels show "Meta + Google". |
| P1-7 | Goals CM3 is not the same number as Snapshot CM3. | `lib/queries/goals.ts:61` vs `pnl.ts:240-248` | WP5: Goals reuses the Snapshot CM3 computation. | Same client and month gives the same CM3 on both pages. |
| P1-8 | Stale methodology copy: "36-month window", "30% OpEx hardcoded", caveats that no longer apply. | `lib/metrics.ts:78,99,106,112,114-120,156,160`; live window is 60 | WP5 | No "36" in UI copy. `ASSUMED_OPEX_RATE` is removed. |
| P1-9 | Copy names specific clients and is shown to every tenant (tenancy finding A). | `lib/metrics.ts:29,57,141,145,152-153`; `email/page.tsx:226`; `inventory/buying/page.tsx:243` | WP5, WP6, WP8 | The client-name grep gate (§4) is clean. |
| P1-10 | The nav lists pages that can never have data for the selected client. | 02 §2 | WP1 filters the nav by capability. Channels is removed from the nav. Creative is hidden from the product rail when Meta is off. | RawBark's sidebar has no Inventory, Email, Channels or Creative. |
| P1-11 | Data Health has no WooCommerce shop row. | `lib/queries/health.ts:143` | WP8 | Ethia and RawBark show a WooCommerce freshness row. |
| P1-12 | Mixed number formatting: the Creative ad panel uses cs-CZ, and `ProductJourney` uses `toLocaleString()` with the viewer's locale. | `AdDetail.tsx:841-850`; `ProductJourney.tsx:165,174,194` | WP7 and WP6 switch to `lib/format`. | The same CZK amount reads the same everywhere. |
| P1-13 | MER, aMER and CAC are overstated for a client with Google but no Meta (RawBark). | 01 §4 rule; RB17 | WP5 shows a one-line Notice: "Paid spend is Google only." | Visible for RawBark only. |
| P1-14 | Stale feeds: Dobias Klaviyo (336h), Manami Ecomail (59h), and Dobias and Venev `shopify_products` (critical). | 03 §2c, §2d, §4 | WP2 triages read-only: n8n executions, the RB25 and RESTORE notes. Any re-run waits for owner OK. **Never change the schedule of a live workflow.** | The triage report names the cause per feed. |
| P1-15 | Registry hygiene: RawBark `taxes_included` is NULL, `has_woocommerce` is NULL for 3 clients, `has_ga4` is not maintained. | 03 §1 | WP2 (owner OK) | `ref.clients` has no NULL flags. |
| P1-16 | `ref.fx_rates` expires silently every month. | RB23; 01 §3 | WP2: add a `fx_rates` coverage alert to `ops.v_pipeline_alerts`, plus the `v_gads_coverage` statuses that are not ok. | The alert fires while the current month is missing. |
| P1-17 | The `wf_woocommerce` n8n workflow is not in the repo. | 01 §8 | WP2 exports it with credentials stripped. | The file exists and has no secret values. |

### P2 (log it, do not start unless a package finishes early)

- No lint config, so `next lint` hangs on an interactive prompt. `npm audit` reports 15 findings (1 critical): review before the prod deploy (02 §5).
- `getClients()` is not cached (2 BigQuery calls per navigation): wrap it in React `cache` (02 §1).
- `avgMonthlyGrowth` is an arithmetic mean, not a compounded rate (`growth.ts:82-84`). `getPayback` has no currency filter (`lifetime.ts:191`).
- Woo catalogue and inventory feed. Fallback to `product_id` when SKU is blank. Ethia creatives snapshot run and tagging. `v_gads_coverage` per-day gap check. An n8n FX automation. Shoptet in `mart_customer_daily`. The Meta App move to One Eighty's BM. Removing em dashes from code comments and docs (UI strings are P0).
- `ref.contracts`, `client_monthly_costs` and `cm3_baseline` are empty, so `mart_cm3_monthly` and profit share return nothing. No page reads them; this needs the owner's contract terms.
- Google shopping and search-term marts belong to the Paid redesign, not this sprint.

## 2. Work packages and waves

**Rules for every package**
- Work happens on the `cleanup/2026-10` branch, never on prod.
- Every frontend package must pass `npx tsc --noEmit` and `npm run build`, then a dev server visual check of its own pages for manami, dobias, venev, ethia, rawbark and demo, at desktop and 375px width.
- No new em dashes anywhere, including code comments on lines you touch.
- Writes to `mart_qa` are allowed (it is the SOP step 7 sandbox). Any write to `raw`, `stg`, `mart`, `ref` or `ops`, any DTS run, and the Vercel deploy all need owner OK.
- Never paste secrets into chat or files. No commit or push unless Matej asks.

### Wave 1 (parallel, Monday to Tuesday)

**WP1. UI foundation: capability model, empty-state primitives, glyph, controls, nav** (model: `opus`, prod: no)
- **New files:**
  - `dashboard/lib/capabilities.ts` must be pure: `import type` only, no `server-only` imports, because `Sidebar` runs in the browser.
  - `dashboard/components/ui/EmptyState.tsx` exports `NotConnected({source})`, which renders "{Source} not connected.", and `NoData()`, which renders "No data in this range.". Neither takes a hint or paragraph prop, by design.
  - `dashboard/components/ui/Notice.tsx`: one line, tokens only.
  - `dashboard/components/ui/InfoTip.tsx`: focusable hover tooltip for headers and labels.
- **Edits:**
  - `lib/clients.ts`: add `has_woocommerce` to `ClientRow`, both SELECTs and `toClient`; add `capabilities.woocommerce` (NULL means false).
  - `lib/demo/client.ts`.
  - `lib/format.ts`: export `NO_VALUE = "n/a"` and return it from all four formatters; add a `unit` option to `formatMoney`.
  - `lib/nav.ts`: remove Channels and `NOT_BUILT`; `navFor(isAdmin, client)` filters by capability.
  - `lib/params.ts`, `components/controls/{ControlBar,PageControls,DateRangeControl}.tsx`: `compare` and `currency` props default to false; drop "Today".
  - `components/shell/{Header,Sidebar,MobileTopBar,ProductRail}.tsx`: Header ignores `eyebrow` and the prop becomes optional. Sidebar works out the selected client on the client side with `useSearchParams` (the layout cannot read search params). Remove the unreachable "Soon" branches.
  - `app/(app)/layout.tsx`: pass the clients with their capabilities.
  - `components/ui/{Badge,DataTable}.tsx`: WooCommerce dot; optional `info` on a DataTable column.
  - `components/dashboard/{MetricCard,KpiTile,MetricTooltip}.tsx`: the states render one line; no dash glyph; no hex colours.
  - `components/creative/primitives.tsx`: the dash constants switch to `NO_VALUE`; `NotIngested` delegates to `NotConnected`.
  - `components/inventory/NoStockData.tsx`: delegates to the new primitive.
  - `styles/tokens/colors.css`, `tailwind.config.ts`, `app/globals.css`: move `--shoptet` and `--ecomail` into the token file; add `--woocommerce` and notice tint tokens.
- **Page requirements table** (in `capabilities.ts`):

| Pages | Shown when the client has |
|---|---|
| Snapshot, Goals, Growth, Orders, Products, Unit economics | any shop: Shopify, Shoptet or WooCommerce |
| Customers, Time between orders, Cohorts, Repurchase, Repeat timing | any shop |
| Inventory (all three pages) | Shopify |
| Paid | Meta or Google Ads |
| Email | Klaviyo or Ecomail |
| Creative (all pages) | Meta |
| Channels | never in the nav this sprint (no GA4 mart yet) |

  Also export `pageAvailability(client, href)`, returning `available` or `not-connected`, and `missingSource(client, href)`.
- **Inputs:** 02 §1, §2, §4, §7; 04 §2, §3a; the copy policy (§4 below).
- **Acceptance:**
  - `scripts/check-capabilities.ts` (run with tsx) asserts the table above for 03 §1 registry fixtures of all 5 clients plus demo.
  - `formatMoney(0.62, "USD", {unit: true})` returns "$0.62"; any formatter given null returns "n/a".
  - Owned files contain no "—" and no `bg-[#...]`.
  - On the dev server the RawBark sidebar has no Inventory, Email, Channels or Creative.
  - `tsc` and `build` are green.

**WP2. Warehouse repo sync plus ops, registry and FX prep** (model: `sonnet`, prod: read-only now; the DML and the DTS run wait for owner OK)
- **Owns:**
  - New directory `infra/bigquery/live/`: one `CREATE OR REPLACE VIEW` file per live view in `stg`, `mart` and `ops` (from `INFORMATION_SCHEMA.VIEWS`), table DDL for `ref` and `ops` tables (from `INFORMATION_SCHEMA.TABLES.ddl`), and `scheduled_queries.md` with every scheduled query from `bq ls --transfer_config --transfer_location=eu`, including whatever writes `ops.feed_freshness`.
  - `infra/bigquery/live/README.md`: snapshot date and how to regenerate it.
  - `infra/n8n/wf_woocommerce_to_bigquery.json`: exported through the n8n API, credential IDs only.
  - `infra/bigquery/230_feed_sla_woo.sql`, `231_registry_hygiene_2026_10.sql`, `232_fx_rates_2026_09_10.sql`, `233_ops_alerts_fx_gads.sql`.
  - `_clients/rawbark/warehouse/rawbark-cogs-template.csv` (outside the repo).
- **Tasks:** see warehouse items W1, W4, W5 and W7 in §5. Also the read-only triage for P1-14, reported back in the package result rather than as a new doc.
- **Acceptance:**
  - Re-exporting produces no diff.
  - The 230 to 233 scripts are idempotent (MERGE or `WHERE NOT EXISTS`).
  - The DTS backfill command is written out but not run.
  - The template CSV lists every RawBark `product_id` and `variation_id` sold in the last 24 months.

**WP3. Woo revenue definition (fee lines) and honest COGS** (model: `opus`, prod: view deploy and the `ref.product_costs` ALTER need owner OK)
- **Owns:** `infra/bigquery/228_woo_fee_lines_cogs_null.sql`, `infra/bigquery/qa/228_regression.sql`, `METRICS.md` (the Woo revenue definition and the known-gaps rows).
- **Touches these views (in `mart_qa` first):** `stg.stg_woo_orders`, `stg.stg_woo_order_items`, the Woo branch of `mart.mart_daily_kpis`, `mart.mart_cm3_monthly`, and the Woo branches of `mart_orders`, `mart_product_perf`, `mart_sku_perf` and `mart_unit_economics` if they use the changed columns.
- **Task:** W2 in §5.
- **Acceptance:** the regression protocol (§5.R) passes; the diff equals the fee lines; the decision is recorded in `METRICS.md`.

**WP4. Customer marts read WooCommerce** (model: `opus`, prod: view deploy needs owner OK)
- **Owns:** `infra/bigquery/229_customer_marts_woo.sql`, `infra/bigquery/qa/229_regression.sql`.
- **Touches these views:** `mart_customer_lifetime`, `_cohorts`, `_cohort_grid`, `_payback`, `_product_steps`, `_daily`, `_market_daily`, `mart_order_gaps`. Optionally a new `stg.stg_customer_orders` union view.
- **Task:** W3 in §5.
- **Acceptance:** §5.R passes; the Woo reconciliation checks pass.

`mart_qa` naming, so the parallel packages never collide: candidates are `mart_qa.wp3_<view>` and `mart_qa.wp4_<view>`; baselines are `mart_qa.base_<view>_20261005`.

### Wave 2 (starts once WP1 is merged, around Tuesday afternoon; runs while WP2 to WP4 wait for owner OK)

All four packages follow the copy policy (§4) and the 04 tags for their files:
- KEEP stays.
- SHORTEN takes the proposed text, minus any dash.
- CUT is deleted.
- MOVE goes into a tooltip:
  - If the target is a metric label with an entry in `METRIC_DEFINITIONS`, WP5 adds it to `lib/metrics.ts`, collecting these rows from every page.
  - Otherwise the owning package adds it inline with `InfoTip` or the DataTable `info`.

Every page:
- Starts with a guard: `if (pageAvailability(...) !== "available")`, render the title plus `<NotConnected source=... />`.
- Drops `eyebrow=` and `scope=`.
- Replaces every inline dashed "No data" card with `NoData` or `NotConnected`.

**WP5. Profitability pages and metric definitions** (model: `sonnet`)
- **Owns:** `app/(app)/{snapshot,goals,growth,orders,products,unit-economics}/page.tsx`, `components/dashboard/{AcquisitionEconomics,BottomLine,RevenueMix,RevenueComposition,MarginStack,YearOverYear}.tsx`, `lib/metrics.ts`, `lib/queries/{pnl,goals,growth,yoy,orders,products,unitEconomics,context}.ts`, `lib/goals/progress.ts`.
- **Tasks:**
  - Copy for these files.
  - P1-5 (unit decimals on CAC and AUR), P1-6, P1-7, P1-8, P1-9 (in `metrics.ts`) and P1-13 (the Google-only Notice).
  - The "No cost data" state on the CM cards and in MarginStack whenever `cogs === null && revenue !== null`.
  - Opt in to `compare` on Snapshot, Growth, Products and Unit economics; opt in to `currency` on Snapshot.
  - The Orders market-label copy must not assume Shoptet.
  - Do NOT delete exports that other packages' files use (`KNOWN_CAVEATS`); WP9 removes those.
- **Acceptance:** grep gates are clean on owned files; RawBark Snapshot shows the "No cost data" state and the Notice; Goals and Snapshot CM3 match for Manami in September 2026.

**WP6. Marketing and Retention pages, including the Paid minimum fix** (model: `sonnet`)
- **Owns:** `app/(app)/{paid,channels,email,customers,gaps,cohorts}/page.tsx`, `app/(app)/repurchase/page.tsx`, `app/(app)/repurchase/timing/page.tsx`, `components/dashboard/{Funnel,CohortHeatmap,ProductJourney,RepeatTimingChart}.tsx`, `components/controls/MarketFilter.tsx`, `lib/queries/{paid,email,lifetime,cohorts,cohortGrid,gaps,journey,journeyShape,repeatTiming}.ts`.
- **Paid (minimum fix):**
  - Take `connected` from `client.capabilities` (`paid.ts:220`).
  - If Meta is off, render `<NotConnected source="Meta" />` in place of the Meta tiles, funnel and ad table.
  - If Meta is on but there are no rows, render `<NoData />`.
  - Delete the banner (lines 233-247) and the `mart_meta_ad_perf` heading text.
  - Use unit decimals for CPC, CPM and CPA.
  - Move the ROAS/CPA dash explanation into the header `InfoTip`.
- **Other pages:** P1-3 and P1-4 on Email. Customers returns null rather than 0 when there are no rows. Channels shrinks to the title plus `NotConnected source="GA4"`. `ProductJourney` uses `lib/format`.
- **Acceptance:** RawBark Paid matches DoD; Email totals match a mart SUM; the Customers grep finds no literal `0` fallback.

**WP7. Creative product** (model: `sonnet`)
- **Owns:** `app/(app)/creative/**`, `components/creative/*`, `lib/creative/*`.
- **Tasks:**
  - Copy (172 strings), including shortening the verdict texts.
  - Remove dev vocabulary from server actions: `CLICKUP_API_TOKEN`, Secret Manager, migrations 219-224.
  - Replace the cs-CZ formatter and `SYMBOL` map in `AdDetail.tsx:833-850` with `lib/format`.
  - Merge the four "Untagged" label variants into one.
  - Guard the pages on Meta; opt in to `compare`.
- **Acceptance:** grep gates are clean; the ad panel and grid tile show the same string for the same amount.

**WP8. Inventory, Settings, Data Health, Admin, Auth, Chat and app shell** (model: `sonnet`)
- **Owns:** `app/(app)/inventory/**`, `components/inventory/*`, `lib/inventory/*`, `app/(app)/{settings,health,admin,chat}/**`, `components/settings/*`, `components/chat/*`, `lib/chat/*`, `lib/queries/{health,inventory}.ts`, `lib/users/settings.ts`, `lib/goals/store.ts`, `app/auth/**`, `app/layout.tsx`, `app/manifest.ts`, `app/(app)/loading.tsx`.
- **Tasks:**
  - Copy (Settings section descriptions become one line or a tooltip; inventory footnotes are cut).
  - P1-11: add the WooCommerce row and a Google row per capability in `health.ts`.
  - Stop rendering the `KNOWN_CAVEATS` list on Health.
  - Make the Assistant holding reply neutral: no emoji, no person's name.
  - For stale inventory snapshots, show the Notice "Stock as of {date}."
- **Acceptance:** grep gates are clean; Health lists WooCommerce for Ethia and RawBark.

### Wave 3 (Thursday to Friday)

**WP9. Integration, sweep, verification and deploy prep** (model: `sonnet`; the lead reviews)
- **Owns:**
  - Any file, for sweep fixes only, after wave 2 is merged.
  - `lib/nav.ts`: delete `pageEyebrow` once there are 0 callers.
  - `lib/metrics.ts`: delete the dead `KNOWN_CAVEATS` and `ASSUMED_OPEX_RATE`.
  - Docs: `PROJECT_LOG.md` (new entry at the top), `README.md`, `dashboard/README.md` (fix the stale middleware and domain claims), `CLAUDE_CODE_BRIEF_V4.md` §7 (amend "em dash plus reason" to "n/a plus a state line").
- **Tasks:**
  - Run every grep gate across the whole tree.
  - Recount words with the scratchpad `extract.py`/`classify.py`.
  - Walk the full DoD matrix on the dev server (5 clients plus demo, desktop and 375px) and save screenshots.
  - `tsc` and `build`.
  - Write the deploy command `npx vercel --prod --yes` from the repo root, for owner OK. After the deploy, smoke test `dashboard.oneeighty.cz` against the matrix.
- **Acceptance:** §7 is fully green, or every red cell traces to a named item on the owner checklist.

**Merge order and conflict rule.** No file is owned by two packages in the same wave. Within wave 2, each package's own files are its boundary: `lib/format.ts`, `capabilities.ts` and the primitives are frozen after WP1, and a package that needs a change there tells the lead instead of editing.

## 3. Shared components first (part of WP1, recap)

| Primitive | API | Replaces |
|---|---|---|
| `NotConnected` | `source: string` → "{source} not connected." | 9 inline dashed cards, `NotIngested`, `NoStockData`, the Channels status board |
| `NoData` | no props → "No data in this range." | "No product rows...", "No campaigns sent...", "No data yet" plus their apology paragraphs |
| `Notice` | `tone`, one-line `children` | 6 hand-written amber banners with hex colours |
| `InfoTip` | `text` | footnotes and KPI micro-captions (MOVE rows) |
| `MetricCard` / `KpiTile` state | `no-account` → "Not connected"; `no-data` → reason, 3 words or fewer (e.g. "No cost data") | null values shown as a dash with a reason |
| `pageAvailability`, `missingSource` | pure functions over `Client` | data-driven guessing on every page |
| `NO_VALUE` | `"n/a"` | the em dash glyph |

## 4. UI copy policy (the rulebook copy agents follow)

1. **No em dashes or en dashes in any UI string,** tooltips included. Use a period or comma. Write ranges as "to" ("Sep 1 to Sep 30"); compact numeric ranges take a hyphen ("0-100%").
2. **No-value glyph: `n/a`**, muted, always from `NO_VALUE` in `lib/format.ts`. Never "0" for missing data, never a dash, never a blank cell. Why not the alternatives:
   - An en dash is still a dash, and the owner's complaint is about dashes.
   - A blank cell looks like a rendering bug.
   - "n/a" reads the same in any locale and cannot be mistaken for zero.
3. **Page header is the title only.** No eyebrow or kicker (no "Group · Client"), no subtitle, no scope label next to the date picker.
4. **Section headings are 1 to 3 words.** No subtitle, no "· table_name" suffix, no "Click a heading to sort".
5. **Empty states are one line, and only through the primitives:**
   - "{Source} not connected."
   - "No data in this range."
   - "No cost data."
   - "Not measured." (margin steps keep the locked hatched style)
   - Never a second sentence, never "widen the range", never an explanation of the pipeline.
6. **Definitions, formulas, caveats and methodology live only in tooltips** (`lib/metrics.ts` or `InfoTip`). At most 40 words per tooltip. No footnotes, no "How to read this" blocks, no KPI micro-captions.
7. **Notices come from a closed list, one line, 12 words or fewer:**
   - "{n} {CUR} orders excluded from totals."
   - "Paid spend is Google only."
   - "Stock as of {date}."
   - "No verdicts. Set thresholds in Settings."
   - Any new one needs the lead's OK.
8. **No developer vocabulary:** no table or view names, snake_case, env vars, migration numbers, runbook paths, "warehouse", "backfill", "n8n", "Secret Manager", "mart", "stg". Data Health (internal) may name platforms, not tables.
9. **Tenant-neutral:** no client names, no client-specific figures, no currency symbols in prose.
10. **Number formatting:** en-US everywhere through `lib/format` only.
    - Amounts: ISO code prefix, no decimals ("CZK 108,357").
    - Unit costs under 100: 2 decimals.
    - Percentages: 1 decimal. Ratios: 2 decimals plus "×". Rate deltas: "pp".
    - No `toLocaleString()` without a locale; no cs-CZ.
11. **English only, sentence case.** No jokes, no emoji, no exclamation marks. Buttons are 3 words or fewer and start with a verb.
12. **Word budget:** each page lands at or under the "words after cuts" figure in 04 §1. App total is 3,100 visible words or fewer.

**Grep gates** (run on `dashboard/app`, `dashboard/components`, `dashboard/lib/metrics.ts` and `dashboard/lib/nav.ts`; all must return 0):
- `—`
- `border-dashed` (outside `EmptyState.tsx`)
- `bg-\[#`
- `mart_|stg_|raw_|_per_day|infra/|migration|Secret Manager|n8n|backfill|CLICKUP_API_TOKEN` in JSX text and string literals
- `Dobias|Manami|Venev|Ethia|RawBark` (excluding `lib/demo`)
- `toLocaleString\(\)`
- `pageEyebrow\(` (from wave 3)

## 5. Warehouse fix list

**W1. Export the live DDL into the repo (WP2).** For each view in `stg`, `mart` and `ops`: `SELECT table_schema, table_name, view_definition FROM region-eu.INFORMATION_SCHEMA.VIEWS`, written as `infra/bigquery/live/<schema>.<view>.sql` wrapped in `CREATE OR REPLACE VIEW`. Tables come from `INFORMATION_SCHEMA.TABLES.ddl` for `ref.*` and `ops.*`. Add the scheduled query SQL. From now on, new migrations are numbered 228 and up, and each must cite the `live/` file it changes.

**W2. Woo revenue and COGS (WP3).**
- **Measure first.** Use `raw_woo_orders.payload_json` fee lines to split fees into negative ones (discounts: "Sleva za tlapičky", "Věrnostní sleva 3/5/8 %", "Sleva 5 % za balíček") and positive ones (surcharges). Expected: almost all negative.
- **`stg_woo_orders`:**
  - Add `fee_discounts = SUM(negative fee lines)` and `fee_charges = SUM(positive)` (ex tax, times `fx_rate`). If the payload cannot split them, fall back to `fees_total` signed.
  - `net_revenue = (subtotal_ex_tax + shipping + COALESCE(fees_total,0) - refunds*net_ratio) * fx_rate`.
  - `total_discounts` gains `ABS(fee_discounts)`.
  - Keep the locked rule `revenue = net_sales + shipping` (ex tax). Recommendation: negative fees go into `net_sales`; positive fees are reported as `other_charges` and included in revenue only if they are material, and the choice is recorded in `METRICS.md`.
- **`stg_woo_order_items`:** spread negative order-level fees over lines in proportion to line `total`, so Products reconciles with Snapshot (SUM of line revenue per order = order net sales, within 1 CZK).
- **Dormant cost join:** `unit_cost = COALESCE(i.unit_cost, pc.cost)` from `ref.product_costs`, matched on `client_id` plus (`variation_id`, then `product_id`, then `sku`), effective-dated (`effective_from <= order_date`, latest wins). This needs an additive `ALTER TABLE ref.product_costs ADD COLUMN product_id INT64, ADD COLUMN variation_id INT64` (owner OK). Until rows exist, nothing changes.
- **Woo branch of `mart_daily_kpis`:** `COALESCE(c.cogs, 0) AS cogs` becomes `c.cogs`, so a day with no costed line is NULL and CM1 to CM3 are NULL. `net_sales` must follow the stg definition. The same change goes into `mart_cm3_monthly`. Leave the Shopify and Shoptet branches byte for byte as they are.
- **Expected effect:** RawBark revenue drops about 7.5% and COGS/CM become NULL; Ethia revenue drops about 1.3% and COGS is unchanged; the other 3 clients see zero diff.

**W3. Customer marts read Woo (WP4).**
- **Recommended design:** a new `stg.stg_customer_orders` as a UNION ALL of Shopify, Shoptet and Woo with the shared columns (`client_id, order_id, order_date, currency, customer_key = LOWER(TRIM(email)), is_returning_customer, net_sales, revenue, shipping_country, cogs`), plus `stg.stg_customer_order_items`. Then point the 8 marts at it.
- **Woo specifics:**
  - Identity is the email; guest orders (NULL email) are excluded, as with Shopify.
  - Market is `shipping_country`, which carries `billing_country` in Woo.
  - Product key is `COALESCE(NULLIF(sku,''), CAST(product_id AS STRING))`.
  - Currency is the client currency (the stg layer already converts EUR to CZK).
  - Payback reads `paid_spend`.
- **Reconciliation for Woo clients:**
  - Lifetime orders per client = COUNT of `stg_woo_orders` with an email.
  - Customer count = COUNT DISTINCT of the email key.
  - First order dates are 2025-03-02 for Ethia and 2022-10-01 for RawBark.
  - Cohort grid month 0 = cohort size.
  - Returning share in the 90-day window matches `stg` (RawBark about 85%).
  - Each new per-customer average is sanity-checked against AOV.

**W4. FX refresh (WP2, owner OK).** In `232_fx_rates_2026_09_10.sql`, follow RB23 (ČNB monthly table only; assert the header's third column is `leden`): MERGE the final September 2026 rows (`cnb_monthly_avg`) for USD→CZK, EUR→CZK and CZK→EUR, plus October rows tagged `cnb_mtd_avg@<date>`. Re-run in November to replace October. In `233`, `v_pipeline_alerts` gains a row whenever `MAX(month_start) < DATE_TRUNC(CURRENT_DATE(), MONTH)` for any pair a client uses.

**W5. Ops coverage (WP2, owner OK).** In `230_feed_sla_woo.sql`, insert into `ref.feed_sla`:
- `woocommerce_orders` (source `woocommerce`, flag `has_woocommerce`, `raw.raw_woo_orders`, 12h, critical)
- `woocommerce_order_items` (same, `raw.raw_woo_order_items`)

Confirm first that the `feed_freshness` writer (from the W1 scheduled-query export) handles `has_woocommerce` and the `ingested_at` column. Google Ads goes into `v_pipeline_alerts` as a UNION of `ops.v_gads_coverage WHERE status != 'ok'` rather than a `feed_sla` row, because DTS tables have no `ingested_at`.

**W6. Google Ads 2026-09-17 backfill (WP2 prepares, owner OK).** `bq mk --transfer_run --start_time=2026-09-17T00:00:00Z --end_time=2026-09-18T00:00:00Z <transferConfig>`. Verify that `p_ads_AccountBasicStats_9406261058` and `CampaignBasicStats` have that date, and that `mart_daily_kpis` RawBark `google_spend` for 2026-09-17 is not NULL.

**W7. Registry hygiene (WP2, owner OK).** `231_registry_hygiene_2026_10.sql`:
- RawBark `taxes_included = FALSE`.
- `has_woocommerce = FALSE` where it is NULL.
- `has_ga4 = TRUE` for dobias and manami (fresh exports exist); for ethia, rawbark and venev only once their links are live.
- When RawBark Meta lands, set `has_meta = TRUE, meta_currency = 'CZK'` **in the same UPDATE**. A NULL `meta_currency` silently zeroes spend (03 §3).

**5.R Regression protocol (SOP step 7, applies to WP3, WP4 and W5 view changes)**
1. **Candidate:** `CREATE OR REPLACE VIEW mart_qa.wpN_<view>` with the new SQL. References to other changed views point at their `mart_qa.wpN_*` copies; dependants that are not changed (e.g. `mart_monthly_kpis` on top of `mart_daily_kpis`) get a `mart_qa` copy too.
2. **Zero-diff for unaffected clients.** Compare prod and candidate in one query so both see the same raw data, all columns via `TO_JSON_STRING`, `date < CURRENT_DATE()`, `client_id NOT IN (<affected>)`, both directions with `EXCEPT DISTINCT`. The criterion is 0 rows. Do not raise any tolerance: every diff row must be explained one by one. The only accepted exception is the FLOAT64 summation-order noise on `google_spend` documented in RB17.
3. **Expected diff for affected clients:** WP3 asserts that the per-day revenue delta equals the per-day fee sum exactly; WP4 checks are listed in W3.
4. **Determinism:** run `FARM_FINGERPRINT(STRING_AGG(TO_JSON_STRING(t) ORDER BY key))` on the candidate 5 times with `--nouse_cache`; all 5 must match.
5. **Reconciliation** against the source (SOP step 8). RawBark has over 200 orders a month, so the aggregate delta must be under 2%. Ethia has under 100 a month, so compare order by order with a FULL OUTER JOIN against a Woo export, or against `raw` deduped.
6. **Deploy (owner OK):**
   1. Snapshot `mart_qa.base_<view>_20261005` right before the deploy.
   2. `CREATE OR REPLACE` the prod views from the migration file.
   3. Re-run steps 2 and 5 against prod.
   4. Drop the `mart_qa.wpN_*` objects and the old `base_*_2026_10_01` tables.
   5. Write `agency/_processes/reporting/learnings.md` and `_clients/{ethia,rawbark}/context/analytics-quirks.md` (SOP step 9).

## 6. Owner checklist (most urgent first)

1. **GA4 BigQuery links (urgent, history is lost every day).**
   - **Ethia and RawBark:** in GA4 Admin → Product links → BigQuery links, link to project `oneeighty-warehouse`, location **EU**, Daily export on (Streaming optional). Or give Matej's agency account Editor on the property and we will do it.
   - **Venev:** find out why property `324879665` stopped exporting on 2026-08-19, and link the **venev.eu** property (88.9% of orders).
   - **Send:** property IDs and site hostnames per client.
   - **Where it goes:** `analytics_<id>` datasets, then `ref.clients.has_ga4` (WP2).
2. **RawBark Meta.**
   - Finish the custom app and System User access with `ads_read` on `act_4229772050472158` (BM 3062510437366002).
   - Create the secrets yourself in Secret Manager: `meta-rawbark-access-token` and `meta-rawbark-ad-account-id`. Do not paste them anywhere.
   - **Send:** "done" plus the ad account currency.
   - **Where it goes:** the registry UPDATE in W7. The first run backfills 12 months; older history is a one-off with `infra/meta_backfill.py`.
3. **RawBark COGS.**
   - Fill in `_clients/rawbark/warehouse/rawbark-cogs-template.csv` (WP2 generates it): `unit_cost_czk_ex_vat` per product or variation (per pack size), `effective_from`, and earlier cost rows if prices changed.
   - **Where it goes:** `ref.product_costs`, which the WP3 dormant join picks up.
   - Optionally turn on WooCommerce cost of goods so new orders carry `_woo_cost_price` like Ethia's do.
4. **Approvals (one message can cover all):**
   - WP2 DML: `230` to `233`, the DTS 09-17 backfill, and the `ref.product_costs` ALTER.
   - WP3 and WP4 view deploys after §5.R is green.
   - Deleting the old `mart_qa` baselines.
   - The Vercel prod deploy after the wave 3 sign-off.
5. **Local dev environment for the visual checks** (blocks visual verification from Tuesday). Run `npx vercel env pull dashboard/.env.local` yourself, or provide `GCP_SERVICE_ACCOUNT_KEY_BASE64` (`sa-frontend-reader`), `DATABASE_URL`, `NEXTAUTH_SECRET` and the Google OAuth values. Without them only the demo client can be checked.
6. **Rotate RawBark's Woo API key.** n8n stores the Secret Manager responses unredacted, and the key exposes customer PII. Rotate it in Woo admin and update `woocommerce-rawbark-consumer-key` and `-consumer-secret`.
7. **Does Ethia run Google Ads? Yes or no.** If yes, send the customer ID and accept the MCC link invite. We then run one UPDATE (`gads_customer_id`, `has_gads`, `gads_currency`) and confirm `ops.v_gads_coverage = ok`.
8. **Email platform for Ethia and RawBark.** Which ESP, or none.
   - Klaviyo: a private key with read scopes in `klaviyo-<slug>-api-key`.
   - Ecomail: `ecomail-<slug>-api-key`. Note that a second Ecomail client needs the v2 registry-driven workflow activated (RB24_ecomail).
9. **Cost assumptions for Ethia and RawBark:** fulfilment cost per order and the other CM1 cost per order, entered under Settings → Clients → {client} → Cost assumptions. Until then CM2 equals CM1 and shows as "Not measured".
10. **Contract terms for CM3 and profit share** (Ethia, RawBark): `contract_start_date`, `retainer_czk`, `profit_share_pct`, `baseline_from/to`, `media_channels`, `valid_from/to`, and the monthly fixed costs (packaging, shipping, gateway). These go into `ref.contracts` and `ref.client_monthly_costs`. Not blocking this sprint.
11. **Brand terms** for RawBark and Manami (and Ethia if it runs Google), for the later brand vs non-brand split. These go to the Paid redesign. Not blocking.
12. **Venev:** confirm the Shopify store is the live one (it is near dormant) and whether Ecomail should be connected.

## 7. Definition of done ("clean slate" matrix)

Legend:
- **D**: data shown.
- **D+N**: data plus one allowed Notice.
- **NC**: not connected. Hidden from the nav; if opened by URL, the title plus "{Source} not connected."
- **G**: known gap, shown as a one-line state (no paragraph).
- **(#n)**: becomes D when owner checklist item n is done.

| Page | manami | dobias | venev | ethia | rawbark |
|---|---|---|---|---|---|
| Snapshot | D | D | D | D (CM2 step "Not measured" #9) | D+N: revenue and spend D; CM1 to CM3% "No cost data" (#3); Notice "Paid spend is Google only." (#2) |
| Goals | D, or "No targets set." | same | same | same | same; CM3 shows n/a until #3 |
| Growth | D | D | D | D | D |
| Orders | D | D | D | D | D (October EUR revenue present after W4) |
| Products | D | D | D | D (product level) | D; margin n/a (#3) |
| Unit economics | D | D | D | D | D; COGS% n/a (#3) |
| Stock health, Catalogue, Buying plan | NC | D+N "Stock as of 2026-05-19." | D+N (stale snapshot) | NC | NC |
| Paid (minimum fix) | D (Meta + Google) | D (Meta) | D (Meta) | D (Meta) | D Google totals; Meta block "Meta not connected." (#2) |
| Channels | NC | NC | NC | NC | NC |
| Email | D (Ecomail campaigns via P1-4, plus flows) | D (G until the Klaviyo feed is repaired, P1-14) | NC (#12) | NC (#8) | NC (#8) |
| Customers, Time between orders, Cohorts, Repurchase, Repeat timing | D | D | D | D (after the WP4 deploy, #4) | D (after the WP4 deploy, #4) |
| Creative pages | D | D (Concepts G) | D (Concepts G) | D (thumbnails and tags G) | NC (#2) |
| Breakdown (Creative) | G | G | G | G | NC |
| Data Health (internal) | rows for every connected source | same | same | WooCommerce and Meta rows | WooCommerce and Google rows |

The sprint is done when all of these hold:
1. Every cell is in its stated state, on the dev server and again on prod after the deploy.
2. The §4 grep gates return 0, and the visible word count is 3,100 or fewer.
3. Not a single screen shows an em dash, a "0" standing in for missing data, or a table or pipeline name.
4. §5.R is green and logged for WP3 and WP4.
5. The FX rows, `feed_sla` rows and registry hygiene are applied; `ops.v_feed_health` shows Woo `ok` for both Woo clients.
6. `tsc` and `next build` are green.
7. PROJECT_LOG, METRICS.md, `learnings.md` and both `analytics-quirks.md` files are updated.
8. Every remaining red cell maps to a numbered owner checklist item.

**Suggested calendar:**
- **Mon:** owner items 1 to 5 sent; wave 1 starts.
- **Tue:** WP1 merged; wave 2 starts; WP3 and WP4 regression in `mart_qa`.
- **Wed:** owner OK, then warehouse deploys (W4, W5, W6, W7, WP3, WP4).
- **Thu:** wave 2 merged; WP9 sweep and the matrix walk.
- **Fri:** owner review on the dev server, then the Vercel prod deploy and the prod smoke test.

### Critical Files for Implementation
- `/Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/clients.ts`
- `/Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/format.ts`
- `/Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/app/(app)/paid/page.tsx`
- `/Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/metrics.ts`
- `/Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/infra/bigquery/` (new `live/` export plus migrations 228 to 233; live `stg.stg_woo_orders` and `mart.mart_daily_kpis` are the base for WP3)