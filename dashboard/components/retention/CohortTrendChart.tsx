"use client";

/**
 * Trend: one rate per first-order month at ONE horizon, with its Wilson range,
 * and pooled calendar quarters drawn as a step with a shaded range.
 *
 * Reading rules baked in:
 *   - only months that are fully mature for the horizon are drawn (no partial points);
 *   - a month made only of early customers is a hollow point;
 *   - a month under 30 customers has no point (n/a), its bar is still there;
 *   - a quarter is drawn only when all 3 months are mature and not early;
 *   - no ranking between months: points are not labelled, the range is the message.
 *
 * Drawn as plain SVG (like the other charts of the dashboard) so the whisker,
 * band and bar strip share one coordinate system. Hover and keyboard focus
 * snap to the nearest month and show a tooltip; a table with the same figures
 * is the Cohorts table above.
 */

import { useState } from "react";
import { formatNumber, formatPercent } from "@/lib/format";
import { RETENTION_TIPS } from "@/lib/metrics";
import { monthLabel, type Trend } from "@/lib/retention/model";
import { ciText } from "@/components/retention/RateCell";

const W = 1000;
const H = 320;
const PAD_L = 40;
const PAD_R = 16;
const PAD_T = 14;
const BAR_H = 34;
const AXIS_H = 22;
const PLOT_B = H - BAR_H - AXIS_H - 8;

const SERIES = "var(--series-1)";

function niceMax(v: number): number {
  const steps = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1];
  return steps.find((s) => s >= v) ?? 1;
}

function shortMonth(month: string): string {
  return `${monthLabel(month).slice(0, 3)} ${month.slice(2, 4)}`;
}

