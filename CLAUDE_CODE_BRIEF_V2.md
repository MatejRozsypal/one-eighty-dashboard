# One Eighty Data Warehouse — Claude Code Continuation Brief v2

**Last session ended:** 2026-05-13. Mart layer v2 complete (customer lifetime + cohorts + enhanced daily KPIs). Looker spec written. GA4 and Daily Budget ingest still pending.

**Previous brief:** `CLAUDE_CODE_BRIEF.md` (kept for historical reference — pre-Klaviyo/Meta era). This v2 supersedes it.

This document is the full handoff. Read top to bottom before touching anything.

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
- **ref.\*** — registry tables (`clients`, `fx_rates` pending, `product_costs` pending).
- **stg.\*** — deduped views via `ROW_NUMBER() OVER (...) ORDER BY ingested_at DESC`. 14 views live.
- **mart.\*** — pre-aggregated, cross-source, dashboard-ready. **11 views live.** Looker queries mart exclusively.
- **ops.\*** — `pipeline_log`, `access_log`, `fx_rates_log` (pending).

---

## 2. Clients in scope

| Client | Country | Currency | Sources active | Status |
|---|---|---|---|---|
| **Manami** | Czech Republic | **CZK** | Shoptet ✅ + Ecomail ✅ + Meta Ads ✅ + IG media ✅ | Active, all flowing |
| **Dobias (Dr. Dobias Natural Pet Health)** | Canada | **CAD** (shop+email) / **USD** (Meta) | Klaviyo ✅ + Meta Ads ✅ (24 days only — account inactive before April 2026). **Shopify pending** `shpat_` token from his dev. | Active, blocked on Shopify |

`ref.clients` currently has exactly these 2 rows. The old `dr-dobias` stub row was deleted during onboarding.

---

## 3. Decisions locked in (don't re-litigate)

| Decision | Value |
|---|---|
| GCP project ID | `oneeighty-warehouse` |
| BQ dataset names | `raw`, `ref`, `stg`, `mart`, `ops` |
| Dashboard domain (Phase 4) | `dashboard.oneeighty.cz` |
| Backfill window | 24 months (12-month rolling for Meta auto-backfill) |
| Frontend MVP auth | Google SSO `@oneeighty.cz` only |
| Failure alert email | `matej@oneeighty.cz` |
| Currency policy | Native per source. Manami=CZK throughout. Dobias=CAD for shop+email, **USD for Meta** (immutable). FX conversion deferred (Phase 2 with `ref.fx_rates`). |
| Secret naming | `<source>-<slug>-<key>` (lowercase, hyphens only) |
| Mart refresh | Looker queries views directly (no scheduled materialization yet); per-source workflows append raw on cron |
| GA4 ingest path | Native BigQuery Linking when wired (NOT n8n) |
| Looker source | **mart.* exclusively** — never raw or stg |
| Workflow architecture | Per-source loop over `ref.clients`. Workflows continue on per-iteration failures via `onError: continueRegularOutput` + `alwaysOutputData: true`. |
| Shoptet ingest | **CSV web export via HTTP node**, parsed by JS Code node. See §6.1. |
| Meta App ownership | Currently owned by Manami's BM (mistake) — TODO to migrate to a One Eighty BM. Tracked in `TODO_meta_app_ownership_migration.md`. |

---

## 4. Repo

- **GitHub:** https://github.com/MatejRozsypal/one-eighty-dashboard
- **Local clone:** `~/Documents/Claude/Projects/one-eighty-dashboard/`
- **Latest commit at handoff:** `f8f501e` "Mart layer v2: customer lifetime + cohorts + enhanced daily KPIs"

### Folder layout

```
infra/
  bigquery/    -- DDL files numbered 001-100, 200 (stg views), 300 (mart views)
  n8n/         -- workflow JSON files + spec .md per source
  samples/     -- Graph API response samples used to design DDL
  secrets/     -- README only — no credentials
runbooks/      -- click-by-click guides (01-11) + TODO_* parked work
dashboard/     -- Next.js 14 scaffold (Phase 4, untouched this session)
```

### First thing to do in a new session

```bash
cd ~/Documents/Claude/Projects/one-eighty-dashboard && git status && git log --oneline -15 && ls -la infra/bigquery/ infra/n8n/ runbooks/
```

Then sanity check BigQuery state via the BQ MCP if available (`mcp__*__execute_sql_readonly` tools).

---

## 5. State of every workflow

### 5.1 Workflows live and on cron

