# Markets: Products by market

Subpage of Markets at `/markets/products`: which products sell in which market, and what a market buys differently from home. Kept light, per the owner: shares, units and average selling price. No price index and no buying-power adjustment; a lower price in a market is shown as it is.

Status: built in the worktree `oe-dash-wt/mk0-markets-spec`, not committed, not deployed. The nav link comes from the Trends work (`lib/nav.ts`).

## What the page shows

1. **What sells differently from home** (top card, redesigned 2026-10-16, owner pick: option A by units + D + C). One compared market at a time (pills when there are several). A one-line takeaway (same mix or not; what the market buys clearly more and less of, by index), then the **mix map**: one dot per product, share of home's units across, share of the market's units up, both on square-root axes. The dashed diagonal is "same mix", the grey band is index 85 to 115 (index = market share / home share x 100). Colour = more / same / less, size = the market's units, faded = under 100 units in the market. Units, not net sales or GP, so a lower price in a market does not read as buying less (owner, 2026-10-16). Shipping insurance, gift cards / vouchers and free lines (no net sales) are left out and named under the legend.
1b. **Entry products** (second card, same market). Share of first orders (new customers) containing each product, market vs home, with first-order counts; under 30 first orders a share is faded "low n", never hidden. Takeaway names the product that opens clearly more first orders than at home.
2. **Product x market matrix.** Top 15 products by net sales across all markets as rows, the rest pooled into "Other products" (always last). Columns: All markets, then home, then the other markets by net sales, then Other. Two modes:
   - **Share**: the product's share of that market's net sales, with units under it. Cells are shaded on the accent ramp in fixed steps (under 2 %, 2 %, 5 %, 10 %, 20 %+), so a shade means the same thing in every column.
   - **Avg price**: net sales / units in base currency, with the local price under it where the market pays in one currency. A cell with fewer than 3 units shows n/a, because one order would set the price.
   - Every header sorts; the pooled row stays last. Hover or focus a cell to see net sales, units, share, average price (base and local), and the change in share (pp) and net sales (follows the % / 123 delta toggle) against Compare.
3. **Top 5 per market.** Each market's best sellers with share, a bar scaled to the market's top product, and the change in share in pp against Compare (neutral colour: a share has no better direction). A product that was not in the comparison's top 5 gets a "new" or "was #N" badge.

Period picker, Compare, delta mode, client switcher and demo region (US + CA / CZ + SK) all work. The default range is 90 days, the same as Markets.

## Data

- Orders and markets: `market_orders` through `marketsTable()`, so `MARKETS_SOURCE` switches this page together with Markets (mart_qa by default).
- Lines: `stg.stg_customer_order_items`, the same line view the Repurchase and journey marts use. Products are grouped by its `product_name` label (latest Shoptet name per base code, shortest Woo name per key, Shopify item name).
- **Net sales per product**: each order's `net_sales` is split over its lines in proportion to line revenue. The products of a market therefore add up to that market's net sales on the main Markets page. Checked on real data for the 90 days to 2026-10-13: every order in every market of all 5 clients has lines, and no net sales are lost.
- **Units**: the line view has no quantity, so units come from the client's own platform table (`stg_shopify_order_items`, `stg_shoptet_order_items` or `stg_woo_order_items`). They are joined on order and the view's `product_key`, using the same key rule as the view. Only one platform table is read per client.
- **Local price**: comes only from orders paid in the market's configured local currency (`client_markets.local_currency`) that carry an exchange rate. It is shown when those orders hold at least 95 % of the market's net sales. Otherwise there is an n/a with the reason. A market whose local currency is the base currency shows base only. Other never gets a local price.
- Cost: roughly 450 MB scanned per period (the line view unions every platform), so about 0.9 GB per page load with Compare on.

## Rules (lib/markets/products.ts)

