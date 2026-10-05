"use client";

/**
 * Time to repeat (or to a full-size order): Kaplan-Meier, share converted by
 * day since the first order, for two groups of first-order dates.
 *
 * Customers who have not had the time yet count until their last observed day
 * instead of being dropped, which is why a recent group can be drawn at all. A
 * curve stops where fewer than 30 customers are still observed. The shaded band
 * is the Greenwood 95% range. Markers sit at 30, 90 and 180 days; hover and
 * keyboard (left and right) read any day: "Day 90: 11.0%, CI a to b, at risk n".
 *
 * One axis, two series: the recent group in the first series colour, the older
 * group in the second. The legend names both and each curve is labelled at its
 * end, so colour is never the only key.
 */

import { useState } from "react";
import { formatNumber, formatPercent } from "@/lib/format";
import { RETENTION_TIPS } from "@/lib/metrics";
import { kmAt, type KmCurve } from "@/lib/retention/stats";
import { ciText } from "@/components/retention/RateCell";

const W = 1000;
const H = 300;
const PAD_L = 40;
const PAD_R = 150;
const PAD_T = 14;
const PAD_B = 28;
const MAX_DAY = 365;
const MARKS = [30, 90, 180] as const;

interface Series {
  key: "recent" | "older";
  label: string;
  color: string;
  curve: KmCurve;
}

function niceMax(v: number): number {
  const steps = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1];
  return steps.find((s) => s >= v) ?? 1;
}

/** Step coordinates [day, value] for a key of the curve's points. */
function steps(curve: KmCurve, key: "cum" | "lo" | "hi"): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let prev = 0;
  for (const p of curve.points) {
    out.push([p.t, prev]);
    out.push([p.t, p[key]]);
    prev = p[key];
  }
  return out;
}

export function RepeatCurveChart({ recent, older, eventLabel }: { recent: KmCurve; older: KmCurve; eventLabel: string }) {
  const [day, setDay] = useState<number | null>(null);

  const series: Series[] = [
    { key: "recent", label: "Last 6 months", color: "var(--series-1)", curve: recent },
    { key: "older", label: "6 to 18 months ago", color: "var(--series-2)", curve: older },
  ];
  const drawn = series.filter((s) => s.curve.endT !== null);
  if (drawn.length === 0) return null;

  const plotW = W - PAD_L - PAD_R;
  const x = (t: number) => PAD_L + (t / MAX_DAY) * plotW;
  const top = Math.max(0.02, ...drawn.flatMap((s) => s.curve.points.map((p) => p.hi)));
  const yMax = niceMax(top);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / yMax);

  const path = (pts: Array<[number, number]>) => pts.map(([t, v], i) => `${i === 0 ? "M" : "L"} ${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const band = (s: Series) => {
    const hi = steps(s.curve, "hi");
    const lo = steps(s.curve, "lo").reverse();
    const end = s.curve.endT ?? 0;
    return `${path(hi)} L ${x(end).toFixed(1)} ${y(hi[hi.length - 1][1]).toFixed(1)} L ${x(end).toFixed(1)} ${y(lo[0][1]).toFixed(1)} ${lo.map(([t, v]) => `L ${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} Z`;
  };
  const line = (s: Series) => {
    const pts = steps(s.curve, "cum");
    const end = s.curve.endT ?? 0;
    pts.push([end, s.curve.points[s.curve.points.length - 1].cum]);
    return path(pts);
  };

  function pick(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * W;
    setDay(Math.max(0, Math.min(MAX_DAY, Math.round(((px - PAD_L) / plotW) * MAX_DAY))));
  }

  const readings = day === null ? [] : series.map((s) => ({ s, r: kmAt(s.curve, day) }));
  const tipLeft = day === null ? 0 : Math.min(62, Math.max(2, (x(day) / W) * 100 + 1.5));

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-content-body">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" x2="18" y1="4" y2="4" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {s.label}
            {s.curve.endT === null && <span className="text-content-muted">(n/a)</span>}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="relative min-w-[680px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-pan-y outline-none"
            role="img"
            tabIndex={0}
            aria-label={`${eventLabel} by day since the first order, for two groups of first orders`}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setDay(null)}
            onFocus={() => setDay((d) => d ?? 90)}
            onBlur={() => setDay(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setDay((d) => Math.min(MAX_DAY, (d ?? 0) + 5));
              if (e.key === "ArrowLeft") setDay((d) => Math.max(0, (d ?? 0) - 5));
            }}
          >
            {[0, yMax / 2, yMax].map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
                <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" className="fill-content-muted font-mono text-[10px]">
                  {formatPercent(v, { decimals: 0 })}
                </text>
              </g>
            ))}
            {[30, 90, 180, 365].map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={H - PAD_B} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
                <text x={x(t)} y={H - PAD_B + 15} textAnchor="middle" className="fill-content-muted font-mono text-[10px]">
                  {t}
                </text>
              </g>
            ))}
            <text x={PAD_L} y={H - PAD_B + 15} textAnchor="middle" className="fill-content-muted font-mono text-[10px]">
              0
            </text>
            <text x={x(365) + 20} y={H - PAD_B + 15} className="fill-content-muted font-mono text-[10px]">
              days
            </text>

            {drawn.map((s) => (
              <g key={s.key}>
                <path d={band(s)} fill={s.color} opacity="0.14" />
                <path d={line(s)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
                {MARKS.map((m) => {
                  const r = kmAt(s.curve, m);
                  return r ? <circle key={m} cx={x(m)} cy={y(r.cum)} r="4" fill={s.color} stroke="var(--surface-card)" strokeWidth="2" /> : null;
                })}
                {s.curve.endT !== null && s.curve.points.length > 0 && (
                  <text
                    x={x(s.curve.endT) + 8}
                    y={y(s.curve.points[s.curve.points.length - 1].cum) + 3}
                    className="fill-content-body font-mono text-[10.5px]"
                  >
                    {s.label}
                  </text>
                )}
              </g>
            ))}

            {day !== null && <line x1={x(day)} x2={x(day)} y1={PAD_T} y2={H - PAD_B} stroke="var(--text-muted)" strokeDasharray="3 3" opacity="0.7" />}
            {readings.map(({ s, r }) => (r ? <circle key={s.key} cx={x(r.t)} cy={y(r.cum)} r="5" fill={s.color} stroke="var(--surface-card)" strokeWidth="2" /> : null))}
          </svg>

          {day !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 w-[230px] rounded-md border border-hairline-inverse bg-bg-inverse p-[10px_12px] text-left shadow-lg"
              style={{ left: `${tipLeft}%` }}
            >
              <div className="font-mono text-[11px] text-gray-300">Day {day}</div>
              {readings.map(({ s, r }) => (
                <div key={s.key} className="mt-1.5">
                  <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-gray-300">
                    <svg width="12" height="6" aria-hidden="true">
                      <line x1="0" x2="12" y1="3" y2="3" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    {s.label}
                  </div>
                  {r ? (
                    <div className="font-mono text-[11.5px] text-content-inverse">
                      <span className="text-[14px] font-semibold">{formatPercent(r.cum)}</span>, CI {ciText(r)}, at risk {formatNumber(r.atRisk)}
                    </div>
                  ) : (
                    <div className="font-mono text-[11.5px] text-gray-300">n/a</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <figcaption className="sr-only">{RETENTION_TIPS.timeToRepeat}</figcaption>
    </figure>
  );
}
