# Markets: cost cards, CM2 and CM3 (fix F6)

Status 2026-10-15: built in worktree `mk0-markets-spec`, not committed, not deployed. Checks green (`check:markets` 244 passed), `tsc --noEmit` clean, `next build` passes.

## What changed for the reader

Data only, the `/markets` layout is unchanged:

- P&L matrix: the rows **Shipping and fulfilment**, **Payment fees incl. COD**, **CM2** and **CM3** now show values (they were all n/a). One new row, **First-order GP after ads** (money, has a Total), sits right after GP after ads. "First-order GP minus nCAC" stays.
- Drawer waterfall: the dashed CM2 placeholders become bars; the chart ends at CM3 (with a "Fixed market cost" bar when a card has one). Without a card it stays as before, with the reason on each placeholder.
- Verdict chips run on CM2 / CM3 once the market has a card; the "on CM1" tag shows only for markets without one.
- Leaderboard ranks by CM3 once every sold market has a card ("Ranked by CM3"); the map's profit pill reads "CM3" and shows CM3 in the same case. Before that, ranking stays GP after ads.
- A market without a card: those rows are n/a with "No cost card for this market (Settings > Market costs)".

## Storage

Postgres, the same store and pattern as the Creative Engine thresholds (`lib/creative/store.ts`): typed inputs, and the app's BigQuery account is read-only. No BigQuery migration was needed, so `infra/bigquery/299_market_cost_rates.sql` was not written and nothing was created in `mart_qa`.

Table `market_cost_cards`, created by `lib/markets/costStore.ts` behind its own `ensure()` guard (a failure leaves CM2 n/a, nothing else down):

| Column | Meaning |
|---|---|
| client_id, market, effective_from | primary key; market = ISO-2 or `OTHER` |
| ship_cost_per_order | shipping + packaging + pick-and-pack per order, base currency ex VAT |
| pay_fee_pct | payment fees as a share of net revenue (stored 0.029, typed 2.9) |
| cod_fee | extra cost per COD order |
| return_cost | handling per refunded order |
| fixed_monthly | optional fixed cost of running the market per month |
| updated_at, updated_by | audit |

Every cost is nullable with no default: empty means "not stated". History: saving with a new date adds a card and keeps the old one; the same date corrects that card. A day uses the latest card that started on or before it; days before the first card use the first card.

## Formulas (lib/markets/model.ts)

Per market and period, card applied day by day (`marketCosts`):

- Shipping and fulfilment (row) = ship cost x orders + return cost x refunded orders - shipping charged
- Payment fees (row) = fee % x net revenue + COD fee x COD orders
- **CM2** = gross profit + shipping charged - ship cost x orders - fee % x net revenue - COD fee x COD orders - return cost x refunded orders
- **CM3** = CM2 - ad spend (allocated) - fixed monthly cost pro rata (12 / 365 per day of the range)
- CM2 %, CM3 % = of net revenue (model fields, used by the verdicts)
- **First-order GP after ads** = first-order GP per new customer x new customers - ad spend (= the per-customer row x new customers)
- **Break-even aMER** on CM2: AOV new / first-order CM2, where first-order CM2 = first-order GP - (market average shipping net + returns + COD per order) - fee % x new-customer revenue per customer. Falls back to CM1 without a card.
- Total: each market on its own card, summed; n/a naming the markets without a card. Unallocated spend comes off Total CM3.

n/a rules: no card; ship cost or fee % empty; COD fee empty while the market has COD orders; return cost empty while it has refunded orders; no COGS (keeps the COGS reason). When the mart has no COD or refund data, the card's COD fee / return cost is not subtracted and the cell carries a note. Shoptet's shipping is already in net sales, so no offset note there.

Verdicts: CM3 replaces GP after ads in Exit / Fix acquisition / Scale / Hold; Fix structure compares CM2 margin with home when both have cards (drivers now include shipping and payment fees), gross margin otherwise.

## Real data read

When a client has cards, `lib/queries/markets.ts` also reads per-day counts from `market_orders` (`COUNT(*)`, `COUNTIF(is_cod)`, `COUNTIF(refunds > 0)`, `SUM(net_revenue)`), checked read-only on `mart_qa.mk_market_orders`. Clients without cards get no extra query. What the mart has today (Jul 16 to Oct 13): COD orders for Manami (CZ 130, SK 28); refunded orders only for Ethia and RawBark (RawBark reads 0); Dobias and Manami refunds not ingested, so return cost is noted, not subtracted.

## Files

- `lib/markets/types.ts` (CostCard, CostDay, `costCards`, `costDays`)
- `lib/markets/model.ts` (marketCosts, cardOn, sumCosts, NO_CARD, new PeriodMetrics fields, verdict, ranking, mapValue)
- `lib/markets/costStore.ts` (Postgres), `lib/markets/costCardForm.ts` (fields, validation, summary)
- `lib/queries/markets.ts` (cards + per-day counts, `getCostCardMarkets`)
- `lib/demo/markets.ts` (demo cards: US with a rate change 45 days back, CA and PL with a fixed monthly cost, Other)
- `components/markets/PnlMatrix.tsx`, `Waterfall.tsx`, `MarketDrawer.tsx`, `Leaderboard.tsx`, `MarketsView.tsx`, `bits.tsx` (data wiring and tooltip text)
- `components/settings/MarketCostCards.tsx`, `app/(app)/settings/page.tsx` (section "Market costs"), `app/(app)/settings/actions.ts` (`saveMarketCostCardAction`)
- `app/dev/market-costs/page.tsx` (dev harness, 404 in production; `?empty=1` shows the no-card state)
- `scripts/check-markets.ts` (CM2/CM3 math, card history, missing card and empty fields, Total, first-order GP after ads, verdicts on CM2, ranking switch, form validation, matrix and waterfall render)

## What the owner must fill

Settings > Clients > (client) > Market costs: one card per sold market plus "Other countries", all in the client's base currency, ex VAT:

1. **Effective from**: the day the rates start (keep the date to correct, a new date to record a change).
2. **Shipping and fulfilment per order**: carrier + packaging + pick-and-pack (required).
3. **Payment fee %** of net revenue, blended (required).
4. **COD fee per COD order**: required for Manami CZ / SK (and any market with COD); 0 is a valid answer.
5. **Return handling per refunded order**: required where refunds are ingested and non-zero (Ethia); optional elsewhere until refunds are ingested.
6. **Fixed cost per month**: optional.

Until then every real client shows CM2 / CM3 n/a and ranks by GP after ads. The Other card is needed for the Total column's CM2 / CM3, not for the ranking. RawBark gets no CM2 until COGS exists (F7). Duty % and COD refusal % from the SPEC table are not on the card yet.

## Verification note

Verified on a fresh `next dev` of a scratch copy (port 3109): `/dev/markets` (matrix rows filled, CA drawer waterfall to CM3 with fixed cost, "Ranked by CM3", map pill CM3) and `/dev/market-costs` (validation messages, Save disabled while invalid). The shared `markets-dev` server on 3107 answered `/dev/markets` with "Unsupported Server Component type: undefined" after many hot reloads from the parallel agents; the same code renders cleanly on a fresh server and builds, so that server needs a restart.
