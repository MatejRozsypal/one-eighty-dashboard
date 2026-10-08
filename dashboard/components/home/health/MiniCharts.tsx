/**
 * The small charts under a highlight sentence, Health style: no axes, no
 * gridlines, one colour for the figure the sentence is about and grey for what
 * it is compared with. Server-rendered SVG and plain boxes, no chart library.
 *
 * Every chart draws exactly the values the sentence was built from (see
 * lib/home/health/highlights.ts); none of them computes anything.
 */

import type { HighlightChart } from "@/lib/home/health/types";
import { family, type Family } from "./palette";

const GREY = "var(--sm-neutral-tint)";

/* ------------------------------------------------------------------------ */
/* Compare: horizontal bars on one scale                                    */
/* ------------------------------------------------------------------------ */

function Compare({ chart, of }: { chart: Extract<HighlightChart, { kind: "compare" }>; of: Family }) {
  const colour = family(of);
  const max = Math.max(...chart.rows.map((r) => Math.max(0, r.value)), 0);
  const width = (v: number) => (max > 0 ? `${Math.max(0, v / max) * 100}%` : "0%");

  if (chart.rows.length <= 2) {
    return (
      <div className="flex flex-col gap-2.5">
        {chart.rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1">
            <span className="flex items-baseline gap-1.5">
              <span
                className="text-[17px] font-bold leading-none tracking-heading tabular"
                style={{ color: r.emphasis ? colour.text : "var(--text-strong)" }}
              >
                {r.text}
              </span>
              <span className="text-[12px] text-content-muted">{r.label}</span>
            </span>
            <span className="block h-[18px] w-full overflow-hidden rounded-[5px]">
              <span
                className="block h-full rounded-[5px]"
                style={{ width: width(r.value), minWidth: r.value > 0 ? 4 : 0, background: r.emphasis ? colour.graphic : GREY }}
              />
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 text-[12.5px]">
      {chart.rows.map((r) => (
        <div key={r.label} className="contents">
          <span className={`truncate ${r.emphasis ? "font-semibold text-content-strong" : "text-content-muted"}`}>{r.label}</span>
          <span className="block h-[10px] w-full">
            <span
              className="block h-full rounded-full"
              style={{ width: width(r.value), minWidth: r.value > 0 ? 4 : 0, background: r.emphasis ? colour.graphic : GREY }}
            />
          </span>
          <span
            className="text-right font-semibold tabular"
            style={{ color: r.emphasis ? colour.text : "var(--text-muted)" }}
          >
            {r.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Columns: daily bars with an average line over each half                  */
/* ------------------------------------------------------------------------ */

function Columns({ chart, of }: { chart: Extract<HighlightChart, { kind: "columns" }>; of: Family }) {
  const colour = family(of);
  const values = chart.bars.map((b) => b.value ?? 0);
  const max = Math.max(...values, ...chart.averages.map((a) => a.value), 0);
  const pct = (v: number) => (max > 0 ? (Math.max(0, v) / max) * 100 : 0);
  const n = chart.bars.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-[12px] leading-[1.2]">
        {chart.averages.map((a) => (
          <span key={a.from} className={`flex flex-col ${a.emphasis ? "items-end text-right" : ""}`}>
            <span className="text-content-muted">{a.emphasis ? "Last 7 days" : "7 days before"}</span>
            <span className="text-[15px] font-bold tabular" style={{ color: a.emphasis ? colour.text : "var(--text-strong)" }}>
              {a.text}
              <span className="text-[11px] font-semibold text-content-muted"> / day</span>
            </span>
          </span>
        ))}
      </div>
      <div className="relative h-[72px]">
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {chart.bars.map((b, i) => (
            <span
              key={i}
              title={b.label}
              className="block flex-1 rounded-t-[3px]"
              style={{ height: `${pct(b.value ?? 0)}%`, minHeight: b.value ? 2 : 0, background: b.emphasis ? colour.graphic : GREY }}
            />
          ))}
        </div>
        {chart.averages.map((a) => (
          <span
            key={a.from}
            aria-hidden="true"
            className="absolute block border-t-2 border-dashed"
            style={{
              left: `${(a.from / n) * 100}%`,
              width: `${((a.to - a.from + 1) / n) * 100}%`,
              bottom: `${pct(a.value)}%`,
              borderColor: a.emphasis ? colour.text : "var(--sm-neutral)",
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-content-muted">
        <span>{chart.bars[0]?.label}</span>
        <span>{chart.bars[n - 1]?.label}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Line, with an optional reference level                                   */
/* ------------------------------------------------------------------------ */

const W = 300;
const H = 76;

function Line({ chart, of }: { chart: Extract<HighlightChart, { kind: "line" }>; of: Family }) {
  const colour = family(of);
  const values = chart.points.filter((p): p is number => p !== null);
  if (values.length < 2) return null;
  const all = chart.reference ? [...values, chart.reference.value] : values;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const n = chart.points.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - ((v - min) / (max - min)) * H;

  // Gaps break the line: a missing day is not drawn as a value.
  const segments: string[] = [];
  let current = "";
  chart.points.forEach((p, i) => {
    if (p === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)} `;
  });
  if (current) segments.push(current);

  let lastIndex = -1;
  chart.points.forEach((p, i) => {
    if (p !== null) lastIndex = i;
  });
  const last = chart.points[lastIndex] as number;
  const refY = chart.reference ? y(chart.reference.value) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-content-muted">
          {chart.reference && (
            <>
              <span
                aria-hidden="true"
                className="mr-1 inline-block w-3 border-t-2 border-dashed align-middle"
                style={{ borderColor: "var(--sm-neutral)" }}
              />
              {chart.reference.label}
            </>
          )}
        </span>
        <span className="text-[15px] font-bold tabular" style={{ color: colour.text }}>
          {chart.endText}
        </span>
      </div>
      <div className="relative h-[76px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true" focusable="false">
          {refY !== null && (
            <line x1="0" x2={W} y1={refY} y2={refY} stroke="var(--sm-neutral)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          )}
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={colour.graphic} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span
          aria-hidden="true"
          className="absolute block h-[11px] w-[11px] -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-paper"
          style={{ left: `${(x(lastIndex) / W) * 100}%`, bottom: `${((H - y(last)) / H) * 100}%`, background: colour.graphic }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-content-muted">
        <span>{chart.startLabel}</span>
        <span>{chart.endLabel}</span>
      </div>
    </div>
  );
}

export function MiniChart({ chart, of }: { chart: HighlightChart; of: Family }) {
  if (chart.kind === "compare") return <Compare chart={chart} of={of} />;
  if (chart.kind === "columns") return <Columns chart={chart} of={of} />;
  return <Line chart={chart} of={of} />;
}
