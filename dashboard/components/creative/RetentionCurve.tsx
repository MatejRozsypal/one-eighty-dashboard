"use client";

/**
 * The retention curve, drawn from eight measured points.
 *
 * ── Why this is hand-drawn SVG and not Recharts ────────────────────────────
 * The x axis is time in seconds with unevenly spaced measurements, the hook and
 * hold moments need their own rules and labels, and a marker has to scrub along
 * the interpolated line as the video plays. Recharts can be bent into all
 * three, but the bending costs more code than the drawing does, and this ends
 * up more readable.
 *
 * The marker is what makes the panel worth opening: it turns "hold rate is
 * 6.1%" into "at 0:07, 9.2% of impressions are still watching", which is a
 * sentence somebody can act on.
 */

import { useMemo } from "react";
import type { RetentionPoint } from "@/lib/creative/view";

const W = 620;
const H = 180;
const ML = 36;
const MR = 14;
const MT = 14;
const MB = 26;

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Linear interpolation between the two measured points either side of `t`. */
export function watchingAt(points: RetentionPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].y;
  const last = points[points.length - 1];
  if (t >= last.t) return last.y;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      return a.y + ((b.y - a.y) * (t - a.t)) / span;
    }
  }
  return last.y;
}

export function RetentionCurve({
  points,
  lengthSec,
  marker,
}: {
  points: RetentionPoint[];
  lengthSec: number;
  /** Seconds, or null when nothing is playing. */
  marker: number | null;
}) {
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  const maxY = useMemo(() => {
    const top = Math.max(...points.map((p) => p.y));
    // Round up to a clean 5% step so the axis labels are readable numbers.
    return Math.max(0.05, Math.ceil((top * 100) / 5) * 0.05);
  }, [points]);

  const x = (t: number) => ML + (t / lengthSec) * pw;
  const y = (v: number) => MT + ph - (v / maxY) * ph;

  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`)
    .join(" ");
  const area = `M${x(0)},${y(0)} ${line.slice(1)} L${x(lengthSec)},${y(0)} Z`;

  const cur = marker === null ? null : watchingAt(points, marker);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Share of impressions still watching across the video's ${Math.round(lengthSec)} seconds`}
    >
      {[0, maxY / 2, maxY].map((g) => (
        <g key={g}>
          <line x1={ML} x2={W - MR} y1={y(g)} y2={y(g)} stroke="var(--border)" />
          <text
            x={ML - 6}
            y={y(g) + 4}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--text-muted)"
          >
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}

      <path d={area} fill="var(--accent)" opacity="0.1" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {points.map((p) => (
        <g key={p.label}>
          <circle cx={x(p.t)} cy={y(p.y)} r="2.8" fill="var(--accent)" />
          {(p.label === "3s" || p.label === "15s") && (
            <>
              {/* The two moments the fast loop is judged on: hook rate at 3
                  seconds, hold rate at 15. Marked because every iteration
                  instruction the tool produces branches on one of them. */}
              <line
                x1={x(p.t)}
                x2={x(p.t)}
                y1={MT}
                y2={MT + ph}
                stroke="var(--text-muted)"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
              <text
                x={x(p.t) + 5}
                y={MT + 11}
                fontFamily="var(--font-mono)"
                fontSize="9.5"
                fill="var(--text-muted)"
                letterSpacing="0.05em"
              >
                {p.label === "3s" ? "HOOK" : "HOLD"}
              </text>
            </>
          )}
        </g>
      ))}

      {marker !== null && cur !== null && (
        <g>
          <line
            x1={x(marker)}
            x2={x(marker)}
            y1={MT}
            y2={MT + ph}
            stroke="var(--text-strong)"
            strokeWidth="1.5"
          />
          <circle cx={x(marker)} cy={y(cur)} r="4.5" fill="var(--text-strong)" />
          <text
            x={Math.min(x(marker) + 8, W - MR - 116)}
            y={y(cur) - 9}
            fontFamily="var(--font-mono)"
            fontSize="11"
            fill="var(--text-strong)"
          >
            {(cur * 100).toFixed(1)}% watching
          </text>
        </g>
      )}

      {[0, lengthSec / 2, lengthSec].map((t, i) => (
        <text
          key={t}
          x={x(t)}
          y={H - 8}
          textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          fontFamily="var(--font-mono)"
          fontSize="10"
          fill="var(--text-muted)"
        >
          {mmss(t)}
        </text>
      ))}
    </svg>
  );
}