| Constant | Value | Meaning |
|---|---|---|
| `TOP_PRODUCTS` | 15 | matrix rows before pooling |
| `TOP_PER_MARKET` | 5 | per-market list |
| `MIN_MARKET_UNITS` | 50 | below this a market gets no mix map (n/a, a mix this small is noise) |
| `MIX_MIN_UNITS` | 100 | under this many units in the market a product's dot is faded |
| `MIX_BAND` | 15 % | index 85 to 115 reads as the same mix |
| `ENTRY_LIMIT` | 8 | products per entry list |
| `ENTRY_MIN_ORDERS` | 30 | under this many first orders an entry share is faded "low n" |
| `MIN_PRICE_UNITS` | 3 | below this a matrix cell shows no average price |
| `LOCAL_COVERAGE` | 95 % | share of net sales that must be in local-currency orders to show a local price |

## Real-data sanity check (mart_qa, 2026-07-16 to 2026-10-13)

**Dobias, US (home) vs CA.** The mixes are almost the same. The largest gaps are about 2 pp: MitoBoost (+2.1 pp in CA), GutSense (+1.9) and GreenMin (+1.9) are higher in CA; FeelGood Omega H+ (-1.3) and SoulFood H+ (-1.1) are lower. The human H+ line sells a little less in Canada. The real difference is price. In USD, CA's average selling price is 22 to 37 % below US on the top products: GutSense $35.47 vs $56.23, FeelGood Omega $26.38 vs $36.16, JointPowder $54.51 vs $69.54. **CA has no local (CAD) price.** `fx_local_to_base` is NULL on all 1,336 CAD orders in `mk_market_orders`, and the Shopify lines carry USD only. So the page says "No CAD exchange rate on this market's orders in the warehouse". To get CAD prices, the mart needs the presentment FX.

**Rawbark, CZ (home) vs SK.** The mix is the same within about 1 pp: Granule na míru 10 kg 47.2 % vs 48.3 %, and 4 kg 42.7 % vs 42.5 %. Small wet-food lines are slightly higher in SK. The price is lower in SK: the 10 kg bag averages CZK 1,296 (EUR 53.36) vs CZK 1,507 in CZ, which is 14 % less. SK gets a EUR price because 387 of 392 orders are in EUR with a rate.

These figures come from a direct SQL check of the same logic. They are not a screenshot of the live page, which needs a signed-in session.

## Files

- `app/(app)/markets/products/page.tsx`, `loading.tsx`: the route (thin guard)
- `components/markets/products/`: `ProductsScreen` (server: header, controls, Suspense), `ProductsSkeleton`, `ProductsView`, `ProductMatrix`, `MixMap` (+ `MixLegend`), `EntryProducts`, `TopByMarket`
- `lib/markets/products.ts`: pure helpers and model (`marketShares`, `mixProducts`, `unitMix`, `entryProducts`, `topProducts`, `orderMarkets`, `buildProductsModel`, takeaways)
- `lib/queries/marketsProducts.ts`: BigQuery, `getMarketsProducts`
- `lib/demo/marketsProducts.ts`: demo fixture. Each market's net sales come from the Markets demo, so the totals match the main page. The catalogue has 18 products. In the na region, CA leans to supplements and away from the serum and the starter set. In the eu region, SK buys the starter set and the mask, and PL buys the starter set and the travel duo.
- `app/dev/markets-products/page.tsx`: dev harness for the demo client. It returns 404 in production (verified on a production build).
- `scripts/check-markets-products.ts`: `npm run check:markets-products`, 144 checks. They cover shares, the units mix map, entry products, the takeaways, top lists, column order, pooling, reconciliation to Markets, the local-price rules, both demo regions, static renders, and no em dash.

## Verified

- `tsc --noEmit` clean; `check:markets-products` 97/97; `check:markets` 229/229 (unchanged)
- `next build` passes (built from a copy so the shared dev server's `.next` was not touched)
- Demo in the built-in browser (`markets-dev`, :3107, `/dev/markets-products`). Checked: both regions; Share and Avg price modes; hover tooltip with Compare deltas; sorting; at 375 px, no horizontal page scroll and a sticky product column. No console errors.

## Open

- CAD prices for Dobias need `fx_local_to_base` on CA orders (mart build).
- Sorting in Avg price mode sorts by price, so switching mode reorders the rows. This is deliberate: the sort follows what the cells show.
