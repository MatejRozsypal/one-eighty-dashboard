/**
 * ChartSummary: the text alternative for a chart whose values otherwise live
 * only in its hover tooltip.
 *
 * A `role="img"` chart with a label like "Revenue over time" tells a screen
 * reader what the chart is, not what it says. This renders a visually hidden
 * paragraph that the chart points at with `aria-describedby`: per series the
 * latest value, the low and the high, and which way it moved from the first
 * point to the last. A short series (up to `LIST_MAX` points) also lists every
 * value, which for a week of days or a year of months is the whole chart.
 *
 * `categories` is for a bar per item rather than a line over time: no latest
 * and no direction, just the low, the high and every value.
 *
 * Kept as a sibling of the `role="img"` element, not a child: the children of
 * an image are presentational and would not be read.
 *
 * Callers pass their own formatter, built on lib/format, so the summary reads
 * the same figures the axis and the tooltip show.
 */

import { NO_VALUE } from "@/lib/format";

/** Up to this many points, every value is listed after the summary. */
const LIST_MAX = 12;

export interface SummarySeries {
  name: string;
  /** One per label; null or undefined is a gap and is skipped. */
  values: ReadonlyArray<number | null | undefined>;
}

type Point = { i: number; v: number };

function seriesSentence(
  s: SummarySeries,
  labels: ReadonlyArray<string>,
  format: (v: number) => string,
  categories: boolean,
): string {
  const points: Point[] = [];
  s.values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) points.push({ i, v });
  });
  if (points.length === 0) return `${s.name}: ${NO_VALUE}.`;

  const at = (p: Point) => (labels[p.i] ? ` (${labels[p.i]})` : "");
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) return `${s.name}: ${format(last.v)}${at(last)}.`;

  let low = first;
  let high = first;
  for (const p of points) {
    if (p.v < low.v) low = p;
    if (p.v > high.v) high = p;
  }
  const listAll = labels.length > 0 && (categories || s.values.length <= LIST_MAX);
  const list = listAll
    ? ` Values: ${s.values
        .map((v, i) => `${labels[i] ?? i + 1} ${typeof v === "number" && Number.isFinite(v) ? format(v) : NO_VALUE}`)
        .join(", ")}.`
    : "";
  if (categories) return `${s.name}: low ${format(low.v)}${at(low)}, high ${format(high.v)}${at(high)}.${list}`;

  // Compared as formatted, so a move too small to show reads as unchanged.
  const direction =
    format(last.v) === format(first.v)
      ? `unchanged from ${format(first.v)}`
      : `${last.v > first.v ? "up" : "down"} from ${format(first.v)}${at(first)}`;

  return `${s.name}: latest ${format(last.v)}${at(last)}, ${direction}; low ${format(low.v)}${at(low)}, high ${format(high.v)}${at(high)}.${list}`;
}

export function chartSummaryText(
  series: ReadonlyArray<SummarySeries>,
  labels: ReadonlyArray<string>,
  format: (v: number) => string,
  categories = false,
): string {
  return series.map((s) => seriesSentence(s, labels, format, categories)).join(" ");
}

export function ChartSummary({
  id,
  series,
  labels,
  format,
  categories = false,
}: {
  /** The id the chart's `aria-describedby` names. */
  id: string;
  series: ReadonlyArray<SummarySeries>;
  /** The x labels (days, months, buckets), one per value. */
  labels: ReadonlyArray<string>;
  format: (v: number) => string;
  /** One bar per item, not a trend: no latest, no direction, every value listed. */
  categories?: boolean;
}) {
  return (
    <p id={id} className="sr-only">
      {chartSummaryText(series, labels, format, categories)}
    </p>
  );
}