export function CohortTrendChart({ trend, eventLabel }: { trend: Trend; eventLabel: string }) {
  const [active, setActive] = useState<number | null>(null);
  const { points, quarters, entrants, horizon } = trend;
  const count = points.length;
  if (count === 0) return null;

  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / count;
  const x = (i: number) => PAD_L + (i + 0.5) * slot;
  const top = Math.max(0.02, ...points.map((p) => p.rate.ci?.hi ?? 0), ...quarters.map((q) => q.rate.ci?.hi ?? 0));
  const yMax = niceMax(top);
  const y = (v: number) => PAD_T + (PLOT_B - PAD_T) * (1 - v / yMax);
  const maxN = Math.max(1, ...entrants.map((e) => e.n));
  const labelEvery = Math.max(1, Math.ceil(count / 9));
  const index = new Map(points.map((p, i) => [p.month, i]));

  const ticks = [0, yMax / 2, yMax];

  function pick(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * W;
    setActive(Math.max(0, Math.min(count - 1, Math.floor((px - PAD_L) / slot))));
  }

  const a = active === null ? null : points[active];
  const aQuarter = a ? quarters.find((q) => a.month >= q.from && a.month <= q.to) : undefined;
  const tipLeft = active === null ? 0 : Math.min(78, Math.max(2, (x(active) / W) * 100 - 11));

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-content-body">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden="true">
            <line x1="8" x2="8" y1="0" y2="10" stroke={SERIES} strokeWidth="1.5" />
            <circle cx="8" cy="5" r="3.5" fill={SERIES} />
          </svg>
          Month, 95% range
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden="true">
            <rect x="0" y="0" width="16" height="10" fill={SERIES} opacity="0.16" />
            <line x1="0" x2="16" y1="5" y2="5" stroke={SERIES} strokeWidth="2" />
          </svg>
          Quarter, pooled
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden="true">
            <circle cx="8" cy="5" r="3.5" fill="var(--surface-card)" stroke={SERIES} strokeWidth="1.5" />
          </svg>
          Early
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <div className="relative min-w-[680px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-pan-y"
            role="img"
            aria-label={`${eventLabel} rate within ${horizon} days by first-order month, with quarters pooled`}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
                <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" className="fill-content-muted font-mono text-[10px]">
                  {formatPercent(v, { decimals: 0 })}
                </text>
              </g>
            ))}

            {quarters.map((q) => {
              const i0 = index.get(q.from);
              const i1 = index.get(q.to);
              if (i0 === undefined || i1 === undefined || !q.rate.ci || q.rate.state === "few") return null;
              const x0 = PAD_L + i0 * slot + 2;
              const x1 = PAD_L + (i1 + 1) * slot - 2;
              return (
                <g key={q.from}>
                  <rect x={x0} y={y(q.rate.ci.hi)} width={x1 - x0} height={Math.max(1, y(q.rate.ci.lo) - y(q.rate.ci.hi))} fill={SERIES} opacity="0.14" />
                  <line x1={x0} x2={x1} y1={y(q.rate.p ?? 0)} y2={y(q.rate.p ?? 0)} stroke={SERIES} strokeWidth="2" strokeLinecap="round" />
                  <title>{`${q.label}: ${formatPercent(q.rate.p)}, ${formatNumber(q.rate.k)} of ${formatNumber(q.rate.n)}, 95% CI ${q.rate.ci ? ciText(q.rate.ci) : ""}`}</title>
                </g>
              );
            })}

            {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD_T} y2={PLOT_B} stroke="var(--text-muted)" strokeDasharray="3 3" opacity="0.6" />}

            {points.map((p, i) => {
              if (!p.rate.ci || p.rate.state === "few" || p.rate.p === null) return null;
              const cx = x(i);
              const isActive = active === i;
              return (
                <g key={p.month}>
                  <line x1={cx} x2={cx} y1={y(p.rate.ci.hi)} y2={y(p.rate.ci.lo)} stroke={SERIES} strokeWidth="1.5" opacity={p.early ? 0.55 : 0.8} />
                  <line x1={cx - 3} x2={cx + 3} y1={y(p.rate.ci.hi)} y2={y(p.rate.ci.hi)} stroke={SERIES} strokeWidth="1.5" opacity={p.early ? 0.55 : 0.8} />
                  <line x1={cx - 3} x2={cx + 3} y1={y(p.rate.ci.lo)} y2={y(p.rate.ci.lo)} stroke={SERIES} strokeWidth="1.5" opacity={p.early ? 0.55 : 0.8} />
                  <circle
                    cx={cx}
                    cy={y(p.rate.p)}
                    r={isActive ? 5.5 : 4}
                    fill={p.early ? "var(--surface-card)" : SERIES}
                    stroke={p.early ? SERIES : "var(--surface-card)"}
                    strokeWidth={p.early ? 1.5 : 2}
                  />
                </g>
              );
            })}

            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text key={p.month} x={x(i)} y={PLOT_B + 15} textAnchor="middle" className="fill-content-muted font-mono text-[10px]">
                  {shortMonth(p.month)}
                </text>
              ) : null
            )}

            {entrants.map((e, i) => {
              const h = Math.max(1, (e.n / maxN) * BAR_H);
              return (
                <rect
                  key={e.month}
                  x={x(i) - Math.min(slot * 0.34, 10)}
                  y={H - h}
                  width={Math.min(slot * 0.68, 20)}
                  height={h}
                  rx="2"
                  fill="var(--gray-200)"
                  opacity={active === i ? 1 : 0.7}
                />
              );
            })}
            <text x={PAD_L - 6} y={H - 4} textAnchor="end" className="fill-content-muted font-mono text-[9px]">
              n
            </text>

            {/* Hit areas: one band per month, focusable. */}
            {points.map((p, i) => (
              <rect
                key={p.month}
                x={PAD_L + i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                tabIndex={0}
                aria-label={`${monthLabel(p.month)}: ${p.rate.p === null || p.rate.state === "few" ? "n/a" : formatPercent(p.rate.p)}, ${formatNumber(p.rate.n)} customers`}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ outline: "none" }}
              />
            ))}
          </svg>

          {a && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 w-[200px] rounded-md border border-hairline-inverse bg-bg-inverse p-[10px_12px] text-left shadow-lg"
              style={{ left: `${tipLeft}%` }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-gray-300">{monthLabel(a.month)}</span>
                {a.early && <span className="font-mono text-[9.5px] uppercase text-gray-300">Early</span>}
              </div>
              {a.rate.state === "few" || a.rate.p === null ? (
                <div className="mt-1 font-mono text-[13px] text-content-inverse">n/a</div>
              ) : (
                <>
                  <div className="mt-1 font-mono text-[16px] font-semibold text-content-inverse">{formatPercent(a.rate.p)}</div>
                  <div className="font-mono text-[11px] text-gray-300">
                    {formatNumber(a.rate.k)} of {formatNumber(a.rate.n)}
                  </div>
                  {a.rate.ci && <div className="font-mono text-[11px] text-gray-300">95% CI {ciText(a.rate.ci)}</div>}
                </>
              )}
              <div className="font-mono text-[11px] text-gray-300">{formatNumber(entrants[active]?.n ?? 0)} entrants</div>
              {aQuarter && aQuarter.rate.p !== null && (
                <div className="mt-1 border-t border-hairline-inverse pt-1 font-mono text-[11px] text-gray-300">
                  {aQuarter.label}: {formatPercent(aQuarter.rate.p)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <figcaption className="sr-only">{RETENTION_TIPS.trend}</figcaption>
    </figure>
  );
}
