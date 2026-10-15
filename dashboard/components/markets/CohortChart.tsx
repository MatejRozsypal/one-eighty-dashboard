"use client";

/**
 * Cohort value against acquisition cost for one market.
 *
 * Solid: cumulative GP per new customer at 0 (first order), 30, 60, 90, 180
 * and 365 days, each point the latest complete cohorts at that age. Grey: the
 * home market on the same scale. Flat line: today's nCAC, so the crossing is
 * the payback. Dashed with a band: the forecast for young cohorts, labelled
 * as such and drawn apart from the actuals it never mixes with.
 *
 * Without COGS the curve falls back to revenue per customer and says so.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { formatMoney } from "@/lib/format";
import { isNa, num, type MarketColumn } from "@/lib/markets/model";
import { COHORT_AGES } from "@/lib/markets/types";
import { shortName } from "@/lib/markets/display";

const H = 230;
const L = 52;
const R = 92;
const T = 14;
const B = 28;

function niceStep(x: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(x || 1)));
  const f = x / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

type Pt = [number, number];

function curve(c: MarketColumn, field: "gp" | "rev", factor: number): Pt[] {
  if (!c.cohorts) return [];
  const pts: Pt[] = [];
  if (field === "gp") {
    const d0 = num(c.cohorts.firstOrderGpPerCustomer);
    if (d0 !== null) pts.push([0, d0 * factor]);
  }
  for (const a of COHORT_AGES) {
    const p = c.cohorts.points[a];
    if (!p) continue;
    const v = num(field === "gp" ? p.gpPerCustomer : p.revenuePerCustomer);
    if (v !== null) pts.push([a, v * factor]);
  }
  return pts;
}

export function CohortChart({
  market,
  home,
  currency,
  factor,
}: {
  market: MarketColumn;
  home: MarketColumn | null;
  currency: string;
  factor: number;
}) {
  const id = useId();
  // Drawn at the width it is shown at, so the axis text stays legible on a phone.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setW(Math.min(720, Math.max(300, w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gpOk = market.cohorts !== null && Object.values(market.cohorts.points).some((p) => p && !isNa(p.gpPerCustomer));
  const field: "gp" | "rev" = gpOk ? "gp" : "rev";
  const main = curve(market, field, factor);
  const homeCurve = home && home.key !== market.key ? curve(home, field, factor) : [];
  const nCac = field === "gp" ? num(market.cur.nCac) : null;
  const ncacLine = nCac !== null ? nCac * factor : null;
  const fc = field === "gp" ? market.forecast?.value ?? null : null;

  if (main.length < 2) {
    return (
      <p className="text-[12.5px] text-content-muted">
        {market.cohorts ? "Too few complete cohorts to draw a curve yet." : "No cohorts for this market."}
      </p>
    );
  }

  const values = [...main, ...homeCurve].map((p) => p[1]);
  if (ncacLine !== null) values.push(ncacLine);
  if (fc) values.push(fc.high * factor);
  const step = niceStep((Math.max(...values, 1) * 1.08) / 4);
  const yMax = Math.ceil((Math.max(...values, 1) * 1.08) / step) * step;
  const X = (d: number) => L + (d / 365) * (W - L - R);
  const Y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  const short = (v: number) => formatMoney(v, currency, { compact: v >= 10_000, unit: v < 10_000 });

  const ends: Array<{ y: number; text: string; tone: string }> = [];
  const last = main[main.length - 1];
  ends.push({ y: Y(last[1]), text: `${shortName(market)} ${short(last[1])}`, tone: "var(--text-strong)" });
  if (homeCurve.length) {
    const h = homeCurve[homeCurve.length - 1];
    ends.push({ y: Y(h[1]), text: `${shortName(home!)} ${short(h[1])}`, tone: "var(--text-muted)" });
  }
  if (ncacLine !== null) ends.push({ y: Y(ncacLine), text: `nCAC ${short(ncacLine)}`, tone: "var(--warning-700)" });
  if (fc) ends.push({ y: Y(fc.forecast * factor), text: `Forecast ${short(fc.forecast * factor)}`, tone: "var(--text-muted)" });
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
  const labels = ["0 d", ...COHORT_AGES.map((a) => `${a} d`)];
  const ageIndex = (pts: Pt[]) => [0, ...COHORT_AGES].map((a) => pts.find((p) => p[0] === a)?.[1] ?? null);

  return (
    <div ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${field === "gp" ? "Gross profit" : "Revenue"} per new customer by cohort age`}
        aria-describedby={`${id}-sum`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} style={{ stroke: "var(--border)" }} />
            <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" className="font-mono text-[10.5px] tabular" style={{ fill: "var(--text-muted)" }}>
              {formatMoney(v, currency, { compact: v >= 10_000 })}
            </text>
          </g>
        ))}
        {[0, 90, 180, 365].map((d) => (
          <text key={d} x={X(d)} y={H - 8} textAnchor="middle" className="font-mono text-[10.5px]" style={{ fill: "var(--text-muted)" }}>
            {d} d
          </text>
        ))}
        {ncacLine !== null && (
          <line x1={L} x2={W - R} y1={Y(ncacLine)} y2={Y(ncacLine)} style={{ stroke: "var(--warning-700)", strokeWidth: 1.5 }} />
        )}
        {fc && (
          <>
            <path
              d={`M${X(fc.asOfAge)} ${Y(fc.actual * factor)}L${X(365)} ${Y(fc.high * factor)}L${X(365)} ${Y(fc.low * factor)}Z`}
              style={{ fill: "var(--growth-500)", fillOpacity: 0.12 }}
            />
            <path
              d={`M${X(fc.asOfAge)} ${Y(fc.actual * factor)}L${X(365)} ${Y(fc.forecast * factor)}`}
              style={{ fill: "none", stroke: "var(--growth-600)", strokeWidth: 2, strokeDasharray: "5 4" }}
            />
            <circle cx={X(365)} cy={Y(fc.forecast * factor)} r={3.5} style={{ fill: "var(--paper)", stroke: "var(--growth-600)", strokeWidth: 2 }} />
          </>
        )}
        {homeCurve.length > 1 && (
          <path d={path(homeCurve)} style={{ fill: "none", stroke: "var(--gray-300)", strokeWidth: 2, strokeLinejoin: "round" }} />
        )}
        <path d={path(main)} style={{ fill: "none", stroke: "var(--growth-600)", strokeWidth: 2.2, strokeLinejoin: "round" }} />
        {main.map((p) => (
          <circle key={p[0]} cx={X(p[0])} cy={Y(p[1])} r={3.5} style={{ fill: "var(--growth-600)", stroke: "var(--paper)", strokeWidth: 1.5 }}>
            <title>{`${p[0]} d: ${formatMoney(p[1], currency, { unit: true })}`}</title>
          </circle>
        ))}
        {ends.map((e) => (
          <text key={e.text} x={W - R + 8} y={e.y + 3.5} className="font-sans text-[11px] font-medium tabular" style={{ fill: e.tone }}>
            {e.text}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-content-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-[3px] w-4 rounded-pill bg-growth-600" />
          {shortName(market)}, actual
        </span>
        {homeCurve.length > 1 && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-[3px] w-4 rounded-pill bg-gray-300" />
            {shortName(home!)} (home)
          </span>
        )}
        {ncacLine !== null && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-[2px] w-4 bg-warning-700" />
            nCAC in this range
          </span>
        )}
        {fc && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-growth-600" />
            Forecast with range, {fc.cohorts} young cohort{fc.cohorts === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {field === "rev" && <p className="mt-1.5 text-[11.5px] text-content-muted">Revenue per customer: no COGS for a GP curve.</p>}
      <ChartSummary
        id={`${id}-sum`}
        labels={labels}
        format={(x) => formatMoney(x, currency, { unit: true })}
        series={[
          { name: `${shortName(market)} actual`, values: ageIndex(main) },
          ...(homeCurve.length ? [{ name: `${shortName(home!)} home`, values: ageIndex(homeCurve) }] : []),
          ...(ncacLine !== null ? [{ name: "nCAC", values: [ncacLine] }] : []),
          ...(fc ? [{ name: "Forecast at 365 d", values: [fc.forecast * factor] }] : []),
        ]}
      />
    </div>
  );
}
