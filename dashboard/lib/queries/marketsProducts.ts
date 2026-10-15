/**
 * Markets, Products: net sales and units per product per market, one period.
 *
 * ── Which tables ────────────────────────────────────────────────────────────
 * Orders and their market come from `market_orders` through `marketsTable()`,
 * so `MARKETS_SOURCE` (mart_qa default, mart after sign-off) switches this page
 * with the main Markets page. Lines come from `stg.stg_customer_order_items`,
 * the line view the Repurchase and journey marts use: one product identity per
 * platform (`product_key`) and one stable label (`product_name`, the latest
 * Shoptet name per base code, the shortest Woo name per key, the Shopify item
 * name). Rows are grouped by that label.
 *
 * ── Net sales per product ───────────────────────────────────────────────────
 * Line revenue is not the order's net sales (shipping, order-level discounts,
 * refunds and VAT treatment differ by platform), so each order's `net_sales`
 * is split over its lines in proportion to line revenue. A market's products
 * then add up to the market's net sales on the main page. An order whose
 * lines sum to zero revenue (all gifts) contributes no net sales.
 *
 * ── Units ───────────────────────────────────────────────────────────────────
 * The line view carries no quantity, so units are read from the platform's own
 * line table, summed per order and the view's `product_key` (the key rule is
 * repeated here: Shopify the item name, Shoptet the item code else the name,
 * Woo the SKU else the product id else the name). Only the client's platform
 * table is read.
 *
 * ── Local prices ────────────────────────────────────────────────────────────
 * Local net sales are taken only from orders paid in the market's configured
 * local currency (`client_markets.local_currency`) with an exchange rate on
 * the order: base / `fx_local_to_base`, as lib/queries/markets.ts converts.
 * The page decides whether that covers enough of the market to show.
 *
 * A Markets table that does not exist yet returns null and the page says so.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { optional } from "@/lib/queries/errors";
import { num, num0 } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoMarketsProducts } from "@/lib/demo/marketsProducts";
import type { DemoRegion } from "@/lib/demo/markets";
import type { Client } from "@/lib/clients";
import type { DateRange } from "@/lib/period";
import { MARKETS_SOURCE, marketsTable } from "@/lib/queries/markets";
import type { ProductSalesRow, ProductsRaw } from "@/lib/markets/products";

type Row = Record<string, unknown>;

/** Lines are read a week either side of the range: an order's line date can differ from its order date by a day (time zones). */
const LINE_PAD_DAYS = 7;

/** Quantity per order and product key, from the client's platform table, keyed exactly as the line view keys it. */
function unitsSql(platform: string | null): string {
  const window = `client_id = @clientId AND order_date BETWEEN DATE_SUB(DATE(@from), INTERVAL ${LINE_PAD_DAYS} DAY) AND DATE_ADD(DATE(@to), INTERVAL ${LINE_PAD_DAYS} DAY)`;
  const shopify = `SELECT order_id, item_name AS product_key, SUM(quantity) AS qty
     FROM \`${PROJECT_ID}.stg.stg_shopify_order_items\` WHERE ${window} GROUP BY 1, 2`;
  const shoptet = `SELECT order_code AS order_id, COALESCE(NULLIF(item_code, ''), item_name) AS product_key, SUM(quantity) AS qty
     FROM \`${PROJECT_ID}.stg.stg_shoptet_order_items\` WHERE ${window} GROUP BY 1, 2`;
  const woo = `SELECT order_id, COALESCE(NULLIF(sku, ''), NULLIF(NULLIF(product_id, ''), '0'), item_name) AS product_key, SUM(quantity) AS qty
     FROM \`${PROJECT_ID}.stg.stg_woo_order_items\` WHERE ${window} GROUP BY 1, 2`;
  if (platform === "shopify") return shopify;
  if (platform === "shoptet") return shoptet;
  if (platform === "woocommerce") return woo;
  return [shopify, shoptet, woo].join("\nUNION ALL\n");
}

