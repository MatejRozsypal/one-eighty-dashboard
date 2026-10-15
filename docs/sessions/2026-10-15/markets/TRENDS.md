# Markets: Trends & analysis subpage

Date: 2026-10-15. UI agent, worktree `mk0-markets-spec`. Nothing committed, pushed or deployed. No BigQuery writes, no new view or migration (every section reads the existing `mart` tables).

Route `/markets/trends`, nav child of Markets (Overview `/markets`, Trends & analysis `/markets/trends`, Products `/markets/products`). The Overview page is unchanged.

## Files

| File | What |
|---|---|
| `lib/markets/analysis.ts` | Pure math: Monday weeks, weekly series, portfolio points, bridge decomposition, log fit, reallocation, funnel rows, histogram and threshold inference, market colours |
| `lib/queries/marketsTrends.ts` | Reads: weekly `market_daily` (range, compare, 52-week fit window), GA4 by country, order value bins. Same `MARKETS_SOURCE` switch and `marketsTable()` as the Overview; GA4 always from `mart.market_ga4_country_daily` |
| `lib/demo/marketsTrends.ts` | Demo: weeks read through `demoMarkets` per week (sums equal the Overview), GA4 (na only, 73 days of history), log-normal order values with a round free-shipping threshold |
| `components/markets/trends/*` | `TrendsScreen` (server, one Suspense and skeleton per widget), `PortfolioChart`, `TrendCharts`, `BridgeView`, `ResponseView`, `FunnelTable`, `AovView`, `bits` |
| `app/(app)/markets/trends/{page,loading}.tsx` | Route |
| `app/dev/markets-trends/page.tsx` | Demo harness, 404 in production |
| `lib/nav.ts` | Markets children |
| `scripts/check-markets-trends.ts` | `npm run check:markets-trends` (108 checks) |
| `scripts/check-capabilities.ts` | Pinned "items with children" list now includes Markets, plus a Markets children check |

## Sections and rules

1. **Portfolio.** x = period nCAC, y = GP per customer at 365 d from the latest complete cohorts (the Overview's `cohortSummary`), else first-order GP per new customer in the period (hollow, dashed outline, legend says so). Size = net revenue. Diagonals LTGP:CAC 3:1 and 1:1, two small region labels (hidden on phones). A market without x or y is listed under the chart with the reason. Other is drawn only if it has an nCAC.
2. **Weekly trends.** Net revenue, new customers, nCAC, MER, GP after ads, and CM3 when the client has at least one cost card. Every week is a `MarketPeriodRaw` passed through the Overview's `periodMetrics` (and `marketCosts` for CM3), so n/a reasons and arithmetic match the matrix. Weeks are Monday weeks clipped to the range and the last data day; a cut week is hollow and "partial". Spend gap days (client-level `spend_base IS NULL`) make the week's spend ratios n/a. Compare: dotted line in the same colour, week i against week i.
3. **What changed.** Change in GP after ads vs Compare per market, Unallocated spend as its own bar, Total. For a picked market: `GPA = O x A x K x M - S` with O orders, A gross sales per order, K net sales / gross sales (discounts and refunds), M GP / net sales (1 - COGS %), S spend. Sequential decomposition in the order orders, AOV, discount rate, COGS %, ad spend; each step holds earlier drivers at the current period and later ones at compare, so steps sum to the change exactly. No gross sales (Shoptet): A = net sales per order, discount step n/a and folded into AOV. Needs Compare; n/a if either period has spend gap days or no COGS.
4. **Spend vs new customers.** 52 Monday weeks ending with the range; partial weeks and weeks with spend gaps are dropped. Fit `new = a + b ln(spend)` (log fit, handles weeks with 0 new customers, which a power fit cannot). Hidden below 8 weeks, when b <= 0, or when R2 < 0.10, each with its reason; R2 < 0.30 is shown with a "weak fit" warning. Marginal nCAC at the current weekly spend (mean of the range's complete weeks) = spend / b, shown next to the average nCAC. Calculator: move X a week from A to B, change in new customers read off both fits (floored at 0 customers a week), GP after ads = those customers x each market's first-order GP per new customer; capped at A's spend; warns when it leaves the spend range the fits have seen.
5. **Funnel by market.** GA4 sessions by country grouped into sold markets and Other: sessions, engaged, unpaid share (unpaid engaged / engaged), add-to-cart rate and purchase CVR per session, each indexed to home = 100, deltas vs Compare when the compare period has GA4 days. Coverage line states the first GA4 day and days covered in each range. No GA4 rows ever: "GA4 not connected." (RawBark, Ethia).
6. **Order value vs free shipping.** Bins of order **net sales** (ex VAT, ex shipping), not net revenue: the shipping a paying order adds would push paid orders across the threshold and smear the step. Fine bin = round(p95 / 20) / 5, top 1 % folded into the last bar; display bars are 5 fine bins. Inferred threshold = smallest fine edge where at least 80 % of orders at or above it AND at least 80 % in the next two fine bins (widened to 5 orders) shipped free, with at least max(20, 5 %) orders above. Without the second test the rule lands one or two bins early (Dobias US: 112 instead of 128). Shoptet: n/a with the platform reason (no shipping split).

## Real numbers (prod `mart`, read only, 2026-07-16 to 2026-10-14)

- Weekly scale matches the Overview: Dobias US about 200 to 270 orders and 45 to 60 new customers a week, CA 80 to 130 orders; RawBark CZ 160 to 220 orders, 15 to 38 new customers, SK 20 to 43 orders, 0 to 6 new customers.
- Free-shipping thresholds inferred by the shipped rule on the real bins: Dobias US 128 USD, CA 92 USD (net sales ex VAT); RawBark CZ 1,920 CZK, SK 1,760 CZK (thin: 398 orders in the quarter, read it as approximate).
- Log fits over 52 weeks (complete, no gaps): Dobias US n 25, R2 0.16, marginal nCAC about 154 vs average 35; CA n 17, R2 0.11; RawBark CZ n 50, R2 0.20, marginal about 3,900 vs average 1,352; RawBark SK R2 0.004, hidden by the R2 gate. All real fits are weak: the page says so.
- GA4: Dobias US 104k sessions, CVR 1.7 %, CA 57k, CVR 1.6 % (index 95); Manami CZ CVR 3.7 %, SK 3.6 %.

## Known limits

- Dobias: Meta spend starts 2026-04-20, so any compare period before that has spend gap days and the bridge is n/a (90 d default vs previous period: 2 gap days). Trends and the response fit drop those weeks.
- RawBark: no COGS, so GP after ads, the portfolio y axis and the bridge are n/a with the Woo COGS reason; trends of revenue, new customers, nCAC and MER still show.
- GA4 by country exists for Dobias and Manami only, from 2026-08-03.
- Cohort CAC is not used here; the portfolio pairs period nCAC with cohort GP per customer, as the spec says.

## Verification

`tsc --noEmit` clean; `check:markets-trends` 108/108; `check:markets` 244/244 and `check:capabilities` 412/412 still pass; `next build` passes (built in a scratch copy so the shared dev server's `.next` was not touched); demo harness `http://localhost:3107/dev/markets-trends` rendered for `na` and `eu`, with and without Compare, desktop and 375 px (no horizontal page scroll), no console errors.
