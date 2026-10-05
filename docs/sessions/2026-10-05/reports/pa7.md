# PA7 report: Paid GA4 tab (WP-A7)

Branch `pa7-ga4-tab`, worktree `oe-dash-wt/pa7-ga4-tab`, one commit `3757e34` on top of `7b139f1`. Frontend only. No warehouse objects created, no `mart_qa` objects, nothing to deploy.

## Files (all owned)
- `dashboard/app/(app)/paid/ga4/page.tsx` (stub replaced, gate kept)
- `dashboard/lib/queries/paidGa4.ts`, `dashboard/lib/demo/paidGa4.ts`
- `dashboard/components/paid/ga4/{Ga4Kpis,CrossCheck,Ga4Channels,Ga4Funnel,LandingPages}.tsx`
No shared file edited. `Funnel`, `DataTable`, `SegmentedControl`, `KpiTile` used read-only.

## Behaviour
States, in order: capability off -> NotConnected "GA4"; `mart.mart_ga4_sessions_daily` missing -> NotConnected "GA4" (`getGa4LastDate` wraps only that query in `optional`, so only the not-found error is swallowed, permission and other errors rethrow); no rows ever -> NoData; last date older than 3 days -> Notice "No GA4 data since {Mon D}."; no rows in range -> NoData.
- Tiles: Paid sessions, purchases, revenue, CVR, share. Paid = platform in meta, google, other_paid. `unattributed` counts only in the share denominator and all-channel revenue.
- Cross-check: rows Meta, Google, Other paid (only if present), Paid, No channel (only if unattributed revenue > 0, with an (i) tip). Below the table a strip: Shop revenue, GA4 revenue all channels, Tracking coverage. Shop revenue = `gross_revenue_incl_tax` for Shopify clients, `revenue` otherwise; the Shop revenue tip says so. `mart_daily_kpis` money is converted to client currency with `fxSql` (that mart is grained by currency).
- Channels table: paid platforms only, Meta sessions shown as Paid Social (GA4 files some swapped-UTM Meta sessions elsewhere; keeps the table equal to the tile totals). Funnel `?ch=`, landing pages `?lp=` (whitelisted, bad values fall back to default).
- Revenue of a group with zero purchases is 0, not n/a; a group with purchases and all-null revenue (missing FX) stays null. `sessions_fx_missing` > 0 shows Notice "{n} orders excluded from revenue totals."
- Demo branch for every function (deterministic, from the demo spine). Demo client has GA4 off, so the page never reaches it.

## Verification
- `npx tsc --noEmit` 0. `npm run build` 0 (`scratchpad/pa7_build.log`, `/paid/ga4` dynamic). `check:capabilities` 318/318. `check:paid` 190/190.
- Grep gates on owned files: em/en dash 0, `bg-[#` 0, hex 0, `border-dashed` 0, dev vocabulary in JSX 0, client names 0, `toLocaleString()` 0 (one `toLocaleDateString("en-US", ...)`), `pageEyebrow(` 0. Tooltips 17 to 25 words.
- Query sanity, exact SQL shapes run read-only against `mart_qa.pa3_mart_ga4_sessions_daily` (2026-09-27 to 2026-10-02) and prod `mart_daily_kpis`:
  - KPI window (09-30 to 10-02): dobias paid sessions 721, purchases 10, revenue 579.94, all-channel 13,588; manami paid sessions 237, purchases 2, revenue 1,200, all-channel 11,752, unattributed 5,410, fx_missing 0. Previous window 09-27 to 09-29 returns rows.
  - Whole window cross-check, dobias (USD): spend meta 4,043, Meta platform value 10,450, GA4 Meta 775 (over-claim 13.5x, expected: untagged Meta is invisible to GA4); shop gross 43,731 vs net 42,098; GA4 all 29,724 -> coverage 68% (gross basis). Manami (CZK): meta spend 12,373 + google 3,075 = paid_spend 15,448; GA4 paid 11,574; GA4 all 49,387 incl. 16,940 unattributed; shop 55,005 -> coverage 90%.
  - Funnel monotone and equals channel sums: dobias all 1,544 = 1,524 + 4 + 16 sessions, then 1,117, 53, 16, 12; manami all 531 = 338 + 164 + 29, then 425, 26, 18, 12. Paid Social 1,524 / 338.
  - Landing pages and channels queries return rows. Last date dobias 2026-10-02, manami 2026-10-03 (matches pa3).
  - Prod view missing: error text "Not found: Table ... mart_ga4_sessions_daily was not found in location EU"; `isMissingObject` true for it, false for a permission denial and a timeout (tsx check).
- Bug found and fixed during sanity: `HAVING SUM(sessions)` with an alias named `sessions` raises "Aggregations of aggregations"; now `HAVING sessions > 0`.
- Visual check not done (no login). To check: tab order (header, tabs, controls, content), five tiles wrap 2-up on phone with revenue full width, tables scroll sideways inside the card, segmented controls keep `ch`/`lp` and the rest of the query string.

## Ready for prod
Nothing new. The tab shows "GA4 not connected" for every client until migration 243 is deployed and `has_ga4` is TRUE (other packages).

## Open issues
1. Paid row GA4 revenue includes other paid (e.g. Seznam), while paid spend in `mart_daily_kpis` covers Meta and Google only, so the Paid row's GA4 ROAS is slightly high when other paid has revenue. The "Other paid" row is shown to explain the gap. Small today (0 revenue in the 6 day sample).
2. Rate tiles pass `pointChange` as the delta, but `DeltaChip` prints it as "1.2%", not "1.2 pp".
3. "Paid share" tile has no (i) tooltip: no `METRIC_DEFINITIONS` key exists (shared file).
4. Cross-check "Shop" is a three-figure strip under the table rather than a table row (the table columns do not fit shop revenue and coverage).
5. FX: manami October EUR purchases still lack rates until runbook 23; the Notice covers it.

## Requests to orchestrator
- Approve two Notice strings beyond the closed list: "No GA4 data since {date}." (given in the task) and "{n} orders excluded from revenue totals." (variant of the existing orders-excluded line).
- Optional shared-file changes: `DeltaChip` pp mode; `METRIC_DEFINITIONS` entries for Paid share and the GA4 tiles.
