/**
 * The headline metric card.
 *
 * Carries every state the data actually produces, because on this warehouse the
 * unusual states are common: a client with no Google account, a source that's
 * connected but never backfilled, a last day that's structurally incomplete.
 *
 * The two rules it enforces:
 *
 *  1. **"No data" is not "zero."** Dobias has no Google Ads account, so Google
 *     spend is unknown — rendering `$0` would claim we checked and found none.
 *     A null value renders as an em dash with a reason.
 *
 *  2. **Direction is not sentiment.** The arrow follows the movement; the color
 *     follows whether that movement is good. Revenue up is green, CAC up is red,
 *     ad spend up is neither. See `DeltaChip`.
 */

import type { ReactNode } from "react";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { Badge } from "@/components/ui/Badge";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";

const PLATFORM_COLORS: Record<string, string> = {
  shopify: "bg-platform-shopify",
  shoptet: "bg-platform-shoptet",
  meta: "bg-platform-meta",
  google: "bg-platform-google",
  klaviyo: "bg-platform-klaviyo",
  ecomail: "bg-platform-ecomail",
  warehouse: "bg-ink-700",
};

export type MetricState =
  | { kind: "ok" }
  | { kind: "no-account"; badge: string; reason: string }
  | { kind: "no-data"; reason: string }
  | { kind: "partial"; reason: string }
  | { kind: "error"; message: string; jobId?: string };

export function MetricCard({
  label,
  value,
  delta,
  goodWhen = "up",
  comparisonLabel,
  source,
  series,
  sparkTone = "accent",
  state = { kind: "ok" },
}: {
  label: string;
  /** Preformatted value. Null renders the em dash. */
  value: string | null;
  delta?: number | null;
  goodWhen?: GoodWhen;
  comparisonLabel?: string;
  /** Platform key, or "Warehouse" for computed metrics. */
  source: string;
  series?: Array<number | null>;
  sparkTone?: "accent" | "muted" | "negative";
  state?: MetricState;
}) {
  const definition = METRIC_DEFINITIONS[label];
  const dotClass = PLATFORM_COLORS[source.toLowerCase()] ?? "bg-gray-400";

  const isEmpty = state.kind === "no-account" || state.kind === "no-data";

  const shell = [
    "flex min-w-0 flex-col gap-4 rounded-card p-[18px_20px_16px]",
    state.kind === "error"
      ? "border border-negative/35 bg-[#FFF7F7]"
      : state.kind === "no-account"
        ? "border border-dashed border-hairline-strong bg-paper"
        : state.kind === "partial"
          ? "border border-warning/40 bg-surface-card shadow-sm"
          : "border border-hairline bg-surface-card shadow-sm",
  ].join(" ");

  return (
    <div className={shell}>
      <div className="flex items-center justify-between gap-2">
        <span className="relative inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-content-muted">
          {label}
          {definition && <MetricTooltip definition={definition} />}
        </span>

        {state.kind === "no-account" ? (
          <Badge variant="outline" size="sm">
            {state.badge}
          </Badge>
        ) : state.kind === "partial" ? (
          <Badge variant="neutral" size="sm" dot>
            Partial
          </Badge>
        ) : state.kind === "error" ? (
          <Badge variant="negative" size="sm">
            Failed
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.08em] text-content-muted">
            <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-[2px] ${dotClass}`} />
            {source}
          </span>
        )}
      </div>

      {state.kind === "error" ? (
        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-semibold text-content-strong">
            {state.message}
          </span>
          {state.jobId && (
            <span className="font-mono text-[10.5px] text-content-muted">
              {state.jobId}
            </span>
          )}
        </div>
      ) : (
        /*
         * Value, then delta, then sparkline — three stacked rows.
         *
         * The sparkline used to sit beside the value, taking a fixed 92px out
         * of the card's width while the value was `whitespace-nowrap` in a
         * `min-w-0` column. Long figures didn't shrink and didn't wrap, they
         * simply overflowed their column and ran underneath the chart. A CZK
         * rollup total makes that certain rather than merely likely: the same
         * revenue is ~21× the number of digits it is in USD.
         *
         * Giving each the full card width removes the collision by
         * construction, rather than by tuning a width that only holds for the
         * numbers we happen to have today.
         */
        <div className="flex flex-col gap-3.5">
          <div className="flex min-w-0 flex-col gap-[9px]">
            <span
              className={`whitespace-nowrap font-mono text-[clamp(20px,1.9vw,28px)] font-semibold leading-none tracking-display tabular ${
                isEmpty || value === null ? "text-gray-250" : "text-content-strong"
              }`}
            >
              {value ?? "—"}
            </span>

            {isEmpty ? (
              <span className="text-[12px] leading-[1.5] text-content-muted">
                {state.reason}
              </span>
            ) : state.kind === "partial" ? (
              <span className="text-[12px] leading-[1.5] text-content-body">
                {state.reason}
              </span>
            ) : delta !== undefined ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <DeltaChip delta={delta} goodWhen={goodWhen} />
                {delta !== null && comparisonLabel && (
                  <span className="font-mono text-[11.5px] tracking-[0.02em] text-content-muted">
                    {comparisonLabel}
                  </span>
                )}
              </span>
            ) : (
              // Comparison off — hold the vertical space so the card grid
              // doesn't reflow when the user switches comparison to None.
              <span className="block h-3" aria-hidden="true" />
            )}
          </div>

          {series && series.length > 1 && !isEmpty && (
            <Sparkline
              data={series}
              tone={sparkTone}
              width={240}
              height={28}
              className="-mb-1"
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Skeleton shown while BigQuery runs — 2–5s on wide ranges. */
export function MetricCardSkeleton({ label }: { label?: ReactNode }) {
  const shimmer =
    "bg-[linear-gradient(90deg,var(--gray-100)_25%,var(--gray-150)_37%,var(--gray-100)_63%)] bg-[length:320px_100%] animate-[oe-shimmer_1.3s_linear_infinite]";

  return (
    <div className="flex min-h-[132px] flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[18px_20px] shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-content-muted">
          {label ?? " "}
        </span>
        <span className={`h-[9px] w-[52px] rounded-pill ${shimmer}`} />
      </div>
      <div className="flex flex-col gap-3">
        <span className={`h-[30px] w-[70%] rounded-xs ${shimmer}`} />
        <span className={`h-3 w-[40%] rounded-pill ${shimmer}`} />
      </div>
    </div>
  );
}
