"use client";

/**
 * The change in a rate between two pooled windows, with the honest verdict.
 *
 * Local to the Repeat rate page because `Delta.tsx` draws a relative or absolute
 * change but cannot know whether the change is real. Here the difference of two
 * rates is always in percentage points (both delta modes; `formatDelta` with
 * `kind: "rate"`), and the chip is neutral grey unless the Newcombe 95% range
 * of the difference excludes zero: only then does it turn green or red. Hover
 * gives the figures behind it: "+2.7 pp, 95% CI -2.8 to +7.3, n 488 vs 202".
 *
 * `EntrantsDiff` is the companion for the customer counts, which do follow the
 * delta toggle: a percent change in "%", the difference in "123".
 */

import { deltaParts, formatNumber, MINUS, NO_VALUE } from "@/lib/format";
import { useDeltaMode } from "@/components/ui/DeltaMode";
import type { Newcombe, Rate } from "@/lib/retention/stats";

/** "+7.3" or "−2.8" from a fraction, one decimal, no unit. */
export function signedPoints(fraction: number): string {
  const v = fraction * 100;
  const text = Math.abs(v).toFixed(1);
  if (!/[1-9]/.test(text)) return text;
  return `${v > 0 ? "+" : MINUS}${text}`;
}

/** The hover text of a rate difference. */
export function diffTitle(text: string, diff: Newcombe, current: Rate, previous: Rate): string {
  return `${text}, 95% CI ${signedPoints(diff.lo)} to ${signedPoints(diff.hi)}, n ${formatNumber(current.n)} vs ${formatNumber(previous.n)}`;
}

export function RateDiff({
  current,
  previous,
  diff,
  after,
}: {
  current: Rate;
  previous: Rate;
  /** The Newcombe result; null renders "n/a" (one side has too few customers). */
  diff: Newcombe | null;
  /** Rendered after the chip, e.g. "vs Jan to Jun 2025". */
  after?: string;
}) {
  const mode = useDeltaMode();
  const parts =
    diff && current.n > 0 && previous.n > 0
      ? deltaParts(current.k / current.n, previous.k / previous.n, { kind: "rate", mode })
      : null;

  if (!diff || !parts) {
    return (
      <span title="Too few customers" className="font-mono text-[12px] text-content-muted">
        {NO_VALUE}
      </span>
    );
  }

  const arrow = parts.flat ? "→" : parts.change > 0 ? "▲" : "▼";
  const color = diff.verdict === "up" ? "text-positive" : diff.verdict === "down" ? "text-negative" : "text-content-muted";

  return (
    <span className="inline-flex items-center gap-2">
      <span
        title={diffTitle(parts.text, diff, current, previous)}
        className={`inline-flex items-center gap-[5px] whitespace-nowrap font-mono text-[12px] font-medium tabular ${color}`}
      >
        <span aria-hidden="true" className="text-[9px]">
          {arrow}
        </span>
        {parts.magnitude}
        {diff.verdict === "none" && <span className="sr-only"> (no clear change)</span>}
      </span>
      {after && <span className="text-[11px] text-content-muted">{after}</span>}
    </span>
  );
}

/** "Entrants +141.6%" or "Entrants +286" depending on the delta toggle. */
export function EntrantsDiff({ current, previous }: { current: number; previous: number }) {
  const mode = useDeltaMode();
  const parts = deltaParts(current, previous, { kind: "count", mode });
  if (!parts) return null;
  return (
    <span
      title={`${formatNumber(current)} vs ${formatNumber(previous)} entrants`}
      className="font-mono text-[11px] tabular text-content-muted"
    >
      Entrants {parts.text}
    </span>
  );
}
