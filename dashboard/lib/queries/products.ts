/**
 * Products — what actually makes the margin.
 *
 * The useful question here isn't "what sells most" but "what is big *and*
 * profitable", so revenue and margin percentage are always returned together.
 * On Dobias the top seller by units is only second by revenue and has the
 * lowest margin of the top three — exactly the tension this page exists to show.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, safeDiv } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";

export interface ProductRow {
  productName: string;
  /** Product line, where the client has one (Dobias: canine / human). */
  productLine: string | null;
  units: number | null;
  revenue: number | null;
  margin: number | null;
  marginPct: number | null;
}

export async function getProducts(
  clientId: string,
  range: DateRange,
  limit = 40
): Promise<ProductRow[]> {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         product_name, product_line,
         SUM(units_sold) AS units,
         SUM(revenue)    AS revenue,
         SUM(margin)     AS margin
       FROM \`${PROJECT_ID}.mart.mart_product_perf\`
       WHERE client_id = @clientId AND date BETWEEN @from AND @to
       GROUP BY product_name, product_line
       HAVING SUM(revenue) > 0
       ORDER BY revenue DESC
       LIMIT @limit`,
      { clientId, from: range.from, to: range.to, limit }
    );

    return rows.map((r) => {
      const revenue = num(r.revenue);
      const margin = num(r.margin);
      return {
        productName: String(r.product_name ?? "—"),
        productLine: r.product_line ? String(r.product_line) : null,
        units: num(r.units),
        revenue,
        margin,
        marginPct: safeDiv(margin, revenue),
      };
    });
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return [];
  }
}
