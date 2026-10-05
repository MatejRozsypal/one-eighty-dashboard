# Bugfix: gap rule too strict (Meta ROAS "No data", every rollup n/a) (2026-10-04)

Commit `9b49428` on `main` (not pushed). Repo `one-eighty-dashboard-repo`, app `dashboard/`.

## Symptom (prod, Paid efficiency, 5 clients, Sep 1 to 30 2026, prev period, CZK)
- Ethia and Venev Meta ROAS "No data" although both spend on Meta.
- RawBark paid spend, MER, CAC "No data" (Google spend NULL on 2026-09-17).
- Every combined value n/a: KPI tiles (Paid spend, MER, aMER, CAC), weekly MER/aMER and Platform ROAS lines.

## Root causes
1. rs11 marked every `meta_*` / `google_*` column `nullMeans: "gap"` and counted its own NULLs. Read-only BigQuery,
   `mart.mart_daily_kpis`, Sep 2026: `meta_revenue` and `meta_purchases` are NULL with `meta_spend > 0` on
   **4 Ethia days and 26 Venev days**; `meta_revenue = 0` never occurs (the mart encodes "no conversions" as NULL).
   So each Meta ROAS became a gap. Clicks and impressions had no such NULLs. Dobias and Manami: none.
   RawBark: `paid_spend` and `google_spend` NULL only on 2026-09-17 in Sep (Meta NULL all days, not connected).
2. rs11 rollup rule: one client with a gap (or fx_missing / not_measured) nulls the combined and vertical cell.
   RawBark's Sep 17 hole therefore nulled every combined spend metric; Ethia/Venev nulled combined Meta ROAS;
   RawBark nulled combined Google ROAS.

## Fix (owner-approved semantics)
1. **Gap = missing spend only.** New registry field `ComponentDef.missingWhenNull` (`lib/reports/registry/types.ts`,
   validated in `components.ts`): the 8 ad outcomes (`meta_/google_` revenue, purchases, clicks, impressions) point
   to their platform's spend. `compile.ts` counts `COUNTIF(t.<spend> IS NULL)` for them instead of their own NULLs,
   so a NULL outcome on a day with spend is zero, and a day without spend is still a gap for them (CTR, purchases).
   Spend components keep counting their own NULLs. Shop components and COGS unchanged.
2. **Rollups exclude instead of failing** (`evaluate.ts` `rollupOutcome`). Each member is evaluated alone first; a
   member that is a gap ("Missing days"), fx_missing or not_measured for that total or bucket is left out entirely
   (none of its components summed), the rest are summed. Not-connected clients are left out as before. Only when no
   client remains is the cell not ok (shared status of the excluded, else no_data). FX warning months of excluded
   clients still raise the widget's fx warning. Applied to totals, every bucket, combined and vertical.
   Comparison is like for like: the comparison total (and each comparison point) sums exactly the clients of the
   current total (point); if one of them is excluded in the comparison, compareTotal and delta are null.
   Per-client cells unchanged (RawBark stays "Missing days").
3. **Cell contract** (`lib/reports/types.ts` `MetricCell`): `coverage {included, of}` now counts clients actually
   summed into the current total; new `excluded: [{id, name, reason}]` and `pointCoverage: number[]` (rollups).
4. **UI** (minimal): `cellNotes` lists "4 of 5 clients" then "RawBark: Missing days"; `NotesMark` shows the compact
   "4 of 5" as its trigger instead of `^` for a partial rollup (KPI, table, ranked, legends); the line tooltip names a
   partial point "All clients (4 of 5)". No em dashes.
5. `SEMANTIC_VERSION` 3 to 4 (cache keys). Docs: `lib/reports/README.md`, `METRICS.md` (Reporting rules + amendment 21).

## End-to-end verification (offline, read-only BigQuery MCP)
Paid efficiency template widgets planned like `planWidget` (KPIs at week grain via `fetchGrain`), filter: clients
dobias, ethia, manami, rawbark, venev, custom 2026-09-01..2026-09-30, previous period (2026-08-02..2026-08-31), CZK,
clients built from live `ref.clients` + `ref.client_verticals`. Two superset queries compiled by `compileWidget`
(week grain: all components of the 6 week widgets; total grain: scatter + table), params inlined, run via MCP, rows
converted to Node shapes, `normaliseRows` per widget + `evaluateWidget`. Script and rows in `scratchpad/gaps/`
(`_gaps_live.ts`, `week_rows.txt`, `total_rows.txt`, `eval_after.txt`), not committed.

Combined KPI tiles (All clients):
- Paid spend **598,887 CZK**, 4 of 5, excluded RawBark: Missing days
- MER **7.91**, 4 of 5 (RawBark: Missing days)
- aMER **1.75**, 4 of 5 (RawBark: Missing days)
- CAC **1,010 CZK**, 4 of 5 (RawBark: Missing days)
- Prev and delta: n/a on all four. Like-for-like set (dobias, ethia, manami, venev) is not complete in Aug 2..31:
  Venev has `paid_spend` NULL on 2026-08-10 (shop row, no ad row; Venev data starts Aug 10). Correct per rule.
- Weekly MER points 7.62, 9.66, 7.78, 10.80, 9.86 (week of Sep 14 sums 4 clients, others 5).

Platform ROAS lines: combined Meta ROAS **2.15** (4 of 5, RawBark: Meta not connected, prev n/a because of Venev
Aug 10); combined Google ROAS **4.47** (1 of 5: Manami; RawBark Missing days, others not connected), prev 2.15,
delta +108 %.

Per client (table): Ethia Meta ROAS **1.92** (prev 2.22), Venev Meta ROAS **0.12** (prev n/a, Aug 10 gap), both ok
now. Dobias spend 417.8K, MER 10.36, Meta ROAS 2.44; Manami MER 2.91, Meta 1.97, Google 4.47; Ethia MER 3.44;
Venev MER 0.15 (all unchanged, match prod). RawBark: paid spend, MER, CAC, Google ROAS "Missing days"
(revenue ok, 1.73M CZK); Meta metrics not connected.

## Checks
- `npx tsc --noEmit` clean, `npm run build` ok.
- check:reports-eval 274/274 (5 old rollup assertions rewritten to the exclusion rule; new: excluded list and
  reasons, no-partial-ratio, all excluded, mixed reasons, like-for-like compare total and points, pointCoverage,
  vertical, registry missingWhenNull, Ethia-like Meta ROAS), check:reports 306/306 (new SQL assertions: outcomes
  count NULL spend days, spend counts its own), reports-widgets 655/655 (compact "4 of 5" marker, hover names
  "RawBark: Missing days"), reports-authz 37, reports-store 286, reports-url 193, reports-canvas 98,
  reports-pages 201, capabilities 329, paid 190, creative ok.
- check:queries and check:warehouse: no local GCP credentials (unchanged, need the warehouse).

## Notes for the owner
- Venev 2026-08-10 is a spend gap under the rule (ads not yet running, or missing ingestion). It makes every
  combined previous-period delta n/a for Sep 2026. If Venev simply had no ads before Aug 11, the mart could
  COALESCE spend to 0 there; otherwise it stays as is.
- Composition differs between buckets and the total: a week where RawBark is fine includes it, the period total
  does not (its Sep 17 gap excludes it). Hover and tooltip say so.
- Caches: SEMANTIC_VERSION bump changes every cache key, so the old n/a payloads are not served after deploy.
