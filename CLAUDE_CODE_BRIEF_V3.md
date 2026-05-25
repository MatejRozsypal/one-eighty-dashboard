# One Eighty Data Warehouse — Claude Code Continuation Brief v3

**Last session ended:** 2026-05-20. Shopify Dobias is fully live — 24-month backfill of 74k orders done, products+COGS in, daily cron running every 3h, mart layer rebuilt to handle Dobias cleanly with currency-aware grain and country-based market segmentation. The big data-quality landmine (Matrixify ghost orders) was diagnosed and filtered out. Looker now reconciles with Shopify within ~3%.

**Prior brief:** `CLAUDE_CODE_BRIEF_V2.md` (Shopify-pending era — kept for historical reference). This v3 supersedes it.

Read top to bottom before touching anything. The Shopify story is long but every hop matters.

---

## 1. What this project is

One Eighty is a Prague marketing agency. Matěj (you, the user) is building an internal multi-tenant data warehouse + analytics platform that consolidates every paid client's marketing data so the agency stops re-building Looker dashboards client by client.

**Architecture is per-source, not per-client.** One n8n workflow handles all clients for a given source; clients live as rows in `ref.clients`. Adding a new client = one INSERT.

**Pipeline shape:**
```
SOURCES → n8n (Hostinger VPS) → BigQuery (raw → stg → mart) → Looker Studio (Phase 1-3) / Next.js (Phase 4+)
```

**Layers:**
- **raw.\*** — append-only floor of truth. `payload_json` audit column. PARTITION BY DATE, CLUSTER BY client_id.
- **ref.\*** — registry tables (`clients`; `fx_rates` and `product_costs` still pending).
- **stg.\*** — deduped views via `ROW_NUMBER() OVER (...) ORDER BY ingested_at DESC`. Now 17 views (added `stg_shopify_order_items`; `stg_shopify_orders` carries a Matrixify exclusion filter).
- **mart.\*** — pre-aggregated, cross-source, dashboard-ready. **12 views live** (added `mart_orders`). Looker queries mart exclusively.
- **ops.\*** — `pipeline_log`, `access_log`, `fx_rates_log` (pending).

---

## 2. Clients in scope

| Client | Country | Currency | Sources active | Status |
|---|---|---|---|---|
| **Manami** | Czech Republic | **CZK** | Shoptet ✅ + Ecomail ✅ + Meta Ads ✅ + IG media ✅ | All flowing |
| **Dr. Dobias (Dr. Dobias Natural Pet Health)** | USD-shop (Canadian biz, USD primary currency) | **USD** for shop+Meta+Klaviyo | Shopify ✅ + Klaviyo ✅ + Meta Ads ✅ + IG media ✅ | **All flowing, fully unblocked** |

`ref.clients` has these 2 rows. Dobias `has_shopify=TRUE`.

**Important Dobias correction over v2:** the shop's primary currency is **USD**, not CAD. Dr. Dobias is a Canadian business but operates a USD-primary Shopify. CAD orders that appear in raw are Matrixify-app imports (historical migration artefacts, see §6.5) — filtered out at stg. Real Dobias trade is USD-only. Markets are split by `shipping_country` (US/CA/other), **not by currency**.

---

## 3. Decisions locked in (don't re-litigate)

| Decision | Value |
|---|---|
| GCP project ID | `oneeighty-warehouse` |
| BQ dataset names | `raw`, `ref`, `stg`, `mart`, `ops` |
| Dashboard domain (Phase 4) | `dashboard.oneeighty.cz` |
| Backfill window | 24 months default (n8n + bulk export both use 730 days) |
| Frontend MVP auth | Google SSO `@oneeighty.cz` only |
| Failure alert email | `matej@oneeighty.cz` |
| Currency policy | **Native per source. Manami=CZK throughout. Dobias=USD throughout (shop primary + Meta + Klaviyo all USD).** FX deferred (Phase 2 with `ref.fx_rates`) — only needed if a future client has genuine multi-currency selling. |
| Markets / segmentation | **By `shipping_country` via `mart_orders`**, not by currency. Dobias = US + CA + small international tail. |
| OpEx assumption | Flat **30% of revenue** baked into `net_profit_estimated`. Hardcoded in `mart_daily_kpis`; move to `ref.clients.opex_pct` when per-client tuning matters. |
| Secret naming | `<source>-<slug>-<key>` (lowercase, hyphens only) |
| Mart refresh | Looker queries views directly (no scheduled materialization); per-source workflows append raw on cron |
| GA4 ingest path | Native BigQuery Linking when wired (NOT n8n) |
| Looker source | **mart.* exclusively** — never raw or stg |
| Workflow architecture | Per-source loop over `ref.clients` filtered by `has_<source>=TRUE`. Workflows continue on per-iteration failures via `onError: continueRegularOutput` + `alwaysOutputData: true`. |
| Shoptet ingest | **CSV web export via HTTP node**, parsed by JS Code node. See §6.1. |
| Shopify ingest auth (NEW) | **OAuth client-credentials grant**, not legacy `shpat_` tokens. Shopify deprecated new legacy custom apps on Jan 1 2026. See §6.6. |
| Shopify historical backfill (NEW) | **Bulk Operations API via Cloud Shell + bq load**, not n8n. See runbook 12. |
| Shopify products / COGS (NEW) | **Bulk Operations API one-off** (no ongoing sync yet). See runbook 13. |
| Cost matching for Dobias mart (NEW) | **Normalized SKU join** — strip the `DD-` brand prefix, then match on the bare code. Recovers ~6 points of coverage. |
| Meta App ownership | Currently owned by Manami's BM (mistake) — TODO to migrate to One Eighty BM. Tracked in `TODO_meta_app_ownership_migration.md`. |

