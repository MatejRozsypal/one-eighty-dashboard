/**
 * New ads launched per month against capacity at that month's spend.
 *
 * Bars for launches, as in `LaunchCadence`: a launch is a discrete event and a
 * zero month should look empty. Capacity is a mark across each bar's slot
 * rather than one rule across the plot, because it moves with each month's
 * spend and CPA. A bar above its mark is production the budget could not read;
 * a bar below it is budget that bought no new learning.
 */

import { cadenceTicks } from "@/components/creative/LaunchCadence";

export interface CapacityMonth {
  month: string;
  label: string;
  launched: number | null;
  capacity: number | null;
}

export function CapacityBars({ months }: { months: CapacityMonth[] }) {
  if (months.length === 0) return null;

  const W = 900;
  const H = 200;
  const ML = 30;
  const MR = 16;
  const MT = 16;
  const MB = 26;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  const values = months.flatMap((m) => [m.launched ?? 0, m.capacity ?? 0]);
  const maxY = Math.ceil(Math.max(1, ...values)) + 1;
  const ticks = cadenceTicks(maxY);
  const slot = pw / months.length;
  const barW = slot * 0.46;
  const X = (i: number) => ML + (i + 0.5) * slot;
  const Y = (v: number) => MT + ph - (v / maxY) * ph;

  const colourOf = (m: CapacityMonth) =>
    m.capacity === null || m.launched === null
      ? "var(--text-muted)"
      : m.launched > m.capacity
        ? "var(--warning)"
        : "var(--positive)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`New ads launched and capacity in each of the last ${months.length} months`}
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={ML} x2={W - MR} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text x={ML - 6} y={Y(v) + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--text-muted)">
            {v}
          </text>
        </g>
      ))}

      {months.map((m, i) => (
        <g key={m.month}>
          {m.launched !== null && m.launched > 0 && (
            <>
              <rect
                x={(X(i) - barW / 2).toFixed(1)}
                y={Y(m.launched).toFixed(1)}
                width={barW.toFixed(1)}
                height={(MT + ph - Y(m.launched)).toFixed(1)}
                rx="4"
                fill={colourOf(m)}
                opacity="0.85"
              />
              <text x={X(i)} y={Y(m.launched) - 7} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11.5" fill="var(--text-strong)">
                {m.launched}
              </text>
            </>
          )}
          {m.capacity !== null && (
            <line
              x1={X(i) - slot * 0.36}
              x2={X(i) + slot * 0.36}
              y1={Y(m.capacity)}
              y2={Y(m.capacity)}
              stroke="var(--text-strong)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            >
              <title>{`Capacity ${m.capacity.toFixed(1)}`}</title>
            </line>
          )}
          <text x={X(i)} y={H - 8} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--text-muted)">
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