async function period(clientId: string, platform: string | null, range: DateRange): Promise<ProductSalesRow[]> {
  const rows = await query<Row>(
    `WITH o AS (
       SELECT order_id, market, net_sales, currency_local, fx_local_to_base
       FROM ${marketsTable("market_orders")}
       WHERE client_id = @clientId AND order_date BETWEEN @from AND @to
     ),
     cfg AS (
       SELECT market, local_currency FROM ${marketsTable("client_markets")} WHERE client_id = @clientId
     ),
     li AS (
       SELECT order_id, product_key,
              ANY_VALUE(COALESCE(NULLIF(TRIM(product_name), ''), NULLIF(TRIM(item_name), ''), 'Unnamed')) AS product,
              SUM(revenue) AS rev
       FROM \`${PROJECT_ID}.stg.stg_customer_order_items\`
       WHERE client_id = @clientId
         AND order_date BETWEEN DATE_SUB(DATE(@from), INTERVAL ${LINE_PAD_DAYS} DAY) AND DATE_ADD(DATE(@to), INTERVAL ${LINE_PAD_DAYS} DAY)
       GROUP BY order_id, product_key
     ),
     u AS (${unitsSql(platform)}),
     ot AS (SELECT order_id, SUM(rev) AS order_rev FROM li GROUP BY order_id),
     x AS (
       SELECT o.market, li.product,
              o.net_sales * SAFE_DIVIDE(li.rev, ot.order_rev) AS net,
              u.qty,
              (o.currency_local = cfg.local_currency AND o.fx_local_to_base IS NOT NULL AND o.fx_local_to_base > 0) AS in_local,
              o.fx_local_to_base AS fx
       FROM o
       JOIN li USING (order_id)
       JOIN ot USING (order_id)
       LEFT JOIN u USING (order_id, product_key)
       LEFT JOIN cfg ON cfg.market = o.market
     )
     SELECT market, product,
            IFNULL(SUM(net), 0) AS net_sales,
            SUM(qty) AS units,
            IFNULL(SUM(IF(in_local, SAFE_DIVIDE(net, fx), 0)), 0) AS local_net_sales,
            IFNULL(SUM(IF(in_local, qty, 0)), 0) AS local_units,
            IFNULL(SUM(IF(in_local, net, 0)), 0) AS local_covered_net_sales
     FROM x
     GROUP BY market, product`,
    { clientId, from: range.from, to: range.to }
  );
  return rows.map((r) => ({
    market: String(r.market),
    product: String(r.product),
    netSales: num0(r.net_sales),
    units: num(r.units),
    localNetSales: num0(r.local_net_sales),
    localUnits: num0(r.local_units),
    localCoveredNetSales: num0(r.local_covered_net_sales),
  }));
}

async function config(clientId: string): Promise<{ home: string | null; localCurrencyOf: Record<string, string> }> {
  const rows = await optional(
    () =>
      query<Row>(`SELECT market, local_currency, is_home FROM ${marketsTable("client_markets")} WHERE client_id = @clientId`, {
        clientId,
      }),
    [] as Row[]
  );
  const home = rows.find((r) => r.is_home === true);
  return {
    home: home?.market ? String(home.market) : null,
    localCurrencyOf: Object.fromEntries(rows.filter((r) => r.local_currency).map((r) => [String(r.market), String(r.local_currency)])),
  };
}

/** Products by market for one client and period; null when the Markets tables are not built. */
export async function getMarketsProducts(
  client: Client,
  range: DateRange,
  comparison: DateRange | null,
  opts: { demoRegion?: DemoRegion } = {}
): Promise<ProductsRaw | null> {
  if (isDemo(client.clientId)) return demoMarketsProducts(opts.demoRegion ?? "na", range, comparison);

  const clientId = client.clientId;
  const platform = client.shopPlatform;
  return optional(async () => {
    const [current, previous, cfg] = await Promise.all([
      period(clientId, platform, range),
      comparison ? period(clientId, platform, comparison) : Promise.resolve(null),
      config(clientId),
    ]);
    return {
      source: MARKETS_SOURCE,
      baseCurrency: client.currency,
      homeMarket: cfg.home ?? client.country ?? "",
      localCurrencyOf: cfg.localCurrencyOf,
      range,
      compareRange: comparison,
      current,
      previous,
    } satisfies ProductsRaw;
  }, null);
}
