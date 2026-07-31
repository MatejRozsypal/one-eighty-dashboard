/**
 * Funnel — steps across, not down.
 *
 * Modelled on Shopify's "Conversion rate breakdown": each step is a column
 * carrying its own label, share and count, with a solid block whose height is
 * proportional to the value and a sloped connector falling to the next step.
 *
 * ── Why the connector matters ───────────────────────────────────────────────
 * The previous version was a stack of horizontal bars, which shows the same
 * numbers and hides the thing you actually look at a funnel for: where the
 * drop happens. The slope between two blocks *is* the loss, drawn at the size
 * it really is, so a cliff between "landing page views" and "add to cart"
 * reads instantly instead of being a subtraction you do in your head.
 *
 * ── Two percentages, and they answer different questions ────────────────────
 * The number under each step is its share of the **top** of the funnel, which
 * is what makes the columns comparable. The step-to-step rate — how much of
 * the *previous* step survived — is the more actionable one, so it sits on the
 * connector where the drop it describes is drawn.
 *
 * Heights are floored at a couple of pixels: a step that converts 0.4% is still
 * a step, and a block of literally zero height reads as missing data.
 */

import { formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";

export interface FunnelStep {
  label: string;
  value: number;
}

const CHART_H = 132;
const MIN_H = 3;

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  if (steps.length < 2) return null;

  const top = steps[0].value || 1;
  const height = (value: number) =>
    Math.max(MIN_H, Math.round((value / top) * CHART_H));

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[560px]">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const h = height(step.value);
          const nextH = next ? height(next.value) : h;
          const isLast = i === steps.length - 1;

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
                  className={`block flex-[3] rounded-t-xs ${
                    isLast ? "bg-accent" : "bg-growth-500"
                  }`}
                  style={{ height: h }}
                />
                {!isLast && (
                  <span
                    className="block flex-1 bg-growth-300"
                    style={{
                      height: Math.max(h, nextH),
                      // Falls from this step's height to the next one's, so the
                      // wedge that disappears is the drop, at true scale.
                      clipPath:
                        h >= nextH
                          ? `polygon(0 ${((Math.max(h, nextH) - h) / Math.max(h, nextH)) * 100}%, 100% ${((Math.max(h, nextH) - nextH) / Math.max(h, nextH)) * 100}%, 100% 100%, 0 100%)`
                          : `polygon(0 ${((Math.max(h, nextH) - h) / Math.max(h, nextH)) * 100}%, 100% 0, 100% 100%, 0 100%)`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