| Workflow | File | Cron | Behavior |
|---|---|---|---|
| **wf_shoptet** | (built directly in n8n, not in JSON file) | Daily 04:00 CET | CSV web export, 14-day rolling watermark in Code node. Manami only. **Active**. |
| **wf_ecomail_to_bigquery** | `infra/n8n/wf_ecomail_to_bigquery.json` | Every 6h | 3 branches: campaigns + automations + lists. Manami only. **Active**. |
| **wf_klaviyo_to_bigquery** | `infra/n8n/wf_klaviyo_to_bigquery.json` | Every 6h :20 | 3 branches: campaigns + flows + forms. Dobias only. **Active**. |
| **wf_meta_ads_to_bigquery** | `infra/n8n/wf_meta_ads_to_bigquery.json` | Every 30 min (was hourly :15) | Auto-detects new clients (empty BQ → 12 chunks of 30 days, 12-month rolling). Existing clients → yesterday only. Continue-on-fail enabled. **Active**. |
| **wf_instagram_to_bigquery (media branch only)** | `infra/n8n/wf_instagram_to_bigquery.json` | Every 6h :30 | Manami media flows. Account_insights branch **deactivated** in n8n due to token scope issue. |

### 5.2 Workflows built but not flowing

| Workflow | File | Blocker |
|---|---|---|
| **wf_shopify_to_bigquery** | `infra/n8n/wf_shopify_to_bigquery.json` | **Waiting on `shpat_` Admin API token from Dobias's dev.** Dev sent `shpss_` (Storefront) by mistake; chase resumed. |
| **wf_facebook_organic_to_bigquery** | `infra/n8n/wf_facebook_organic_to_bigquery.json` | Token scope + needs Page Access Token swap node. Documented in `runbooks/TODO_facebook_instagram_pending.md`. |
| **wf_instagram_to_bigquery account_insights branch** | (in IG workflow, disabled) | `(#10) Application does not have permission` — needs `instagram_manage_insights` scope verified on the regenerated token. |

---

## 6. Critical lessons learned (DO NOT re-debug these)

### 6.1 n8n quirks

| Symptom | Root cause | Fix |
|---|---|---|
| Workflow stops after first iteration of SplitInBatches | Loop downstream chain emits `[]` somewhere → loopback never fires | **`alwaysOutputData: true`** on Transform + BQ Insert nodes |
| Per-iteration silent failure halts whole workflow | Default n8n behavior on error | **`onError: continueRegularOutput`** on Fetch + BQ Insert nodes |
| Manual "Execute step" skips parallel-fan-out branches | n8n only traces one upstream path | **Chain sequentially**, not parallel from Loop |
| `time_range` expression returns empty/breaks | n8n's expression parser chokes on JSON-shaped values | **Pre-build time_range string in a Code node** (e.g. Plan execution), pass via `={{ $json.time_range }}` simple reference |
| n8n's built-in pagination loops forever on `null` next | `paging.next: null` becomes literal string "null" URL | **Disable pagination**, use `page[size]=100` if endpoint allows. For Meta use 30-day chunks (not 90) — Meta returns 500 on big payloads. |
| Klaviyo: `'page_size' is not a valid field for resource 'campaign'` | Klaviyo rejects page[size] on campaigns endpoint | Drop the param, accept default page size (~100 per endpoint) |
| Klaviyo: response comes back as string `{"data": "..."}` | Default Response Format wasn't JSON | **HTTP Request → Options → Response Format → JSON** |
| HTTP node sends timestamp `2026-04-22T15:21:31+0000` → BQ rejects | BQ streaming insert wants `YYYY-MM-DD HH:MM:SS` not ISO with T+Z | **`fmtTs` helper** in every Transform node (already baked into all relevant workflows) |

### 6.2 BigQuery quirks

| Symptom | Fix |
|---|---|
| `Unexpected keyword ROWS at [...]` | `rows` is reserved word → backtick: `` `rows` `` |
| `TIMESTAMP_SUB does not support the MONTH date part` | Use `INTERVAL 730 DAY` or `DATE_SUB` on DATE column instead |
| Streaming insert silently drops rows on REPEATED STRUCT | **Use STRING column + `JSON.stringify(array)` in Transform** instead of `ARRAY<STRUCT<...>>` |
| `Array specified for non-repeated field` | Transform still passing array; switch to `JSON.stringify(arr ?? [])` |
| `Could not parse '...' as timestamp` | Use the `fmtTs` helper |
| `require_partition_filter` blocks query | Every query MUST have a WHERE on the partition column. Stg views already include this; mart views inherit. Looker auto-adds when date range control is set. |
| Streaming insert latency 5-30 min before query visibility | Use `SELECT row_count FROM \`...__TABLES__\` WHERE table_id=...` to bypass buffer. Or switch n8n BQ node to "Load Job" mode (free, instant) — currently still streaming. |