---

## 4. Repo

- **GitHub:** https://github.com/MatejRozsypal/one-eighty-dashboard
- **Local clone:** `~/Documents/Claude/Projects/one-eighty-dashboard/`
- **NOT pushed** — Matěj reviews + pushes. Many files changed this session but unpushed.

### Folder layout (post-session)

```
infra/
  bigquery/          -- DDL files 001–100, 200 (stg), 300 (mart)
  n8n/               -- workflow JSON files + spec .md per source
  samples/           -- Graph API response samples used to design DDL
  secrets/           -- README only — no credentials
  shopify_bulk_transform.py        -- NEW. JSONL → raw_shopify_orders. Used by runbook 12.
  shopify_products_transform.py    -- NEW. JSONL → raw_shopify_products. Used by runbook 13.
runbooks/            -- click-by-click guides (01–14) + TODO_* parked work
dashboard/           -- Next.js 14 scaffold (Phase 4, untouched)
CLAUDE_CODE_BRIEF_V2.md   -- prior brief (kept)
CLAUDE_CODE_BRIEF_V3.md   -- this brief
```

### First thing to do in a new session

```bash
cd ~/Documents/Claude/Projects/one-eighty-dashboard && git status && git log --oneline -15 && ls -la infra/bigquery/ infra/n8n/ runbooks/
```

Then a fast BigQuery sanity check via the BQ MCP (see §12).

---

## 5. State of every workflow

### 5.1 Workflows live and on cron

| Workflow | File | Cron | Behavior |
|---|---|---|---|
| **wf_shoptet** | (built directly in n8n, no JSON) | Daily 04:00 CET | CSV web export, 14-day rolling watermark in Code node. Manami only. Active. |
| **wf_ecomail_to_bigquery** | `infra/n8n/wf_ecomail_to_bigquery.json` | Every 6h | 3 branches: campaigns + automations + lists. Manami only. Active. |
| **wf_klaviyo_to_bigquery** | `infra/n8n/wf_klaviyo_to_bigquery.json` | Every 6h :20 | 3 branches: campaigns + flows + forms. Dobias only. Active. |
| **wf_meta_ads_to_bigquery** | `infra/n8n/wf_meta_ads_to_bigquery.json` | Every 30 min | Auto-detects new clients (empty BQ → 12 chunks of 30 days, 12-month rolling). Active. |
| **wf_instagram_to_bigquery (media branch only)** | `infra/n8n/wf_instagram_to_bigquery.json` | Every 6h :30 | Manami media. Account_insights branch deactivated (token scope). |
| **wf_shopify_to_bigquery** (NEW — fully working) | `infra/n8n/wf_shopify_to_bigquery.json` | **Every 3h `0 */3 * * *`** | OAuth client-credentials grant per run, no static token. Dobias only. Pagination off (daily volume ~50 orders fits one page). Active. |

### 5.2 Workflows built but not flowing

| Workflow | File | Blocker |
|---|---|---|
| **wf_shopify_csv_import** | `infra/n8n/wf_shopify_csv_import.json` | Backup workflow for manual CSV ingest. Built but not needed (API path works). Kept as fallback. |
| **wf_facebook_organic_to_bigquery** | `infra/n8n/wf_facebook_organic_to_bigquery.json` | Token scope + Page Access Token swap node needed. See `runbooks/TODO_facebook_instagram_pending.md`. |
| **wf_instagram_to_bigquery account_insights branch** | (in IG workflow, disabled) | `(#10) Application does not have permission` — needs `instagram_manage_insights` scope on regenerated token. |

### 5.3 NOT a workflow, but in the pipeline (one-off jobs)

- **Shopify orders bulk backfill** — runbook 12 (Cloud Shell + bq). Run once, May 2026, brought in 74,065 orders / 24 months.
- **Shopify products bulk backfill** — runbook 13 (Cloud Shell + bq). Run once, May 2026, brought in 97 products / 215 variants. **No ongoing sync** — cost data goes stale slowly. Re-run periodically (quarterly?) or build a recurring workflow when needed.

---

## 6. Critical lessons learned (DO NOT re-debug these)

### 6.1 n8n quirks (carried forward from v2 + additions)

| Symptom | Root cause | Fix |
|---|---|---|
| Workflow stops after first iteration of SplitInBatches | Loop downstream chain emits `[]` somewhere | `alwaysOutputData: true` on Transform + BQ Insert nodes |
| Per-iteration silent failure halts whole workflow | Default n8n behavior on error | `onError: continueRegularOutput` on Fetch + BQ Insert nodes |
| Manual "Execute step" skips parallel-fan-out branches | n8n only traces one upstream path | Chain sequentially, not parallel from Loop |
| `time_range` expression returns empty/breaks | n8n's expression parser chokes on JSON-shaped values | Pre-build the time_range string in a Code node, pass via `={{ $json.time_range }}` |
| Built-in pagination loops forever on `null` next | `paging.next: null` becomes literal string "null" URL | Disable pagination; for Shopify daily, one page (250) covers it. For Meta use 30-day chunks. |
| Klaviyo: `'page_size' is not a valid field for resource 'campaign'` | Klaviyo rejects page[size] on campaigns endpoint | Drop the param, accept default |
| Klaviyo: response comes back as string `{"data": "..."}` | Default Response Format wasn't JSON | HTTP Request → Options → Response Format → JSON |
| HTTP node sends timestamp `2026-04-22T15:21:31+0000` → BQ rejects | BQ streaming insert wants `YYYY-MM-DD HH:MM:SS` not ISO with `T+Z` | `fmtTs` helper in every Transform node |
| **`paginationMode: "responseHeaderLink"` doesn't exist (NEW)** | I invented a non-existent n8n pagination mode | Valid modes are `"off"`, `"updateAParameterInEachRequest"`, `"responseContainsNextURL"`. For one-page-per-day workloads just use `"off"`. |
| **`$execution.startedAt` is undefined (NEW)** | Not a real n8n expression — `TIMESTAMP('undefined')` → BQ rejects | Use `CURRENT_TIMESTAMP()` for both `started_at` and `finished_at` in the Log node. |
| **Pasting a big block with the closing heredoc delimiter and the next command on adjacent lines mangles the heredoc (NEW)** | The shell can swallow `PYEOF` and concatenate with the next command | Always put a blank line after the closing `PYEOF`; never combine "create file" + "next command" in a single paste. |

