# Markets: prod rollout checklist

Branch `mk0-markets-spec` (page + migrations 290 to 294) and branch `mm1-shoptet-market` (migration 284). Every step runs only after the owner's OK. BigQuery steps run in the console, location EU, project `oneeighty-warehouse`.

Owner decisions applied (2026-10-15): Dobias home market = US; refresh daily, not hourly; Ethia forecast hidden until a backtest validates it (`ref.client_markets.forecast_min_age_days` NULL = no forecast); dev preview route `app/dev/markets` stays (404 in production). Left at default: `–` (en dash) is NOT a campaign-name delimiter (one 2023 RawBark campaign, outside every window).

## 0. Before anything

- [ ] Merge `mm1-shoptet-market` into `main` (or cherry-pick 03072b7 into `mk0-markets-spec`) so 284 sits in the repo before 290.
- [ ] Check the scheduler identity can write `mart` and read `stg` / `ref`. Known gap (Goals pacing, 2026-10-07): `sa-n8n-writer` lacks stg read + mart write. Fix the grants first or step 7 fails silently every night.

## 1. Migration 284: Shoptet market country
- [ ] Run `infra/bigquery/284_shoptet_market_country.sql` (branch `mm1-shoptet-market`).
- [ ] Check: Manami orders last 12 months by `shipping_country` in `stg.stg_customer_orders`, NULL share under 2 % (QA had 0 %: CZ 1,896, SK 348).
- Rollback: re-run the previous `stg` view definitions from `infra/bigquery/live/`.

## 2. Migration 290: `ref.client_markets` + `mart.market_orders`
- [ ] Run `infra/bigquery/290_mk_market_orders.sql`.
- [ ] Check: `SELECT * FROM ref.client_markets` shows Dobias US `is_home = TRUE`, CA FALSE; RawBark, Manami, Venev CZ home, SK EUR; Ethia CZ.
- [ ] Check: `mart.market_orders` row count close to QA (`mart_qa.mk_market_orders`, 140,083 on 2026-10-15).

## 3. Migration 291: spend split
- [ ] Run `infra/bigquery/291_mk_market_spend.sql`. It inserts ONE row into `ref.naming_rules` (dimension `market_spend`); existing rows and the Paid pages are untouched.
- [ ] Check: Dobias L90 spend US 27,389 USD (incl. 4,383 pro rata), CA 23,974 USD (incl. 1,648 pro rata); RawBark L12M UNALLOCATED down by about 222k CZK vs before.

## 4. Migrations 292, 293, 294 (in this order, each ends with its CALL)
- [ ] `292_mk_market_daily.sql`
- [ ] `293_mk_market_cohorts.sql`
- [ ] `294_mk_market_forecast.sql` (also creates `mart.sp_refresh_markets`, the single entry point)
- [ ] Check forecast methods: Dobias US monthly, CA quarterly from day 180, Manami CZ monthly from day 60, Ethia `none` "not backtested in this market yet: forecast hidden", RawBark `none` (no COGS), Manami SK and Venev `none` (under 50 new customers a month).

## 5. Regression
- [ ] Run `infra/bigquery/qa/290_294_regression.sql` pointed at `mart`. Expected: Ethia, Manami, Venev exact vs the audit; RawBark exact at L90; Dobias differs only by the 59 non-shippable orders and the US & CA split (DATA-BUILD.md section 4).
- [ ] Update `infra/bigquery/live/` with the two ref tables, five mart tables and six procedures.

## 6. App
- [ ] Vercel env `MARKETS_SOURCE=mart` (Production) BEFORE the push. The code default is `mart_qa`, so without it prod would read the QA tables.
- [ ] Push `mk0-markets-spec` to `main` (auto-deploys dashboard.oneeighty.cz).
- [ ] On prod check `/markets` for Dobias, RawBark, Manami, Venev, Ethia: map frame, leaderboard, matrix n/a reasons, drawer, Scouting, phone width. UI-BUILD.md section 6 lists what only real data can prove.

## 7. Daily refresh
- [ ] BigQuery > Scheduled queries > Create. Name `markets_refresh_daily`. Query: ``CALL `oneeighty-warehouse.mart.sp_refresh_markets`();``. Daily 05:30 UTC, no destination table, location EU, the service account from step 0, email on failure. Then "Run one time transfer - now" and check it succeeds.
- Cost: about 4.7 GB per run (about 110 GB/day if it were hourly).
- [ ] Next morning: `SELECT MAX(run_date) FROM mart.market_forecast` = today, and the scheduled query's run history shows success (the Markets procedures fail loudly through ASSERT; they do not write `ops.pipeline_log`).

## 8. Clean up after a week of clean runs
- [ ] Drop `mart_qa.mk_*` and `mart_qa.mm1_*`.