### 6.3 Meta API quirks

| Quirk | Workaround |
|---|---|
| `time_increment=1` capped at ~90 days per request | 30-day chunks (12 chunks × 30 days = rolling 12 months) |
| Service Unavailable / 500 on heavy 90-day ad-level requests | Smaller chunks (30 days) + `onError: continueRegularOutput` |
| Token must have asset assignment AND app assignment | System User in BM needs **Add Assets → App** with "Develop app" permission, not just Ad Account |
| App owner BM != client BM → app must be shared | Share app from owner BM to client BM. Currently Manami owns the app (TODO migration). |
| Page-level endpoints reject System User token | Need to swap for Page Access Token via `/{page_id}?fields=access_token` first. **Not yet implemented in wf_facebook_organic.** |
| `currency` field was lost during a DROP+RECREATE of raw_meta_*_insights tables | Currency hardcoded via CASE in mart: manami→CZK, dobias→USD |
| Meta uses `$` for both USD and CAD in UI — don't trust visually | Verify via Graph API: `act_<id>?fields=currency,name,timezone_name` |

### 6.4 Security incidents
- **Credentials leaked once** in chat during initial Meta setup (App Secret + System User token). Both were rotated immediately. **Hard rule reinforced:** secrets never in chat, always Secret Manager directly.

---

## 7. BigQuery state (verified live at handoff)

### 7.1 Raw layer (data flowing for active sources)

| Table | Rows | Range | Notes |
|---|---|---|---|
| `raw.raw_shoptet_orders` | 2,548 | 2024-05-06 → 2026-05-13 | 24 months, Manami only |
| `raw.raw_shoptet_order_items` | 4,846 | 2024-05-06 → 2026-05-13 | Same |
| `raw.raw_ecomail_campaigns` | ~100s | All time | Append-only with snapshots |
| `raw.raw_ecomail_automations` | Daily snapshots | — | metric_type='cumulative' |
| `raw.raw_ecomail_lists` | Daily snapshots | — | — |
| `raw.raw_klaviyo_campaigns` | 288 | 2025-12-12 → today | Manami's full Klaviyo history (Dobias has ~5 months active) |
| `raw.raw_klaviyo_flows` | Daily snapshots | — | Metadata only — `/api/flows/` doesn't return stats. /flow-series-reports/ deferred. |
| `raw.raw_klaviyo_forms` | 20 | Today | Daily snapshot |
| `raw.raw_meta_campaign_insights` | 1,109 | 2025-05-07 → 2026-05-13 (Manami) + 2026-04-20 → 2026-05-13 (Dobias) | 12-month backfill complete |
| `raw.raw_meta_ad_insights` | 4,170 | Same | Same |
| `raw.raw_instagram_media` | 100 | 8 months back | Manami |
| `raw.raw_instagram_account_insights` | 0 | — | Disabled (token scope) |
| `raw.raw_facebook_posts` | 0 | — | Workflow not active |
| `raw.raw_shopify_*` | 0 | — | Awaiting Dobias's dev's `shpat_` |

### 7.2 Stg views (14 deduped views) — live

`stg.stg_shoptet_orders`, `stg_shoptet_order_items` (pre-existing, snake_case aliases), `stg_ecomail_campaigns`, `stg_ecomail_automations`, `stg_ecomail_lists`, `stg_klaviyo_campaigns`, `stg_klaviyo_flows`, `stg_klaviyo_forms`, `stg_meta_campaign_insights`, `stg_meta_ad_insights`, `stg_instagram_media`, `stg_instagram_account_insights`, `stg_shopify_orders`, `stg_shopify_products`, `stg_shopify_customers`, `stg_facebook_posts`.

DDL: `infra/bigquery/200_create_stg_views.sql`.

### 7.3 Mart views (11 dashboard-ready views) — live