### 6.2 BigQuery quirks

| Symptom | Fix |
|---|---|
| `Unexpected keyword ROWS at [...]` | `rows` is a reserved word → backtick or alias to `row_count` |
| `TIMESTAMP_SUB does not support the MONTH date part` | Use `INTERVAL 730 DAY`. `DATE_SUB` does support `MONTH` — only `TIMESTAMP_SUB` is restricted. |
| Streaming insert silently drops rows on REPEATED STRUCT | Use STRING column + `JSON.stringify(array)` |
| `Array specified for non-repeated field` | Switch to `JSON.stringify(arr ?? [])` |
| `Could not parse '...' as timestamp` | `fmtTs` helper |
| `require_partition_filter` blocks query | Always include a WHERE on the partition column. Looker auto-adds when a date control is set. |
| Streaming insert latency 5–30 min before query visibility | Use `bq load` (load job, free + instant) for bulk operations. The Shopify backfill is `bq load`. The n8n nodes still stream (no big deal for low daily volume). |
| **View creation succeeds but Looker shows stale schema (NEW)** | Looker caches schemas. After any column rename/add/remove: in Looker Studio → Resource → Manage data sources → Edit → **Refresh fields**. Without that, charts referencing renamed fields show errors. |
| **`bq query` with `'dobias'` inside SQL that's wrapped in single quotes breaks (NEW)** | Bash eats the single quotes | Use `"dobias"` (double quotes) inside the SQL when the outer shell quoting is single-quote. BigQuery accepts both. |

### 6.3 Meta API quirks

| Quirk | Workaround |
|---|---|
| `time_increment=1` capped at ~90 days per request | 30-day chunks (12 chunks × 30 days = rolling 12 months) |
| Service Unavailable / 500 on heavy 90-day ad-level requests | Smaller chunks + `onError: continueRegularOutput` |
| Token must have asset assignment AND app assignment | System User in BM needs **Add Assets → App** with "Develop app" permission, not just Ad Account |
| App owner BM != client BM → app must be shared | Share app from owner BM to client BM. Currently Manami owns the app (TODO migration). |
| Page-level endpoints reject System User token | Need to swap for Page Access Token via `/{page_id}?fields=access_token` first. Not yet implemented in wf_facebook_organic. |
| `currency` field was lost during a DROP+RECREATE of raw_meta_*_insights tables | Currency hardcoded via CASE in mart: `manami → CZK`, `dobias → USD` |
| Meta uses `$` for both USD and CAD in UI | Verify via Graph API: `act_<id>?fields=currency,name,timezone_name` |

### 6.4 Security incidents (carried forward)

- **Credentials leaked in chat twice.** Both rotated immediately. **Hard rule reinforced:** secrets never in chat, always Secret Manager directly. When pulling secrets via gcloud, use command-substitution so the value never lands in shell history or chat: `TOKEN=$(gcloud secrets versions access ...)`.

### 6.5 The Matrixify ghost-order saga (NEW — this is the most important lesson of this session)

**Symptom:** Looker showed 2,275 orders / $344k for the last 30 days. Shopify dashboard showed 1,391 / $217k. Same period. 64% gap on orders, 58% on revenue.

