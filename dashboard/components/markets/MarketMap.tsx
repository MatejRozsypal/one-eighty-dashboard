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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import "d3-transition";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { MapGeometry } from "@/lib/markets/geo";

/** Zoom range: out to the whole outline area, in to a small country. */
const MIN_K = 0.5;
const MAX_K = 12;

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

  // Pan and zoom, the way an embedded Google map behaves: drag pans, a
  // trackpad pinch or Ctrl/Cmd + wheel zooms, double click zooms in, and a
  // plain wheel (or one finger on a phone) still scrolls the page; a short
  // hint says how to zoom instead. The transform sits on one <g>, so the
  // outlines stay crisp SVG at every level.
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [zoomK, setZoomK] = useState(1);
  const [isHome, setIsHome] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashHint = useCallback((text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 1400);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g || !geometry) return;
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .extent([[0, 0], [geometry.width, geometry.height]])
      .translateExtent(geometry.extent)
      .clickDistance(4)
      // About 2x per mouse-wheel notch; a trackpad pinch sends many small deltas.
      .wheelDelta((e: WheelEvent) => -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.01))
      .filter((event: Event) => {
        if (event.type === "wheel") {
          const w = event as WheelEvent;
          if (w.ctrlKey || w.metaKey) return true;
          flashHint(isMac ? "Use ⌘ + scroll to zoom the map" : "Use Ctrl + scroll to zoom the map");
          return false;
        }
        // One finger scrolls the page (and a tap opens a market); two pan and pinch.
        if (event.type === "touchstart") return (event as TouchEvent).touches.length >= 2;
        const m = event as MouseEvent;
        return !m.button;
      })
      .on("zoom", (event) => {
        const t = event.transform;
        g.setAttribute("transform", t.toString());
        setZoomK(t.k);
        setIsHome(Math.abs(t.k - 1) < 1e-3 && Math.abs(t.x) < 0.5 && Math.abs(t.y) < 0.5);
      });
    const sel = select(svg);
    sel.call(behavior);
    // d3-zoom sets touch-action: none, which would trap one-finger page
    // scrolling on a phone; two-finger gestures still reach the map.
    svg.style.touchAction = "pan-x pan-y";
    zoomRef.current = behavior;
    sel.call(behavior.transform, zoomIdentity);
    return () => {
      sel.on(".zoom", null);
      zoomRef.current = null;
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, [geometry, flashHint]);

  const zoomBy = useCallback((f: number) => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).transition().duration(250).call(zoomRef.current.scaleBy, f);
  }, []);
  const resetZoom = useCallback(() => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).transition().duration(300).call(zoomRef.current.transform, zoomIdentity);
  }, []);

  // Labels that would overlap a label placed before them are hidden at this
  // zoom (markets first, then the order of `items`); zooming in spreads the
  // countries apart and brings them back.
  const visibleLabels = useMemo(() => {
    const out = new Set<string>();
    if (!geometry) return out;
    const s = labelScale / zoomK;
    const placed: Array<[number, number, number, number]> = [];
    const order = [...entries].sort((a, b) => Number(!a[1].market || a[1].hatch) - Number(!b[1].market || b[1].hatch));
    for (const [iso, it] of order) {
      const at = geometry.labels[iso];
      if (!at || !it.label) continue;
      const chars = Math.max(it.label.length, it.value?.length ?? 0);
      const w = chars * 7 * s + 4 * s;
      const h = (it.value ? 30 : 16) * s;
      const box: [number, number, number, number] = [at[0] - w / 2, at[1] - 13 * s, at[0] + w / 2, at[1] - 13 * s + h];
      if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      out.add(iso);
    }
    return out;
  }, [entries, geometry, labelScale, zoomK]);

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

  const { width, height, extent } = geometry;
  const k = zoomK;
  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full cursor-grab select-none active:cursor-grabbing"
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
        <g ref={gRef}>
        <rect x={extent[0][0]} y={extent[0][1]} width={extent[1][0] - extent[0][0]} height={extent[1][1] - extent[0][1]} style={{ fill: "var(--paper)" }} />
        {geometry.countries.map((c, i) => {
          const it = c.iso ? items[c.iso] : undefined;
          const fill = it?.hatch ? `url(#${uid}-hatch)` : it?.fill ? it.fill.fill : "var(--gray-100)";
          const opacity = it && !it.hatch && it.fill ? it.fill.opacity : 1;
          const isSel = it?.market !== undefined && it.market === selected;
          const common = {
            d: c.d,
            // Borders keep their on-screen width at any zoom.
            vectorEffect: "non-scaling-stroke" as const,
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
          if (!at || !it.label || !visibleLabels.has(iso)) return null;
          // Text is divided by the zoom factor so it keeps its size on screen.
          const s = labelScale / k;
          return (
            <text
              key={`l-${iso}`}
              x={at[0]}
              y={at[1]}
              textAnchor="middle"
              aria-hidden="true"
              className="pointer-events-none font-sans"
              style={{ paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 * s, strokeLinejoin: "round", fill: "var(--text-strong)", fontSize: 13 * s }}
            >
              <tspan x={at[0]} className="font-semibold">{it.label}</tspan>
              {it.value && (
                <tspan x={at[0]} dy={14 * s} className="tabular" style={{ fill: "var(--text-body)", fontSize: 11.5 * s }}>
                  {it.value}
                </tspan>
              )}
            </text>
          );
        })}
        </g>
      </svg>

      <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-hairline bg-[var(--paper)] shadow-sm">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in" className={CTRL}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" className={`${CTRL} border-t border-hairline`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <button type="button" onClick={resetZoom} aria-label="Reset map view" disabled={isHome} className={`${CTRL} border-t border-hairline disabled:opacity-40`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 2.5v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {hint && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--text-strong)_45%,transparent)]">
          <span className="rounded-md bg-[var(--paper)] px-3 py-1.5 text-[12.5px] text-content-strong shadow-sm">{hint}</span>
        </div>
      )}
    </div>
  );
}

const CTRL =
  "flex h-8 w-8 items-center justify-center text-content-strong transition-colors duration-fast hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]";
