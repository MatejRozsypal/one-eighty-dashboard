"use client";

/**
 * Industry benchmark: the "I 3.1x" tag and its hover card (design 1.9).
 *
 *   Industry median        3.1x
 *   pet_food, EU, 2025-07 to 2025-12
 *   Source: <source>  Link
 *   As of 2026-09-15
 *   Revenue ex VAT; blended paid
 *
 * - ok: drawn normally.
 * - stale (as_of more than 12 months old): drawn muted, "Stale" on the card.
 * - no_fx (money benchmark with no rate for its period_end month): hidden as a
 *   value, the tag reads `I n/a` and the card says "No FX {Mon YYYY}".
 *
 * Each widget draws the overlay its own way (KPI line, dashed line, marker,
 * crosshair, table row); this file owns the tag and the card they all share.
 *
 * Owner: RS7 (widgets).
 */

import type { BenchmarkMatch, BenchmarkStat } from "@/lib/reports/types";
import { CardRow, HoverCard } from "./CellStatus";
import { formatMetricValue, monthKey, monthLabel, safeUrl } from "./format";
import type { WidgetMetric } from "./types";

const STAT_LABEL: Record<BenchmarkStat, string> = {
  median: "Industry median",
  mean: "Industry mean",
  p25: "Industry 25th pct",
  p75: "Industry 75th pct",
};

function words(key: string): string {
  return key.replace(/_/g, " ");
}

/** Value of a benchmark in the metric's format, or `n/a` when it is hidden. */
export function benchmarkValueText(match: BenchmarkMatch, metric: WidgetMetric, currency: string): string {
  return formatMetricValue(match.status === "no_fx" ? null : match.value, metric.format, currency);
}

/** The card body. Exported so a table row or an SVG overlay can reuse it. */
export function BenchmarkCardBody({ match, metric, currency }: { match: BenchmarkMatch; metric: WidgetMetric; currency: string }) {
  const url = safeUrl(match.sourceUrl);
  return (
    <div className="space-y-1">
      <CardRow label={STAT_LABEL[match.stat]} value={benchmarkValueText(match, metric, currency)} />
      <div>
        {words(match.vertical)}, {match.region}, {monthKey(match.period.from)} to {monthKey(match.period.to)}
      </div>
      <div>
        Source: {match.source}
        {url && (
          <>
            {" "}
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-content-inverse underline underline-offset-2">
              Link
            </a>
          </>
        )}
      </div>
      <div>
        As of {match.asOf}
        {match.status === "stale" && <span className="ml-2 text-warning-300">Stale</span>}
      </div>
      {match.status === "no_fx" && <div className="text-warning-300">No FX {monthLabel(match.period.to)}</div>}
      {match.note && <div>{match.note}</div>}
    </div>
  );
}

/** Plain-text twin of the card, for the trigger's accessible name. */
export function benchmarkLabel(match: BenchmarkMatch, metric: WidgetMetric, currency: string): string {
  const bits = [
    `${STAT_LABEL[match.stat]} ${benchmarkValueText(match, metric, currency)}`,
    `${words(match.vertical)}, ${match.region}, ${monthKey(match.period.from)} to ${monthKey(match.period.to)}`,
    `Source: ${match.source}`,
    `As of ${match.asOf}`,
  ];
  if (match.status === "stale") bits.push("Stale");
  if (match.status === "no_fx") bits.push(`No FX ${monthLabel(match.period.to)}`);
  if (match.note) bits.push(match.note);
  return bits.join(". ");
}

/** "I 3.1x" with the hover card. Muted when stale or hidden. */
export function BenchmarkTag({ match, metric, currency }: { match: BenchmarkMatch; metric: WidgetMetric; currency: string }) {
  const muted = match.status !== "ok";
  return (
    <HoverCard
      label={benchmarkLabel(match, metric, currency)}
      trigger={
        <span className={`inline-flex items-baseline gap-1 font-mono text-[12px] tabular ${muted ? "text-content-muted" : "text-content-body"}`}>
          <span aria-hidden="true" className="text-[10px] font-medium text-content-muted">
            I
          </span>
          {benchmarkValueText(match, metric, currency)}
        </span>
      }
    >
      <BenchmarkCardBody match={match} metric={metric} currency={currency} />
    </HoverCard>
  );
}

/**
 * Every benchmark of the shown metric as a row of tags, including hidden ones
 * (`I n/a`), so a missing overlay always has its reason one hover away.
 */
export function BenchmarkStrip({
  matches,
  metric,
  currency,
}: {
  matches: readonly BenchmarkMatch[];
  metric: WidgetMetric;
  currency: string;
}) {
  if (matches.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {matches.map((m) => (
        <BenchmarkTag key={m.benchmarkId} match={m} metric={metric} currency={currency} />
      ))}
    </div>
  );
}
