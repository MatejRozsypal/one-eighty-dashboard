# CMP1 report: delta display mode (% | 123), foundation + audit

Branch `cmp1-foundation`, worktree `oe-dash-wt/cmp1-foundation`, one commit `607e739` on `main` @ `8c29564`. Frontend only (`dashboard/`), no BigQuery, no `mart_qa` objects, nothing to deploy to prod, not pushed.

## 1. What the foundation does

| Piece | File | Contract |
|---|---|---|
| Formatter | `lib/format.ts` | `formatDelta(cur, prev, { kind, mode, currency?, unit?, decimals?, compact? })` returns a signed string or null. `deltaParts(...)` returns `{ change, flat, magnitude, text }` (chips draw the unsigned `magnitude` beside the arrow). `kind`: `money` (display currency, 2 decimals below 100, `compact` for narrow cells), `count` (optional `unit` noun), `ratio` ("+0.31×"), `rate` (fractions, always pp in both modes). Null when either side is missing/non-finite, or for a relative change from 0 (absolute from 0 is shown). Negatives U+2212, flat (rounds to 0 at the shown precision) has no sign. `deltaSortKey(input)` gives `{pct, abs}` for tables. Also `DeltaMode`, `DeltaInput`, `parseDeltaMode`, `DELTA_PARAM` (`delta`), `DELTA_COOKIE` (`oe_delta`). Pure, client-safe. |
| Params | `lib/params.ts` | `resolveDeltaMode(searchParams, cookie)`: URL, then cookie, then `pct`. `viewQuery` deliberately never writes `delta` (see race rule). |
| State | `components/ui/DeltaMode.tsx` | `DeltaModeProvider` in `app/(app)/layout.tsx` (inside the navigation provider). The layout reads the cookie on the server (`initial`), the provider reads `?delta=` on the client. Holds the mode across every navigation. `useDeltaMode()` for any component; `DeltaModeStatic` for scripts/exports. |
| Toggle | `components/controls/DeltaModeToggle.tsx` | Segmented `% / 123` (titles and aria-labels "Percent change" / "Absolute change"), right after the Compare segments in `ControlBar` and in `ReportFilterBar`; not rendered when Compare is None. `SegmentedControl` now exports the presentational `SegmentPills` it is built on. |
| Chips | `components/ui/Delta.tsx` | Now a client component. New `change={ current, previous, kind, currency }` follows the mode; legacy `delta` (fraction) still renders, always as a percent, so unconverted call sites are unchanged. New `after` (rendered only with the chip, e.g. "vs prev period") and `fallback` (e.g. muted n/a in a table cell). Direction/sentiment logic unchanged. |
| Cards | `MetricCard`, `KpiTile` | Accept `change` (same semantics as `delta`: object = chip, null = row without chip). |
| Tables | `components/ui/DataTable.tsx` | A `sort` entry may be `deltaSortKey(...)`; the table sorts by the key of the mode on screen (`sortKeyFor`). Cells render `<DeltaChip change=... fallback={<NoValue/>} />`. |
| Reports | `components/reports/widgets/{CellStatus,KpiWidget,RankedWidget,TableWidget,format}` | `CellDelta` takes `total`, `compareTotal`, `format`, `currency`; in abs mode it shows `total - compareTotal` in the metric's unit (compact money when the metric is compact, percent metrics stay pp). Pct mode keeps the evaluator's `delta` exactly. No refetch (widget request key is the filters JSON, `delta` is not a filter). KPI widget now also shows an abs chip when the baseline is 0. Table delta slot `w-[68px]` became `min-w-[68px]` (abs money is wider). |

