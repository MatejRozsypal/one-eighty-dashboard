/**
 * Presentation rules for the Goals page in the Health skin: the goal ring's
 * geometry, and the one mapping from a row's status to a status colour.
 *
 * Pure presentation. Nothing here computes a figure; every number it reads
 * (`actual`, `targetToDate`, `target`, `status`) arrives finished from the
 * warehouse through `lib/plan/model.ts`, exactly as before. Safe in client
 * components.
 */

import { STATUS_LABEL } from "./format";
import type { PacingRow, PeriodType, RowStatus } from "./types";

/* ======================================================================== */
/* The goal ring                                                            */
/* ======================================================================== */

/*
 * One full rotation is the period's goal.
 *
 * The arc is `actual to date / target`, so the ring fills as the period runs
 * and closes exactly when the goal is met. The dot is `target to date /
 * target`: where the plan says today should be. The gap between the end of the
 * arc and the dot is therefore the shortfall, read directly off the ring.
 *
 * There is no scale factor to name here, and that is the point of the rule:
 * the denominator is the period's own target, which is data, not a constant.
 * The first cut of this ring plotted pace on a scale with 25% headroom, which
 * meant a month a fifth of the way through drew four fifths of a circle and
 * the goal itself sat two rotations away. One rotation now means one goal.
 *
 * Ratio metrics need no special case. A ratio target does not ramp through the
 * period, so its target to date is its period target and the dot lands at a
 * full rotation, which is correct: an aMER of 2.00x is expected from day one,
 * not accumulated. The same two lines of arithmetic serve every metric.
 */

/** Box, radius and stroke of the ring, in the SVG's own user units. */
export const RING_BOX = 66;
export const RING_RADIUS = 26;
export const RING_STROKE = 8;

/** The overflow arc: inset well inside the main ring, and thinner. */
export const RING_OVERFLOW_RADIUS = 15;
export const RING_OVERFLOW_STROKE = 3.5;

export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** What the ring is drawn from. Every field is a warehouse figure, unchanged. */
export interface RingInput {
  actual: number | null | undefined;
  targetToDate: number | null | undefined;
  target: number | null | undefined;
}

export interface RingGeometry {
  /** Arc length of the main ring, in user units. */
  arc: number;
  /** Arc length of the overflow ring. Zero until the goal is passed. */
  overflowArc: number;
  /** True once the goal is passed and the inner arc is carrying the excess. */
  isOver: boolean;
  /** Share of the goal reached. Null when the period has no target to divide by. */
  fraction: number | null;
  /** Share of the goal the plan expects today. Null without a target. */
  markFraction: number | null;
  /** Centre of the on-plan dot. Null when there is no target to mark. */
  mark: { x: number; y: number } | null;
}

function share(value: number | null | undefined, target: number): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value / target;
}

/** A point on the ring at `fraction` of a turn, clockwise from the top. */
function pointAt(fraction: number): { x: number; y: number } {
  const f = Math.min(1, Math.max(0, fraction));
  const angle = 2 * Math.PI * f;
  const centre = RING_BOX / 2;
  return {
    x: centre + RING_RADIUS * Math.sin(angle),
    y: centre - RING_RADIUS * Math.cos(angle),
  };
}

/**
 * Where the ring's arcs end, and where the dot sits.
 *
 * A period with no target has nothing to divide by, so it draws an empty ring
 * and no dot rather than inventing a denominator.
 *
 * Past one full turn the main ring has nowhere left to go, so it closes and
 * the excess continues on a second, inner arc. Without that, meeting the goal
 * and doubling it would draw the same closed circle. Ad spend and aMER reach
 * this in normal use. The overflow arc itself saturates at one further turn;
 * the figures beside the ring always carry the number.
 */
export function ringGeometry({ actual, targetToDate, target }: RingInput): RingGeometry {
  if (target === null || target === undefined || !Number.isFinite(target) || target === 0) {
    return { arc: 0, overflowArc: 0, isOver: false, fraction: null, markFraction: null, mark: null };
  }

  const fraction = share(actual, target);
  const markFraction = share(targetToDate, target) ?? 0;

  // A figure below zero (CM3 early in a period, when spend lands before margin)
  // draws nothing rather than running the arc backwards.
  const drawn = Math.max(0, fraction ?? 0);
  const main = Math.min(1, drawn);
  const over = Math.min(1, Math.max(0, drawn - 1));

  return {
    arc: main * RING_CIRCUMFERENCE,
    overflowArc: over * 2 * Math.PI * RING_OVERFLOW_RADIUS,
    isOver: over > 0,
    fraction,
    markFraction,
    mark: pointAt(markFraction),
  };
}

/**
 * What the period is called in the ring's own description, so a reader is told
 * which denominator the ring used ("22% of the month's goal") and cannot take
 * it for the pace in the tile's footer, which is measured against the plan to
 * date instead.
 */
const PERIOD_NOUN: Record<PeriodType, string> = {
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  promo: "window",
  gate: "checkpoint",
};

export function periodNoun(periodType: PeriodType): string {
  return PERIOD_NOUN[periodType] ?? "period";
}

function asPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * The ring in words, for its hover title and for screen readers. The ring
 * itself is `aria-hidden`, so this is the only place its two marks are
 * readable, and it names the denominator in both of them.
 */
export function ringDescription(geometry: RingGeometry, periodType: PeriodType): string {
  const noun = periodNoun(periodType);
  if (geometry.fraction === null || geometry.markFraction === null) {
    return `No target for this ${noun}, so the ring is empty.`;
  }
  return `${asPercent(geometry.fraction)} of the ${noun}'s goal. The dot marks ${asPercent(
    geometry.markFraction
  )}, where the plan is today.`;
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
