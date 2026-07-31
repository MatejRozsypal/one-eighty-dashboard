/**
 * Small per-page context queries — freshness stamps and order-level extras.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { isoDate, num } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";

export interface DataThrough {
  /** Last date the shop platform reported. Same-day when healthy. */
  shop: string | null;
  /** Last date any ad platform reported. Structurally D-1. */
  ads: string | null;
}

/**
 * How current the data is, per source family.
 *
 * Two stamps rather than one because the expectations genuinely differ: shops
 * land same-day, ad platforms are a day behind by design (Google Ads cannot be
 * queried for today at all). A single "last updated" would make every ad
 * platform look permanently broken.
 */
export async function getDataThrough(clientId: string): Promise<DataThrough> {
  const [row] = await query<Record<string, unknown>>(
    `SELECT
       MAX(IF(revenue IS NOT NULL, date, NULL)) AS shop_last,
       MAX(IF(meta_spend IS NOT NULL OR google_spend IS NOT NULL, date, NULL)) AS ads_last
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId
       AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`,
    { clientId }
  );

  return {
    shop: isoDate((row?.shop_last ?? null) as never),
    ads: isoDate((row?.ads_last ?? null) as never),
  };
}

/**
 * Discounts given in the period.
 *
 * Only `mart_orders` carries this, and that view is Shopify-only — so a Shoptet
 * client returns null and the UI renders "not exposed by this shop platform"
 * rather than a misleading zero.
 */
export async function getDiscounts(
  clientId: string,
  range: DateRange
): Promise<number | null> {
  try {
    const [row] = await query<Record<string, unknown>>(
      `SELECT SUM(total_discounts) AS discounts
       FROM \`${PROJECT_ID}.mart.mart_orders\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to`,
      { clientId, from: range.from, to: range.to }
    );
    return num(row?.discounts);
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}

/**
 * Orders settled in a currency other than the client's main one.
 *
 * Dobias takes a handful of CAD orders alongside USD. Summing them without a
 * rate is meaningless, so `mart_daily_kpis`'s currency-grained rows keep them
 * separate and the snapshot filters to the native currency — this query reports
 * what that filtering left out, so the exclusion is stated rather than silent.
 */
export async function getExcludedCurrencies(
  clientId: string,
  nativeCurrency: string,
  range: DateRange
): Promise<Array<{ currency: string; orders: number; revenue: number }>> {
  const rows = await query<Record<string, unknown>>(
    `SELECT currency, SUM(orders) AS orders, SUM(revenue) AS revenue
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE client_id = @clientId
       AND date BETWEEN @from AND @to
       AND currency != @nativeCurrency
     GROUP BY currency
     HAVING SUM(orders) > 0
     ORDER BY revenue DESC`,
    { clientId, nativeCurrency, from: range.from, to: range.to }
  );

  return rows.map((r) => ({
    currency: String(r.currency),
    orders: num(r.orders) ?? 0,
    revenue: num(r.revenue) ?? 0,
  }));
}