| View | Purpose |
|---|---|
| `mart.mart_daily_kpis` | All Profitability + Shop Performance scorecards + time series. Includes `mer`, `cac`, `gross_margin_pct`, `meta_gross_profit_naive`, etc. |
| `mart.mart_customer_lifetime` | One row per customer. Powers LTV, LTGP, return rate. (2,014 Manami customers, avg LTV CZK 1,193.) |
| `mart.mart_customer_cohorts` | Cohort-by-first-order-month for cohort retention analysis |
| `mart.mart_sku_perf` | Top-SKUs bar + SKU table |
| `mart.mart_product_perf` | Products table |
| `mart.mart_meta_campaign_perf` | Campaign Performance table on FB Ads page |
| `mart.mart_meta_ad_perf` | Ad Performance table on FB Ads page |
| `mart.mart_email_campaign_perf` | Email campaigns (UNION Ecomail + Klaviyo) |
| `mart.mart_email_flow_perf` | Email flows (UNION) |
| `mart.mart_email_subscribers` | Subscriber counts (Ecomail only) |

DDL: `infra/bigquery/300_create_mart_views.sql`.

**Live verification (Manami, 24-month window):**
- Revenue CZK 2.38M
- Gross profit CZK 1.63M
- Meta spend CZK 273k
- MER 8.71
- 2,014 customers, avg LTV CZK 1,193, avg LTGP CZK 817

---

## 8. Pending / open work

### Priority 1 — Unblocks dashboards

- [ ] **Wait on Dobias's dev's `shpat_` token.** Spec: `runbooks/06_dobias_shopify_dev_spec.md`. Currently chasing — dev sent wrong token type initially (`shpss_` Storefront). Once token arrives:
  1. Drop into Secret Manager as `shopify-dobias-access-token` (new version)
  2. Execute `wf_shopify_to_bigquery` manually — 24-month backfill auto-fires (watermark falls back to 730 days when table is empty)
  3. Verify in `mart_daily_kpis` for Dobias

- [ ] **Rebuild Looker Studio dashboards on mart.\*** — full spec in `runbooks/11_metric_to_mart_mapping.md`. Every dashboard tile → mart view → field mapped. Start with Shop Performance (single-source, easiest validation), then FB Ads, Email, Profitability.

### Priority 2 — Fix in-flight

- [ ] **IG account insights branch** — token scope issue. Steps in `runbooks/TODO_facebook_instagram_pending.md` §1. Regenerate System User token verifying `instagram_manage_insights` is ticked, update Secret Manager, re-activate the 4 disabled nodes.

- [ ] **Facebook organic posts** — needs Page Access Token swap node. Steps in `TODO_facebook_instagram_pending.md` §2. Add new HTTP node between Decode secrets and Watermark posts to fetch `/{page_id}?fields=access_token`, then use that token in Fetch posts.

- [ ] **Facebook Page Insights** — separate ingest, deferred. `TODO_facebook_instagram_pending.md` §3.

### Priority 3 — Feature additions

- [ ] **GA4 BigQuery Linking** (~2h) — enable in GA4 admin, daily + streaming export. Then write:
  - `infra/bigquery/012_create_raw_ga4.sql` (BQ auto-creates `events_*` tables; we just add stg views over them)
  - `infra/bigquery/213_create_stg_ga4.sql`
  - `infra/bigquery/304_create_mart_ga4.sql` — channels, funnel, active users
  - Looker tiles flagged "GA4 pending" become live.

- [ ] **Meta `daily_budget` ingest** (~30 min) — modify `wf_meta_ads` to fetch `/{campaign_id}?fields=daily_budget` after insights, add `daily_budget`/`lifetime_budget` columns to `raw_meta_campaign_insights`, expose in `mart_meta_campaign_perf`.

- [ ] **Klaviyo flow stats backfill** (~30 min) — current `/api/flows/` returns metadata only. Add a POST to `/api/flow-values-reports/` with `conversion_metric_id` (auto-discoverable via `/api/metrics/?filter=equals(name,'Placed Order')`). New table `raw_klaviyo_flow_series` for time-series perf.

- [ ] **Klaviyo lists ingest** — add 4th branch fetching `/api/lists/{id}` for subscriber counts. Then `mart_email_subscribers` becomes multi-platform.

- [ ] **Shoptet multi-tenant** — currently hardcoded `CLIENT_ID='manami'` in Code node. When a 2nd Czech client lands, rewrite to loop over ref.clients with secret-fetch per slug. Pattern in `infra/n8n/wf_shopify_to_bigquery.json` (already multi-tenant).

### Priority 4 — Architecture cleanup

- [ ] **Meta App ownership migration** — currently Manami's BM owns the app. Move to a One Eighty BM. Steps in `runbooks/TODO_meta_app_ownership_migration.md`. Do before client #3 onboards.

