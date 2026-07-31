/**
 * Revenue mix over time — daily revenue split into first-time and returning.
 *
 * A stacked area rather than two lines: the question is composition, and the
 * total is meaningful in its own right. Server-rendered SVG, so it costs no JS.
 *
 * The last day is shaded. Ad platforms report a day behind, so the final point
 * is structurally incomplete — without the shading it looks like a cliff, and
 * "did we just crash?" is the most common false alarm a dashboard like this
 * produces.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatPercent } from "@/lib/currency";
import type { PnlDay } from "@/lib/queries/pnl";

const W = 720;
const H = 210;

function areaPath(
  points: Array<{ x: number; yTop: number }>,
  baseline: Array<{ x: number; y: number }>
): string {
  const up = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.yTop.toFixed(1)}`)
    .join(" ");
  const down = [...baseline]
    .reverse()
    .map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  return `${up} ${down} Z`;
}

export function RevenueMix({
  series,
  newShare,
}: {
  series: PnlDay[];
  /** Share of period revenue from first-time customers. */
  newShare: number | null;
}) {
  const usable = series.filter((d) => d.revenue !== null);

  if (usable.length < 2) {
    return (
      <div className="rounded-card border border-hairline bg-surface-card p-[22px_26px] shadow-sm">
        <Eyebrow>Revenue mix over time</Eyebrow>
        <p className="mt-4 text-[12.5px] text-content-muted">
          Not enough days in this range to draw a trend.
        </p>
      </div>
    );
  }

  const max = Math.max(
    ...usable.map((d) => (d.newCustomerRevenue ?? 0) + (d.returningCustomerRevenue ?? 0))
  );
  const scale = max > 0 ? max * 1.05 : 1;
  const step = usable.length > 1 ? W / (usable.length - 1) : W;

  const baseline = usable.map((_, i) => ({ x: i * step, y: H }));
  const returningTop = usable.map((d, i) => ({
    x: i * step,
    yTop: H - ((d.returningCustomerRevenue ?? 0) / scale) * H,
  }));
  const totalTop = usable.map((d, i) => ({
    x: i * step,
    yTop:
      H -
      (((d.returningCustomerRevenue ?? 0) + (d.newCustomerRevenue ?? 0)) / scale) * H,
  }));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const idx = Math.min(usable.length - 1, Math.round(f * (usable.length - 1)));
    const [y, m, d] = usable[idx].date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  });

  return (
    <div className="rounded-card border border-hairline bg-surface-card p-[22px_20px_18px] shadow-sm lg:p-[22px_26px_18px]">
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-[5px]">
          <Eyebrow>Revenue mix over time</Eyebrow>
          <span className="text-[12.5px] text-content-muted">
            Daily revenue split by first-time vs returning customer
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-body">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
            New {newShare !== null ? formatPercent(newShare, { decimals: 0 }) : ""}
          </span>
          <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-body">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-ink-600" />
            Returning{" "}
            {newShare !== null ? formatPercent(1 - newShare, { decimals: 0 }) : ""}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[210px] w-full"
        role="img"
        aria-label="Daily revenue split between new and returning customers"
      >
        <path d={areaPath(returningTop, baseline)} fill="rgba(38,38,43,0.88)" />
        <path
          d={areaPath(totalTop, returningTop.map((p) => ({ x: p.x, y: p.yTop })))}
          fill="rgba(18,183,106,0.85)"
        />
        {/* Last day: structurally incomplete, not a drop. */}
        <rect
          x={W - step}
          y={0}
          width={step}
          height={H}
          fill="rgba(245,166,35,0.10)"
        />
      </svg>

      <div className="mt-2.5 flex items-center justify-between">
        {ticks.map((t, i) => (
          <span key={i} className="font-mono text-[10.5px] tabular text-content-muted">
            {t}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-[11px]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
        <span className="text-[12px] leading-[1.5] text-content-muted">
          Shaded day is partial — ad platforms report one day behind, so the last
          point is not a drop.
        </span>
      </div>
    </div>
  );
}
