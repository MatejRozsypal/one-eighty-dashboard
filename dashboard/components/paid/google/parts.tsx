/**
 * Small pieces shared by the Google tab's sections: the section shell, the
 * coverage chip and the low-volume mark.
 */

import type { ReactNode } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Value } from "@/components/ui/EmptyState";
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

/**
 * How many rows of a long table are rendered server-side before "Show all".
 *
 * Search terms, keywords and products each arrive as up to 200 rows, and the
 * sortable table ships every row twice (once as HTML, once in the flight
 * payload for the client component), which put the RawBark tab above 1 MB.
 * The page renders the top rows by spend and keeps the rest one link away.
 */
export const ROW_CAP = 50;

/** Rows to render: the first `ROW_CAP`, or all of them when `expanded`. */
export function capRows<T>(rows: readonly T[], expanded: boolean): T[] {
  return expanded || rows.length <= ROW_CAP ? [...rows] : rows.slice(0, ROW_CAP);
}

/** The line under a capped table: how many rows are shown and the link that toggles it. Nothing when the table fits. */
export function RowCap({
  total,
  expanded,
  moreHref,
  lessHref,
}: {
  total: number;
  expanded: boolean;
  moreHref: string;
  lessHref: string;
}) {
  if (total <= ROW_CAP) return null;
  const linkClass = "text-content-accent underline underline-offset-2";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-5 py-3 text-[12.5px] text-content-muted">
      <span>
        {expanded
          ? `Showing all ${total} rows, by spend.`
          : `Showing the top ${ROW_CAP} of ${total} rows, by spend.`}
      </span>
      {expanded ? (
        <AppLink href={lessHref} scroll={false} className={linkClass}>
          Show top {ROW_CAP}
        </AppLink>
      ) : (
        <AppLink href={moreHref} scroll={false} className={linkClass}>
          Show all {total}
        </AppLink>
      )}
    </div>
  );
}
