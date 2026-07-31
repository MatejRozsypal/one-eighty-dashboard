/**
 * Funnel — steps across, not down.
 *
 * Modelled on Shopify's "Conversion rate breakdown": each step is a column
 * carrying its own label, share and count, with a solid block whose height is
 * proportional to the value and a sloped connector falling to the next step.
 *
 * ── Why the connector matters ───────────────────────────────────────────────
 * A stack of horizontal bars shows the same numbers and hides the thing you
 * actually open a funnel for: where the drop happens. The slope between two
 * blocks *is* the loss, drawn at the size it really is, so a cliff reads
 * instantly instead of being a subtraction you do in your head.
 *
 * ── The broken scale, and why it is not a cheat ─────────────────────────────
 * On a real ad funnel the top step is impressions and the rest are three or
 * four orders of magnitude smaller. Scaled linearly against impressions, every
 * step after the first collapses to a two-pixel sliver: you can see that the
 * first drop is enormous and nothing else at all — which is backwards, because
 * the drops you can act on are the later ones.
 *
 * So the scale is broken, the way a bar chart with one runaway value normally
 * is. Steps 2..n are scaled against the largest of *themselves*, so their
 * proportions to each other are exact. The first step is drawn full height
 * with a break mark across it, which is the standard notation for "this bar is
 * cut, do not read its height". Its true value is right above it, and the
 * "% of previous" on the connector still states the real drop.
 *
 * The break only appears when it is earned — a gentle funnel keeps one honest
 * linear scale and no mark, so the notation never appears where nothing was
 * compressed.
 */

import { formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";

export interface FunnelStep {
  label: string;
  value: number;
}

const CHART_H = 132;
const MIN_H = 6;

/**
 * Break the scale once the top step is more than this many times the tallest
 * of the others. Below it, a linear scale still leaves the rest legible.
 */
const BREAK_RATIO = 2.5;

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  if (steps.length < 2) return null;

  const top = steps[0].value || 1;
  const restMax = Math.max(...steps.slice(1).map((s) => s.value), 1);
  const broken = top > restMax * BREAK_RATIO;

  // With the scale broken, the first column is off-scale by construction and
  // everything else is measured against the tallest of the rest.
  const base = broken ? restMax : top;

  const heightOf = (value: number, index: number) => {
    if (broken && index === 0) return CHART_H;
    return Math.max(MIN_H, Math.round((value / base) * CHART_H));
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="overflow-x-auto">
        <div className="flex min-w-[560px]">
          {steps.map((step, i) => {
            const next = steps[i + 1];
            const h = heightOf(step.value, i);
            const nextH = next ? heightOf(next.value, i + 1) : h;
            const isLast = i === steps.length - 1;
            const tallest = Math.max(h, nextH);

            // Share of the previous step — the actual drop this slope draws.
            const stepRate = i === 0 ? null : safeDiv(step.value, steps[i - 1].value);

            return (
              <div
                key={step.label}
                className="flex min-w-0 flex-1 flex-col gap-3 border-l border-hairline first:border-l-0"
              >
                <div className="flex min-w-0 flex-col gap-1 px-3">
                  <span className="truncate text-[13px] font-semibold text-content-strong">
                    {step.label}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      {formatPercent(safeDiv(step.value, top), { decimals: 1 })}
                    </span>
                    <span className="font-mono text-[13.5px] font-semibold tabular text-content-strong">
                      {formatNumber(step.value)}
                    </span>
                  </span>
                  <span className="font-mono text-[10.5px] tabular text-gray-300">
                    {stepRate === null
                      ? "top of funnel"
                      : `${formatPercent(stepRate, { decimals: 1 })} of previous`}
                  </span>
                </div>

                {/* Block plus the slope down to the next step, bottom-aligned. */}
                <div
                  className="relative flex items-end"
                  style={{ height: CHART_H }}
                  aria-hidden="true"
                >
                  <span
                    className={`relative block flex-[3] overflow-hidden rounded-t-xs ${
                      isLast ? "bg-accent" : "bg-growth-500"
                    }`}
                    style={{ height: h }}
                  >
                    {broken && i === 0 && <BreakMark />}
                  </span>

                  {!isLast && (
                    <span
                      className="block flex-1 bg-growth-300"
                      style={{
                        height: tallest,
                        // Falls from this step's height to the next one's, so
                        // the wedge that disappears is the drop.
                        clipPath: `polygon(0 ${(((tallest - h) / tallest) * 100).toFixed(2)}%, 100% ${(((tallest - nextH) / tallest) * 100).toFixed(2)}%, 100% 100%, 0 100%)`,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {broken && (
        <span className="text-[11.5px] leading-[1.5] text-content-muted">
          <b className="text-content-strong">Scale is broken</b> at{" "}
          {steps[0].label.toLowerCase()} — it is {Math.round(top / restMax)}× the
          next tallest step, so the bars after it are scaled against each other
          instead. Read the numbers, not the first bar&apos;s height; the
          percentages are unaffected.
        </span>
      )}
    </div>
  );
}

/**
 * Axis-break notation: two pale slashes across the bar, meaning it is cut.
 * Sat near the top rather than mid-bar so it reads as "continues upward"
 * rather than as a divider between two parts of the same bar.
 */
function BreakMark() {
  return (
    <span className="pointer-events-none absolute inset-x-[-10%] top-[13px] block">
      <span className="block h-[3px] w-[120%] -skew-y-[7deg] bg-surface-card" />
      <span className="mt-[4px] block h-[3px] w-[120%] -skew-y-[7deg] bg-surface-card" />
    </span>
  );
}
