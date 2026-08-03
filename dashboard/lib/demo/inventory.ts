/**
 * The demo brand's stock position.
 *
 * Invented, like everything in `lib/demo` — but shaped to show the page doing
 * its job rather than to flatter the brand. A demo catalogue where every SKU is
 * healthy demonstrates nothing: the whole argument for this screen is that real
 * catalogues contain a hero product about to stock out and a slow mover with two
 * years of cover sitting on it. So the fixtures below contain one of each,
 * plus a dead SKU and one with no cost, which is the state that suppresses a
 * recommendation.
 *
 * Cover figures are stated directly rather than derived from the P&L generator:
 * stock on hand is not a function of the revenue series, and pretending it is
 * would make the two disagree in ways a prospect could spot.
 */

import { PRODUCTS } from "./catalog";
import {
  assignGrades,
  sumStockValue,
  type InventoryData,
  type InventoryRow,
  type InventorySummary,
} from "@/lib/inventory/model";

/** Days of cover per product, by catalogue position. Hand-set, not random. */
const COVER_DAYS: number[] = [
  22, // hero product, about to run out — the headline exception
  96,
  134,
  61,
  212, // creeping overstock
  158,
  418, // deep overstock, the cash-release case
  73,
  0, // stocked out
  289,
];

const WINDOW_DAYS = 90;

export function demoInventory(): InventoryData {
  const rows: InventoryRow[] = PRODUCTS.map((p, i) => {
    // A plausible quarterly unit volume for a brand this size, scaled by the
    // same share the rest of the demo uses so the ordering matches Products.
    const unitsSold = Math.round(p.share * 4200);
    const revenue = Math.round(unitsSold * p.price);
    const velocityPerDay = unitsSold / WINDOW_DAYS;

    const daysCover = COVER_DAYS[i] ?? 120;
    const onHand = Math.round(velocityPerDay * daysCover);

    // One SKU deliberately has no cost, to exercise the suppression path.
    const hasCost = p.name !== "Travel Duo";
    const unitCost = hasCost ? Math.round(p.price * (1 - p.marginPct)) : null;
    const margin = hasCost ? Math.round(revenue * p.marginPct) : null;

    return {
      sku: skuFor(p.name),
      itemName: p.name,
      productLine: p.line,
      unitsSold,
      revenue,
      margin,
      marginPct: hasCost ? p.marginPct : null,
      onHand,
      unitCost,
      stockValueAtCost: unitCost === null ? null : onHand * unitCost,
      velocityPerDay,
      daysCover: unitsSold > 0 ? daysCover : null,
      sellThrough: unitsSold / (unitsSold + Math.max(onHand, 0)),
      abc: null, // assigned below, once the contribution ordering is known
      hasCost,
      negativeStock: false,
      inCatalogue: true,
    };
  });

  // One discontinued line still sitting in the warehouse: sold nothing this
  // quarter, so it grades D and lands in the dead-stock bucket.
  rows.push({
    sku: "SS-LEGACY-01",
    itemName: "Summer Glow Oil (discontinued)",
    productLine: "skincare",
    unitsSold: 0,
    revenue: 0,
    margin: 0,
    marginPct: null,
    onHand: 640,
    unitCost: 11,
    stockValueAtCost: 640 * 11,
    velocityPerDay: 0,
    daysCover: null,
    sellThrough: 0,
    abc: "D",
    hasCost: true,
    negativeStock: false,
    inCatalogue: true,
  });

  rows.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
  assignGrades(rows);

  return { rows, summary: summarise(rows) };
}

function summarise(rows: InventoryRow[]): InventorySummary {
  return {
    // The demo's stock is "counted" yesterday — the point being that a healthy
    // pipeline shows a one-day-old snapshot, not a 76-day-old one.
    snapshotDate: yesterday(),
    snapshotAgeDays: 1,
    skuCount: rows.length,
    skusWithCost: rows.filter((r) => r.hasCost).length,
    negativeStockCount: 0,
    stockValueAtCost: sumStockValue(rows),
    valueHealthy: sumStockValue(rows, "healthy"),
    valueAtRisk: sumStockValue(rows, "at-risk"),
    valueOverstocked: sumStockValue(rows, "overstocked"),
    valueDead: sumStockValue(rows, "dead"),
    stockedOutCount: rows.filter((r) => r.unitsSold > 0 && (r.onHand ?? 0) <= 0)
      .length,
  };
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** A stable, plausible-looking SKU from a product name. */
function skuFor(name: string): string {
  return (
    "SS-" +
    name
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .split(/\s+/)
      .map((w) => w.slice(0, 3).toUpperCase())
      .slice(0, 2)
      .join("")
  );
}
