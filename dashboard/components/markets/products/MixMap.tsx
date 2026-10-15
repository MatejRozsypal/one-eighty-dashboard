"use client";

/**
 * Mix map: what a market buys differently from home, by units. One dot per
 * product, its share of home's units across and its share of the market's
 * units up; the dashed diagonal is "same mix". Units, not net sales, so a
 * market that pays less per unit does not read as buying less.
 *
 * Both axes are on a square-root scale so the many small products spread out
 * instead of piling up at zero. A line through the origin stays straight on
 * that scale, so the diagonal and the band around it (index 85 to 115) are
 * straight too. Colour is the index (market share / home share): accent when
 * the market buys clearly more, warning when clearly less, grey inside the
 * band. Size is the market's units. A product under `MIX_MIN_UNITS` units in
 * the market is drawn faded, and labelled (muted) only after the solid dots:
 * a few orders move its index.
 *
 * Labels are placed greedily (right, left, above, below) and skipped when
 * none fits; every dot keeps its figures in the tooltip and the summary.
 */

import { useId, useState } from "react";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { formatNumber, formatPercent } from "@/lib/format";
import { countryName } from "@/lib/markets/display";
import { formatIndex, MIX_BAND, MIX_MIN_UNITS, type MixPoint } from "@/lib/markets/products";

