/**
 * Small pieces shared by the Google tab's sections: the section shell, the
 * point-change chip, the coverage chip and the low-volume mark.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Value } from "@/components/ui/EmptyState";
import type { GoodWhen } from "@/components/ui/Delta";
import { formatPercent } from "@/lib/format";

/** The card every section sits in: a header row (title left, controls right), then the body. */
export function Section({
  title,
  controls,
  children,
}: {
  title: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-hairline px-5 py-4">
        <Eyebrow>{title}</Eyebrow>
        {controls && <div className="flex flex-wrap items-center gap-3">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Change in a rate, in percentage points (0.012 renders "1.2pp").
 * The arrow follows the movement; only the colour follows whether it is good.
 */
export function PpChip({
  delta,
  goodWhen = "up",
}: {
  /** Difference in fraction points. Null renders nothing. */
  delta: number | null;
  goodWhen?: GoodWhen;
}) {
  if (delta === null) return null;
  const flat = Math.abs(delta) < 0.0005;
  const direction = flat ? "flat" : delta > 0 ? "up" : "down";
  const sentiment =
    goodWhen === "neutral" || flat ? "neutral" : direction === goodWhen ? "good" : "bad";
  const color = {
    good: "text-positive",
    bad: "text-negative",
    neutral: "text-content-muted",
  }[sentiment];
  const arrow = { up: "▲", down: "▼", flat: "→" }[direction];

  return (
    <span
      className={`inline-flex items-center gap-[5px] font-mono text-[12px] font-medium tabular ${color}`}
    >
      <span aria-hidden="true" className="text-[9px]">
        {arrow}
      </span>
      {(Math.abs(delta) * 100).toFixed(1)}pp
    </span>
  );
}

/** "Covers 63% of spend": how much of the spend the rows below can account for. */
export function CoverageChip({ share }: { share: number | null }) {
  if (share === null) return null;
  const capped = Math.min(1, share);
  const text = capped > 0 && capped < 0.01 ? "<1%" : formatPercent(capped, { decimals: 0 });
  return (
    <span className="rounded-pill border border-hairline px-2.5 py-1 font-mono text-[10.5px] text-content-muted">
      Covers {text} of spend
    </span>
  );
}

/** A ratio cell: the formatted value, muted with a "Low volume" dot when the row is too small to read. */
export function RatioCell({ text, low }: { text: string; low: boolean }) {
  if (!low) {
    return (
      <span className="font-mono text-[12.5px] tabular text-content-strong">
        <Value>{text}</Value>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5 font-mono text-[12.5px] tabular text-content-muted">
      <span
        role="img"
        aria-label="Low volume"
        title="Low volume"
        className="h-1.5 w-1.5 flex-none rounded-full bg-warning"
      />
      <Value>{text}</Value>
    </span>
  );
}

/** A plain numeric cell. */
export function NumCell({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <span
      className={`font-mono text-[12.5px] tabular ${
        muted ? "text-content-muted" : "text-content-strong"
      }`}
    >
      <Value>{text}</Value>
    </span>
  );
}

/** A spend cell: the one bold number in a row. */
export function SpendCell({ text }: { text: string }) {
  return (
    <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
      <Value>{text}</Value>
    </span>
  );
}

/** A text cell that truncates, with the full text on hover. */
export function TextCell({
  text,
  muted = false,
  mono = false,
}: {
  text: string;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <span
      title={text}
      className={`block truncate ${mono ? "font-mono text-[11px]" : "text-[13px]"} ${
        muted ? "text-content-muted" : "text-content-strong"
      }`}
    >
      {text}
    </span>
  );
}
