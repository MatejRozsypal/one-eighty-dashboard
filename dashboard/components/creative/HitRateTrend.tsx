/**
 * Hit rate by launch month: twelve bars, one per month an ad was first
 * delivered in.
 *
 * ── What the bar says, and what it does not ───────────────────────────────
 * Height is winners over launches in that month, judged lifetime to date. The
 * label above is `W/n`, because "0%" on 3 launches and "0%" on 41 are different
 * statements and a rate alone hides which one it is.
 *
 * A month with any launch still under 60 days old is MATURING: its bar is
 * hatched, with the open count beneath it, because its rate can only go up.
 * Hiding the newest two months would remove the only feedback on current
 * production, so they are shown and marked instead.
 *
 * A month with no launches shows a dash. It is not 0%: nothing was launched,
 * so nothing could win.
 *
 * Hand-written SVG per the repo convention. The dashed rule is the client's
 * own hit rate over its trailing 12 months ("Your 12-mo rate"). There is no
 * fixed benchmark: a number with no source would only teach the reader to
 * ignore the line.
 *
 * Under the chart, the launch context: hit rate for ads launched into a NEW ad
 * set vs added to an existing one, and the pack-level rate (ad sets with at
 * least one winner), the SOP's own unit.
 *
 * View state is in the URL (`hrfmt`), so the segmented control is plain links
 * and the whole component is a server component.
 */

import { AppLink } from "@/components/ui/AppLink";
import { SectionHead } from "@/components/creative/primitives";
import { NO_VALUE } from "@/lib/format";
import {
  FORMAT_FILTERS,
  HIT_RATE_MATURITY_DAYS,
  HIT_RATE_REFERENCE_LABEL,
  formatRate,
  type ConceptSplitRow,
  type FormatFilter,
  type HitRate,
  type LaunchContext,
  type LaunchMonth,
  type PackHitRate,
} from "@/lib/creative/hitRate";

const FORMAT_LABELS: Record<FormatFilter, string> = {
  all: "All",
  video: "Video",
  static: "Static",
};

