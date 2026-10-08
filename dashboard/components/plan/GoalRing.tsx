/**
 * The goal ring on a Goals tile.
 *
 * One full rotation is the period's goal. The arc is actual to date over the
 * period target, so the ring fills as the period runs and closes exactly when
 * the goal is met; the dark dot is target to date over the same denominator,
 * which is where the plan says today should be. The gap between the end of the
 * arc and the dot is the shortfall.
 *
 * Every metric is drawn the same way, ratio metrics included: a ratio target
 * does not ramp, so its target to date is its period target and the dot sits
 * at a full rotation. The geometry lives in `lib/plan/health.ts`.
 *
 * Past the goal the main ring closes and a second, inner arc carries the
 * excess, so meeting the goal and doubling it do not draw the same picture.
 *
 * ── Why this did not go out with the rollout ───────────────────────────────
 * One rotation is a period target that the warehouse computes on a daily
 * curve, and the dot is where that curve says today should be. No other page
 * in the product has either: Snapshot, Paid and the rest report what happened
 * against a comparison period, not against a plan. Drawing a ring there would
 * mean inventing a denominator, which is the exact mistake the first cut of
 * this ring made inside Goals. It stays where the data is.
 *
 * The ring is decorative, so `aria-hidden`. Its two marks are available as
 * text: `ringDescription` names the denominator ("22% of the month goal"), and
 * it is carried both as a hover title and as a visually hidden sentence, so
 * the ring's share of the goal cannot be read as the pace in the tile footer,
 * which is measured against the plan to date instead.
 */

import {
  RING_BOX,
  RING_CIRCUMFERENCE,
  RING_OVERFLOW_RADIUS,
  RING_OVERFLOW_STROKE,
  RING_RADIUS,
  RING_STROKE,
  ringDescription,
  ringGeometry,
  toneVars,
  type HealthTone,
  type RingInput,
} from "@/lib/plan/health";
import type { PeriodType } from "@/lib/plan/types";

export function GoalRing({
  row,
  periodType,
  tone,
  size = RING_BOX,
}: {
  /** Actual to date, target to date and the period target, as the warehouse gives them. */
  row: RingInput;
  periodType: PeriodType;
  tone: HealthTone;
  /** Rendered size in px. The geometry is unitless, so this only scales it. */
  size?: number;
}) {
  const geometry = ringGeometry(row);
  const { arc, overflowArc, isOver, mark } = geometry;
  const colour = toneVars(tone);
  const centre = RING_BOX / 2;
  const description = ringDescription(geometry, periodType);

  return (
    <span className="flex-none" title={description}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
        aria-hidden="true"
        focusable="false"
        className="block"
      >
        <circle
          cx={centre}
          cy={centre}
          r={RING_RADIUS}
          fill="none"
          stroke={colour.tint}
          strokeWidth={RING_STROKE}
        />
        {arc > 0 && (
          <circle
            cx={centre}
            cy={centre}
            r={RING_RADIUS}
            fill="none"
            stroke={colour.graphic}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${RING_CIRCUMFERENCE}`}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        )}

        {/* Past the goal: the excess, on its own thinner arc inside the closed
            ring, over its own track so the extra turn reads as a turn. */}
        {isOver && (
          <>
            <circle
              cx={centre}
              cy={centre}
              r={RING_OVERFLOW_RADIUS}
              fill="none"
              stroke={colour.tint}
              strokeWidth={RING_OVERFLOW_STROKE}
            />
            <circle
              cx={centre}
              cy={centre}
              r={RING_OVERFLOW_RADIUS}
              fill="none"
              stroke={colour.graphic}
              strokeWidth={RING_OVERFLOW_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${overflowArc} ${2 * Math.PI * RING_OVERFLOW_RADIUS}`}
              transform={`rotate(-90 ${centre} ${centre})`}
            />
          </>
        )}

        {/* On plan for today. White underlay so it stays visible wherever the
            arc happens to end. A period with no target has nothing to mark. */}
        {mark && (
          <>
            <circle cx={mark.x} cy={mark.y} r={4.5} fill="var(--paper)" />
            <circle cx={mark.x} cy={mark.y} r={3} fill="var(--h-mark)" />
          </>
        )}
      </svg>
      <span className="sr-only">{description}</span>
    </span>
  );
}

/** The ring's dot, at text size, for the legend beside the period header. */
export function OnPlanMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" className="flex-none">
      <circle cx="6" cy="6" r="4" fill="var(--h-mark)" />
    </svg>
  );
}

/** A ring part filled, at text size, for the same legend. */
export function GoalArcMark() {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" className="flex-none">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--gray-200)" strokeWidth="2.5" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="var(--h-mark)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * 0.4} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}
