/**
 * Distribution of days between the first and second order.
 *
 * Bars are the share of repeats landing on each day; the dashed line is the
 * running total of those same bars.
 *
 * ── On the second axis ──────────────────────────────────────────────────────
 * This is a two-scale chart, which is normally the worst thing you can do to a
 * reader: two unrelated measures on two axes invite a correlation that is not
 * there. It is defensible here for one specific reason — the curve is the
 * cumulative sum of the bars, not an independent series. It cannot diverge from
 * them, it can only rise, and there is no spurious relationship to read into
 * it. Both axes are percentages of the same denominator; the right one simply
 * runs to 100 because a cumulative must.
 *
 * ── The peak is a week, not a day ───────────────────────────────────────────
 * With a few hundred repeats spread across ninety buckets, the tallest single
 * bar is usually noise. The highlighted band is the heaviest seven consecutive
 * days, which is a window somebody can actually build a flow around.
 */

import type { RepeatTiming } from "@/lib/queries/repeatTiming";
import { formatNumber, formatPercent } from "@/lib/currency";

const W = 1000;
const H = 300;
const PAD_L = 34;
const PAD_R = 40;
const PAD_T = 16;
const PAD_B = 26;

export function RepeatTimingChart({ timing }: { timing: RepeatTiming }) {
  const { days, peak } = timing;
  if (days.length === 0) return null;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxShare = Math.max(...days.map((d) => d.share), 0.001);

  const x = (day: number) => PAD_L + (day / timing.horizon) * plotW;
  const barW = Math.max(1.5, (plotW / (days.length || 1)) * 0.72);
  const yBar = (share: number) => PAD_T + plotH - (share / maxShare) * plotH;
  const yCum = (c: number) => PAD_T + plotH - c * plotH;

  const inPeak = (day: number) =>
    peak !== null && day >= peak.from && day <= peak.to;

  const curve = days
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(d.day).toFixed(1)} ${yCum(d.cumulative).toFixed(1)}`)
    .join(" ");

  // Day labels every 5 days keeps the axis readable at 90 and survives 180.
  const step = timing.horizon <= 90 ? 5 : timing.horizon <= 180 ? 15 : 30;
  const ticks = days.filter((d) => d.day % step === 0);

  const marker = (target: number) => {
    const hit = days.find((d) => d.cumulative >= target);
    return hit ? { day: hit.day, label: `${Math.round(target * 100)}%` } : null;
  };
  const markers = [marker(0.5), marker(0.8)].filter(Boolean) as Array<{
    day: number;
    label: string;
  }>;

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[720px]"
          role="img"
          aria-label={`Share of second orders by day since the first order, days 0 to ${timing.horizon}`}
        >
          {/* Left axis: share per day */}
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yBar(maxShare * f)}
                y2={yBar(maxShare * f)}
                className="stroke-hairline"
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={yBar(maxShare * f) + 3}
                textAnchor="end"
                className="fill-content-muted font-mono text-[9px]"
              >
                {formatPercent(maxShare * f, { decimals: 0 })}
              </text>
            </g>
          ))}

          {/* Right axis: cumulative */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text
              key={f}
              x={W - PAD_R + 6}
              y={yCum(f) + 3}
              className="fill-content-muted font-mono text-[9px]"
            >
              {Math.round(f * 100)}%
            </text>
          ))}

          {markers.map((m) => (
            <g key={m.label}>
              <line
                x1={x(m.day)}
                x2={x(m.day)}
                y1={PAD_T}
                y2={PAD_T + plotH}
                className="stroke-content-muted"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity={0.5}
              />
              <text
                x={x(m.day) + 4}
                y={PAD_T + 9}
                className="fill-content-muted font-mono text-[9px]"
              >
                {m.label} by day {m.day}
              </text>
            </g>
          ))}

          {days.map((d) => (
            <rect
              key={d.day}
              x={x(d.day) - barW / 2}
              y={yBar(d.share)}
              width={barW}
              height={Math.max(0, PAD_T + plotH - yBar(d.share))}
              rx={1}
              className={inPeak(d.day) ? "fill-growth-500" : "fill-growth-300"}
              opacity={inPeak(d.day) ? 1 : 0.55}
            >
              <title>
                {`Day ${d.day}: ${formatNumber(d.customers)} customers · ${formatPercent(d.share, { decimals: 1 })} of repeats · ${formatPercent(d.cumulative, { decimals: 0 })} cumulative`}
              </title>
            </rect>
          ))}

          <path
            d={curve}
            fill="none"
            className="stroke-growth-700"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />

          {ticks.map((d) => (
            <text
              key={d.day}
              x={x(d.day)}
              y={H - 8}
              textAnchor="middle"
              className="fill-content-muted font-mono text-[9px]"
            >
              {d.day}d
            </text>
          ))}
        </svg>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {[
          { label: "Peak week", className: "bg-growth-500" },
          { label: "Other days", className: "bg-growth-300 opacity-60" },
        ].map((k) => (
          <span
            key={k.label}
            className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-muted"
          >
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[3px] ${k.className}`} />
            {k.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-muted">
          <span aria-hidden="true" className="h-0 w-4 border-t-[1.6px] border-dashed border-growth-700" />
          Cumulative reordered
        </span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
          Right axis = cumulative %
        </span>
      </figcaption>
    </figure>
  );
}
