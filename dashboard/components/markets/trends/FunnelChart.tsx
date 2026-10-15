"use client";

/**
 * Funnel by market, drawn as funnels: one row per market, four stages
 * (sessions, engaged, add to cart, purchase) left to right. Stage height is on
 * a square-root scale of the share of sessions, so add to cart and purchase
 * (a few percent of sessions) stay visible; the counts are printed. Between
 * stages sits the step conversion (engaged / sessions, add to cart / engaged,
 * purchase / add to cart), coloured against the home market's same step:
 * green when this market converts better, red when worse, so the step where a
 * market leaks is the red one.
 */

import { useId } from "react";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { formatNumber, formatPercent } from "@/lib/format";
import { isNa } from "@/lib/markets/model";
import type { FunnelRow } from "@/lib/markets/analysis";
import { marketLabel } from "@/components/markets/trends/bits";

const STAGES = ["Sessions", "Engaged", "Add to cart", "Purchase"] as const;
const STEPS = ["engaged / sessions", "add to cart / engaged", "purchase / add to cart"] as const;

/** Within this many percent of home, a step reads as level (grey). */
const LEVEL_BAND = 5;

interface FunnelCounts {
  market: string;
  counts: [number, number, number | null, number | null];
  steps: [number | null, number | null, number | null];
}

function countsOf(r: FunnelRow): FunnelCounts {
  const atc = isNa(r.addToCartRate) ? null : r.addToCartRate.v * r.sessions;
  const buy = isNa(r.cvr) ? null : r.cvr.v * r.sessions;
  const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);
  return {
    market: r.market,
    counts: [r.sessions, r.engagedSessions, atc, buy],
    steps: [ratio(r.engagedSessions, r.sessions), ratio(atc, r.engagedSessions), ratio(buy, atc)],
  };
}

export function FunnelChart({ rows, home }: { rows: FunnelRow[]; home: string | null }) {
  const sumId = useId();
  const data = rows.filter((r) => r.sessions > 0).map(countsOf);
  const homeRow = data.find((d) => d.market === home) ?? null;

  const W = 820;
  const ROW_H = 112;
  const LABEL_W = 70;
  const stageX = (i: number) => LABEL_W + 40 + i * ((W - LABEL_W - 130) / 3);
  const BAR_W = 34;
  const MAX_H = 74;
  const height = (share: number) => Math.max(3, MAX_H * Math.sqrt(Math.max(0, Math.min(1, share))));

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${data.length * ROW_H + 24}`} className="block h-auto w-full" role="img" aria-label="Funnel by market" aria-describedby={sumId}>
        {STAGES.map((s, i) => (
          <text key={s} x={stageX(i)} y={14} textAnchor="middle" style={{ fontSize: 11, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {s.toUpperCase()}
          </text>
        ))}
        {data.map((d, row) => {
          const top = 24 + row * ROW_H;
          const mid = top + ROW_H / 2 - 6;
          const shares = d.counts.map((c) => (c === null ? null : c / d.counts[0]));
          const hs = shares.map((s) => (s === null ? null : height(s)));
          return (
            <g key={d.market}>
              {row > 0 && <line x1={0} x2={W} y1={top} y2={top} style={{ stroke: "var(--border)" }} />}
              <text x={0} y={mid + 4} style={{ fontSize: 13, fill: "var(--text-strong)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                {marketLabel(d.market)}
              </text>
              {d.market === home && (
                <text x={0} y={mid + 19} style={{ fontSize: 10.5, fill: "var(--text-muted)" }}>
                  home
                </text>
              )}
              {/* Connectors: the funnel's sides, from one stage to the next. */}
              {[0, 1, 2].map((i) => {
                const a = hs[i];
                const b = hs[i + 1];
                if (a === null || b === null) return null;
                const x1 = stageX(i) + BAR_W / 2;
                const x2 = stageX(i + 1) - BAR_W / 2;
                return (
                  <path
                    key={`c${i}`}
                    d={`M${x1},${mid - a / 2} L${x2},${mid - b / 2} L${x2},${mid + b / 2} L${x1},${mid + a / 2} Z`}
                    style={{ fill: "var(--growth-100)" }}
                  />
                );
              })}
              {/* Stages */}
              {hs.map((h, i) =>
                h === null ? (
                  <text key={`s${i}`} x={stageX(i)} y={mid + 4} textAnchor="middle" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
                    n/a
                  </text>
                ) : (
                  <g key={`s${i}`}>
                    <rect x={stageX(i) - BAR_W / 2} y={mid - h / 2} width={BAR_W} height={h} rx={3} style={{ fill: i === 0 ? "var(--growth-300)" : "var(--growth-500)" }} />
                    <text x={stageX(i)} y={mid + Math.max(h, 6) / 2 + 14} textAnchor="middle" className="tabular" style={{ fontSize: 11.5, fill: "var(--text-strong)" }}>
                      {formatNumber(Math.round(d.counts[i] as number))}
                    </text>
                    {i > 0 && (
                      <text x={stageX(i)} y={mid + Math.max(h, 6) / 2 + 27} textAnchor="middle" className="tabular" style={{ fontSize: 10.5, fill: "var(--text-muted)" }}>
                        {formatPercent(shares[i] as number)} of sessions
                      </text>
                    )}
                  </g>
                )
              )}
              {/* Step conversion between stages, against home. */}
              {[0, 1, 2].map((i) => {
                const v = d.steps[i];
                if (v === null) return null;
                const h = homeRow?.steps[i] ?? null;
                const idx = h && d.market !== home ? (v / h) * 100 : null;
                const tone = idx === null ? "var(--text-body)" : idx >= 100 + LEVEL_BAND ? "var(--positive-text)" : idx <= 100 - LEVEL_BAND ? "var(--negative-text)" : "var(--text-body)";
                const x = (stageX(i) + stageX(i + 1)) / 2;
                return (
                  <g key={`r${i}`}>
                    <text x={x} y={mid + (idx !== null ? -1 : 4)} textAnchor="middle" className="tabular" style={{ fontSize: 12.5, fontWeight: 600, fill: tone, paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 }}>
                      {formatPercent(v)}
                    </text>
                    {idx !== null && (
                      <text x={x} y={mid + 13} textAnchor="middle" className="tabular" style={{ fontSize: 10.5, fill: tone, paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3 }}>
                        idx {formatNumber(Math.round(idx))}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <p className="m-0 text-[11.5px] text-content-muted">
        Between stages: step conversion ({STEPS.join(", ")}). Green or red against the home market, idx = home 100. Stage height on a square-root scale.
      </p>
      <ChartSummary
        id={sumId}
        categories
        labels={data.map((d) => marketLabel(d.market))}
        series={STEPS.map((s, i) => ({ name: s, values: data.map((d) => d.steps[i]) }))}
        format={(v) => formatPercent(v)}
      />
    </div>
  );
}
