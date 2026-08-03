/**
 * Unit economics — first-time vs returning, at order-line grain.
 *
 * ── Two rows are not measurable, and say so rather than showing a number ────
 * **Return rate.** The warehouse holds no refund data at all — there is no
 * refund or return column anywhere in `stg_shopify_orders`, which is the known
 * gap in METRICS.md ("refetch orders with totalRefundedSet"). The row is kept
 * and marked unmeasured, because dropping it would hide that the leakage
 * picture is incomplete.
 *
 * **Discounts on Shoptet.** Shoptet exposes a per-item discount *percentage*,
 * not an amount, and reconstructing the amount from it means dividing by
 * (100 − pct) — which blows up on a 100% line and quietly invents money
 * elsewhere. Left null, exactly as `mart_orders` already treats it.
 *
 * ── Contribution margin allocates all paid spend to new customers ───────────
 * Paid spend cannot be attributed to an individual order, so it cannot be split
 * between the two segments from the data. The convention here — chosen
 * deliberately, not derived — is that acquisition cost belongs entirely to the
 * customers it acquired, so returning customers carry none and their CM equals
 * gross profit. It is the standard treatment and it flatters returning
 * customers by construction; the page says so where the number is shown.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, safeDiv } from "@/lib/coerce";
import type { DateRange } from "@/lib/period";
import { isDemo } from "@/lib/demo/client";
import { demoUnitEconomics } from "@/lib/demo/commerce";

export interface SegmentEconomics {
  orders: number | null;
  units: number | null;
  /** Average unit retail — before discount. */
  aur: number | null;
  /** Units per transaction. */
  upt: number | null;
  grossRetailPerOrder: number | null;
  /** Net sales ÷ orders — what the customer actually paid, ex-shipping. */
  trueAov: number | null;
  discountRate: number | null;
  cogsPct: number | null;
  grossProfitPct: number | null;
  contributionMarginPct: number | null;
  paidSpend: number | null;
}

export interface UnitEconomics {
  first: SegmentEconomics;
  returning: SegmentEconomics;
  /** True when this platform reports discount amounts at all. */
  hasDiscounts: boolean;
}

const EMPTY: SegmentEconomics = {
  orders: null, units: null, aur: null, upt: null, grossRetailPerOrder: null,
  trueAov: null, discountRate: null, cogsPct: null, grossProfitPct: null,
  contributionMarginPct: null, paidSpend: null,
};

export async function getUnitEconomics(
  clientId: string,
  currency: string,
  range: DateRange
): Promise<UnitEconomics | null> {
  // Demo client: served from memory, never from the warehouse.
  if (isDemo(clientId)) return demoUnitEconomics(range);

  try {
    const [rows, spendRows] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT segment,
                SUM(orders) AS orders, SUM(units) AS units,
                SUM(gross_retail) AS gross_retail, SUM(discounts) AS discounts,
                SUM(net_sales) AS net_sales, SUM(cogs) AS cogs,
                SUM(gross_profit) AS gross_profit
         FROM \`${PROJECT_ID}.mart.mart_unit_economics\`
         WHERE client_id = @clientId AND currency = @currency
           AND date BETWEEN @from AND @to
         GROUP BY segment`,
        { clientId, currency, from: range.from, to: range.to }
      ),
      // Paid spend is not in the line-grain view and cannot be, so it comes
      // from the daily KPIs and is applied whole to the new-customer segment.
      query<Record<string, unknown>>(
        `SELECT SUM(paid_spend) AS paid_spend
         FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
         WHERE client_id = @clientId AND date BETWEEN @from AND @to`,
        { clientId, from: range.from, to: range.to }
      ),
    ]);

    if (rows.length === 0) return null;

    const paidSpend = num(spendRows[0]?.paid_spend);
    let hasDiscounts = false;

    const build = (segment: string): SegmentEconomics => {
      const r = rows.find((x) => String(x.segment) === segment);
      if (!r) return EMPTY;

      const orders = num(r.orders);
      const units = num(r.units);
      const grossRetail = num(r.gross_retail);
      const discounts = num(r.discounts);
      const netSales = num(r.net_sales);
      const cogs = num(r.cogs);
      const grossProfit = num(r.gross_profit);
      if (discounts !== null) hasDiscounts = true;

      // All acquisition cost sits on the new segment — see the header note.
      const spend = segment === "new" ? paidSpend : 0;
      const cm =
        grossProfit === null ? null : grossProfit - (spend ?? 0);

      return {
        orders,
        units,
        aur: safeDiv(grossRetail, units),
        upt: safeDiv(units, orders),
        grossRetailPerOrder: safeDiv(grossRetail, orders),
        trueAov: safeDiv(netSales, orders),
        discountRate: discounts === null ? null : safeDiv(discounts, grossRetail),
        cogsPct: safeDiv(cogs, netSales),
        grossProfitPct: safeDiv(grossProfit, netSales),
        contributionMarginPct: safeDiv(cm, netSales),
        paidSpend: segment === "new" ? paidSpend : 0,
      };
    };

    const first = build("new");
    const returning = build("returning");

    return { first, returning, hasDiscounts };
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return null;
  }
}
