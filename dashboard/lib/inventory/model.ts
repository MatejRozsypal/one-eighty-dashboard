/**
 * Inventory domain model — shapes and classification, no data access.
 *
 * Deliberately separate from `lib/queries/inventory.ts`, which is server-only
 * because it holds the BigQuery client. Everything here is pure: the same
 * classification has to be applied by the warehouse-backed query, by the demo
 * generator, and by the page, and none of those three should have to import a
 * database client to ask "is this SKU overstocked".
 *
 * Keeping it here also means the rules can be exercised directly, which matters
 * more than usual for this page — the thresholds below are assumptions standing
 * in for data we do not have yet, and an assumption that silently changes
 * meaning is worse than one that is wrong out loud.
 */

/** ABCD grade. `U` = too little history to judge; `null` = ungradeable. */
export type AbcGrade = "A" | "B" | "C" | "D" | "U" | null;

export interface InventoryRow {
  sku: string;
  itemName: string;
  productLine: string | null;
  unitsSold: number;
  revenue: number;
  /** NULL where cost is unknown — never coerced to zero. */
  margin: number | null;
  marginPct: number | null;
  onHand: number | null;
  unitCost: number | null;
  stockValueAtCost: number | null;
  velocityPerDay: number;
  /** NULL when nothing sold — cover is undefined, not infinite. */
  daysCover: number | null;
  sellThrough: number | null;
  abc: AbcGrade;
  hasCost: boolean;
  negativeStock: boolean;
  inCatalogue: boolean;
}

export interface InventorySummary {
  snapshotDate: string | null;
  snapshotAgeDays: number | null;
  skuCount: number;
  /** SKUs whose cost is known — the denominator for every money figure below. */
  skusWithCost: number;
  negativeStockCount: number;
  stockValueAtCost: number;
  /** Stock value split by state. Only covers SKUs with a known cost. */
  valueHealthy: number;
  valueAtRisk: number;
  valueOverstocked: number;
  valueDead: number;
  /** SKUs at zero stock that sold in the window — stocked out, or untracked. */
  stockedOutCount: number;
}

export interface InventoryData {
  rows: InventoryRow[];
  summary: InventorySummary;
}

/**
 * Cover thresholds, in days.
 *
 * Placeholders standing in for per-SKU supplier lead times, which no client has
 * given us yet (`ref.sku_config` in the proposal). Named constants rather than
 * inline comparisons so that swapping them for real data is a change of source,
 * not a rewrite — and so the UI can say out loud that they are assumptions.
 */
export const COVER_AT_RISK_DAYS = 45;
export const COVER_OVERSTOCK_DAYS = 180;

export type StockState = "at-risk" | "healthy" | "overstocked" | "dead";

/**
 * Classify a SKU. Deliberately total — every row lands somewhere, because a
 * silently unclassified row is a row nobody looks at.
 */
export function stockState(row: InventoryRow): StockState {
  if (row.unitsSold === 0) return "dead";
  if (row.daysCover === null) return "dead";
  if (row.daysCover < COVER_AT_RISK_DAYS) return "at-risk";
  if (row.daysCover > COVER_OVERSTOCK_DAYS) return "overstocked";
  return "healthy";
}

/**
 * Stock value for a state, counting only rows whose cost is known.
 *
 * Negative stock is an error state, not negative value: including it would
 * silently reduce the total and hide the very rows the flag exists to surface.
 */
export function sumStockValue(
  rows: InventoryRow[],
  state?: StockState
): number {
  return rows.reduce((total, row) => {
    if (!row.hasCost) return total;
    if (state && stockState(row) !== state) return total;
    return total + Math.max(row.stockValueAtCost ?? 0, 0);
  }, 0);
}

/**
 * Assign cumulative-contribution ABCD grades in place, over rows already sorted
 * by contribution descending.
 *
 * Shared by the warehouse path and the demo so the two cannot drift into
 * grading the same shape differently. Mirrors the cutoffs in
 * `218_mart_sku_inventory.sql`; if one changes, both must.
 */
export function assignGrades(rows: InventoryRow[]): void {
  const total = rows.reduce((s, r) => s + Math.max(r.margin ?? 0, 0), 0);
  if (total <= 0) return;

  let cumulative = 0;
  for (const row of rows) {
    if (row.unitsSold === 0) {
      row.abc = "D";
      continue;
    }
    cumulative += Math.max(row.margin ?? 0, 0);
    const share = cumulative / total;
    row.abc = share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C";
  }
}

/**
 * Days of cover, written so a human can read it.
 *
 * Cover is stock ÷ velocity, and on a nearly-dead SKU the denominator collapses:
 * Venev's "VENEV set" holds 1,012 units against 5 sold in a quarter, which is
 * 91,080 days. Printing that verbatim is technically honest and practically
 * useless — six digits of false precision that make the page look broken.
 *
 * Past two years the exact figure carries no information anyway: everything up
 * there means "this will not sell through in any planning horizon", and for a
 * cosmetics SKU it means "this expires first".
 */
export function formatCover(days: number | null): string {
  if (days === null) return "—";
  if (days < 730) return `${Math.round(days)} days`;
  const years = days / 365;
  return years >= 100 ? "100+ years" : `${Math.round(years)} years`;
}

