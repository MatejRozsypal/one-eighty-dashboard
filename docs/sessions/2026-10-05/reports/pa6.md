# PA6 report: Paid Google tab (WP-A6)

Branch `pa6-google-tab`, worktree `oe-dash-wt/pa6-google-tab`, one commit `8689f6a` on top of `7b139f1` (PA0 merged). Frontend only. No warehouse objects, no `mart_qa` objects, nothing to deploy.

## What changed (files)

- `app/(app)/paid/google/page.tsx`: stub replaced. Capability gate kept. One `Promise.all` of the queries, URL-driven view state, `NoData` when no campaign delivered in range.
- `lib/queries/paidGoogle.ts`: `getGadsCampaignAgg(period)` (one scan, both periods, per campaign), `getGadsLeakage(period)`, `getGadsPmaxSplit`, `getGadsAdGroups`, `getGadsDevices`, `getGadsSearchTerms(mode)`, `getGadsKeywords`, `getGadsProducts(group, zeroOnly)`, `getGadsCoverage`. Every function has an `isDemo` branch. Only summable components leave the warehouse; term mode and product group go through SQL whitelists.
- `lib/demo/paidGoogle.ts`: deterministic demo data on the demo spine (campaign spend adds up to the daily Google spend; ad groups, devices and PMax networks sum to their campaign).
- `components/paid/google/`: `GoogleKpis`, `BrandSplit`, `GoogleCampaigns`, `GoogleCampaignDetail`, `PmaxSplit`, `SearchTerms`, `Products` (spec names) plus `aggregate.ts` (pure roll-ups), `labels.ts`, `parts.tsx` (section shell, `PpChip`, `CoverageChip`, `RatioCell` with the low-volume dot).

## Behaviour against the spec

- Money in `client.gadsCurrency` (fallback `client.currency`), no currency toggle, `PageControls compare` only, data ends D-1.
- Conversions = `purchases` / `purchase_value` on the campaign mart. Ad group, search term, keyword and product marts only carry the primary conversion definition (identical today, both accounts count Nákup only).
- Row 1: Spend, Conv. value, ROAS, Conversions, CPA. Row 2: Brand share, Non-brand ROAS, Search IS, Lost IS budget, Lost IS rank, CTR, CPC, Brand leakage. Rates show pp deltas, money, counts and ratios show %. No delta when compare is off or the previous value is null.
- IS only via `isImpressions / eligibleImpressions`, top via `topEligibleImpressions`, click share via `eligibleClicks`. Lost IS tooltips say "Upper bound, because Google reports shares under 10% as a floor value." (Search IS tooltip has the floor note too).
- Campaigns table: column sets Outcome / Auction / Budget (`?cols=`), class filter (`?class=`, only classes present), name links to `?campaign=` (no scroll jump), Δ Spend and Δ ROAS only with compare on, low volume mutes ROAS and CPA with a dot and nulls the sort key. Budget set: bid strategy (+ target when the mart has one), budget/day, spend/day over delivery days, utilisation (null for shared budgets).
- Detail block: ad groups (non-PMax) or the campaign's PMax channel bars, plus device share and ROAS. Close link drops `campaign`.
- PMax channels section only when PMax spent. Segments labelled inside when wider than 15%, hover (title) shows spend, value, ROAS. Fills are ink, green and gray tokens (red, amber, blue are status only), legend always shown.
- Search terms: All / Brand / Non-brand / Waste, Search terms / Keywords switch (`?src=`), `PMax terms` segment disabled with title "Not ingested". Keywords also show campaign (small addition to the spec columns, because the same keyword text repeats across campaigns). Hidden when there is no Search spend and no rows.
- Products: group by Product / Type / Brand / Label 0, All / Zero conversions toggle, rows split by campaign type, "Covers N% of spend" chip. Item label is item id plus product type L1 (Phase A).
- Coverage chips: terms = term spend inside SEARCH campaigns over SEARCH campaign spend; products = Shopping and PMax product spend over Shopping and PMax campaign spend, capped at 100%.

## Verification

