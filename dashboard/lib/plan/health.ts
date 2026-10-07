/**
 * Presentation rules for the Goals page in the Health skin: the pace ring's
 * geometry, and the one mapping from a row's status to a status colour.
 *
 * Pure presentation. Nothing here computes a figure; every number it reads
 * (`pacePct`, `status`, `result`) arrives finished from the warehouse through
 * `lib/plan/model.ts`, exactly as before. Safe in client components.
 */

import { STATUS_LABEL } from "./format";
import type { PacingRow, RowStatus } from "./types";

/* ======================================================================== */
/* The pace ring                                                            */
/* ======================================================================== */

/**
 * A full circle is 125% of plan.
 *
 * The scale carries headroom above the plan line on purpose: a ring that
 * closed at 100% would have nothing left to show for a period that is ahead,
 * and every good month would look identical to a merely adequate one.
 */
export const RING_FULL_PACE = 1.25;

/**
 * Being exactly on plan therefore sits at 80% of the circumference (1 / 1.25).
 * The dark dot is drawn there, so "where the dot is" reads as "where today
 * should be" on every metric without a label.
 */
export const RING_ON_PLAN_FRACTION = 1 / RING_FULL_PACE;

/** Box, radius and stroke of the ring, in the SVG's own user units. */
export const RING_BOX = 66;
export const RING_RADIUS = 26;
export const RING_STROKE = 8;

/** The overflow arc: inset well inside the main ring, and thinner. */
export const RING_OVERFLOW_RADIUS = 15;
export const RING_OVERFLOW_STROKE = 3.5;

export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface RingGeometry {
  /** Arc length of the main ring, in user units. */
  arc: number;
  /** Arc length of the overflow ring. Zero while pace is within the scale. */
  overflowArc: number;
  /** True once the main ring has closed and the overflow arc is carrying the rest. */
  isOver: boolean;
  /** Centre of the on-plan dot. */
  mark: { x: number; y: number };
}

/**
 * Where the ring's arcs end for a pace.
 *
 * `pacePct` is the warehouse's pace, as a percentage (64.1 for 64.1%). Null,
 * or a period with nothing to pace against, draws an empty ring.
 *
 * Past `RING_FULL_PACE` the main ring has nowhere left to go, so it closes and
 * the excess continues on a second, inner arc. Without that, 125% and 400%
 * would draw the same closed circle. The overflow arc itself saturates at one
 * further turn; the figure beside the ring always carries the number.
 */
export function ringGeometry(pacePct: number | null | undefined): RingGeometry {
  const fraction =
    pacePct === null || pacePct === undefined || !Number.isFinite(pacePct)
      ? 0
      : Math.max(0, pacePct / 100 / RING_FULL_PACE);

  const main = Math.min(1, fraction);
  const over = Math.min(1, Math.max(0, fraction - 1));

  // Clockwise from the top: the ring is drawn rotated -90 degrees, so the
  // marker is placed in the same frame.
  const angle = 2 * Math.PI * RING_ON_PLAN_FRACTION;
  const centre = RING_BOX / 2;

  return {
    arc: main * RING_CIRCUMFERENCE,
    overflowArc: over * 2 * Math.PI * RING_OVERFLOW_RADIUS,
    isOver: over > 0,
    mark: {
      x: centre + RING_RADIUS * Math.sin(angle),
      y: centre - RING_RADIUS * Math.cos(angle),
    },
  };
}

/* ======================================================================== */
/* Status colour                                                            */
/* ======================================================================== */

/** The five status colours the skin defines. See styles/skins/health.css. */
export type HealthTone = "negative" | "info" | "positive" | "warning" | "neutral";

export interface ToneVars {
  /** Labels and the status word. Meets 4.5:1 on white. */
  text: string;
  /** The ring arc and other graphics. Meets 3:1 on white. */
  graphic: string;
  /** The ring's track behind the arc. */
  tint: string;
}

export function toneVars(tone: HealthTone): ToneVars {
  return {
    text: `var(--h-${tone}-text)`,
    graphic: `var(--h-${tone})`,
    tint: `var(--h-${tone}-tint)`,
  };
}

type StatusBits = Pick<PacingRow, "status" | "metric" | "result">;

function isSpend(metric: string): boolean {
  return metric === "ad_spend";
}

/**
 * The word for a status. Unchanged from what the page said before.
 *
 * A closed period shows its result instead. Ad spend reads "Over plan" above
 * its band and "Under plan" below it: spending more is not being ahead. A
 * metric with no target reads "No target", and a targeted metric the data
 * cannot measure reads "No cost data" (CM3) or "Missing days" (aMER).
 */
export function planStatusLabel(row: StatusBits): string {
  if (row.status === "closed" && row.result) return row.result === "met" ? "Met" : "Missed";
  if (row.status === "no_target") return "No target";
  if (row.status === "not_measured") return row.metric === "cm3" ? "No cost data" : "Missing days";
  if (isSpend(row.metric)) {
    if (row.status === "ahead") return "Over plan";
    if (row.status === "behind" || row.status === "off_track") return "Under plan";
  }
  return STATUS_LABEL[row.status];
}

/** The colour for a status. One mapping, read by the chip, the ring and the charts. */
export function planStatusTone(status: RowStatus, metric: string, result: PacingRow["result"]): HealthTone {
  switch (status) {
    case "ahead":
      return isSpend(metric) ? "warning" : "info";
    case "on_track":
      return "positive";
    case "behind":
      return isSpend(metric) ? "info" : "warning";
    case "off_track":
      return isSpend(metric) ? "info" : "negative";
    case "closed":
      return result === "met" ? "positive" : result === "missed" ? "negative" : "neutral";
    default:
      return "neutral";
  }
}

export function toneOfRow(row: StatusBits | undefined): HealthTone {
  return row ? planStatusTone(row.status, row.metric, row.result) : "neutral";
}