- [ ] **FX rates layer (Phase 2 currency)** — `ref.fx_rates` DDL + daily `wf_fx_rates` workflow pulling from openexchangerates.org or exchangerate.host. Then mart views can convert USD→CAD for Dobias's Meta spend.

- [ ] **Switch BQ Inserts from streaming to load jobs** — current setup uses streaming inserts ($0.01/200MB + ~5-30 min query latency). Load jobs are free + instant. Open BQ Insert nodes → look for "Use Load Job" or operation type toggle.

- [ ] **Phase 4 frontend** — `dashboard/` directory has Next.js 14 scaffold from earlier. Once mart is feeding Looker stably, build the custom dashboard.

---

## 9. File index — what's in the repo

### Runbooks (read these first)
- `01_gcp_setup.md` — original GCP project + service accounts setup
- `02_secret_manager.md` — Secret Manager click-by-click
- `03_shopify_custom_app.md` — early Shopify app setup
- `04_n8n_workflow_pattern.md` — universal workflow shape
- `05_ecomail_n8n_setup.md` — Ecomail workflow build
- `06_dobias_shopify_dev_spec.md` — **send this to Dobias's dev for Shopify creds**
- `07_meta_app_and_system_user.md` — Meta App setup
- `08_dobias_full_onboarding.md` — full Dobias onboarding (Shopify + Klaviyo + Meta)
- `09_klaviyo_dev_spec.md` — send to Klaviyo admin for API key
- `10_looker_studio_metrics_spec.md` — Looker metrics spec (mostly superseded by 11)
- `11_metric_to_mart_mapping.md` — **THE GUIDE for rebuilding Looker on mart**
- `TODO_facebook_instagram_pending.md` — FB/IG fixes parked
- `TODO_meta_app_ownership_migration.md` — Meta App BM transfer

### BigQuery DDL (run order)
1. `001_create_datasets.sql` — datasets
2. `002_create_clients_registry.sql` — ref.clients
3. `003_seed_clients.sql` — seed Manami + Dobias
4. `004_create_raw_shoptet.sql`
5. `005_create_raw_ecomail.sql` (rewritten to match real API field names)
6. `005a_drop_raw_ecomail.sql` — one-time migration
7. `006_create_raw_shopify.sql`
8. `007_create_raw_klaviyo.sql`
9. `007a_create_raw_klaviyo_forms.sql` — added later
10. `008_create_ops.sql`
11. `009_create_raw_meta_ads.sql`
12. `010_create_raw_instagram.sql`
13. `011_create_raw_facebook.sql`
14. `100_mart_daily_kpis.sql` — **OBSOLETE** — superseded by 300
15. `200_create_stg_views.sql` — stg layer (14 views)
16. `300_create_mart_views.sql` — mart layer (11 views) **canonical**

### n8n workflow JSONs (importable)
- `wf_shoptet.md` — spec (Manami workflow lives directly in n8n, no JSON)
- `wf_ecomail_to_bigquery.json` — Manami email
- `wf_shopify_to_bigquery.json` — Dobias shop (pending creds)
- `wf_klaviyo_to_bigquery.json` — Dobias email
- `wf_meta_ads_to_bigquery.json` — both clients, auto-backfill
- `wf_instagram_to_bigquery.json` — both clients
- `wf_facebook_organic_to_bigquery.json` — pending fixes

### Samples (used for DDL design)
- `infra/samples/meta_campaign_insights.json`, `meta_ad_insights.json`, `fb_posts.json`, `ig_media.json`, `ig_reels.json`, `ig_account_insights.json`

---

## 10. Secret Manager state (12 secrets in use)

System-wide:
- `sa-n8n-writer-key`

Manami (5 active):
- `shoptet-manami-client-id`, `shoptet-manami-client-secret`, `shoptet-manami-shop-url`
- `ecomail-manami-api-key`, `ecomail-manami-region`

Meta (6 per client × 2 clients):
- `meta-manami-app-id`, `meta-manami-app-secret`, `meta-manami-access-token`, `meta-manami-ad-account-id`, `meta-manami-fb-page-id`, `meta-manami-ig-business-id`
- `meta-dobias-app-id`, `meta-dobias-app-secret`, `meta-dobias-access-token`, `meta-dobias-ad-account-id` (= `act_38180535`), `meta-dobias-fb-page-id`, `meta-dobias-ig-business-id`

Dobias Klaviyo (2):
- `klaviyo-dobias-api-key`, `klaviyo-dobias-region` (= `us`)