const W = 760;
const H = 380;
const PAD = { l: 48, r: 18, t: 14, b: 40 };
const DOMAINS = [2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
const TICKS = [0, 0.5, 1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
/** Labels drawn at most; the rest live in the tooltip. */
const MAX_LABELS = 12;
const LABEL_CHARS = 24;
const CHAR_W = 6.2;

type Tone = "more" | "less" | "same";

export function mixTone(p: Pick<MixPoint, "index">): Tone {
  if (p.index === null || p.index >= 1 + MIX_BAND) return "more";
  if (p.index <= 1 - MIX_BAND) return "less";
  return "same";
}

const TONE_COLOR: Record<Tone, string> = { more: "var(--accent)", less: "var(--warning)", same: "var(--gray-400)" };

function short(name: string): string {
  return name.length > LABEL_CHARS ? `${name.slice(0, LABEL_CHARS - 1).trimEnd()}…` : name;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function MixMap({ points, market, home }: { points: MixPoint[]; market: string; home: string }) {
  const sumId = useId();
  const [hover, setHover] = useState<string | null>(null);

  const maxShare = Math.max(0.0001, ...points.flatMap((p) => [p.share, p.homeShare])) * 100;
  const D = DOMAINS.find((d) => d >= maxShare * 1.05) ?? 100;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const X = (pct: number) => PAD.l + Math.sqrt(Math.max(0, pct) / D) * iw;
  const Y = (pct: number) => H - PAD.b - Math.sqrt(Math.max(0, pct) / D) * ih;

  const ticks: number[] = [];
  for (const t of TICKS.filter((t) => t <= D)) if (!ticks.length || X(t) - X(ticks[ticks.length - 1]) >= 24) ticks.push(t);

  const maxUnits = Math.max(1, ...points.map((p) => p.units));
  const dots = points.map((p) => ({
    p,
    cx: X(p.homeShare * 100),
    cy: Y(p.share * 100),
    r: 3 + 12 * Math.sqrt(p.units / maxUnits),
    tone: mixTone(p),
  }));

  // Labels: the biggest products first, then the ones outside the band.
  const placed: Box[] = [];
  const obstacles: Box[] = dots.map((d) => ({ x: d.cx - d.r, y: d.cy - d.r, w: d.r * 2, h: d.r * 2 }));
  const byPull = (list: typeof dots) => {
    const ranked = [...list].sort((a, b) => Math.max(b.p.share, b.p.homeShare) - Math.max(a.p.share, a.p.homeShare));
    return [...ranked.slice(0, 6), ...ranked.slice(6).sort((a, b) => (a.tone === "same" ? 1 : 0) - (b.tone === "same" ? 1 : 0))];
  };
  // Solid dots first; faded ones (a small market) still get a muted label when room is left.
  const order = [...byPull(dots.filter((d) => !d.p.low)), ...byPull(dots.filter((d) => d.p.low))];
  const labels: { key: string; x: number; y: number; anchor: "start" | "end" | "middle"; text: string; idx: string | null; low: boolean }[] = [];
  for (const d of order) {
    if (labels.length >= MAX_LABELS) break;
    const text = short(d.p.product);
    const idx = d.p.index === null ? null : formatIndex(d.p.index);
    const w = (text.length + (idx ? idx.length + 1 : 0)) * CHAR_W + 4;
    const h = 13;
    const options: { box: Box; x: number; y: number; anchor: "start" | "end" | "middle" }[] = [
      { box: { x: d.cx + d.r + 3, y: d.cy - h / 2, w, h }, x: d.cx + d.r + 4, y: d.cy + 4, anchor: "start" },
      { box: { x: d.cx - d.r - 3 - w, y: d.cy - h / 2, w, h }, x: d.cx - d.r - 4, y: d.cy + 4, anchor: "end" },
      { box: { x: d.cx - w / 2, y: d.cy - d.r - 3 - h, w, h }, x: d.cx, y: d.cy - d.r - 6, anchor: "middle" },
      { box: { x: d.cx - w / 2, y: d.cy + d.r + 3, w, h }, x: d.cx, y: d.cy + d.r + 13, anchor: "middle" },
      { box: { x: d.cx + d.r * 0.7, y: d.cy - d.r * 0.7 - h - 2, w, h }, x: d.cx + d.r * 0.7 + 1, y: d.cy - d.r * 0.7 - 5, anchor: "start" },
      { box: { x: d.cx - d.r * 0.7 - w, y: d.cy - d.r * 0.7 - h - 2, w, h }, x: d.cx - d.r * 0.7 - 1, y: d.cy - d.r * 0.7 - 5, anchor: "end" },
      { box: { x: d.cx + d.r * 0.7, y: d.cy + d.r * 0.7 + 2, w, h }, x: d.cx + d.r * 0.7 + 1, y: d.cy + d.r * 0.7 + 12, anchor: "start" },
      { box: { x: d.cx - d.r * 0.7 - w, y: d.cy + d.r * 0.7 + 2, w, h }, x: d.cx - d.r * 0.7 - 1, y: d.cy + d.r * 0.7 + 12, anchor: "end" },
    ];
    const inside = (b: Box) => b.x >= PAD.l && b.x + b.w <= W - 2 && b.y >= 0 && b.y + b.h <= H - PAD.b;
    const own = (b: Box) => Math.abs(b.x + b.w / 2 - d.cx) < 0.5 && Math.abs(b.y + b.h / 2 - d.cy) < 0.5;
    // First try clear of every label and dot; then clear of labels only (a
    // label may cross another dot's edge rather than go missing).
    const fit =
      options.find((o) => inside(o.box) && !placed.some((b) => overlaps(b, o.box)) && !obstacles.some((b) => !own(b) && overlaps(b, o.box))) ??
      options.find((o) => inside(o.box) && !placed.some((b) => overlaps(b, o.box)));
    if (!fit) continue;
    placed.push(fit.box);
    labels.push({ key: d.p.product, x: fit.x, y: fit.y, anchor: fit.anchor, text, idx, low: d.p.low });
  }

  const hovered = dots.find((d) => d.p.product === hover) ?? null;
  const summaryPoints = points.slice(0, 12);
  const mName = countryName(market);
  const hName = countryName(home);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`Share of units per product, ${market} against ${home}`}
          aria-describedby={sumId}
          onMouseLeave={() => setHover(null)}
        >
          {/* Same-mix band (index 85 to 115) and the diagonal. */}
          <polygon
            points={[
              [0, 0],
              [D / (1 + MIX_BAND), D],
              [D, D],
              [D, D * (1 - MIX_BAND)],
            ]
              .map(([x, y]) => `${X(x)},${Y(y)}`)
              .join(" ")}
            style={{ fill: "var(--gray-100)", opacity: 0.7 }}
          />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={PAD.t} y2={H - PAD.b} style={{ stroke: "var(--gray-150)" }} />
              <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} style={{ stroke: "var(--gray-150)" }} />
              <text x={X(t)} y={H - PAD.b + 15} textAnchor="middle" className="tabular" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
                {t}%
              </text>
              <text x={PAD.l - 6} y={Y(t) + 4} textAnchor="end" className="tabular" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
                {t}%
              </text>
            </g>
          ))}
          <line x1={X(0)} y1={Y(0)} x2={X(D)} y2={Y(D)} style={{ stroke: "var(--gray-400)", strokeDasharray: "4 4" }} />
          <text x={X(0) + 8} y={PAD.t + 12} style={{ fontSize: 11, fill: "var(--text-muted)" }}>
            ↑ Share of {market} units
          </text>
          <text x={X(0) + 8} y={PAD.t + 26} style={{ fontSize: 11, fill: "var(--text-muted)" }}>
            {market} buys more
          </text>
          <text x={W - PAD.r - 4} y={H - PAD.b - 8} textAnchor="end" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
            {market} buys less
          </text>
          <text x={W - PAD.r} y={H - 4} textAnchor="end" style={{ fontSize: 11, fill: "var(--text-muted)" }}>
            Share of {home} units →
          </text>

          {[...dots]
            .sort((a, b) => b.r - a.r)
            .map((d) => (
              <circle
                key={d.p.product}
                cx={d.cx}
                cy={d.cy}
                r={d.r}
                tabIndex={0}
                aria-label={d.p.product}
                onMouseEnter={() => setHover(d.p.product)}
                onFocus={() => setHover(d.p.product)}
                onBlur={() => setHover(null)}
                style={{
                  fill: TONE_COLOR[d.tone],
                  fillOpacity: d.p.low ? 0.1 : 0.32,
                  stroke: TONE_COLOR[d.tone],
                  strokeOpacity: d.p.low ? 0.4 : 1,
                  strokeWidth: hover === d.p.product ? 2.5 : 1.5,
                  outline: "none",
                  cursor: "default",
                }}
              />
            ))}

          {labels.map((l) => (
            <text
              key={l.key}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              aria-hidden="true"
              style={{ fontSize: 11, fill: l.low ? "var(--text-muted)" : "var(--text-strong)", paintOrder: "stroke", stroke: "var(--paper)", strokeWidth: 3, pointerEvents: "none" }}
            >
              {l.text}
              {l.idx && <tspan style={{ fill: "var(--text-muted)" }}> {l.idx}</tspan>}
            </text>
          ))}
        </svg>

        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 min-w-[200px] max-w-[280px] rounded-md border border-hairline bg-paper px-3 py-2 text-[12px] shadow-sm"
            style={{
              left: `${Math.min(70, (hovered.cx / W) * 100)}%`,
              top: `${(hovered.cy / H) * 100}%`,
              transform: "translate(12px, -50%)",
            }}
          >
            <div className="mb-1 font-semibold text-content-strong">{hovered.p.product}</div>
            <div className="flex justify-between gap-3 font-mono tabular text-content-body">
              <span>{market}</span>
              <span>
                {formatPercent(hovered.p.share)} ({formatNumber(hovered.p.units)})
              </span>
            </div>
            <div className="flex justify-between gap-3 font-mono tabular text-content-body">
              <span>{home}</span>
              <span>
                {formatPercent(hovered.p.homeShare)} ({formatNumber(hovered.p.homeUnits)})
              </span>
            </div>
            <div className="mt-1 flex justify-between gap-3 font-mono tabular text-content-strong">
              <span>Index</span>
              <span>{hovered.p.index === null ? `not sold in ${home}` : formatIndex(hovered.p.index)}</span>
            </div>
            {hovered.p.low && (
              <div className="mt-1 text-content-muted">
                Under {MIX_MIN_UNITS} units in {market}: a few orders move this index.
              </div>
            )}
          </div>
        )}
      </div>

      <ChartSummary
        id={sumId}
        categories
        labels={summaryPoints.map((p) => p.product)}
        series={[
          { name: `Share of ${mName} units`, values: summaryPoints.map((p) => p.share) },
          { name: `Share of ${hName} units`, values: summaryPoints.map((p) => p.homeShare) },
        ]}
        format={(v) => formatPercent(v)}
      />
    </div>
  );
}

export function MixLegend({ market, excluded }: { market: string; excluded: string[] }) {
  const sw = (tone: Tone) => (
    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TONE_COLOR[tone], opacity: 0.8 }} />
  );
  const band = Math.round(MIX_BAND * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-content-muted">
        <span className="inline-flex items-center gap-1.5">
          {sw("more")}
          {market} buys more (index {100 + band}+)
        </span>
        <span className="inline-flex items-center gap-1.5">
          {sw("same")}
          Same mix
        </span>
        <span className="inline-flex items-center gap-1.5">
          {sw("less")}
          {market} buys less (index {100 - band} or under)
        </span>
        <span>
          Size = {market} units. Faded = under {MIX_MIN_UNITS} {market} units
        </span>
      </div>
      {excluded.length > 0 && (
        <p className="m-0 text-[11.5px] text-content-muted">
          Left out, not products or given away free: {excluded.slice(0, 4).join(", ")}
          {excluded.length > 4 ? ` and ${excluded.length - 4} more` : ""}.
        </p>
      )}
    </div>
  );
}
