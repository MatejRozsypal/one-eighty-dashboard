/**
 * One KPI tile on the Paid page.
 *
 * Extracted so the two scope rows cannot drift apart: the all-platform row and
 * the Meta-only row are the same object shown twice.
 *
 * A null or "n/a" value renders a muted "n/a". A `state` renders one short line
 * in place of the figure ("Not connected", or a reason of 3 words or fewer).
 *
 * Below sm the tile can shrink (min-w-0) and its header wraps, so nothing runs
 * past the card edge on a phone.
 *
 * Optional, for the Paid tabs: `delta` (a fraction, with `goodWhen` saying which
 * direction is good) renders a change chip under the figure, and `metricKey`
 * adds the (i) tooltip with that metric's definition from `lib/metrics.ts`.
 * Callers that pass neither render exactly as before.
 */

import { NO_VALUE, isNoValue } from "@/lib/format";
import { stateLine, type MetricState } from "@/components/dashboard/MetricCard";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";

export interface Kpi {
  label: string;
  /** Preformatted value. Null (or "n/a") renders a muted "n/a". */
  value: string | null;
  /** Present when the figure covers one platform only. */
  scope?: string;
  /** "no-account" or "no-data" replace the figure with one line. */
  state?: MetricState;
  /** Change against the comparison period, as a fraction. Null shows no chip; omit it to hold no space. */
  delta?: number | null;
  /** Which direction is good. Default "up"; spend, frequency and share are "neutral". */
  goodWhen?: GoodWhen;
  /** Key into `METRIC_DEFINITIONS`. Adds the (i) tooltip. */
  metricKey?: string;
}

export function KpiTile({ label, value, scope, state, delta, goodWhen = "up", metricKey }: Kpi) {
  const line = state ? stateLine(state) : null;
  const missing = value === null || isNoValue(value);
  const definition = metricKey ? METRIC_DEFINITIONS[metricKey] : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="relative inline-flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          {label}
          {definition && <MetricTooltip definition={definition} />}
        </span>
        {scope === "meta" && (
          <span
            aria-label="Meta only"
            title="Meta only"
            className="h-[7px] w-[7px] flex-none rounded-[2px] bg-platform-meta"
          />
        )}
      </span>
      {line !== null ? (
        <span className="text-[14px] leading-[22px] text-content-muted">{line}</span>
      ) : (
        <span
          className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${
            missing ? "text-content-muted" : "text-content-strong"
          }`}
        >
          {missing ? NO_VALUE : value}
        </span>
      )}
      {line === null && delta !== undefined && delta !== null && (
        <span className="flex min-w-0 max-w-full flex-wrap">
          <DeltaChip delta={delta} goodWhen={goodWhen} />
        </span>
      )}
    </div>
  );
}
