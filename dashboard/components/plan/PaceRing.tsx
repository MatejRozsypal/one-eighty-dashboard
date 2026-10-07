/**
 * The pace ring on a Goals tile.
 *
 * It plots pace, actual to date over target to date, on one scale for every
 * metric. aMER is plotted the same way as the additive ones; a ratio with its
 * own scale would mean the six rings could not be compared at a glance, which
 * is the only reason they are all the same shape.
 *
 * The scale has headroom (`RING_FULL_PACE`), so being on plan sits at
 * `RING_ON_PLAN_FRACTION` of the circumference and the dark dot marks it. Past
 * the top of the scale the main ring closes and a second, inner arc carries
 * the excess, so a period at 400% does not draw the same picture as one at
 * exactly 125%. The geometry lives in `lib/plan/health.ts`.
 *
 * Decorative, so `aria-hidden`: the pace and the status word are text in the
 * tile beside it, and the status never rests on colour alone.
 */

import {
  RING_BOX,
  RING_CIRCUMFERENCE,
  RING_OVERFLOW_RADIUS,
  RING_OVERFLOW_STROKE,
  RING_RADIUS,
  RING_STROKE,
  ringGeometry,
  toneVars,
  type HealthTone,
} from "@/lib/plan/health";

export function PaceRing({
  pacePct,
  tone,
  size = RING_BOX,
}: {
  /** The warehouse's pace, as a percentage. Null draws an empty ring. */
  pacePct: number | null | undefined;
  tone: HealthTone;
  /** Rendered size in px. The geometry is unitless, so this only scales it. */
  size?: number;
}) {
  const { arc, overflowArc, isOver, mark } = ringGeometry(pacePct);
  const colour = toneVars(tone);
  const centre = RING_BOX / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
      aria-hidden="true"
      focusable="false"
      className="flex-none"
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

      {/* Over the top of the scale: the excess, on its own thinner arc inside
          the closed ring, over its own track so the turn reads as a turn. */}
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
          arc happens to end. */}
      <circle cx={mark.x} cy={mark.y} r={4.5} fill="var(--paper)" />
      <circle cx={mark.x} cy={mark.y} r={3} fill="var(--h-mark)" />
    </svg>
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
