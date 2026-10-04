/**
 * Revenue mix over time, daily revenue split into first-time and returning.
 *
 * A stacked area rather than two lines: the question is composition, and the
 * total is meaningful in its own right. Server-rendered SVG, so it costs no JS.
 *
 * ── Time axis ──────────────────────────────────────────────────────────────
 * Points sit at their date, not at their index, and every day of the range is
 * drawn: a day with no revenue is a zero day (the warehouse has a row for every
 * day, a NULL shop figure means nothing sold). A sparse shop therefore shows
 * gaps as gaps, and the tick labels are evenly spaced in time.
 *
 * Long ranges are bucketed so the chart stays legible: weekly over 120 days,
 * monthly over 730. A bucket plots revenue per day (its total over its days),
 * so a short first or last bucket does not read as a dip.
 *
 * ── The partial day ────────────────────────────────────────────────────────
 * When the range includes today, the last day is shaded: it is structurally
 * incomplete, and without the shading it looks like a cliff ("did we just
 * crash?" is the most common false alarm a dashboard like this produces). A
 * range that ended in the past has no partial day, so nothing is shaded.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatPercent } from "@/lib/currency";
import type { PnlDay } from "@/lib/queries/pnl";
import type { DateRange } from "@/lib/period";

const W = 720;
const H = 210;

/** Just the top edge of a band, for the boundary stroke. */
function linePath(points: Array<{ x: number; yTop: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.yTop.toFixed(1)}`)
    .join(" ");
}

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


const DAY_MS = 86_400_000;
const WEEKLY_OVER_DAYS = 120;
const MONTHLY_OVER_DAYS = 730;

type Grain = "day" | "week" | "month";

function toMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** One plotted point: revenue per day over `days` days, centred on a day index. */
interface Bucket {
  /** Day index (0 = first day of the axis) of the bucket's centre. */
  centre: number;
  returning: number;
  total: number;
}

export interface MixModel {
  grain: Grain;
  /** Days on the axis. */
  days: number;
  /** Date of day index 0, ISO. */
  from: string;
  buckets: Bucket[];
}

/**
 * Zero-fill the range, then bucket it by length.
 *
 * Exported so the bucketing can be asserted without rendering.
 */
export function buildMixModel(
  series: PnlDay[],
  range: DateRange,
  partialLast: boolean
): MixModel {
  const fromMs = toMs(range.from);
  const days = Math.max(1, Math.round((toMs(range.to) - fromMs) / DAY_MS) + 1);

  const newBy = new Array<number>(days).fill(0);
  const retBy = new Array<number>(days).fill(0);
  for (const d of series) {
    const i = Math.round((toMs(d.date) - fromMs) / DAY_MS);
    if (i < 0 || i >= days) continue;
    newBy[i] = d.newCustomerRevenue ?? 0;
    retBy[i] = d.returningCustomerRevenue ?? 0;
  }

  const grain: Grain =
    days > MONTHLY_OVER_DAYS ? "month" : days > WEEKLY_OVER_DAYS ? "week" : "day";

  if (grain === "day") {
    return {
      grain,
      days,
      from: range.from,
      buckets: newBy.map((n, i) => ({ centre: i, returning: retBy[i], total: n + retBy[i] })),
    };
  }

  // Bucket key per day: weekly buckets are 7 days counted from the range start,
  // monthly buckets are calendar months.
  const keyOf = (i: number) =>
    grain === "week" ? Math.floor(i / 7) : isoOf(fromMs + i * DAY_MS).slice(0, 7);

  // The partial day is left out of a bucket's average (and the bucket dropped if
  // it is only that day): a few hours of sales would otherwise drag the last
  // bucket down. It stays on the axis, shaded.
  const last = days - 1;
  const groups = new Map<string | number, { idx: number[]; ret: number; total: number }>();
  for (let i = 0; i < days; i++) {
    if (partialLast && i === last) continue;
    const key = keyOf(i);
    const g = groups.get(key) ?? { idx: [], ret: 0, total: 0 };
    g.idx.push(i);
    g.ret += retBy[i];
    g.total += newBy[i] + retBy[i];
    groups.set(key, g);
  }

  const buckets = [...groups.values()].map((g) => ({
    centre: (g.idx[0] + g.idx[g.idx.length - 1]) / 2,
    returning: g.ret / g.idx.length,
    total: g.total / g.idx.length,
  }));
  return { grain, days, from: range.from, buckets };
}

/** Five evenly spaced dates across the axis, labelled to suit its length. */
export function tickLabels(model: Pick<MixModel, "days" | "from">): string[] {
  const long = model.days > 180;
  return [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const i = Math.round(f * (model.days - 1));
    return new Date(toMs(model.from) + i * DAY_MS).toLocaleDateString("en-US", {
      month: "short",
      ...(long ? { year: "numeric" } : { day: "numeric" }),
      timeZone: "UTC",
    });
  });
}

export function RevenueMix({
  series,
  range,
  partialLast,
  newShare,
}: {
  series: PnlDay[];
  /** The selected period: the axis covers all of it, not just days with sales. */
  range: DateRange;
  /** The range includes today, so its last day is incomplete. */
  partialLast: boolean;
  /** Share of period revenue from first-time customers. */
  newShare: number | null;
}) {
  const model = buildMixModel(series, range, partialLast);
  const hasRevenue = series.some((d) => d.revenue !== null);

  if (model.days < 2 || !hasRevenue || model.buckets.length < 2) {
    return (
      <div className="rounded-card border border-hairline bg-surface-card p-[22px_26px] shadow-sm">
        <Eyebrow>Revenue mix over time</Eyebrow>
        <p className="mt-4 text-[12.5px] text-content-muted">
          Not enough days for trend.
        </p>
      </div>
    );
  }

  const max = Math.max(...model.buckets.map((b) => b.total));
  const scale = max > 0 ? max * 1.05 : 1;
  const span = model.days - 1;
  // Date-positioned. The first and last points sit on the edges so the area
  // reaches both ends of the axis the tick labels describe.
  const xOf = (b: Bucket, i: number) =>
    i === 0 ? 0 : i === model.buckets.length - 1 ? W : (b.centre / span) * W;

  const baseline = model.buckets.map((b, i) => ({ x: xOf(b, i), y: H }));
  const returningTop = model.buckets.map((b, i) => ({
    x: xOf(b, i),
    yTop: H - (b.returning / scale) * H,
  }));
  const totalTop = model.buckets.map((b, i) => ({
    x: xOf(b, i),
    yTop: H - (b.total / scale) * H,
  }));

  const ticks = tickLabels(model);
  const dayWidth = (1 / model.days) * W;
  const ariaGrain =
    model.grain === "day" ? "Daily" : model.grain === "week" ? "Weekly average daily" : "Monthly average daily";

  return (
    <div className="rounded-card border border-hairline bg-surface-card p-[22px_20px_18px] shadow-sm lg:p-[22px_26px_18px]">
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-4">
        <Eyebrow>Revenue mix over time</Eyebrow>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-body">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
            New {newShare !== null ? formatPercent(newShare, { decimals: 0 }) : ""}
          </span>
          <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-body">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-info" />
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
        aria-label={`${ariaGrain} revenue split between new and returning customers`}
      >
        {/*
          Soft vertical gradients with a crisp line along the top of each band,
          rather than two flat saturated slabs. Flat fills at 80-85% opacity
          made the chart read as poster art: the two colours competed at equal
          weight everywhere, and neither boundary, the one that actually
          carries the split, stood out from the mass behind it.

          The fade also puts the strongest colour where each band begins, so
          thickness reads as magnitude instead of the whole area shouting at
          once. `preserveAspectRatio="none"` stretches the geometry, so the
          gradients are declared in objectBoundingBox units to stretch with it.
        */}
        <defs>
          <linearGradient id="mix-returning" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--info)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--info)" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id="mix-new" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        <path d={areaPath(returningTop, baseline)} fill="url(#mix-returning)" />
        <path
          d={areaPath(totalTop, returningTop.map((p) => ({ x: p.x, y: p.yTop })))}
          fill="url(#mix-new)"
        />

        {/*
          The two boundaries, drawn last so nothing sits on top of them.
          `vectorEffect` keeps them hairline-thin despite the non-uniform
          scaling that `preserveAspectRatio="none"` applies.
        */}
        <path
          d={linePath(totalTop)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.75"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={linePath(returningTop)}
          fill="none"
          stroke="var(--info)"
          strokeWidth="1.75"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Last day: structurally incomplete, not a drop. Only when it is today. */}
        {partialLast && (
          <rect
            x={W - dayWidth}
            y={0}
            width={dayWidth}
            height={H}
            fill="rgba(245,166,35,0.10)"
          />
        )}
      </svg>

      <div className="mt-2.5 flex items-center justify-between">
        {ticks.map((t, i) => (
          <span key={i} className="font-mono text-[10.5px] tabular text-content-muted">
            {t}
          </span>
        ))}
      </div>

      {partialLast && (
        <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-[11px]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
          <span className="text-[12px] leading-[1.5] text-content-muted">
            Shaded day is partial.
          </span>
        </div>
      )}
    </div>
  );
}
