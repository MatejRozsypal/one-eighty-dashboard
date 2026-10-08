"use client";

/**
 * Delta chip: period-over-period change.
 *
 * ── Why this isn't just "green when the number went up" ─────────────────────
 * The design system's Stat takes a `deltaDir` and paints up-green / down-red.
 * That's right for revenue and wrong for half the metrics on a P&L page. COGS
 * rising is bad. Ad spend rising is neutral-to-bad. CAC rising is bad. A chart
 * that paints rising CAC green is not a cosmetic slip, it inverts the meaning
 * of the page.
 *
 * So direction (which way the number moved) and sentiment (whether that's good)
 * are separate here. `goodWhen` declares the metric's polarity; the arrow always
 * follows the movement, and only the color follows the sentiment.
 *
 * `goodWhen: "neutral"` is for metrics with no inherent better direction,
 * spend, order counts in isolation, where a colored chip would assert a
 * judgement the number doesn't support. Those render muted.
 *
 * ── Percent or absolute ─────────────────────────────────────────────────────
 * Pass `change` ({ current, previous, kind, currency }) and the chip follows the
 * global delta toggle (`useDeltaMode`): "+12.4%" or "+CZK 12,345", rates in pp
 * in both modes. The older `delta` (a relative fraction) still renders, always
 * as a percent, until its call site passes `change`.
 */

// From lib/format, not lib/currency. The re-export in lib/currency is
// identical, but that module also holds the FX SQL and therefore imports
// `lib/bigquery`, which is `server-only`, so a client component importing it
// fails the build with an error naming `server-only` rather than this line.
import type { ReactNode } from "react";
import { deltaParts, formatPercent, type DeltaInput, type DeltaParts } from "@/lib/format";
import { useDeltaMode } from "@/components/ui/DeltaMode";

export type GoodWhen = "up" | "down" | "neutral";

/** A relative fraction drawn as a percent: the legacy `delta` path. */
function relativeParts(delta: number | null | undefined): DeltaParts | null {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const magnitude = formatPercent(Math.abs(delta));
  const flat = !/[1-9]/.test(magnitude);
  return { change: delta, flat, magnitude, text: magnitude };
}

export function DeltaChip({
  delta,
  change,
  goodWhen = "up",
  className = "",
  after,
  fallback = null,
}: {
  /** Legacy: relative change as a fraction, always shown as a percent. Ignored when `change` is set. */
  delta?: number | null;
  /** Both values and the metric kind: the chip follows the delta toggle. */
  change?: DeltaInput | null;
  goodWhen?: GoodWhen;
  className?: string;
  /** Rendered after the chip, only when the chip renders (e.g. "vs prev period"). */
  after?: ReactNode;
  /** Rendered instead when there is nothing to show (e.g. a muted n/a in a table cell). */
  fallback?: ReactNode;
}) {
  const mode = useDeltaMode();
  const parts = change
    ? deltaParts(change.current, change.previous, { ...change, mode })
    : relativeParts(delta);
  if (parts === null) return <>{fallback}</>;

  // A change that rounds to zero at the precision shown is flat: "▲ 0.0%"
  // implies a precision we don't have.
  const direction = parts.flat ? "flat" : parts.change > 0 ? "up" : "down";

  const sentiment =
    goodWhen === "neutral" || parts.flat
      ? "neutral"
      : direction === goodWhen
        ? "good"
        : "bad";

  const color = {
    good: "text-positive-text",
    bad: "text-negative-text",
    neutral: "text-content-muted",
  }[sentiment];

  const arrow = { up: "▲", down: "▼", flat: "→" }[direction];

  return (
    <>
      <span
        className={[
          "inline-flex items-center gap-[5px] whitespace-nowrap font-mono text-[12px] font-medium tabular",
          color,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span aria-hidden="true" className="text-[9px]">
          {arrow}
        </span>
        {parts.magnitude}
      </span>
      {after}
    </>
  );
}
