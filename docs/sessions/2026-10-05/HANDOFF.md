# Handoff: One Eighty dashboard, sessions 2026-10-04/05

Paste the "Next session prompt" at the bottom into a new Claude Code session started in `/Users/matej/Documents/_One Eighty/OE Second Brain`.

## Where things live
- Code: GitHub `MatejRozsypal/one-eighty-dashboard`, local clone `OE Second Brain/one-eighty-dashboard-repo`, branch `main` = prod. **A push to `main` auto-deploys dashboard.oneeighty.cz** (Vercel). Push via SSH remote. Last prod commit this session: `9486f63` + docs.
- `OE Second Brain/one-eighty-dashboard/` is a hollow old docs copy, not the source.
- Worktrees used per package: `OE Second Brain/oe-dash-wt/<branch>` (can be pruned: `git worktree prune` after deleting the folders).
- Local dev cannot log in or read BigQuery (Vercel env vars are Sensitive, `vercel env pull` gives placeholders). Verify on prod. Browser QA: Claude in Chrome (owner's signed-in Chrome); the built-in browser cannot sign in.
- node/npm: `/Users/matej/.local/node/bin`. Checks: `npm run check:<name>` (capabilities, loading, paid, creative, hitrate, delta, delta-shop, delta-paid, delta-cmpc, retention, reports, reports-eval, reports-pages, reports-widgets, reports-canvas, reports-url, reports-authz, reports-store). `check:queries` / `check:warehouse` need GCP creds.
- All plans, designs, agent reports and QA reports of this session: `docs/sessions/2026-10-05/` (plans/, reports/, qa/, retention/, audit-hitrate/, dobias/). Agent rules: `plans/00_agent_rules.md`.
- Owner checklist: `OWNER_TODO_2026-10.md` (repo root).

## What shipped (all live)
1. Cleanup sprint: capability model (pages hidden for missing sources), `n/a` glyph, ~67% less UI text, no em dashes, empty/error states, pulsing loading everywhere, error boundaries.
2. Paid redesign: Overview (shop-first MER/aMER/nCAC), Meta, Google (brand/non-brand, search terms, products, PMax, IS), GA4 tabs.
3. Reporting suite `/reports`: drag-and-drop builder, semantic layer, internal-only API (security reviewed, F1/F2 fixed), CM3 parity with Snapshot, Meta soft metrics, hit rate, retention metrics.
4. Compare (Prev period / Prev year / None) + `% | 123` delta toggle app-wide; rates always pp.
5. Creative hit rate (Creative tile + trend, Paid Meta tile, Reports): winner = lifetime purchases >= N AND shrunk ROAS >= target, >= 14 days old; launches by first delivery, relaunches excluded, 60-day maturity; reference = client's own 12-month rate; launch-context + pack-level hit rate. Thresholds in Settings (Dobias 3.00/25, Ethia 2.50/10, Manami 2.25/15, Venev 2.10/10).
6. Meta engine audit -> SOP v3 small dated edits (creative winner vs graduation, 14-day period, 7dc+1dv basis, hit-rate definition, relative hook/hold floors); KPI files `_clients/<client>/kpi/meta-thresholds.md`.
7. Attribution windows stored per ad-day (7d click / 1d view / engaged view), n8n branch live; Paid, Creative, hit rate and Reports winner metrics on 7d click + 1d view.
8. Retention: new `/repeat-rate` page (fixed-horizon repeat and discovery->full-size upgrade on mature cohorts, Wilson CIs, KM curve, entry products), Customers/Cohorts/Repurchase fixes, Reports retention metrics.
9. Warehouse migrations deployed: 228-235, 240-243, 250, 251, 253-260 (see `infra/bigquery/` and `infra/bigquery/live/`). Rollback texts were saved per deploy (see reports).

## Open: owner actions (blocking)
1. **Create the BigQuery scheduled query `rpt_refresh_hourly`** (EU, every 1 hour, no destination, run as owner):
   `CALL mart.sp_refresh_rpt_kpis(); CALL mart.sp_refresh_rpt_ad_launch(); CALL mart.sp_refresh_rpt_customer_entry();` (fully qualified with `oneeighty-warehouse.`). Until then rpt_kpis_daily, rpt_ad_launch, rpt_customer_entry are frozen snapshots.
2. GA4 scheduled query `ga4_sessions_daily` + grants for `sa-n8n-writer` (see `reports/deploy_243.md`); GA4 links for Ethia and RawBark; Venev GA4 export stalled since 2026-08-19.
3. `feed_freshness` scheduled query update (230b) and Google Ads backfill for 2026-09-17 (RawBark).
4. Creative assets: run `infra/creative_assets_job.py ethia` (and dobias manami venev) in Cloud Shell, then schedule it (Cloud Run job, runbook 29). Owner was running it at session end: verify `mart_creative_asset` has Ethia rows, then CALL `mart.sp_refresh_rpt_ad_launch()` and recheck Ethia hit rate / launch context.
5. RawBark: Meta access + secrets, COGS per kg (template `_clients/rawbark/warehouse/rawbark-cogs-template-v2.csv`), rotate Woo API key, brand terms (Manami, RawBark).
6. Venev target CPA in Settings (form is EUR; 783 CZK ~ 32 EUR, unconfirmed).
7. Ask Manami what "Slevovy kod - testery" (819 orders 2024-05..2025-10) was; Sept Meta ads promise a full-bottle credit that does not exist (claims risk).
8. Shopify products feed for Dobias (stale since 2026-05-19) and Venev (since 2026-08-03): restart decision.

## Open: engineering follow-ups
1. After the scheduled query runs: merge QF1 registry switch commit `7a571b7` (Reports read `mart.rpt_kpis_daily`), then switch pages via `KPIS_SOURCE` per `reports/r3-perf.md` section 4 (Snapshot, Goals, Growth, Paid Overview, Unit economics). Biggest speed win.
2. Add 7dc+1dv basis columns to `mart_meta_campaign_perf` and `mart_daily_kpis` so Snapshot/MER and Reports meta_roas/cpa use the same basis (today Dobias 2.84 there vs 2.98 on Paid) (`reports/me5.md`).
3. Hook rate in Paid/Reports with the fixed `is_video` rule; Reports per-client reference line; METRICS.md updates (5% reference, 36-month texts) (`reports/me3.md`).
4. Paid/Creative layouts: use `getSession()` (double session lookup); `lib/users/accessLog.ts` lock-free schema check.
5. Dobias: register Meta spend 2025-01-01..2026-04-19 as zero in `ref.ad_spend_zero_days` (real 15-month pause, not missing data) and consider a retention `history_guard_days` for Dobias (store migration artefacts May/Jun 2024).
6. Product classes (`ref.product_classes`) for clients other than Manami to enable discovery/upgrade metrics.
7. Experiment support for Manami "Tester to Full" holdout (design `retention/03_design.md` section 5) when owner wants it.
8. Cleanup: drop `mart_qa` scratch objects (prefixes wp*, pa*, qf3_, fx1_, hr1_, me1_, me2_, wr1_, wr2*, rs10_, m234_, aud_, dvt_, ret_, base_*), delete n8n backfill workflow `ByGJ1fZkgEAj0EPm` and inactive `BnRCbPqaYSO0zwIS` when no longer needed.
9. Full SOP/playbook revision for the Meta engine (owner: fewer scaling campaigns now; 7dc+1dv standard).

## Key findings to remember
- Dobias view-through (`dobias/01_analysis.md`): ~51% of Meta-claimed purchases are 1-day view; only ~10-20% of that looks incremental; true ROAS ~1.0-1.3 vs reported 2.98; incremental CAC ~$90-120 vs reported ~$52. Recommended: US geo holdout 12 Oct to 22 Nov 2026, daily-synced customer exclusion list on all ad sets, judge Dobias on 7-day click, do not scale past ~$20k/month until the test reads, re-plan $6M Lever 1.
- Manami sample set: 59% enter via Testovaci sada; 365-day repeat 17.2%, perfume 15.2%; no proven improvement (CIs overlap); a 3 pp lift needs ~1,900 per arm.
- Hit rate history (12 months): Dobias 6/35, Ethia 7/156 (all winners from ads added to existing ad sets), Manami 8/120.

## Next session prompt

```
You are continuing the One Eighty dashboard work. First read brain.md, then
one-eighty-dashboard-repo/docs/sessions/2026-10-05/HANDOFF.md fully, then
docs/sessions/2026-10-05/plans/00_agent_rules.md. Work as an orchestrator:
launch subagents per package in git worktrees under oe-dash-wt/, Opus only for
analysis/design/architecture, Sonnet for routine implementation. Never push to
main (= prod deploy) or change prod BigQuery / n8n / Meta without my explicit OK
in this session. No em dashes anywhere.

Start by checking state, without changing anything:
1. Has the scheduled query rpt_refresh_hourly been created? (check
   MAX(refreshed_at) in mart.rpt_kpis_daily, mart.rpt_ad_launch,
   mart.rpt_customer_entry via the BigQuery MCP).
2. Has Ethia got rows in mart.mart_creative_asset (creatives job)?
3. Open items in OWNER_TODO_2026-10.md that are still open.
Then give me a short status and propose the next 3 to 5 engineering packages
from the "Open: engineering follow-ups" list, ranked by impact, and ask which
to run.
```
