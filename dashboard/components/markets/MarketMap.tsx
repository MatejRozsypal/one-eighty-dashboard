"use client";

/**
 * The Markets map: country outlines projected on the server (lib/markets/geo),
 * filled here by the selected metric.
 *
 * Every market is a focusable button (Tab, then Enter or Space opens it), and
 * the chart carries a text summary for screen readers. Hatching marks a value
 * that is n/a, a country pooled into Other, or a scouting candidate: the
 * pattern, not a colour, says "no figure here", so it reads the same for
 * every kind of colour vision.
 *
 * Without outlines (a market the atlas does not know) the same items draw as
 * a tile grid, so the page never loses the entry point.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { MapGeometry } from "@/lib/markets/geo";

export interface MapItem {
  /** Market the country opens (its own code, or OTHER). Absent: not clickable. */
  market?: string;
  fill?: { fill: string; opacity: number };
  hatch?: boolean;
  /** Short label drawn on the country (ISO code). */
  label?: string;
  /** Second label line (the value). */
  value?: string;
  /** Accessible name: country and value. */
  aria: string;
}

export function MarketMap({
  geometry,
  items,
  onSelect,
  selected,
  title,
  describedBy,
}: {
  geometry: MapGeometry | null;
  items: Record<string, MapItem>;
  onSelect: (market: string) => void;
  selected: string | null;
  title: string;
  /** Id of the ChartSummary the parent renders beside the map. */
  describedBy?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const entries = Object.entries(items);
  // Labels keep a readable size on screen: the outlines scale with the card,
  // the text is set in viewBox units, so it is scaled back up on a phone.
  const svgRef = useRef<SVGSVGElement>(null);
  const [labelScale, setLabelScale] = useState(1);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !geometry || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setLabelScale(Math.min(2.4, Math.max(1, geometry.width / w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [geometry]);

  if (!geometry) {
    return (
      <div>
        <div role="group" aria-label={title} aria-describedby={describedBy} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entries.map(([iso, it]) => {
            const inner = (
              <>
                <span className="font-mono text-[13px] font-semibold text-content-strong">{iso}</span>
                {it.value && <span className="font-mono text-[12px] tabular text-content-body">{it.value}</span>}
              </>
            );
            const style = it.fill && !it.hatch ? { background: `color-mix(in srgb, ${it.fill.fill} ${Math.round(it.fill.opacity * 100)}%, var(--paper))` } : undefined;
            const cls = `flex min-h-[64px] flex-col items-start justify-between rounded-md border border-hairline p-2.5 text-left ${
              it.hatch ? "bg-[repeating-linear-gradient(45deg,var(--gray-100)_0_4px,var(--paper)_4px_8px)]" : "bg-gray-50"
            }`;
            return it.market ? (
              <button
                key={iso}
                type="button"
                onClick={() => onSelect(it.market!)}
                aria-label={it.aria}
                className={`${cls} transition-shadow duration-fast hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]`}
                style={style}
              >
                {inner}
              </button>
            ) : (
              <div key={iso} className={cls} style={style} aria-label={it.aria}>
                {inner}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11.5px] text-content-muted">Tile grid: no outline for one of these countries.</p>
      </div>
    );
  }

  const { width, height } = geometry;
  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        role="group"
        aria-label={title}
        aria-describedby={describedBy}
      >
        <defs>
          <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" style={{ fill: "var(--gray-100)" }} />
            <line x1="0" y1="0" x2="0" y2="7" style={{ stroke: "var(--gray-300)", strokeWidth: 2.4 }} />
          </pattern>
        </defs>
        <rect width={width} height={height} style={{ fill: "var(--paper)" }} />
        {geometry.countries.map((c, i) => {
          const it = c.iso ? items[c.iso] : undefined;
          const fill = it?.hatch ? `url(#${uid}-hatch)` : it?.fill ? it.fill.fill : "var(--gray-100)";
          const opacity = it && !it.hatch && it.fill ? it.fill.opacity : 1;
          const isSel = it?.market !== undefined && it.market === selected;
          const common = {
            d: c.d,
            style: {
              fill,
              fillOpacity: opacity,
              stroke: isSel ? "var(--text-strong)" : "var(--paper)",
              strokeWidth: isSel ? 2 : 0.8,
            },
          };
          if (!it?.market) return <path key={`${c.iso ?? "x"}-${i}`} {...common} aria-hidden="true" />;
          const market = it.market;
          return (
            <path
              key={`${c.iso}-${i}`}
              {...common}
              role="button"
              tabIndex={0}
              aria-label={it.aria}
              aria-pressed={isSel}
              className="cursor-pointer outline-none transition-[fill-opacity] duration-fast hover:[fill-opacity:0.82] focus-visible:[stroke:var(--text-strong)] focus-visible:[stroke-width:2.5]"
              onClick={() => onSelect(market)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(market);
                }
              }}
            >
              <title>{it.aria}</title>
            </path>
          );
        })}
        {entries.map(([iso, it]) => {
          const at = geometry.labels[iso];
          if (!at || !it.label) return null;
          return (
            <text
              key={`l-${iso}`}
              x={at[0]}
              y={at[1]}
              textAnchor="middle"
              aria-hidden="true"
              className="pointer-events-none font-sans"
              style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 * labelScale, strokeLinejoin: "round", fill: "var(--text-strong)", fontSize: 13 * labelScale }}
            >
              <tspan x={at[0]} className="font-semibold">{it.label}</tspan>
              {it.value && (
                <tspan x={at[0]} dy={14 * labelScale} className="tabular" style={{ fill: "var(--text-body)", fontSize: 11.5 * labelScale }}>
                  {it.value}
                </tspan>
              )}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
