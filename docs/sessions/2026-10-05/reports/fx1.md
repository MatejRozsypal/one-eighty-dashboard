# FX1: ad spend zero days registry (migration 235), deployed to prod 2026-10-04

Branch `fx1-venev-zero`, commit `038d779` (not pushed). Worktree `oe-dash-wt/fx1-venev-zero`.

## Step 1: Venev NULL Meta spend in `mart.mart_daily_kpis` (live, all history)

The data does NOT match the premise "Venev ads started 2026-08-11".

- Venev mart rows: 727 days (2022-07-25 to 2026-10-03). `meta_spend` NULL on 623 days, every one of them has a shop row (the mart has no shop-less NULL day). `google_spend` never exists for Venev.
- First Meta spend date **2025-12-04**, last 2026-10-03. Meta spend months: Dec 2025 (18 days), Jan 2026 (7), Feb (28, all), Mar (4: 03-01 to 03-04), then nothing Apr to mid-Aug, then continuous from **2026-08-18** (stg raw: first Meta row 2026-08-18) to 2026-10-03. July 2026 has no row at all.
- **No mart row exists for 2026-08-10** (no order, no ad row, stg has none either). The "Venev paid_spend NULL on 2026-08-10" in `bugfix_reports_gaps.md` cannot be reproduced; the only Aug 2..31 NULL day is **2026-08-12** (3 orders, no Meta row). Venev has orders on 2026-08-12 and 2026-08-18 only in that window.
- NULL ranges (day-level, 623 days) before the first Meta spend: 606 shop days, 2022-07-25 to 2025-12-03 (the long tail of isolated days and runs, e.g. 2022-08-07..2022-10-12 67 days, 2023-11-16..2023-12-23 38 days). After 2025-12-04: **17 days**: 2025-12-19, 2025-12-26, 2026-01-06, 2026-03-08, 03-09, 03-10, 03-12, 03-25, 2026-04-14, 04-18, 04-28, 2026-05-12, 05-18, 2026-06-02, 06-10, 06-23, **2026-08-12**.

## Step 2: design and what changed

- New `ref.ad_spend_zero_days` (client_id, platform meta|google, date_from, date_to NOT NULL inclusive, note, updated_by, updated_at). Seeded:
  - venev meta 2022-07-25 to 2025-12-03 (everything before the first Meta spend; 606 rows)
  - venev meta 2026-08-10 (owner confirmed; no mart row exists for it, so it changes nothing today, noted in the seed)
- `mart.mart_daily_kpis` (started from LIVE text, md5 `9dc51402...` = 234 body): five edits, two CTEs `meta_zero_days` / `google_zero_days` (SELECT DISTINCT, expanded from ranges), `COALESCE(meta_spend, 0 if meta zero day)`, same for `google_spend` (FLOAT64 0) and `paid_spend` (0 if meta or google zero day), two LEFT JOINs. Properties: fills NULL only (never overrides a value), never creates a row, no fan-out on overlaps, schema identical (34 cols). Ad outcomes stay NULL; cm1/cm2/cm3 unchanged numerically (they already use COALESCE(paid_spend, 0)).
- Files: `infra/bigquery/235_ad_spend_zero_days.sql` (header, table, idempotent seed, view), `infra/bigquery/qa/235_regression.sql`.

## Step 3: tests (mart_qa, prefix fx1_) and prod

- Candidate vs prod, whole-row EXCEPT DISTINCT both directions, date < CURRENT_DATE(), float columns rounded to 6 dp: dobias, ethia, manami, rawbark **0 rows**; venev **606 / 606**, 5364 rows both sides. Column explanation: meta_spend 606 NULL to 0, paid_spend 606 NULL to 0, google/cm/all other columns 0 diff, diff dates 2022-07-25 to 2025-11-27, 0 outside the registry, 17 post-start NULL days unchanged.
- Monthly: 212 / 212 rows, 41 Venev months (2022-07 to 2025-11) NULL to 0 spend, nothing else.
- Synthetic edge registry (`fx1s_*`): no new row from a 2030 range, no fan-out from overlap, a range over real spend never overrides, inverted range inert, RawBark google 2026-09-17 becomes 0/0 only in the synthetic test, Manami real Google spend untouched, cm3 0 changes.
- Rollback saved: `scratchpad/rollback/mart.mart_daily_kpis.pre235.sql` (= 234 body, md5 `9dc5140218469a887bed32050d1bbf0e`).
- Prod deploy: one script, ASSERT live md5 = 9dc5... and candidate md5 = 9a54... before CREATE TABLE, seed INSERT, CREATE OR REPLACE VIEW. Prod view md5 **`9a5405191e68a9be6d52f8f6b5e8cfdc`** = the 235 file body = `live/mart.mart_daily_kpis.sql` body. Registry has 2 rows. Prod vs pre-deploy snapshot: same result as above (venev 606, others 0, monthly 41 Venev rows, bad_meta 0, bad_paid 0, other cols 0).

## Step 4: repo

`infra/bigquery/live/mart.mart_daily_kpis.sql`, new `live/ref.ad_spend_zero_days.sql` (DDL as deployed), `live/README.md` counts, `METRICS.md` (Last updated, new block under Known data gaps with the rule "a NULL spend is missing data unless the day is in ref.ad_spend_zero_days", meta_spend row, Reporting registry note, amendment 22), `PROJECT_LOG.md` top entry. No em dashes added.

## mart_qa objects created (drop after owner go)

Tables: `fx1_ad_spend_zero_days`, `fx1s_ad_spend_zero_days`, `fx1_base_daily_kpis`, `fx1_base_monthly_kpis`. Views: `fx1_mart_daily_kpis`, `fx1s_mart_daily_kpis`, `fx1_mart_monthly_kpis`.

## Open questions for the owner (not seeded, still NULL = missing)

1. The 17 Venev post-start days above. **The one that matters for Reports is 2026-08-12** (Aug 2..31 previous-period window): while it is NULL, the Paid efficiency combined previous-period delta for Sep 2026 stays n/a, i.e. the original symptom is NOT fixed by this migration, because 2026-08-10 has no row. Was Venev not advertising 2026-04-01 to 2026-08-17 (and 2025-12-19, 12-26, 2026-01-06, 03-08 to 03-25)? If yes, one INSERT fixes it (no view change): `INSERT INTO ref.ad_spend_zero_days (client_id, platform, date_from, date_to, note, updated_by) VALUES ('venev','meta',DATE '2026-03-05',DATE '2026-08-17','No Meta ads between the Mar 2026 pause and the Aug 18 restart (owner confirmed)','matej@oneeighty.cz')` (adjust to what the owner confirms; Meta spend exists on 2026-03-01 to 03-04 only in Mar). Then Reports need no code change, but the SEMANTIC_VERSION cache (24h?) may serve old payloads: check.
2. The owner statement "ads started 2026-08-11" vs data 2026-08-18 (and an earlier Dec 2025 to Mar 2026 run).
3. Zero ranges should stay in the past: `ads_last` (context.ts) and `meta_last` (health.ts) read "last non-NULL spend day".
4. MER-type dashboard code on Venev 2022 to 2025 now sees paid_spend 0 instead of NULL; `pnl.ts` uses `safeDiv`, so MER is null, but a UI pass on Venev history (Paid overview, P&L) is worth one look.

## Requests to orchestrator

- Re-run Reports QA on prod (Paid efficiency, Venev, any range before 2025-12-04 now shows spend 0 and Meta ROAS with 0 spend).
- `mart_qa.fx1_*` cleanup with the other candidates.
- `300_create_mart_views.sql` hazard unchanged (would revert 228/234/235).
