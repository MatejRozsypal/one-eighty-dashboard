# WP6 report: Marketing and Retention pages, Paid minimum fix

Branch `wp6-marketing-retention`, worktree `oe-dash-wt/wp6-marketing-retention`, one commit `13a0d4f` on top of the WP1 merge. Frontend only. No warehouse objects created or changed, no `mart_qa` objects, nothing to deploy to prod.

## What changed (owned files only)

Every page now starts with `pageAvailability` -> `<NotConnected source=...>`, drops the eyebrow and the `scope` prop, shows `<NoData />` for an empty result, renders missing values through `formatX` + `<Value>` ("n/a"), and has no footnotes (definitions moved to `InfoTip` or DataTable `info`).

- **Paid** (`paid/page.tsx`, `lib/queries/paid.ts`, `Funnel.tsx`): Meta queries only run when `client.capabilities.meta`. Meta off: Spend/Revenue/ROAS tiles (Google totals) plus the single line "Meta not connected." in place of Meta tiles, funnel and ad table. Meta on, no rows: `NoData`. `getChannelTotals(clientId, range, hasGoogle, hasMeta = true)`: Meta `connected` is no longer hard-coded true, absent platforms return null (never the mart's 0). Banner and "mart_meta_ad_perf" heading deleted ("Top ads"). CPM, CPC, CPA use `{ unit: true }`. ROAS and CPA dash note moved to column `info`. "By platform" footnote moved to an InfoTip. Funnel "Scale is broken" paragraph replaced by a small InfoTip. The 4th arg is optional so `scripts/check-warehouse.ts` still compiles.
- **Channels**: title + `<NotConnected source="GA4" />` only (no controls).
- **Email** (P1-3, P1-4): `getEmailSummary(clientId, range, limit, platform)` now runs a separate no-LIMIT summary query for headline totals, and the table query keeps `LIMIT`. For `ecomail` clients the source is `mart.mart_email_campaign_perf` (filter `platform = 'ecomail'`, `conversions` as orders), otherwise `mart_email_campaign_message_perf`. Table shows "Top N by revenue" only when truncated. Blue banner, "Not here yet" block, flow coverage banner, flow footnote removed. Flows section: tiles + table when the daily series covers the range, otherwise `NoData`. Flows are skipped for Ecomail (the daily series is Klaviyo only).
- **Customers**: `getLifetimeSummary` returns `null` when there are no customer rows (was `customers: 0`). Snapshot (WP5) already calls it through `optional(..., null)`, so it is compatible. The LTGP bar is hidden when the ratio is null (was `width: 0%`). Non-returning rows show a "New" badge instead of a blank cell.
- **Time between orders**: bucket labels use hyphens ("0-7"), `isOrderHygiene` keyed off `min === 0`, `border-dashed` removed from the hygiene bars, explanatory text moved to an InfoTip.
- **Cohorts**: mature-cohort tiles use a `meanOf` that returns null when no values exist (was `/ (n || 1)`, which produced 0). Cumulative LTV/LTGP in `cohortGrid.ts` no longer turns missing values into a running 0. A grid with no values renders `NoData`. `MarketFilter` and `CohortHeatmap` use `formatNumber`.
- **Repurchase / Repeat timing**: single `NoData` when there is nothing to draw, blended-rate line with the "ignores date range" InfoTip, "How to read this" blocks cut, window labels use hyphens, legend dashed line is an SVG (no `border-dashed`).
- **ProductJourney** (P1-12): `toLocaleString()` replaced by `formatNumber`; footnote cut.
- Em dashes and en dashes removed from all owned files, comments included.

## Live check (read-only BigQuery)
- `mart_email_campaign_perf` columns: client_id, platform, campaign_id, campaign_name, send_date, sent_at, sent, delivered, bounces, unique_opens, total_opens, open_rate, unique_clicks, total_clicks, click_rate, unsubscribes, spam_complaints, conversions, revenue, open_rate_pct, click_rate_pct, conversion_rate_pct, revenue_per_email, currency. It is a union of Ecomail and Klaviyo; Manami = 197 ecomail rows since 2025-01-01 (CZK, last send 2026-07-30), Dobias = 210 klaviyo rows.
- The exact summary SQL for Manami, 2026-05-01 to 2026-07-31: 47 campaigns, revenue 50,814.16, sent 46,945. With the old LIMIT 30 the page would have totalled fewer campaigns, so P1-3 is demonstrated. `mart_email_campaign_message_perf` has Dobias only (no Manami rows), which is why Manami was empty (P1-4).

## Verification
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0 (all routes listed).
- Grep gates on owned files: em/en dash 0, `bg-[#` 0, `border-dashed` 0, `toLocaleString` 0, `pageEyebrow(` 0, client names 0 in `app/` and `components/`, dev vocabulary 0 in JSX text. Remaining hits are comments and SQL strings inside `lib/queries/*` (table names, client names in explanatory comments), outside the gated directories.
- No literal `0` fallback for missing data on the Customers path (`getLifetimeSummary` null, tile values via `formatX`). Remaining `?? 0` are internal counts and sums (cohort grid cells, journey link counts).
- Word count (crude visible-string counter, `scratchpad/wp6_wc.py`): before 1481, after 577 across the 13 page/component files (lists in `wp6_wc_before.txt` and `wp6_wc_after.txt`). Funnel went 3 -> 24 because of the new tooltip.
- Visual check on the dev server: NOT done (cannot log in).

## Behaviour notes for the orchestrator
- Manami Email: campaigns appear. Flows show `NoData` (Ecomail has only a lifetime snapshot, `mart_email_flow_perf`, which the page deliberately does not use for a ranged page). The DoD matrix says "plus flows" for Manami: that needs a daily Ecomail flow series from the warehouse, or a decision to show the lifetime snapshot.
- Dobias Email flows show `NoData` for ranges ending after the daily series' last day (currently 2026-09-19), as before but in one line.
- Compare/Currency stay off on these pages (no opt-in requested).
- Repurchase blended rate is still computed over the listed products (>= 30 matured customers), so it is not "every product"; the tooltip no longer claims that.
- Heatmap cells inside a cohort's lifetime with a null value render blank, same as "not yet reached" (blank is the legend). Whole-grid-null renders `NoData`.

## Requests to orchestrator
1. None for `lib/metrics.ts`. No metric definition rows were targeted by my MOVE rows (all moved text lives in InfoTip/`info`).
2. Optional: a daily Ecomail flow mart if Manami flows must show real numbers.
3. `lib/demo/media.ts` (`demoEmailSummary`) does not return `campaignCount`; the field is optional so it compiles. Whoever owns demo data can add it.
