/**
 * Packs launched per month, against the target.
 *
 * ── Why bars and not the line the other charts use ─────────────────────────
 * A pack is a discrete event — you launched two, or you launched none. A line
 * between June's four and July's zero draws a value at every point between
 * them, and there is no such thing as 2.3 packs in the middle of July. Bars
 * also make a zero month visibly empty rather than a line touching the floor,
 * and an empty month is the finding this chart exists for.
 *
 * The target is a dashed rule across the whole plot rather than a tick on each
 * bar: the question is whether the rhythm clears the line, and a rule lets you
 * read six months of that in one glance.
 *
 * Colour is the same three-state language the gauges use — at target, short,
 * nothing shipped — so a month reads the same here as it would there.
 */

import type { LaunchMonth } from "@/lib/creative/velocity";

export function LaunchCadence({
  months,
  target,
}: {
  months: LaunchMonth[];
  /** Packs per month the client is aiming for. Drawn as the dashed rule. */
  target: number;
}) {
  if (months.length === 0) return null;

  const W = 900;
  const H = 180;
  const ML = 30;
  const MR = 16;
  const MT = 14;
  const MB = 26;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  // Headroom above the tallest bar so its value label is never clipped by the
  // top of the viewBox, and never below the target so the rule stays on screen.
  const maxY = Math.max(target, ...months.map((m) => m.packs)) + 1;
  const barW = (pw / months.length) * 0.46;
  const X = (i: number) => ML + (i + 0.5) * (pw / months.length);
  const Y = (v: number) => MT + ph - (v / maxY) * ph;

  const colourOf = (packs: number) =>
    packs >= target ? "var(--positive)" : packs >= 1 ? "var(--warning)" : "var(--negative)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Packs launched in each of the last ${months.length} months, against a target of ${target} per month`}
    >
      {[0, maxY / 2, maxY].map((v) => (
        <g key={v}>
          <line x1={ML} x2={W - MR} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text
            x={ML - 6}
            y={Y(v) + 4}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--text-muted)"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}

      {months.map((m, i) => (
        <g key={m.month}>
          {m.packs > 0 && (
            <>
              <rect
                x={(X(i) - barW / 2).toFixed(1)}
                y={Y(m.packs).toFixed(1)}
                width={barW.toFixed(1)}
                height={(MT + ph - Y(m.packs)).toFixed(1)}
                rx="4"
                fill={colourOf(m.packs)}
                opacity="0.85"
              />
              <text
                x={X(i)}
                y={Y(m.packs) - 7}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="11.5"
                fill="var(--text-strong)"
              >
                {m.packs}
              </text>
            </>
          )}
          <text
            x={X(i)}
            y={H - 8}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="10.5"
            fill="var(--text-muted)"
          >
            {m.label}
          </text>
        </g>
      ))}

      <line
        x1={ML}
        x2={W - MR}
        y1={Y(target)}
        y2={Y(target)}
        stroke="var(--text-strong)"
        strokeWidth="1.25"
        strokeDasharray="4 3"
      />
      <text
        x={W - MR}
        y={Y(target) - 7}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="10.5"
        fill="var(--text-strong)"
        letterSpacing=".05em"
      >
        TARGET {target}
      </text>
    </svg>
  );
}