- Marts deployed in prod: columns of all 7 `mart_gads_*` views match `242_gads_marts.sql` (checked at start through INFORMATION_SCHEMA, read-only).
- `npx tsc --noEmit`: exit 0. `npm run build`: exit 0 (`scratchpad/pa6_build.log`, `/paid/google` 854 B page, 103 kB first load). `npm run check:capabilities`: 318/318. `npm run check:paid`: 190/190.
- Grep gates on my files (app route, components, both lib files): em/en dash 0, `border-dashed` 0, `bg-[#` or `[#` 0, client names 0, `toLocaleString()` 0, dev vocabulary in UI files 0.
- Component render check (ad hoc, not committed): every section rendered through `react-dom/server` with demo data, compare on and off. Output read and sane. Demo campaign spend equals the demo spine's Google spend.
- Read-only BigQuery, 30 days 2026-09-04 to 2026-10-03 (compare 2026-08-05 to 2026-09-03), the same SQL the page runs:
  - Spend vs `mart_daily_kpis`: rawbark 85,136.35 on both sides, manami 13,318.12 on both. Value vs `google_revenue` (231,911.34 and 57,677.06) and conversions vs `google_purchases` (266.2 and 60.7) also identical.
  - ROAS: rawbark 2.72x (prev period 10.70x), manami 4.33x (prev 2.26x).
  - Rawbark classes: brand 8,324 (9.8% share), non-brand 27,960, Shopping and PMax 46,828, other 2,024. Non-brand ROAS (non-brand plus Shopping and PMax) 0.58x. Brand leakage 74 of 15,015 = 0.5%. Manami: 100% Shopping and PMax, brand share 0.0%, leakage n/a.
  - Coverage: rawbark terms 22,765 / 36,284 = 62.7%; rawbark products 7,167 / 46,828 = 15.3% (Shopping 100%, PMax 0%); manami products 3,440 / 13,318 = 25.8%; manami has no Search spend so the Search section is hidden.
  - IS (rawbark): Search IS 17.2%, lost budget 27.2%, lost rank 56.8%, CTR 1.44%, CPC 15.73. Terms (waste mode), keywords, ad groups, devices, coverage and the campaign query all execute and return sane rows. Manami budget: PMax 700/day, 30 of 30 days delivered.
- NOT done: visual check (no login). To check on the dev server: tab content below the control bar, sticky tabs, SegmentedControls update the URL and keep `campaign`, row link opens the detail without scrolling to top, tables scroll sideways inside their card at phone width, PMax bars readable at 375 px.

## Open issues and notes

1. Manami Search IS reads about 10%, lost rank about 90%: PMax reports a search-network share at the "<10%" floor, and the spec formula includes every row with a reported share. The tooltip caveat covers it; if the owner prefers Search-channel campaigns only for the IS tiles, filter `channel_type = 'SEARCH'` in `getGadsCampaignAgg` for the IS sums.
2. Rawbark previous period is large (spend 122,682, value 1,312,979, ROAS 10.7x), so compare deltas are big. Same figures as the shop mart; worth a look at the August data, not a tab bug.
3. `target_roas` is NULL for TARGET_ROAS campaigns (PA2 note), so the Budget set shows "Target ROAS" without the figure for those.
4. Low volume applies to every table (campaigns, ad groups, terms, keywords, products) with the table's own spend as the 1% base. In the terms and products tables most rows will therefore show the muted ROAS and CPA with a dot.
5. Mobile: DataTable has no sticky first column, so the tables scroll sideways as whole rows (acceptable, listed as a gap vs spec 4).
6. The frontend service account needs read on the new `mart` views (they inherit dataset access, but confirm once after the first load on prod).

## Requests to orchestrator

- `lib/metrics.ts`: add `ROAS`, `Conv. value`, `Conversions`, `CPA`, `CTR`, `CPC` definitions, and an optional `note` for Lost IS (budget/rank) and Search IS about the floor value. `KpiTile` has no free-text tooltip or pp delta, so `GoogleKpis` ships a local tile with its own `InfoTip` and `PpChip`. When KpiTile gains `info` and a point-change delta, the local tile can be replaced.
- Optional: a `PpChip` in `components/ui/Delta.tsx` (the local copy is in `components/paid/google/parts.tsx`).
- Optional: DataTable sticky first column for the mobile spec.
- A5 and A7 will need the same `scroll={false}` Link pattern for row selection; nothing shared was changed for it.