### Deviation from the brief, on purpose: the toggle does not navigate
The brief asked for the toggle to go through `navigate` so it pulses. The mode is display only, so a navigation would re-render the page on the server and re-run every BigQuery query (Snapshot 5 to 10 s) to redraw the same figures. Instead:
- The chips switch on click (5 ms measured), the cookie is written, and the URL is written in place via the new `useNavigation().replaceInPlace(href)` (Next 14.2's patched `history.replaceState`: `useSearchParams` follows, nothing is fetched).
- Race rule (both directions verified in a browser):
  - toggle while a same-page navigation is in flight: `replaceInPlace` hands the href to `navigate`, superseding it (page pulses; final URL carries both changes);
  - control clicked in the same tick after the toggle: `baseQuery` returns the in-place href until the router applies it (`inPlaceHref`, cleared when the committed URL changes or on any `navigate`);
  - toggle while a navigation to another page is in flight: URL left alone, the provider state carries the mode there.
- Server-built links (`viewQuery`, Snapshot/Paid) never carry `delta`, because they go stale after an in-place write and a stale explicit value would undo the toggle. Client links (Sidebar, rail, mobile menu, client switch, Paid tabs via `tabHref`) copy the live query string, so they carry it. Both end in the same mode.
If the owner still wants a pulse on toggle, swap `replaceInPlace` for `navigate` inside `DeltaModeProvider.setMode` (one line); the race handling then comes from `baseQuery` as for the other controls.

## 2. Audit: every page

"Fetches comparison" = the page's queries already read `params.period.comparison`.

| Page | Period-based numbers | Compare today | Fetches comparison | Delta call sites today | Verdict | Package |
|---|---|---|---|---|---|---|
| /snapshot | yes (4 MetricCards, AcquisitionEconomics, MarginStack, RevenueMix, RevenueComposition, BottomLine) | yes (+currency) | yes (pnl snapshot cur/prev) | MetricCard `delta` x4, AcquisitionEconomics, MarginStack (legacy pct; `cm3Pct` margin % is a relative delta, must become `rate`/pp) | convert | A |
| /products | yes (4 MetricCards, table) | yes | yes (`getProducts(comparison)`) | MetricCard `delta` x4 | convert | A |
| /unit-economics | yes (table by segment) | yes | yes | DeltaChip per row (some rows are % rates) | convert | A |
| /growth | monthly series | no (own MoM/YoY `view` control) | own MoM/prior month in `months`, YoY | DeltaChip MoM x2 per row, YearOverYear | global Compare N/A; add `DeltaModeToggle` beside its own Compare and convert MoM/YoY chips (prev month values are in `months`) | A |
| /orders | yes (6 MetricCards; recent-orders list is a list) | no | no (`getOrdersSummary(range)`) | none | add compare: `getOrdersSummary(id, comparison)` in parallel, `change` on cards | C |
| /email | yes (5 KPI tiles, flows table) | no | no (`getEmailSummary(range)`, `getFlows(range)`) | none | add compare: summary for the comparison range, `change` on tiles (open/click rate = `rate`); flows table optional | C |
| /paid (overview) | yes | yes (+currency) | yes | PaidTile `delta` x5+, CampaignsAcross, PeriodTable/PlatformTable | convert | B |
| /paid/meta | yes | yes | yes | MetaKpis (rel + local `PpChip`), MetaCampaigns `DeltaCell`/`PpChip` (cells.tsx), MetaTrend | convert; replace local PpChips with `kind: "rate"` | B |
| /paid/google | yes | yes | yes | GoogleKpis (`delta` + `pointDelta` PpChip), BrandSplit, GoogleCampaigns | convert; table delta columns use `deltaSortKey` | B |
| /paid/ga4 | yes | yes | yes | Ga4Kpis (relativeChange + pointChange) | convert | B |
| /creative (overview) | yes (StatLine tiles) | yes | yes (`getCreativeTotals(comparison)`) | 4 tiles via `delta()` (spend, ROAS, CPA, purchases) | convert (`primitives.tsx` StatLine/Scorecard tile gets `change`) | C |
| /creative/breakdown | lifetime-by-design (default preset all; statistical power) | no | no | none | no compare: accumulation is the point of the screen | none |
| /creative/concepts | verdicts per concept | no | no | none | no compare (verdicts, not period totals) | none |
| /creative/velocity | cadence gauges, pack spec | no | no | none | no compare (cadence vs target, not period vs period) | none |
| /creative/production | cost/ROI per method | no | no | none | no compare for now (costs mostly estimated, see page header) | none |
| /goals | targets vs actuals per year/quarter/month | no | no | none | no compare (attainment against a target is its own comparison) | none |
| /cohorts | by acquisition month | no | no | none | no compare | none |
| /customers | lifetime (`getLifetimeSummary`, top customers) | no | no | none | no compare (ignores the range) | none |
| /gaps | lifetime gap stats | no | no | none | no compare (ignores the range) | none |
| /repurchase, /repurchase/timing | lifetime journeys and timing | no | no | none | no compare (ignore the range) | none |
| /inventory, /buying, /catalogue | stock snapshot | no | no | none | no compare (snapshot) | none |
| /reports, /reports/[id] | report widgets | own compare in ReportFilterBar | yes (evaluator) | KPI, ranked, table widgets | done in CMP1 (toggle + abs cells) | done |
| /health, /settings, /admin, /chat, /channels | no period figures | no bar / n/a | n/a | none | no control | none |

Step 3 ("pages that need only a prop flip"): **none exist**. Every page that already fetches the comparison already has Compare on; every page without it needs at least one extra query (Orders, Email) or should not compare at all. So no page file was touched in CMP1.

Side finding (not in scope): /customers, /gaps, /repurchase*, /inventory* render the date range control although their queries ignore the range (and /cohorts reads only months). Worth a separate decision: hide the date control there or make the queries honour it.

## 3. Proposed split: 3 parallel Sonnet packages

All three use only the CMP1 API: `change={{ current, previous, kind, currency }}` on DeltaChip/MetricCard/KpiTile (or the package's own tile), `deltaSortKey` in table `sort`, `fallback={<NoValue />}` in table cells, `formatDelta` where a string is needed. Kinds: money (revenue, spend, profit, CPA, CPC, CPM, CAC, AOV), count (orders, purchases, sessions, sends, clicks), ratio (ROAS, MER, aMER, frequency), rate (CTR, CVR, margin %, share, open/click rate, impression share, lost IS, hook rate). Rates that are now relative deltas become pp (design change: owner already agreed rates are pp). `scripts/check-delta.ts` is shared, so packages put their assertions in a new `scripts/check-delta-<pkg>.ts` (or their existing check script) and the orchestrator adds the npm scripts.

| Package | Owns (only these files) | Work |
|---|---|---|
| **CMP-A Shop and P&L** | `app/(app)/snapshot/page.tsx`, `app/(app)/products/page.tsx`, `app/(app)/unit-economics/page.tsx`, `app/(app)/growth/page.tsx`, `components/dashboard/{AcquisitionEconomics,MarginStack,RevenueMix,RevenueComposition,BottomLine,YearOverYear}.tsx`, `components/growth/stats.ts`, `lib/queries/growth.ts`, `lib/queries/yoy.ts` (if touched), the `metric()` helper in `lib/queries/pnl.ts` (snapshot cur/prev accessors only) | Convert every delta to `change` (cm3Pct to `rate`). Growth: render `DeltaModeToggle` beside its own MoM/YoY control and pass prior-month / prior-year values. Keep `paidSpendDelta` gap rule (null when comparison spend is partial) for both modes. |
| **CMP-B Paid** | `app/(app)/paid/**`, `components/paid/**` (overview, meta, google, ga4) | Convert KPI tiles, PaidTile (add `change` prop), CampaignsAcross, MetaCampaigns/cells (`DeltaCell` takes `change`; delete local `PpChip`s in cells.tsx, MetaKpis.tsx, GoogleKpis.tsx in favour of `kind: "rate"`), BrandSplit, GoogleCampaigns; delta columns sort with `deltaSortKey`. Narrow column templates may need widening for "CZK 12,345" (check the `compare` grid variants in MetaCampaigns/GoogleCampaigns). Run `check:paid`. |
| **CMP-C Orders, Email, Creative** | `app/(app)/orders/page.tsx`, `lib/queries/orders.ts` (only if a summary helper is needed; prefer calling `getOrdersSummary(id, comparison)` as is), `app/(app)/email/page.tsx`, `lib/queries/email.ts` (same), `app/(app)/creative/page.tsx`, `components/creative/primitives.tsx` (StatLine/Scorecard tile `change`) | Orders and Email: turn Compare on, fetch the comparison summary in the same `Promise.all` (skip when comparison is null), add `change` to the cards; demo client functions take a range already. Creative overview: `change` on the 4 tiles. Must not turn Compare on for breakdown/concepts/velocity/production. |

No overlaps: A owns `components/dashboard/*` except MetricCard/KpiTile/MetricTooltip (CMP1, unchanged API), B owns `components/paid/**`, C owns `components/creative/primitives.tsx`. `ControlBar`, `PageControls`, `Delta.tsx`, `DeltaMode.tsx`, `lib/format.ts` stay frozen; requests go to the orchestrator.

## 4. Verification
- `npx tsc --noEmit`: 0 errors. `npm run build`: exit 0, 0 warnings (`scratchpad/cmp1_build.log`).
- New `npm run check:delta`: 177/177. Covers formatDelta for money (CZK, USD, small cents, compact, decimals, no currency), count (unit, grouping), ratio (unit), rate (pp in both modes, from zero); null/undefined/NaN/Infinity on either side for every kind and mode; zero baseline (pct null, abs shown); negative values (U+2212, no hyphen, no em dash; negative baseline uses |prev|); flat; sort keys; param/cookie parsing and precedence; viewQuery never writes delta; DeltaChip/MetricCard/KpiTile/CellDelta rendered in both modes (sentiment unchanged, fallback/after); pills markup; toggle placement and None rule; provider/layout wiring; race-rule source pins; no em dash in owned files.
- Existing checks all green: loading 260, capabilities 350, paid 211, reports 327 (BigQuery steps skipped, no credentials), reports-eval 359, -authz 37, -store 315, -url 193, -widgets 684, -canvas 98, -pages 216, creative all match.
- Browser (throwaway route `app/cmp1-harness` with a 2.5 s server delay, dev server 3127, deleted before the commit, `.next` removed and rebuilt):
  - click "123": chips switched within 5 ms (MetricCard "CZK 12,345", count "123", rate "1.2 pp", table "CZK 20,000 / 4,000 / -10,000"), URL `&delta=abs`, cookie `oe_delta=abs`, server render counter unchanged, 0 RSC requests;
  - "Prev year" then "123" 200 ms later: page pulsed, final URL `compare=previous_year&delta=abs`, chips abs;
  - "%" then "Prev year" in the same tick: final URL `compare=previous_year&delta=pct`, chips pct (this failed before `inPlaceHref` was added; fixed and pinned in check:delta);
  - fresh load without `delta` and cookie abs: abs (also in the SSR HTML via curl; `&delta=pct` in the URL wins over the cookie);
  - DataTable sorted by the Change column: abs order Alpha, Beta, Gamma; after switching to % without re-sorting: Beta (400%), Alpha, Gamma;
  - Compare None: toggle absent from the HTML.
- Not verified: the real `(app)` shell with login, Reports page in a browser (covered by render tests), a phone width (toggle adds about 80 px to the Compare row, which still fits 343 px).

## 5. Notes and requests to the orchestrator
1. The chip now has `whitespace-nowrap` (abs money contains a no-break space but the arrow could wrap). Report table delta slot is `min-w-[68px]` instead of `w-[68px]`; long abs values push the value text left in that column rather than overlapping.
2. Compact abs money in Reports uses `formatMoney` compact ("CZK 1M", "CZK 1.2M"), not the widgets' fixed one-decimal `compactMoney` ("CZK 1.0M"). Harmless; unify later if wanted.
3. Rates that are relative today will read as pp after the packages land (Snapshot CM3 %, Unit economics % rows). That is the agreed interpretation, but it changes numbers people know; worth one line in the release note.
4. If the owner wants the toggle to pulse anyway, see section 1 (one line in `DeltaModeProvider`).