/** Gridlines at 0 and every `step` up to `max`, in whole percent. */
export function rateTicks(max: number): number[] {
  const top = Math.max(0.05, max);
  const step = top <= 0.2 ? 0.05 : top <= 0.5 ? 0.1 : 0.25;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** The chart's top: above the tallest bar and the reference, in steps the ticks land on. */
export function rateCeiling(months: LaunchMonth[], reference: number | null = null): number {
  const top = Math.max(0.05, reference ?? 0, ...months.map((m) => m.rate ?? 0));
  const step = top <= 0.2 ? 0.05 : top <= 0.5 ? 0.1 : 0.25;
  return Math.ceil((top * 1.15) / step - 1e-9) * step;
}

function Chart({ months, reference }: { months: LaunchMonth[]; reference: number | null }) {
  const W = 900;
  const H = 214;
  const ML = 36;
  const MR = 16;
  const MT = 18;
  const MB = 46;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const maxY = rateCeiling(months, reference);
  const ticks = rateTicks(maxY);
  const slot = pw / months.length;
  const barW = slot * 0.5;
  const X = (i: number) => ML + (i + 0.5) * slot;
  const Y = (v: number) => MT + ph - (v / maxY) * ph;
  const refY = reference === null ? null : Y(reference);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Hit rate for ads launched in each of the last ${months.length} months${
        reference === null ? "" : `, against ${HIT_RATE_REFERENCE_LABEL.toLowerCase()} of ${formatRate(reference)}`
      }`}
    >
      <defs>
        <pattern id="hr-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--positive)" opacity="0.12" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--positive)" strokeWidth="2.2" opacity="0.7" />
        </pattern>
      </defs>

      {months.map((m, i) =>
        m.inRange ? (
          <rect
            key={`bg-${m.month}`}
            x={(ML + i * slot).toFixed(1)}
            y={MT}
            width={slot.toFixed(1)}
            height={ph}
            fill="var(--border)"
            opacity="0.35"
          />
        ) : null
      )}

      {ticks.map((v) => (
        <g key={v}>
          <line x1={ML} x2={W - MR} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text
            x={ML - 6}
            y={Y(v) + 4}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--text-muted)"
          >
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}

      {months.map((m, i) => {
        const h = m.rate === null ? 0 : MT + ph - Y(m.rate);
        return (
          <g key={m.month}>
            {m.rate !== null && h > 0 && (
              <rect
                x={(X(i) - barW / 2).toFixed(1)}
                y={Y(m.rate).toFixed(1)}
                width={barW.toFixed(1)}
                height={h.toFixed(1)}
                rx="3"
                fill={m.maturing ? "url(#hr-hatch)" : "var(--positive)"}
                stroke={m.maturing ? "var(--positive)" : "none"}
                strokeWidth={m.maturing ? 1 : 0}
                opacity={m.maturing ? 1 : 0.85}
              />
            )}
            <text
              x={X(i)}
              y={(m.rate === null || h <= 0 ? MT + ph : Y(m.rate)) - 6}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="11"
              fill={m.launched === 0 ? "var(--text-muted)" : "var(--text-strong)"}
            >
              {m.launched === 0 ? "-" : `${m.winners ?? 0}/${m.launched}`}
            </text>
            <text
              x={X(i)}
              y={H - 24}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              fill="var(--text-muted)"
            >
              {m.label}
            </text>
            {m.maturing && (
              <text
                x={X(i)}
                y={H - 9}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="9.5"
                fill="var(--text-muted)"
              >
                {m.open} open
              </text>
            )}
          </g>
        );
      })}

      {refY !== null && reference !== null && (
        <>
          <line
            x1={ML}
            x2={W - MR}
            y1={refY}
            y2={refY}
            stroke="var(--text-strong)"
            strokeWidth="1.25"
            strokeDasharray="4 3"
          />
          <text
            x={W - MR}
            y={refY - 6}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fontSize="10.5"
            fill="var(--text-strong)"
            letterSpacing=".05em"
          >
            {`${HIT_RATE_REFERENCE_LABEL.toUpperCase()} ${formatRate(reference)}`}
          </text>
        </>
      )}
    </svg>
  );
}

function FormatControl({
  format,
  hrefs,
}: {
  format: FormatFilter;
  hrefs: Record<FormatFilter, string>;
}) {
  return (
    <div
      role="group"
      aria-label="Format"
      className="ml-auto inline-flex overflow-hidden rounded-pill border border-hairline"
    >
      {FORMAT_FILTERS.map((f) => (
        <AppLink
          key={f}
          href={hrefs[f]}
          aria-current={f === format ? "true" : undefined}
          className={`px-3 py-1 font-mono text-[11.5px] uppercase tracking-[0.08em] transition-colors duration-fast ${
            f === format
              ? "bg-gray-100 font-semibold text-content-strong"
              : "text-content-muted hover:text-content-strong"
          }`}
        >
          {FORMAT_LABELS[f]}
        </AppLink>
      ))}
    </div>
  );
}

function ConceptTable({ rows }: { rows: ConceptSplitRow[] }) {
  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <thead>
        <tr className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          <th className="py-2 pr-3 font-medium">Concept</th>
          <th className="px-3 py-2 text-right font-medium">Launched</th>
          <th className="px-3 py-2 text-right font-medium">Winners</th>
          <th className="py-2 pl-3 text-right font-medium">Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-hairline">
            <td className={`py-2 pr-3 ${r.untagged ? "text-content-muted" : "text-content-strong"}`}>
              {r.label}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular">{r.launched}</td>
            <td className="px-3 py-2 text-right font-mono tabular">{r.winners ?? NO_VALUE}</td>
            <td className="py-2 pl-3 text-right font-mono tabular">{formatRate(r.rate) ?? NO_VALUE}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContextRow({ label, r, noun }: { label: string; r: HitRate; noun?: string }) {
  return (
    <tr className="border-t border-hairline">
      <td className="py-2 pr-3 text-content-strong">{label}</td>
      <td className="px-3 py-2 text-right font-mono tabular">{r.launched}</td>
      <td className="px-3 py-2 text-right font-mono tabular">{r.winners ?? NO_VALUE}</td>
      <td className="py-2 pl-3 text-right font-mono tabular" title={noun}>
        {formatRate(r.rate) ?? NO_VALUE}
      </td>
    </tr>
  );
}

/**
 * New ad set vs added to an existing ad set, then the pack-level rate. Not
 * ready (the launch table lacks the ad set columns) is one line, never a split
 * of zeros.
 */
function ContextBlock({ context, packs }: { context: LaunchContext; packs: PackHitRate | null }) {
  if (context.launches === 0) return null;
  if (!context.ready) {
    return (
      <p className="m-0 text-[12.5px] text-content-muted">Launch context is not ready.</p>
    );
  }
  return (
    <div className="glass px-4 py-3">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            <th className="py-2 pr-3 font-medium">Launch context</th>
            <th className="px-3 py-2 text-right font-medium">Launched</th>
            <th className="px-3 py-2 text-right font-medium">Winners</th>
            <th className="py-2 pl-3 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          <ContextRow label="New ad set" r={context.newAdset} />
          <ContextRow label="Added to existing ad set" r={context.existing} />
          {packs && packs.ready && (
            <ContextRow label="Packs (new ad sets) with a winner" r={packs} noun="Ad sets that first delivered in the range" />
          )}
        </tbody>
      </table>
      {context.unknown > 0 && (
        <p className="m-0 mt-1 text-[11.5px] text-content-muted">
          {context.unknown} {context.unknown === 1 ? "launch" : "launches"} with no ad set, in neither row.
        </p>
      )}
    </div>
  );
}

export type HitRateTrendState = "ready" | "not-ready" | "no-thresholds";

export function HitRateTrend({
  state,
  months,
  format,
  hrefs,
  concepts,
  reference = null,
  context = null,
  packs = null,
}: {
  state: HitRateTrendState;
  months: LaunchMonth[];
  format: FormatFilter;
  hrefs: Record<FormatFilter, string>;
  /** Null hides the split (fewer than half of the launches in range carry a concept). */
  concepts: ConceptSplitRow[] | null;
  /** The client's own trailing 12-month hit rate, drawn as the dashed line. Null draws none. */
  reference?: number | null;
  /** Hit rate by launch context for the launches in range. Null hides the block. */
  context?: LaunchContext | null;
  packs?: PackHitRate | null;
}) {
  const empty = months.every((m) => m.launched === 0);
  const maturing = months.some((m) => m.maturing);

  return (
    <section className="flex flex-col gap-3">
      <SectionHead
        title="Hit rate by launch month"
        info={`Winners over ads first delivered in the month, judged lifetime to date. Hatched months have ads under ${HIT_RATE_MATURITY_DAYS} days old, so the rate can still rise. Highlighted months are in the selected range. The dashed line is ${HIT_RATE_REFERENCE_LABEL.toLowerCase()}.`}
      >
        {state === "ready" && <FormatControl format={format} hrefs={hrefs} />}
      </SectionHead>

      {state === "not-ready" ? (
        <p className="m-0 text-[13px] text-content-muted">Launch data is not ready.</p>
      ) : state === "no-thresholds" ? (
        <p className="m-0 text-[13px] text-content-muted">Set a target ROAS in Settings.</p>
      ) : (
        <div className="glass px-4 py-3.5">
          {empty ? (
            <p className="m-0 py-6 text-center text-[13px] text-content-muted">
              No launches in these months.
            </p>
          ) : (
            <Chart months={months} reference={reference} />
          )}
          {maturing && !empty && (
            <p className="m-0 mt-1 text-[11.5px] text-content-muted">
              Hatched: launches under {HIT_RATE_MATURITY_DAYS} days old are still open.
            </p>
          )}
        </div>
      )}

      {state === "ready" && context && <ContextBlock context={context} packs={packs} />}

      {state === "ready" && concepts && concepts.length > 0 && (
        <div className="glass px-4 py-3">
          <ConceptTable rows={concepts} />
        </div>
      )}
    </section>
  );
}
