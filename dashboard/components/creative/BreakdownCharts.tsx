/**
 * The two charts that carry the Breakdown screen.
 *
 * Hand-drawn SVG rather than Recharts, for the same reason as the retention
 * curve: both of these are unusual shapes with rules a chart library does not
 * have. The first pairs two bars per row on one shared scale; the second plots
 * confidence intervals against three shaded decision zones. Bending a library
 * into either costs more code than drawing it.
 *
 * Server components — they take numbers and emit markup, and nothing here
 * responds to a click.
 */

import type { Confidence } from "@/lib/creative/stats";

export interface BreakdownRow {
  key: string;
  label: string;
  untagged: boolean;
  ads: number;
  spend: number;
  spendShare: number;
  revenue: number;
  purchases: number;
  cpa: number | null;
  roas: number | null;
  roasRaw: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  confidence: Confidence;
  readable: boolean;
  /**
   * What the Creatives grid filters on to show this row's ads. Null for the
   * untagged row, which is a residue rather than a value — there is no filter
   * that means "everything nobody filed".
   */
  focusValue?: string | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");

/**
 * Spend against revenue, two bars per row on ONE shared scale.
 *
 * The gap between the two bar ends is the profit, and putting them on a shared
 * scale is what makes that gap readable at a glance. Spend is neutral grey
 * because it is not a judgement; revenue is coloured by where the row sits
 * against the two lines.
 *
 * Share sits as a muted line under the label, never inside the bar. A
 * percentage printed on a bar competes with the bar's own length for the same
 * meaning and the reader ends up trusting neither.
 */
export function SpendRevenueBars({
  rows,
  killRoas,
  targetRoas,
}: {
  rows: BreakdownRow[];
  /** Null when the client has set no lines: the bars are drawn, uncoloured. */
  killRoas: number | null;
  targetRoas: number | null;
}) {
  const top = rows.slice(0, 8);
  if (top.length === 0) return null;

  const W = 980;
  const RH = 46;
  const LAB = 214;
  const RT = 272;
  const BH = 13;
  const GAP = 4;
  const track = W - LAB - RT;
  const maxV = Math.max(...top.map((r) => Math.max(r.spend, r.revenue)), 1);
  const cV = W - RT + 120;
  const cP = W - RT + 196;
  const cR = W - RT + 262;

  // Colour is a verdict. Without lines to judge against, every revenue bar is
  // drawn in the neutral tone rather than in whichever colour a zero kill line
  // and an infinite target happen to fall out to.
  const judged = killRoas !== null && targetRoas !== null;
  const revColour = (r: BreakdownRow) =>
    !r.readable
      ? "var(--text-muted)"
      : !judged
        ? "var(--info)"
        : r.roas !== null && r.roas >= targetRoas
          ? "var(--accent)"
          : r.roas !== null && r.roas < killRoas
            ? "var(--negative)"
            : "var(--info)";

  return (
    <svg
      viewBox={`0 0 ${W} ${top.length * RH + 30}`}
      className="h-auto w-full"
      role="img"
      aria-label="Spend against revenue for each row, with purchases and ROAS"
    >
      {[
        [cV, "SPEND / REVENUE"],
        [cP, "PURCHASES"],
        [cR, "ROAS"],
      ].map(([x, label]) => (
        <text
          key={label as string}
          x={x as number}
          y="12"
          textAnchor="end"
          fontFamily="var(--font-mono)"
          fontSize="9.5"
          fill="var(--text-muted)"
          letterSpacing=".1em"
        >
          {label}
        </text>
      ))}

      {top.map((r, i) => {
        const y = i * RH + 26;
        const col = revColour(r);
        const wS = Math.max(2, (r.spend / maxV) * track);
        const wR = Math.max(2, (r.revenue / maxV) * track);
        const dim = r.readable ? 1 : 0.45;
        return (
          <g key={r.key}>
            <text
              x="0"
              y={y + 2}
              fontFamily="var(--font-sans)"
              fontSize="13"
              fill={r.readable ? "var(--text-body)" : "var(--text-muted)"}
            >
              {clip(r.label, 26)}
            </text>
            <text
              x="0"
              y={y + 19}
              fontFamily="var(--font-mono)"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {Math.round(r.spendShare * 100)}% of spend
            </text>

            <rect x={LAB} y={y - 8} width={track} height={BH * 2 + GAP} rx="4"
                  fill="var(--gray-100)" opacity="0.5" />
            <rect x={LAB} y={y - 8} width={wS.toFixed(1)} height={BH} rx="3"
                  fill="var(--text-muted)" opacity={0.8 * dim} />
            <rect x={LAB} y={y - 8 + BH + GAP} width={wR.toFixed(1)} height={BH} rx="3"
                  fill={col} opacity={0.9 * dim} />

            <text x={cV} y={y + 2} textAnchor="end" fontFamily="var(--font-mono)"
                  fontSize="12.5" fill="var(--text-muted)">
              {fmtInt(r.spend)}
            </text>
            <text x={cV} y={y + 19} textAnchor="end" fontFamily="var(--font-mono)"
                  fontSize="12.5" fontWeight="500" fill={col}>
              {fmtInt(r.revenue)}
            </text>
            <text x={cP} y={y + 11} textAnchor="end" fontFamily="var(--font-mono)"
                  fontSize="13" fill={r.readable ? "var(--text-body)" : "var(--text-muted)"}>
              {r.purchases}
            </text>
            <text x={cR} y={y + 11} textAnchor="end" fontFamily="var(--font-mono)"
                  fontSize="13" fontWeight="500"
                  fill={!r.readable ? "var(--text-muted)" : col === "var(--info)" ? "var(--text-strong)" : col}>
              {r.roas === null ? "—" : r.roas.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * What we can and cannot tell apart.
 *
 * The most important chart in the product. Each row is its 95% interval drawn
 * across three shaded zones — losing money, profitable but under target, at or
 * above target — with a plain-language readout on the right.
 *
 * The readout is the payload. "2.15" invites a decision; "2.15, and the true
 * value is somewhere between 1.42 and 2.88, so we cannot separate it from the
 * kill line" prevents one. At this account's volume the second sentence is true
 * far more often than the first, and a chart that only drew the point estimate
 * would hide that completely.
 */
export function IntervalChart({
  rows,
  killRoas,
  targetRoas,
}: {
  rows: BreakdownRow[];
  /**
   * Null when the client has set no lines. The intervals still draw — how far
   * apart two rows are is a measurement — but the three zones, the two vertical
   * lines and the verdict wording on the right all come off, because each of
   * them is a claim about a threshold that does not exist.
   *
   * Passing the display stand-ins here instead would put `targetRoas` at
   * Infinity, and `maxR` is derived from it: the x-scale would collapse and
   * every bar would render at zero width.
   */
  killRoas: number | null;
  targetRoas: number | null;
}) {
  const top = rows.slice(0, 8).filter((r) => r.roas !== null);
  if (top.length === 0) return null;

  const judged = killRoas !== null && targetRoas !== null;
  const W = 900;
  const RH = 38;
  const L = 232;
  const R = 176;
  const maxR = judged
    ? Math.max(4.5, targetRoas * 1.8)
    : Math.max(4.5, ...top.map((r) => (r.ciHigh ?? r.roas ?? 0) * 1.1));
  const h = top.length * RH + 44;
  const plotB = top.length * RH + 8;
  const X = (v: number) => L + Math.min(1, v / maxR) * (W - L - R);

  const clash = (v: number) =>
    judged && (Math.abs(v - killRoas) < 0.45 || Math.abs(v - targetRoas) < 0.45);
  const ticks = Array.from({ length: Math.floor(maxR) }, (_, i) => i + 1).filter(
    (v) => v <= maxR - 0.2 && !clash(v)
  );

  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full" role="img"
         aria-label={judged
           ? "Shrunk ROAS with 95% intervals against the kill line and the target"
           : "Shrunk ROAS with 95% intervals. No kill line or target is set for this client."}>
      {judged && (
        <>
          <rect x={X(0)} y="4" width={X(killRoas) - X(0)} height={plotB - 4}
                fill="var(--negative)" opacity="0.06" />
          <rect x={X(killRoas)} y="4" width={X(targetRoas) - X(killRoas)} height={plotB - 4}
                fill="var(--text-muted)" opacity="0.05" />
          <rect x={X(targetRoas)} y="4" width={X(maxR) - X(targetRoas)} height={plotB - 4}
                fill="var(--accent)" opacity="0.07" />
        </>
      )}

      {/* ── The scale ────────────────────────────────────────────────────
          Without these the axis has two labelled points at most, both of them
          policy rather than measurement, and a reader cannot tell where 2.0
          sits on the bar in front of them. Whole numbers, minus any that would
          collide with the kill or target label — a tick printed on top of
          "kill 1.80" is worse than no tick. */}
      {ticks.map((v) => (
        <text key={`t${v}`} x={X(v)} y={plotB + 17} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--text-muted)">
          {v.toFixed(1)}
        </text>
      ))}

      {(judged
        ? ([
            [killRoas, "var(--negative)", `kill ${killRoas.toFixed(2)}`],
            [targetRoas, "var(--accent)", `target ${targetRoas.toFixed(2)}`],
          ] as const)
        : []
      ).map(([v, col, label]) => (
        <g key={label as string}>
          <line x1={X(v as number)} x2={X(v as number)} y1="4" y2={plotB}
                stroke={col as string} strokeWidth="1.25" />
          <text x={X(v as number)} y={plotB + 17} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="10.5" fill={col as string}
                letterSpacing=".05em">
            {label}
          </text>
        </g>
      ))}

      {top.map((r, i) => {
        const y = i * RH + 22;
        const lo = r.ciLow ?? 0;
        const hi = Math.min(r.ciHigh ?? 0, maxR);
        const point = r.roas ?? 0;

        let say: string;
        let colour: string;
        if (!judged) {
          // The width of the interval is still worth stating: it is the one
          // thing here that does not depend on a threshold.
          say = r.readable
            ? `${lo.toFixed(2)} – ${hi.toFixed(2)}`
            : "too little data";
          colour = "var(--text-muted)";
        } else if (!r.readable) {
          say = "too little data";
          colour = "var(--text-muted)";
        } else if (lo >= targetRoas) {
          say = "above target";
          colour = "var(--growth-700)";
        } else if ((r.ciHigh ?? 0) < killRoas) {
          say = "below the kill line";
          colour = "var(--negative)";
        } else if (lo >= killRoas) {
          say = "profitable, under target";
          colour = "var(--text-body)";
        } else {
          say = "cannot tell yet";
          colour = "var(--text-muted)";
        }

        const dot = !judged
          ? "var(--text-strong)"
          : point >= targetRoas
            ? "var(--accent)"
            : point < killRoas
              ? "var(--negative)"
              : "var(--text-strong)";

        return (
          <g key={r.key} opacity={r.readable ? 1 : 0.5}>
            <text x="0" y={y + 4} fontFamily="var(--font-sans)" fontSize="12.5"
                  fill={r.readable ? "var(--text-body)" : "var(--text-muted)"}>
              {clip(r.label, 32)}
            </text>
            <line x1={X(lo)} x2={X(hi)} y1={y} y2={y} stroke="var(--border-strong)"
                  strokeWidth="8" strokeLinecap="round" />
            <circle cx={X(point)} cy={y} r="5" fill={dot} />
            <text x={X(point)} y={y - 11} textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize="11"
                  fill={r.readable ? "var(--text-strong)" : "var(--text-muted)"}>
              {point.toFixed(2)}
            </text>
            <text x={W} y={y + 4} textAnchor="end" fontFamily="var(--font-sans)"
                  fontSize="12" fill={colour}>
              {say}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Share of spend over time, top five rows by monthly share.
 *
 * Share rather than absolute spend: the account's total moves month to month,
 * and an absolute chart makes every line rise and fall together for reasons
 * that have nothing to do with the thing being measured.
 */
export function ShareOverTime({
  series,
  months,
}: {
  series: Array<{ key: string; label: string; values: number[] }>;
  months: string[];
}) {
  if (series.length === 0 || months.length < 2) return null;

  const W = 900;
  const H = 200;
  const ml = 36;
  const mr = 48;
  const mt = 10;
  const mb = 26;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  // Clamped at 100%: this axis is a share of total spend, so a gridline
  // labelled 112% is a number that cannot exist and reads as a bug in the
  // chart rather than as headroom above the top line.
  const maxY = Math.min(1, Math.max(0.2, ...series.flatMap((s) => s.values)) * 1.12);
  const X = (i: number) => ml + (i / (months.length - 1)) * pw;
  const Y = (v: number) => mt + ph - (v / maxY) * ph;
  const palette = [
    "var(--growth-500)", "var(--info)", "var(--warning)",
    "var(--negative)", "var(--text-muted)",
  ];

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
           aria-label="Share of spend by month">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = maxY * f;
          return (
            <g key={f}>
              <line x1={ml} x2={W - mr} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
              <text x={ml - 7} y={Y(v) + 4} textAnchor="end"
                    fontFamily="var(--font-mono)" fontSize="10" fill="var(--text-muted)">
                {Math.round(v * 100)}%
              </text>
            </g>
          );
        })}
        {months.map((m, i) => (
          <text key={m} x={X(i)} y={H - 8} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--text-muted)">
            {m.slice(5)}
          </text>
        ))}
        {series.map((s, i) => (
          <g key={s.key}>
            <path
              d={s.values
                .map((v, j) => `${j ? "L" : "M"}${X(j).toFixed(1)},${Y(v).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={palette[i % palette.length]}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, j) =>
              v > 0 ? (
                <circle key={j} cx={X(j)} cy={Y(v)} r={j === months.length - 1 ? 3.5 : 2.2}
                        fill={palette[i % palette.length]} />
              ) : null
            )}
          </g>
        ))}
      </svg>
      <div className="mt-2.5 flex flex-wrap gap-4 text-[12px] text-content-muted">
        {series.map((s, i) => (
          <span key={s.key}>
            <i
              aria-hidden="true"
              className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-[-1px]"
              style={{ background: palette[i % palette.length] }}
            />
            {clip(s.label, 34)}
          </span>
        ))}
      </div>
    </>
  );
}
