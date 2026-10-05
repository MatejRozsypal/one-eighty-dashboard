# WP5 report: Profitability pages and metric definitions

Branch `wp5-profitability`, commit `f8a84e8` on top of `376392e` (WP1 merged). Frontend only. No warehouse writes, no mart_qa objects, nothing to deploy to prod. Only owned files edited.

## What changed
- All six pages (snapshot, goals, growth, orders, products, unit-economics): capability guard (`pageAvailability` -> Title + `NotConnected`), no eyebrow/scope, `NoData` replaces the dashed cards, headings 1 to 3 words, footnotes cut or moved to tooltips (`MetricTooltip` / `InfoTip` / DataTable `info`), `n/a` via `NO_VALUE`/`<Value>`, en/em dashes gone.
- Components (AcquisitionEconomics, BottomLine, RevenueMix, RevenueComposition, MarginStack, YearOverYear): same, plus YoY warnings folded into one projection tooltip; MarginStack steps use "Not measured" / "No cost data" (hatched fill kept, `border-dashed` dropped to satisfy the gate).
- `lib/metrics.ts`: tenant-neutral, no table/column names, 36 -> 60 months, 30% OpEx removed (`ASSUMED_OPEX_RATE` deleted, nothing imported it), stale "hardcoded to zero" caveats replaced by "rate set in Settings". New definitions (MOVE rows): Net sales, AOV incl. shipping, Gross margin, Payback, Fulfilment, Attainment, Growth. `KNOWN_CAVEATS` kept (Health still imports it) but sanitised; WP9 deletes.
- P1-5: CAC, Blended CAC use `{unit:true}`. P1-6: paid source "Meta + Google" / "Google" / "Meta". P1-13: Notice "Paid spend is Google only." when Google on and Meta off. P1-9: no client names in metrics.ts.
- P1-7: `getGoalActuals` now builds from the Snapshot's own daily rows (`fetchPnlDays`, exported from pnl.ts) with the same stated per-order costs, so a month's CM3 on Goals equals Snapshot. Goals page reads settings and passes the rates. Optional 4th arg keeps `scripts/check-warehouse.ts` compiling.
- Opt-in controls: Snapshot `compare` + `currency`; Products `compare` (KPI cards now `MetricCard` with deltas, comparison range fetched); Unit economics `compare` (delta chip under each value). Orders market label no longer assumes Shoptet (platform type now includes woocommerce; split by country unless platform is shoptet).
- Snapshot currency toggle fix: discounts withheld when converted; BottomLine formats lifetime/payback in native currency (`lifetimeCurrency`).

## WP3 coverage rule (coordinator message) and "No cost data"
1. MarginStack: no `?? 0` geometry for cost steps when coverage is none; COGS, CM1, CM2, CM3 drawn hatched with "No cost data".
2. products.ts: margin stays null when every row is null, and null when any revenue row has no margin.
3. Coverage rule, "revenue > 0 and COGS NULL anywhere in the range => COGS, CM1-3, CM% null": pnl.ts `aggregate` (`costCoverage: "full"|"none"`, `hasNoCostData()`), goals.ts (per month), growth.ts and yoy.ts (monthly mart `cogs` column added to SELECT; demo rows without `cogs` are exempt), unitEconomics.ts (`COUNTIF(net_sales > 0 AND cogs IS NULL)` per segment), orders.ts (day-level query: any day with revenue and no order margin nulls the range margin). Limitation: the monthly mart sums COGS, so a month with only some uncosted days cannot be detected in growth/yoy.
4. Snapshot CM3 and CM3 % use `MetricCard state={{kind:"no-data",reason:"No cost data"}}`; Gross margin in BottomLine and the Unit economics COGS/GP/CM rows show "No cost data".
Risk: the strict rule on products/orders will also null margin for a client whose uncosted lines are legitimate (e.g. a gift-card day). Worth a look on the first live check.

## Verification
- `npx tsc --noEmit` exit 0; `npm run build` exit 0 (log `scratchpad/wp5_build.log`).
- Grep gates on owned files (em/en dash, `border-dashed`, `bg-[#`, `toLocaleString()`, `pageEyebrow(`, dev vocabulary, client names): 0 hits in UI text. Only SQL table names inside query strings remain (not UI).
- Word count (extract.py method, my 14 files incl. tooltip text): 2,232 before, 1,577 after. Pages and components alone fall about 45%; `metrics.ts` grew 554 -> 620 because definitions were added (hover only). Not yet at the 04 per-page budgets for every file; the 04 CUT rows are all applied.
- Visual check on the dev server: NOT done (no login).

## Deviations / notes
- Growth does not use the global Compare control: the page's comparison is its own Month over month / Year over year switch and the queries ignore `period.comparison`, so the control would be dead (P1-1 intent). Needs your call if you want it anyway.
- Unit economics: kept a one-line tooltip on the CM row ("All paid spend is applied to first-time customers...") although 04 tagged it CUT.
- Goals empty state is a plain one-line card "No targets set. Set targets in Settings." (no primitive exists for it).
- `getDiscounts` comment/doc updated; unit-economics paid spend now filtered by currency (matches Snapshot).
- Mechanical em/en dash removal in comments of owned lib files.

## Requests to orchestrator
1. Closed Notice list: consider adding "No targets set." if you want it via `Notice`.
2. `MetricTooltip` renders only title/formula/source/limitation, so MOVE text went into `limitation` (shows with the warning marker). A neutral `note` field in WP1's component would be cleaner.
3. WP9: delete `KNOWN_CAVEATS`; `ChannelSplit.tsx` (not imported anywhere) still reads `PnlSnapshot` and compiles.