Dobias Shopify (3 — pending real values):
- `shopify-dobias-shop-domain`, `shopify-dobias-access-token`, `shopify-dobias-api-version`

`sa-n8n-writer` has project-level **Secret Manager Secret Accessor** role — new secrets auto-inherit.

---

## 11. Hard rules (carried forward from v1, reinforced)

1. **Never paste secrets in chat.** Direct to Secret Manager. Hit this twice; second time the user rotated immediately.
2. **Repo push only when Matěj asks.** Don't auto-commit/push.
3. **Don't break the Manami Shoptet pipeline.** CSV web export Code node body is the only one not in JSON — see commit `5cd3a4f` and brief v1 §6 for full source.
4. **Raw is append-only.** Never UPDATE/DELETE. Dedup in stg.
5. **`payload_json` preserved on every raw row.** Non-negotiable audit trail.
6. **Workflows per-source, not per-client.** Loop over `ref.clients` filtered by `has_<source>=TRUE`.
7. **PII firewall:** `sa-n8n-writer` writes raw + ops only. `sa-frontend-reader` reads mart only. Never both.
8. **Matěj writes nothing.** Claude writes files, code, runbooks. Matěj clicks buttons in UIs.
9. **Looker queries mart.*, never raw or stg.**
10. **Currency policy:** native per source, no in-ingest conversion. FX deferred to Phase 2.

---

## 12. The first thing to do in a new session

Recommended opening sequence:

1. **Pull latest:**
   ```bash
   cd ~/Documents/Claude/Projects/one-eighty-dashboard && git pull && git log --oneline -10
   ```

2. **Sanity check BQ state** via BQ MCP (if available):
   ```sql
   SELECT 'manami_meta' AS t, COUNT(*) AS rows FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE client_id='manami' AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
   UNION ALL SELECT 'dobias_meta', COUNT(*) FROM `oneeighty-warehouse.mart.mart_daily_kpis` WHERE client_id='dobias' AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
   UNION ALL SELECT 'manami_customers', COUNT(*) FROM `oneeighty-warehouse.mart.mart_customer_lifetime` WHERE client_id='manami';
   ```

3. **Check Dobias Shopify token status:**
   ```sql
   SELECT row_count FROM `oneeighty-warehouse.raw.__TABLES__` WHERE table_id='raw_shopify_orders';
   ```
   If > 0, the dev came through and we have data. If 0, still waiting.

4. **Ask Matěj which of these to tackle:**
   - **(a)** Build Looker Studio pages on mart (Shop Performance → FB Ads → Email → Profitability)
   - **(b)** Wire up Shopify once `shpat_` arrives
   - **(c)** Fix IG account insights + FB organic (TODO file)
   - **(d)** Add GA4 BigQuery Linking
   - **(e)** Add Meta daily_budget ingest
   - **(f)** Add Klaviyo flow-series-reports for historical flow perf
   - **(g)** Meta App ownership migration to One Eighty BM

   **Default suggestion: (a)** — Looker rebuild on mart is the next visible win. Everything else is either blocked on external (Shopify dev, GA4 admin clicks) or "polish".

---

## 13. Tone & working style notes

- Matěj prefers Czech informal context but works in English. Switches to Czech occasionally; answer in English unless he switches deliberately.
- Values directness. Push back when he jumps ahead of decisions or asks for things that solve imaginary problems. He'll respect it.
- He's a marketer, not a developer. Can SSH and run SQL but won't debug TypeScript. Write runbooks in plain prose with copy-paste-ready commands.
- He wants weekend-scale wins, not week-scale. Many things have taken 3× the estimate due to n8n quirks; budget accordingly.
- **Brevity beats thoroughness mid-task.** Long thorough docs are great as references but not as iterative answers. He asked twice for "concise, save on credits."

---

## 14. Tools used this session

- **BigQuery MCP** (`mcp__806eaa04-..__execute_sql` / `_readonly`) — used heavily for live queries + DDL execution. Saves the "paste me the SQL" round-trips.
- **n8n MCP** (`mcp__45167f53-..__*`) — read-only and pointed at a different n8n instance than Matěj's Hostinger VPS. Couldn't edit workflows. We delivered JSON files for him to re-import.

If both MCPs are available in the next session, prefer them over copy-paste.

---

## End of brief.

State as of handoff: ~85% complete on data plumbing. Mart layer is solid. Two clients flowing for everything except Shopify (Dobias, blocked) and FB organic + IG account insights (token scope). The next session should prioritize Looker rebuild on mart unless Dobias's dev came through.
