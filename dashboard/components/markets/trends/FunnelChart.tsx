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
 *
 * The rules come from funnelRows (lib/markets/analysis): no step rate and no
 * index on a denominator under 30 ("too few to compare", the counts stay); a
 * step above 100 % keeps its value in neutral grey with a note below the chart
 * and is never coloured against home.
 */

import { useId } from "react";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { formatNumber, formatPercent } from "@/lib/format";
import { isNa } from "@/lib/markets/model";
import { FUNNEL_MIN_DENOMINATOR, FUNNEL_STEPS, type FunnelRow, type FunnelStep } from "@/lib/markets/analysis";
import { marketLabel } from "@/components/markets/trends/bits";

const STAGES = ["Sessions", "Engaged", "Add to cart", "Purchase"] as const;
const STEPS = FUNNEL_STEPS.map((s) => s.label);

/** Within this many percent of home, a step reads as level (grey). */
const LEVEL_BAND = 5;

interface FunnelCounts {
  market: string;
  counts: [number, number, number, number];
  steps: [FunnelStep, FunnelStep, FunnelStep];
}

function countsOf(r: FunnelRow): FunnelCounts {
  return {
    market: r.market,
    counts: [r.sessions, r.engagedSessions, r.addToCartSessions, r.purchases],
    steps: r.steps,
  };
}

export function FunnelChart({ rows, home }: { rows: FunnelRow[]; home: string | null }) {
  const sumId = useId();
  const data = rows.filter((r) => r.sessions > 0).map(countsOf);
  const overs = data.flatMap((d) =>
    d.steps.flatMap((st, i) => (st.over && !isNa(st.rate) ? [{ market: d.market, step: i, st }] : []))
  );

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
          const shares = d.counts.map((c) => c / d.counts[0]);
          const hs = shares.map((s) => height(s));
          // Shares of sessions are rates too: none on fewer than 30 sessions.
          const shareOk = d.counts[0] >= FUNNEL_MIN_DENOMINATOR;
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
              {hs.map((h, i) => (
                  <g key={`s${i}`}>
                    <rect x={stageX(i) - BAR_W / 2} y={mid - h / 2} width={BAR_W} height={h} rx={3} style={{ fill: i === 0 ? "var(--growth-300)" : "var(--growth-500)" }} />
                    <text x={stageX(i)} y={mid + Math.max(h, 6) / 2 + 14} textAnchor="middle" className="tabular" style={{ fontSize: 11.5, fill: "var(--text-strong)" }}>
                      {formatNumber(Math.round(d.counts[i] as number))}
                    </text>
                    {i > 0 && shareOk && (
                      <text x={stageX(i)} y={mid + Math.max(h, 6) / 2 + 27} textAnchor="middle" className="tabular" style={{ fontSize: 10.5, fill: "var(--text-muted)" }}>
                        {formatPercent(shares[i])} of sessions
                      </text>
                    )}
                  </g>
              ))}
              {/* Step conversion between stages, against home. */}
              {[0, 1, 2].map((i) => {
                const st = d.steps[i];
                const x = (stageX(i) + stageX(i + 1)) / 2;
                const halo = { paintOrder: "stroke" as const, stroke: "var(--paper)", strokeWidth: 3 };
                if (isNa(st.rate)) {
                  // Too few to compare (or nothing to divide by): the counts above say it all.
                  return (
                    <text key={`r${i}`} x={x} y={mid + 4} textAnchor="middle" style={{ fontSize: 10.5, fill: "var(--text-muted)", ...halo }}>
                      {st.den > 0 ? "too few to compare" : "n/a"}
                    </text>
                  );
                }
                const idx = d.market !== home && !isNa(st.index) ? st.index.v : null;
                const tone = idx === null ? "var(--text-body)" : idx >= 100 + LEVEL_BAND ? "var(--positive-text)" : idx <= 100 - LEVEL_BAND ? "var(--negative-text)" : "var(--text-body)";
                const second = st.over ? FUNNEL_STEPS[i].overShort : idx !== null ? `idx ${formatNumber(Math.round(idx))}` : null;
                return (
                  <g key={`r${i}`}>
                    <text x={x} y={mid + (second !== null ? -1 : 4)} textAnchor="middle" className="tabular" style={{ fontSize: 12.5, fontWeight: 600, fill: tone, ...halo }}>
                      {formatPercent(st.rate.v)}
                      {st.over ? "*" : ""}
                    </text>
                    {second !== null && (
                      <text x={x} y={mid + 13} textAnchor="middle" className="tabular" style={{ fontSize: 10.5, fill: st.over ? "var(--text-muted)" : tone, ...halo }}>
                        {second}
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
        Between stages: step conversion ({STEPS.join(", ")}). Green or red against the home market, idx = home 100. No rate under {FUNNEL_MIN_DENOMINATOR} in the denominator: too few to compare. Stage height on a square-root scale.
      </p>
      {overs.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11.5px] text-content-muted">
          {overs.map(({ market, step, st }) => (
            <li key={`${market}-${step}`}>
              {`* ${marketLabel(market)}, ${FUNNEL_STEPS[step].label} ${formatPercent(isNa(st.rate) ? null : st.rate.v)} (${formatNumber(st.num)} of ${formatNumber(st.den)}): ${st.over}. Not indexed against home.`}
            </li>
          ))}
        </ul>
      )}
      <ChartSummary
        id={sumId}
        categories
        labels={data.map((d) => marketLabel(d.market))}
        series={STEPS.map((s, i) => ({ name: s, values: data.map((d) => (isNa(d.steps[i].rate) ? null : d.steps[i].rate.v)) }))}
        format={(v) => formatPercent(v)}
      />
    </div>
  );
}
