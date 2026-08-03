/**
 * Inventory — what is on the shelf, how fast it leaves, and what that costs.
 *
 * The page this feeds answers one question the rest of the dashboard cannot:
 * not "what did we earn" but "how much of what we sell can we still sell."
 *
 * This module is the data access half only. The shapes, thresholds and
 * classification rules live in `lib/inventory/model.ts`, which is pure and
 * importable without a database client — the demo generator needs the same
 * rules and should not have to reach through BigQuery to get them.
 *
 * ── Why the numbers describe a point in the past ────────────────────────────
 * There is one stock snapshot per client in the warehouse — the products
 * webhook is not appending — so `mart_sku_inventory` pairs each snapshot with
 * the 90 days of sales ending on the same date. That makes days-of-cover an
 * internally consistent statement about that date rather than a ratio whose
 * numerator and denominator come from different months. `snapshotAgeDays` is
 * carried all the way to the UI so the reader is never left guessing how old
 * "now" is. See INVENTORY_DESIGN_PROPOSAL.md §7.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { isMissingObject } from "@/lib/queries/errors";
import { num, isoDate } from "@/lib/coerce";
import { isDemo } from "@/lib/demo/client";
import { demoInventory } from "@/lib/demo/inventory";
import {
  sumStockValue,
  type AbcGrade,
  type InventoryData,
  type InventoryRow,
  type InventorySummary,
} from "@/lib/inventory/model";

const EMPTY_SUMMARY: InventorySummary = {
  snapshotDate: null,
  snapshotAgeDays: null,
  skuCount: 0,
  skusWithCost: 0,
  negativeStockCount: 0,
  stockValueAtCost: 0,
  valueHealthy: 0,
  valueAtRisk: 0,
  valueOverstocked: 0,
  valueDead: 0,
  stockedOutCount: 0,
};

export async function getInventory(clientId: string): Promise<InventoryData> {
  if (isDemo(clientId)) return demoInventory();

  try {
    const raw = await query<Record<string, unknown>>(
      `SELECT sku, item_name, product_line,
              units_90d, revenue_90d, margin_90d, margin_pct,
              on_hand, unit_cost, stock_value_at_cost,
              velocity_per_day, days_cover, sell_through_90d,
              abc, has_cost, negative_stock, in_catalogue,
              snapshot_date, snapshot_age_days
       FROM \`${PROJECT_ID}.mart.mart_sku_inventory\`
       WHERE client_id = @clientId`,
      { clientId }
    );

    if (raw.length === 0) return { rows: [], summary: EMPTY_SUMMARY };

    const rows: InventoryRow[] = raw.map((r) => ({
      sku: String(r.sku ?? "—"),
      itemName: String(r.item_name ?? "Unknown"),
      productLine: r.product_line ? String(r.product_line) : null,
      unitsSold: num(r.units_90d) ?? 0,
      revenue: num(r.revenue_90d) ?? 0,
      margin: num(r.margin_90d),
      marginPct: num(r.margin_pct),
      onHand: num(r.on_hand),
      unitCost: num(r.unit_cost),
      stockValueAtCost: num(r.stock_value_at_cost),
      velocityPerDay: num(r.velocity_per_day) ?? 0,
      daysCover: num(r.days_cover),
      sellThrough: num(r.sell_through_90d),
      abc: (r.abc as AbcGrade) ?? null,
      hasCost: r.has_cost === true,
      negativeStock: r.negative_stock === true,
      inCatalogue: r.in_catalogue === true,
    }));

    // Sorted by contribution, which is also what the ABCD grade ranks on — so
    // the table reads down in the same order the grades were assigned.
    rows.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));

    const first = raw[0];
    const summary: InventorySummary = {
      snapshotDate: isoDate(
        first.snapshot_date as string | { value: string } | null
      ),
      snapshotAgeDays: num(first.snapshot_age_days),
      skuCount: rows.length,
      skusWithCost: rows.filter((r) => r.hasCost).length,
      negativeStockCount: rows.filter((r) => r.negativeStock).length,
      stockValueAtCost: sumStockValue(rows),
      valueHealthy: sumStockValue(rows, "healthy"),
      valueAtRisk: sumStockValue(rows, "at-risk"),
      valueOverstocked: sumStockValue(rows, "overstocked"),
      valueDead: sumStockValue(rows, "dead"),
      // Sold in the window but nothing left. Genuinely ambiguous — a real
      // stockout and a SKU with inventory tracking switched off look identical
      // from here, which is why the UI names both possibilities.
      stockedOutCount: rows.filter(
        (r) => r.unitsSold > 0 && (r.onHand ?? 0) <= 0
      ).length,
    };

    return { rows, summary };
  } catch (error) {
    // Only a genuinely absent view falls through to the empty state; a
    // permission failure must surface, not masquerade as "no stock data".
    if (!isMissingObject(error)) throw error;
    return { rows: [], summary: EMPTY_SUMMARY };
  }
}
