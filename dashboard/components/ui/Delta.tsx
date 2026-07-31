/**
 * Delta chip — period-over-period change.
 *
 * ── Why this isn't just "green when the number went up" ─────────────────────
 * The design system's Stat takes a `deltaDir` and paints up-green / down-red.
 * That's right for revenue and wrong for half the metrics on a P&L page. COGS
 * rising is bad. Ad spend rising is neutral-to-bad. CAC rising is bad. A chart
 * that paints rising CAC green is not a cosmetic slip — it inverts the meaning
 * of the page.
 *
 * So direction (which way the number moved) and sentiment (whether that's good)
 * are separate here. `goodWhen` declares the metric's polarity; the arrow always
 * follows the movement, and only the color follows the sentiment.
 *
 * `goodWhen: "neutral"` is for metrics with no inherent better direction —
 * spend, order counts in isolation — where a colored chip would assert a
 * judgement the number doesn't support. Those render muted.
 */

import { formatPercent } from "@/lib/currency";

export type GoodWhen = "up" | "down" | "neutral";

export function DeltaChip({
  /** Relative change as a fraction. Null renders nothing. */
  delta,
  goodWhen = "up",
  className = "",
}: {
  delta: number | null;
  goodWhen?: GoodWhen;
  className?: string;
}) {
  if (delta === null) return null;

  // Sub-0.05% movement is noise — usually a rounding artifact or a single
  // late-landing order. Showing "▲ 0.0%" implies a precision we don't have.
  const isFlat = Math.abs(delta) < 0.0005;
  const direction = isFlat ? "flat" : delta > 0 ? "up" : "down";

  const sentiment =
    goodWhen === "neutral" || isFlat
      ? "neutral"
      : direction === goodWhen
        ? "good"
        : "bad";

  const color = {
    good: "text-positive",
    bad: "text-negative",
    neutral: "text-content-muted",
  }[sentiment];

  const arrow = { up: "▲", down: "▼", flat: "→" }[direction];

  return (
    <span
      className={[
        "inline-flex items-center gap-[5px] font-mono text-[12px] font-medium tabular",
        color,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className="text-[9px]">
        {arrow}
      </span>
      {formatPercent(Math.abs(delta))}
    </span>
  );
}