export interface Exception {
  sku: string;
  itemName: string;
  abc: AbcGrade;
  action: string;
  evidence: string;
  severity: "high" | "normal";
}

/**
 * Turn the catalogue into at most five decisions, ranked by money at stake.
 *
 * Five is a budget, not a coincidence: process-industry alarm standards
 * (EEMUA 191 / ISA-18.2) give the only measured limits on how many alerts a
 * human absorbs, and scaled to a weekly review they land at about five, of
 * which one may be urgent.
 *
 * SKUs with no cost are skipped entirely. We cannot size the consequence, and a
 * recommendation whose magnitude is unknown is exactly the kind of confident
 * wrong number that costs a dashboard its credibility.
 */
export function buildExceptions(rows: InventoryRow[]): Exception[] {
  const candidates: Array<Exception & { stake: number }> = [];
  const n = (v: number | null) => Math.round(v ?? 0).toLocaleString("en-US");

  for (const row of rows) {
    if (!row.hasCost) continue;
    const state = stockState(row);

    if (state === "at-risk") {
      const cover = row.daysCover ?? 0;
      candidates.push({
        sku: row.sku,
        itemName: row.itemName,
        abc: row.abc,
        action: cover <= 0 ? "Out of stock" : "Reorder",
        severity: row.abc === "A" ? "high" : "normal",
        stake: annualisedContribution(row),
        evidence:
          cover <= 0
            ? `Nothing on hand, but it sold ${n(row.unitsSold)} units and made ` +
              `${n(row.margin)} in margin over the 90 days to the count. Either it ` +
              `stocked out or inventory tracking is off for it — worth confirming ` +
              `which, because only one of those is an emergency.`
            : `${formatCover(cover)} of cover at ${row.velocityPerDay.toFixed(1)} ` +
              `units/day. Any supplier lead time longer than that means the ` +
              `stockout is already unavoidable — and advertising into it spends ` +
              `CAC on an empty shelf.`,
      });
    }

    if (state === "overstocked" || state === "dead") {
      const releasable = releasableCash(row);
      if (releasable <= 0) continue;
      candidates.push({
        sku: row.sku,
        itemName: row.itemName,
        abc: row.abc,
        action: state === "dead" ? "Dead stock" : "Mark down",
        severity: "normal",
        stake: releasable,
        evidence:
          state === "dead"
            ? `${n(row.onHand)} units on hand and nothing sold in 90 days — ` +
              `roughly ${n(releasable)} at cost, doing nothing. For a cosmetics ` +
              `SKU this is also an expiry clock, not just idle cash.`
            : `${formatCover(row.daysCover)} of cover at ` +
              `${row.velocityPerDay.toFixed(2)} units/day. Clearing back to ` +
              `${COVER_OVERSTOCK_DAYS} days would release about ${n(releasable)} ` +
              `of the ${n(row.stockValueAtCost)} tied up here.`,
      });
    }
  }

  return candidates
    .sort((a, b) => {
      // Urgency first, then size — a hero product about to run out outranks a
      // larger pile of slow stock, because only one of them has a deadline.
      if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
      return b.stake - a.stake;
    })
    .slice(0, 5)
    .map(({ stake: _stake, ...rest }) => rest);
}

/**
 * Contribution that stops arriving if this SKU goes to zero, annualised.
 *
 * ── Why annualised, and why this function exists at all ─────────────────────
 * The exception list ranks stockouts against overstock in one sort, so the two
 * stakes have to be the same kind of quantity. They were not: a stockout was
 * scored on one quarter of margin and an overstock on the entire value of the
 * pile. A margin is a recurring flow and stock value is a one-off balance, and
 * scoring a quarter of the flow against all of the balance pushed both errors
 * the same way — slow stock outranked genuinely empty shelves.
 *
 * On real Dobias data that put two overstocked SKUs above TickHex and
 * LiverTune H+, both of which were at zero. Exactly backwards from what the
 * page is for.
 *
 * Four quarters is a ranking device, not a forecast: it does not claim the
 * stockout lasts a year, only that a recurring loss and a one-off release
 * belong on the same axis before they are compared.
 */
function annualisedContribution(row: InventoryRow): number {
  return (row.margin ?? 0) * 4;
}

/**
 * Cash a markdown could actually free — the excess over a healthy cover level,
 * not the whole pile.
 *
 * Nobody clears an overstocked SKU to zero; they clear it back to a sensible
 * cover. Ranking on total stock value therefore overstates every overstock by
 * whatever the SKU legitimately needs to hold, and overstates it most for the
 * fast movers that need the most.
 *
 * Dead stock has no velocity and so no legitimate holding — the whole value is
 * releasable, which is what makes it dead rather than merely slow.
 */
function releasableCash(row: InventoryRow): number {
  const value = row.stockValueAtCost ?? 0;
  if (value <= 0) return 0;
  if (row.velocityPerDay <= 0) return value;

  const onHand = row.onHand ?? 0;
  if (onHand <= 0) return 0;

  const healthyUnits = row.velocityPerDay * COVER_OVERSTOCK_DAYS;
  const excessUnits = Math.max(onHand - healthyUnits, 0);
  return (excessUnits / onHand) * value;
}