**Root cause:** `raw_shopify_orders` contained ~48,000 "ghost" CAD-presentment orders concentrated on 7 days in March 2026, all with `source_name = 'Matrixify App'` and order numbers ending in `-C`. They were a historical bulk-import via the [Matrixify](https://matrixify.app/) Shopify app — almost certainly a Shopify Markets / multi-currency migration that retroactively created CAD-presentment versions of historical orders. They duplicate real USD orders and don't represent any actual customer activity in their dated period.

**Why we found it late:** the bulk export pulled them legitimately (they exist in Shopify's `orders` resource). Shopify's own Analytics dashboard filters them out; the warehouse didn't.

**Fix:**
```sql
-- stg.stg_shopify_orders now ends with:
WHERE rn = 1 AND source_name != 'Matrixify App';
```
That filter cascades through every downstream view because everything reads stg, not raw.

**Lesson for the next session:**
- When a Shopify number disagrees with the warehouse by more than a couple of percent, **check `source_name` distribution first**. Real customer orders are `web`, `pos`, `shop`, `shopify_draft_order`, `subscription_contract_checkout_one`, or a numeric channel ID. Anything else (`Matrixify App`, other migration tools) is suspect and likely needs exclusion.
- The brief's earlier currency confusion (CAD vs USD, multi-currency selling, FX) **was largely a Matrixify artefact**. Dobias's real business is USD-only. Markets are countries, not currencies.
- The `currency` column on stg_shopify_orders is the **presentment currency** (what the customer paid in), not the shop currency. For Dobias post-filter it's almost entirely USD.

### 6.6 Shopify 2026 deprecation + new auth model (NEW)

**Background:** Effective Jan 1 2026, Shopify discontinued the creation of *new* legacy custom apps directly in the store admin. The classic "Reveal token once → static `shpat_…` access token" flow is gone for newly created apps. Existing legacy apps still work.

**New model:** Custom apps are created in the **Shopify Dev Dashboard** (`partners.shopify.com` / `dev.shopify.com`). Instead of a static token, the app has:
- **Client ID** (public, like `b08fc6e2…`)
- **Client Secret** (`shpss_…`)

To call the Admin API, you exchange these via the **OAuth client-credentials grant**:
```
POST https://{shop}.myshopify.com/admin/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=…&client_secret=…
```
Returns an **`access_token` valid 24 hours**. The token goes in the standard `X-Shopify-Access-Token` header.

**Critical org rule (we burned three days on this):** the app must be created **from inside the merchant's store admin** (Settings → Apps and sales channels → Develop apps → Build apps). That ties it to the store's organization. If you create it standalone in a separate Dev Dashboard org, you get `Oauth error shop_not_permitted: Client credentials cannot be performed on this shop`. The fix is to recreate the app from the right entry point — Peter (the store owner) did this and it immediately worked.

The corrected procedure is documented inline in §12 ("First thing to do") and the dev spec at `runbooks/06_dobias_shopify_dev_spec.md` should be updated to reflect this (it still describes the legacy flow as of session end — TODO).

### 6.7 Cloud Shell session-volatility (NEW)

Cloud Shell **loses shell variables** when the session ends or times out. We hit this repeatedly with `$SHOP`, `$TOKEN`, `$URL` — re-pasting downstream commands silently failed because the variables were empty. Every reusable command block is now **self-contained**: re-runs Step 0 (pulling secrets and minting a token) inside the block, then proceeds. See runbooks 12 + 13 for the canonical pattern.

---

## 7. BigQuery state (verified live at handoff)

### 7.1 Raw layer

| Table | Rows | Range | Notes |
|---|---|---|---|
| `raw.raw_shoptet_orders` | ~2,548+ | 2024-05-06 → today | 24 months, Manami only |
| `raw.raw_shoptet_order_items` | ~4,846+ | same | same |
| `raw.raw_ecomail_campaigns` | ~100s | All time | Append-only with snapshots |
| `raw.raw_ecomail_automations` | Daily snapshots | — | `metric_type='cumulative'` |
| `raw.raw_ecomail_lists` | Daily snapshots | — | — |
| `raw.raw_klaviyo_campaigns` | 288 | 2025-12-12 → today | Dobias |
| `raw.raw_klaviyo_flows` | Daily snapshots | — | Metadata only — `/api/flows/` doesn't return stats. `/flow-series-reports/` deferred. |
| `raw.raw_klaviyo_forms` | 20 | Today | Daily snapshot |
| `raw.raw_meta_campaign_insights` | 1,109+ | 2025-05-07 → today | 12-month backfill + daily |
| `raw.raw_meta_ad_insights` | 4,170+ | same | same |
| `raw.raw_instagram_media` | 100 | 8 months back | Manami |
| `raw.raw_instagram_account_insights` | 0 | — | Disabled (token scope) |
| `raw.raw_facebook_posts` | 0 | — | Workflow not active |
| **`raw.raw_shopify_orders`** | **~75,000+ (incl. ~48k Matrixify ghosts)** | **2024-05-18 → today** | **Schema rewritten this session: `line_items` is now STRING (JSON), not ARRAY<STRUCT>.** Bulk-backfilled May 2026 via runbook 12. Daily incremental via n8n every 3h. Stg view filters out `source_name='Matrixify App'`. |
| **`raw.raw_shopify_products`** | **215 variants / 97 products** | One-off backfill | Bulk-backfilled via runbook 13. **No ongoing sync** — cost data goes stale. |
| `raw.raw_shopify_customers` | 0 | — | Customers workflow never built. |

### 7.2 Stg views (17 deduped views) — live

Existing 14 from v2 (`stg_shoptet_orders`, `stg_shoptet_order_items`, `stg_ecomail_*`, `stg_klaviyo_*`, `stg_meta_*`, `stg_instagram_*`, `stg_facebook_posts`) **plus 3 added this session:**
- `stg_shopify_orders` — **WITH `source_name != 'Matrixify App'` filter**
- `stg_shopify_products`
- `stg_shopify_customers` (forward-compatible — no data yet)
- `stg_shopify_order_items` — **NEW.** Flattens line items from `stg_shopify_orders`, joins cost from `stg_shopify_products` via normalized SKU (strips `DD-` prefix). Cost/margin NULL where SKU can't be matched.

DDL: `infra/bigquery/200_create_stg_views.sql`.

### 7.3 Mart views (12 dashboard-ready views) — live

| View | Purpose | Major change this session |
|---|---|---|
| `mart.mart_daily_kpis` | Daily KPIs per (client, date, **currency**). Looker reads here. | **Grain now includes `currency`. Dobias `gross_profit` now populated** via daily aggregate of `stg_shopify_order_items`. **New column `net_profit_estimated`** = `gross_profit − meta_spend − revenue × 30%`. Matrixify excluded via stg. |
| `mart.mart_customer_lifetime` | One row per (client_id, customer_email, currency). | Grain now includes `currency`. |
| `mart.mart_customer_cohorts` | Cohort-by-first-order-month per currency. | Grain now includes `currency`. |
| `mart.mart_sku_perf` | Top-SKUs + SKU table. | **Now UNION Shoptet + Shopify** (was Manami-only). Cost/margin via normalized-SKU join. |
| `mart.mart_product_perf` | Products table. | **Now UNION Shoptet + Shopify** (was Manami-only). |
| `mart.mart_meta_campaign_perf` | Campaign performance table | Unchanged. |
| `mart.mart_meta_ad_perf` | Ad performance table | Unchanged. |
| `mart.mart_email_campaign_perf` | Email campaigns (UNION Ecomail + Klaviyo) | Unchanged. |
| `mart.mart_email_flow_perf` | Email flows (UNION) | Unchanged. |
| `mart.mart_email_subscribers` | Subscriber counts (Ecomail only) | Unchanged. |
| **`mart.mart_orders`** | **NEW.** Order-level view (one row per Shopify order). Includes `shipping_country`, customer email, financial_status, source_name. | **Use this for country-based market analysis (US/CA filter).** |

DDL: `infra/bigquery/300_create_mart_views.sql`.

**Verification numbers at session end (Dobias, last 30 days):**

| Metric | Warehouse (mart_daily_kpis) | Shopify dashboard |
|---|---|---|
| Orders | 1,400 | 1,391 |
| Revenue | $223,257 | $217,186 (Total sales) |
| Gross profit | $176,542 (79% margin) | — |
| Meta spend | $4,869 | — |
| Net profit (naive) | $171,673 | — |
| Net profit (with 30% OpEx) | $104,696 (~47% net margin) | — |

The remaining ~2.8% revenue gap to Shopify is refund netting — see §8 P1.

### 7.4 ref.* state

- `ref.clients` — 2 rows (manami, dobias). Dobias `has_shopify=TRUE`.
- `ref.fx_rates` — **pending** (would unlock cross-source ratios for any future multi-currency client; Dobias doesn't need it).
- `ref.product_costs` — **pending** (a manual SKU-cost map for clients/items where Shopify's `inventoryItem.unitCost` isn't populated; lower priority now that Dobias has 89% coverage from Shopify directly).
- `ref.clients.opex_pct` — **pending** (currently OpEx hardcoded 30% in mart_daily_kpis; move here for per-client tuning).

---

## 8. Pending / open work

### Priority 1 — close the residual data-quality gap (small)

- [ ] **Net refunds out of revenue** to exact-match Shopify. The bulk export query didn't pull `totalRefundedSet.shopMoney.amount`. Two paths:
  1. Re-pull orders with the field — same Bulk API pattern as runbook 12, add `totalRefundedSet { shopMoney { amount } }` to the GraphQL. Then `revenue := total_price - total_refunded` in stg or mart. Maybe an hour.
  2. Quick-and-dirty: zero out `REFUNDED` orders' revenue in the mart view; live with PARTIALLY_REFUNDED counted at full. Closes most of the 2.8% gap; a stopgap.
- [ ] **Regenerate `runbooks/14_mart_daily_kpis_dictionary.xlsx`** — it's stale. The currency-column consolidation, `net_profit_estimated`, `mart_orders`, and the Matrixify caveat all need to be documented. The generator script template is `/tmp/build_kpi_dict.py` (from this session) or re-derive from `300_create_mart_views.sql`.

### Priority 2 — Looker rebuild (the visible win)

This is the actual product layer. Now that mart is solid:
- [ ] **Refresh data sources in Looker** for every view we touched: `mart_daily_kpis`, `mart_customer_lifetime`, `mart_customer_cohorts`, `mart_sku_perf`, `mart_product_perf`, `mart_orders` (add as new). In each: Resource → Manage data sources → Edit → **Refresh fields**.
- [ ] **Re-bind any chart that used `shop_currency` or `meta_currency`** → switch to the unified `currency` column.
- [ ] **Add country filter on `mart_orders`** — gives the "US vs Canada vs other" market split Matěj asked for.
- [ ] **Build the dashboard pages**, per runbook 11:
  1. Shop Performance (easiest, single-source per client)
  2. FB Ads
  3. Email
  4. Profitability (uses the new `net_profit_estimated`)
- [ ] **Surface `net_profit_estimated` on the Profitability page** alongside `net_profit_naive`. Label clearly: "naive = gross − Meta only", "estimated = also − 30% OpEx".

### Priority 3 — n8n monitoring + OpEx config

- [ ] **n8n error workflow** (we discussed but didn't finish):
  - Error Trigger → ClickUp Create Task.
  - Task name expression: `Error n8n - {{ $json.workflow.name }}`.
  - Due date expression: `{{ $now.plus({ hours: 1 }).toMillis() }}` (toggle Due Date Time = on).
  - Assignee = Matěj.
  - Then for each monitored workflow: Workflow Settings → Error Workflow → select this one.
- [ ] **Move OpEx 30% to `ref.clients`** — add `opex_pct NUMERIC` column, seed values (Dobias 0.30, Manami TBD), update `mart_daily_kpis` to join `ref.clients` and use `c.opex_pct` instead of the literal `0.30`.

### Priority 4 — Feature additions still pending from v2

- [ ] **GA4 BigQuery Linking** (~2h) — enable in GA4 admin, daily + streaming export. Then write `infra/bigquery/012_create_raw_ga4.sql`, `213_create_stg_ga4.sql`, `304_create_mart_ga4.sql` (channels, funnel, active users).
- [ ] **Meta `daily_budget` ingest** (~30 min) — modify `wf_meta_ads` to fetch `/{campaign_id}?fields=daily_budget` after insights, add `daily_budget`/`lifetime_budget` columns to `raw_meta_campaign_insights`, expose in `mart_meta_campaign_perf`.
- [ ] **Klaviyo flow stats backfill** (~30 min) — POST `/api/flow-values-reports/` with `conversion_metric_id` (auto-discoverable via `/api/metrics/?filter=equals(name,'Placed Order')`). New table `raw_klaviyo_flow_series`.
- [ ] **Klaviyo lists ingest** — 4th branch fetching `/api/lists/{id}` for subscriber counts. Then `mart_email_subscribers` becomes multi-platform.
- [ ] **Shoptet multi-tenant** — currently hardcoded `CLIENT_ID='manami'` in Code node. Rewrite when a 2nd Czech client lands.
- [ ] **Shopify products ongoing sync** — currently one-off via runbook 13. For cost data freshness, either:
  - A new n8n workflow `wf_shopify_products_sync` that does a weekly Bulk Operations pull, OR
  - An on-demand re-run of runbook 13 when product costs change in Shopify (manual).
- [ ] **Shopify customers ingest** — branch was never built. Needed if mart_customer_lifetime should incorporate Shopify customer attributes (accepts_marketing, total_orders, etc.).
- [ ] **IG account insights branch** — token scope issue. Steps in `runbooks/TODO_facebook_instagram_pending.md` §1.
- [ ] **Facebook organic posts** — needs Page Access Token swap node. Steps in same file §2.
- [ ] **Update `runbooks/06_dobias_shopify_dev_spec.md`** — it still describes the legacy `shpat_` flow. Rewrite for the new Dev Dashboard / client-credentials grant.

### Priority 5 — Architecture cleanup

- [ ] **Meta App ownership migration** — currently Manami's BM owns the app. Steps in `runbooks/TODO_meta_app_ownership_migration.md`. Do before client #3.
- [ ] **FX rates layer (Phase 2 currency)** — `ref.fx_rates` DDL + daily `wf_fx_rates` workflow pulling from openexchangerates.org or exchangerate.host. **Lower priority now** since Dobias is USD-only (the brief's earlier "Dobias = CAD" assumption was wrong). Only needed if a future client has genuine multi-currency selling.
- [ ] **Switch n8n BQ Inserts from streaming to load jobs** — current setup uses streaming inserts ($0.01/200MB + 5–30 min query latency). Load jobs free + instant. Lower priority post-Shopify (the heavy load is via `bq load`; n8n streaming is for low-volume daily increments now).
- [ ] **Phase 4 frontend** — `dashboard/` directory has the Next.js 14 scaffold. Build once Looker is stable and the agency wants something more polished than Looker Studio.

---

## 9. File index — what's in the repo

### Runbooks (read these first for context)

- `01_gcp_setup.md` — original GCP project + service accounts setup
- `02_secret_manager.md` — Secret Manager click-by-click
- `03_shopify_custom_app.md` — **STALE.** Describes legacy `shpat_` flow. Don't use; see §6.6.
- `04_n8n_workflow_pattern.md` — universal workflow shape
- `05_ecomail_n8n_setup.md` — Ecomail workflow build
- `06_dobias_shopify_dev_spec.md` — **STALE.** Still describes legacy custom app flow. TODO to rewrite for client-credentials.
- `07_meta_app_and_system_user.md` — Meta App setup
- `08_dobias_full_onboarding.md` — full Dobias onboarding (parts now stale on Shopify side)
- `09_klaviyo_dev_spec.md` — send to Klaviyo admin for API key
- `10_looker_studio_metrics_spec.md` — Looker metrics spec
- `11_metric_to_mart_mapping.md` — Looker rebuild guide (still current; mart views just got wider)
- **`12_shopify_bulk_backfill.md`** — NEW. One-off Shopify orders backfill via Bulk Operations API in Cloud Shell.
- **`13_shopify_products_backfill.md`** — NEW. One-off products + cost backfill via Bulk Operations API.
- **`14_mart_daily_kpis_dictionary.xlsx`** — NEW (slightly stale). Per-metric documentation of `mart_daily_kpis` + Shopify-discrepancy explanations. **Regenerate before next major use.**
- `TODO_facebook_instagram_pending.md` — FB/IG fixes parked
- `TODO_meta_app_ownership_migration.md` — Meta App BM transfer

### BigQuery DDL (run order)

1. `001_create_datasets.sql` — datasets
2. `002_create_clients_registry.sql` — ref.clients
3. `003_seed_clients.sql` — seed Manami + Dobias
4. `004_create_raw_shoptet.sql`
5. `005_create_raw_ecomail.sql` + `005a_drop_raw_ecomail.sql` (one-time migration)
6. **`006_create_raw_shopify.sql`** — UPDATED this session: `line_items` is now `STRING`, not `ARRAY<STRUCT>`. Apply via `CREATE OR REPLACE TABLE` (live table was migrated).
7. `007_create_raw_klaviyo.sql` + `007a_create_raw_klaviyo_forms.sql`
8. `008_create_ops.sql`
9. `009_create_raw_meta_ads.sql`
10. `010_create_raw_instagram.sql`
11. `011_create_raw_facebook.sql`
12. ~~`100_mart_daily_kpis.sql`~~ — OBSOLETE — superseded by 300
13. **`200_create_stg_views.sql`** — UPDATED: added `stg_shopify_order_items`; `stg_shopify_orders` carries the Matrixify exclusion filter.
14. **`300_create_mart_views.sql`** — HEAVILY UPDATED. Currency in grain on daily/lifetime/cohorts. `mart_orders` added. `mart_sku_perf` / `mart_product_perf` UNION Shopify + Shoptet. `mart_daily_kpis` has new `net_profit_estimated` and live Dobias gross_profit.

### n8n workflow JSONs

- `wf_shoptet.md` — spec (built in n8n, no JSON)
- `wf_ecomail_to_bigquery.json` — Manami email
- `wf_shopify_to_bigquery.json` — **NOW LIVE.** Client-credentials auth, every-3h cron, Dobias.
- `wf_shopify_csv_import.json` — **NEW.** Backup CSV-import workflow (not in production use).
- `wf_klaviyo_to_bigquery.json` — Dobias email
- `wf_meta_ads_to_bigquery.json` — both clients
- `wf_instagram_to_bigquery.json` — both clients
- `wf_facebook_organic_to_bigquery.json` — pending fixes

### Python helpers (new this session)

- `infra/shopify_bulk_transform.py` — JSONL → `raw_shopify_orders` rows. Streaming; one parent-then-children reassembly. Embedded as heredoc in runbook 12.
- `infra/shopify_products_transform.py` — JSONL → `raw_shopify_products` rows (one per variant). Embedded as heredoc in runbook 13.

### Samples (used for DDL design)

- `infra/samples/meta_campaign_insights.json`, `meta_ad_insights.json`, `fb_posts.json`, `ig_media.json`, `ig_reels.json`, `ig_account_insights.json`

---

## 10. Secret Manager state

System-wide:
- `sa-n8n-writer-key`

Manami (5 active):
- `shoptet-manami-client-id`, `shoptet-manami-client-secret`, `shoptet-manami-shop-url`
- `ecomail-manami-api-key`, `ecomail-manami-region`

Meta (6 per client × 2 clients):
- `meta-manami-app-id`, `meta-manami-app-secret`, `meta-manami-access-token`, `meta-manami-ad-account-id`, `meta-manami-fb-page-id`, `meta-manami-ig-business-id`
- `meta-dobias-app-id`, `meta-dobias-app-secret`, `meta-dobias-access-token`, `meta-dobias-ad-account-id` (= `act_38180535`), `meta-dobias-fb-page-id`, `meta-dobias-ig-business-id`

Dobias Klaviyo:
- `klaviyo-dobias-api-key`, `klaviyo-dobias-region` (= `us`)

**Dobias Shopify (FULLY POPULATED this session):**
- `shopify-dobias-shop-domain` = `dr-dobias-natural-healing-usa.myshopify.com`
- `shopify-dobias-client-id` = the Dev Dashboard Client ID
- `shopify-dobias-client-secret` = the Dev Dashboard Client Secret (`shpss_…`)
- `shopify-dobias-api-version` = `2026-04`
- `shopify-dobias-access-token` — **OBSOLETE.** Held the old `shpss_` value during the auth saga; not used by the current workflow. Safe to delete.

`sa-n8n-writer` has project-level **Secret Manager Secret Accessor** role — new secrets auto-inherit.

---

## 11. Hard rules (carried forward + reinforced)

1. **Never paste secrets in chat.** Direct to Secret Manager. Hit this *three times* this session; the user rotated each time. When pulling secret values for use, always use command substitution (`TOKEN=$(gcloud secrets versions access …)`) so values never appear in shell history or chat.
2. **Repo push only when Matěj asks.** Don't auto-commit/push.
3. **Don't break the Manami Shoptet pipeline.** CSV web export Code node body is the only one not in JSON — see commit `5cd3a4f` and brief v1 §6 for full source.
4. **Raw is append-only.** Never UPDATE/DELETE raw. Dedup in stg.
5. **`payload_json` preserved on every raw row.** Non-negotiable audit trail.
6. **Workflows per-source, not per-client.** Loop over `ref.clients` filtered by `has_<source>=TRUE`.
7. **PII firewall:** `sa-n8n-writer` writes raw + ops only. `sa-frontend-reader` reads mart only. Never both.
8. **Matěj writes nothing.** Claude writes files, code, runbooks. Matěj clicks buttons in UIs and pastes block-commands.
9. **Looker queries mart.\*, never raw or stg.**
10. **Currency policy:** native per source, no in-ingest conversion. FX deferred to Phase 2.
11. **NEW: Shopify auth is OAuth client-credentials grant** for any new client. Never expect a static `shpat_` token unless the merchant already has an existing legacy custom app from before Jan 1 2026.
12. **NEW: When the warehouse disagrees with a source by more than ~5%**, suspect a `source_name` you haven't seen before (Matrixify, other import tools), inconsistent casing (lowercase vs UPPERCASE financial_status), or a date-boundary timezone shift. Diagnose the source first, then the math.

---

## 12. The first thing to do in a new session

Recommended opening sequence:

**1. Pull latest:**
```bash
cd ~/Documents/Claude/Projects/one-eighty-dashboard && git pull && git log --oneline -10
```

**2. Sanity check BQ state** via the BQ MCP (`mcp__806eaa04-…__execute_sql_readonly`). Connector is **flaky** — if it errors with "connection invalidated," ask Matěj to reconnect it. Suggested queries:

```sql
-- Dobias real revenue (no Matrixify, with gross profit & net estimate) — last 30 days
SELECT currency,
  ROUND(SUM(revenue), 0) AS revenue,
  ROUND(SUM(gross_profit), 0) AS gross_profit,
  ROUND(SUM(net_profit_estimated), 0) AS net_profit_estimated
FROM `oneeighty-warehouse.mart.mart_daily_kpis`
WHERE client_id = 'dobias'
  AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY currency;

-- Verify Shopify cron is fresh
SELECT MAX(ingested_at) FROM `oneeighty-warehouse.raw.raw_shopify_orders`;

-- US vs Canada split for the last 30 days
SELECT shipping_country, COUNT(*) AS orders, ROUND(SUM(revenue), 0) AS revenue
FROM `oneeighty-warehouse.mart.mart_orders`
WHERE client_id = 'dobias' AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY shipping_country ORDER BY orders DESC;
```

**3. Confirm Looker has been refreshed.** If the user is still seeing inflated old numbers, walk them through "Refresh fields" on each data source (especially the ones that lost the old `shop_currency` / `meta_currency` columns).

**4. Ask Matěj which of the open items to tackle:**
- **(a) Refund netting** — re-pull orders with `totalRefundedSet` to exact-match Shopify (closes the residual 2.8%).
- **(b) Regenerate `mart_daily_kpis_dictionary.xlsx`** — it's stale.
- **(c) Build the Looker dashboard pages** on the now-clean mart (the actual visible product — runbook 11).
- **(d) n8n error workflow** to ClickUp.
- **(e) Move OpEx 30% from hardcoded literal to `ref.clients.opex_pct`.**
- **(f) GA4 BigQuery Linking.**
- **(g) Meta daily_budget ingest.**
- **(h) Update runbook 06 to reflect the new Shopify auth.**

**Default suggestion: (c)** — the Looker rebuild on the clean mart is the visible payoff after a long Shopify saga. Everything else either parallels it or is polish.

---

## 13. Tone & working style notes

- Matěj prefers Czech informal context but works in English. Switches to Czech occasionally; **answer in English unless he switches deliberately**.
- **Values directness.** Push back when he jumps ahead of decisions or asks for things that solve imaginary problems. He'll respect it.
- He's a marketer, not a developer. Can SSH and run SQL but won't debug TypeScript. Write runbooks in plain prose with copy-paste-ready commands.
- He wants **weekend-scale wins**, not week-scale. Many things take 3× the estimate due to n8n quirks; budget accordingly.
- **Brevity beats thoroughness mid-task.** Long thorough docs are great as references but not as iterative answers.
- **He'll delegate autonomous work when he steps away** ("go and solve it on your own"). When he does: investigate fully, fix what's broken, update repo files, leave a clean summary on his return.
- **Trust his domain intuition.** When he says "GutSense definitely has cost" against aggregate data telling you otherwise, dig. It was right.

---

## 14. Tools used this session

- **BigQuery MCP** (`mcp__806eaa04-..__execute_sql` / `_readonly`) — heavy use for live queries + DDL execution. **Connector drops frequently** — every other turn the session needed it reconnected. Workaround: have Matěj run `bq query` in Cloud Shell when the MCP is down.
- **n8n MCP** (`mcp__45167f53-..__*`) — read-only and points at a different n8n instance than the Hostinger VPS. We delivered workflow JSON files for re-import; never ran/edited workflows via MCP.
- **WebSearch / WebFetch** — used to verify Shopify's 2026 Dev Dashboard / client-credentials docs after the legacy-token approach failed. Saved a guess-and-iterate loop.
- **xlsx skill** (`anthropic-skills:xlsx`) — used to generate the metric-dictionary spreadsheet. Required `python3 -m pip install --user openpyxl` first.

If both MCPs are available in the next session, prefer them over copy-paste. If BQ MCP keeps dropping, fall back to `bq query` in Cloud Shell.

---

## 15. Quick reference — verifying Shopify auth works (post-setup)

If the next session ever needs to check that the Shopify connection is healthy:

```bash
SHOP=$(gcloud secrets versions access latest --secret=shopify-dobias-shop-domain --project=oneeighty-warehouse)
CID=$(gcloud secrets versions access latest --secret=shopify-dobias-client-id --project=oneeighty-warehouse)
CSEC=$(gcloud secrets versions access latest --secret=shopify-dobias-client-secret --project=oneeighty-warehouse)

RESP=$(curl -s -X POST "https://$SHOP/admin/oauth/access_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" -d "client_id=$CID" -d "client_secret=$CSEC")
echo "$RESP" | jq 'del(.access_token)'   # shows scope + expires_in; never the token

TOKEN=$(echo "$RESP" | jq -r '.access_token // empty')
[ -n "$TOKEN" ] && curl -s "https://$SHOP/admin/api/2026-04/orders/count.json?status=any" \
  -H "X-Shopify-Access-Token: $TOKEN"
```

Healthy response: `scope` includes `read_orders` + `read_all_orders` + others, `expires_in: 86399`, and orders/count returns a number.

---

## End of brief.

State as of handoff: **all four Dobias sources flowing**; mart layer rebuilt with currency-aware grain, Matrixify cleaned out, country-based market segmentation via `mart_orders`, Dobias gross profit live at daily level, OpEx-aware `net_profit_estimated` added. Looker now matches Shopify within ~3% (gap is refund netting, traceable). The Shopify auth saga is closed.

**Next session priority: the Looker rebuild on the now-clean mart.** That's the visible payoff. Then refunds (exact match), then GA4, then daily_budget, then polish.
