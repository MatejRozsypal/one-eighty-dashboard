"use client";

/**
 * Plumbing shared by the three Recharts widgets (line, bar, scatter). The only
 * non-chart widget file that imports recharts, and only chart widgets import it.
 *
 * - `ChartFrame`: `ResponsiveContainer` (debounced, so grid resizing stays
 *   smooth), or a fixed `size` for print and tests, where the chart renders
 *   its SVG on the server too.
 * - `TooltipCard`: the light card behind every chart tooltip.
 * - `HatchDefs`: the hatch pattern for a missing bar.
 *
 * Owner: RS7 (widgets).
 */

import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { AXIS_TICK, HATCH_STROKE, TOOLTIP_CLASS, truncateLabel } from "./chartTheme";

export function ChartFrame({ size, children }: { size?: { width: number; height: number }; children: ReactElement }) {
  if (size) return cloneElement(children, { width: size.width, height: size.height });
  return (
    <ResponsiveContainer width="100%" height="100%" debounce={60}>
      {children}
    </ResponsiveContainer>
  );
}

export function TooltipCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={TOOLTIP_CLASS}>
      {title && <div className="mb-1.5 text-content-strong">{title}</div>}
      {children}
    </div>
  );
}

/** One tooltip line: a swatch, a name, and the value right aligned. */
export function TooltipRow({ color, name, value, muted }: { color?: string; name: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-content-muted">
        {color && <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />}
        <span className="truncate">{name}</span>
      </span>
      <span className={`tabular ${muted ? "text-content-muted" : "text-content-strong"}`}>{value}</span>
    </div>
  );
}

/**
 * A category-axis tick (the series names of a horizontal bar) cut to `max`
 * characters, with the full name in the native hover title. Pass it as
 * `tick={categoryTick(14)}`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function categoryTick(max: number): (props: any) => ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function CategoryTick({ x, y, payload }: any) {
    const full = String(payload?.value ?? "");
    return (
      <g transform={`translate(${x},${y})`}>
        <title>{full}</title>
        <text x={0} y={0} dy={4} textAnchor="end" fontSize={AXIS_TICK.fontSize} fontFamily={AXIS_TICK.fontFamily} fill={AXIS_TICK.fill}>
          {truncateLabel(full, max)}
        </text>
      </g>
    );
  };
}

/** Returns a stable, selector-safe pattern id and the `<defs>` that defines it. */
export function useHatch(): { id: string; defs: ReactElement } {
  const raw = useId();
  const id = `hatch-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const defs = (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke={HATCH_STROKE} strokeWidth="2" />
      </pattern>
    </defs>
  );
  return { id, defs };
}
