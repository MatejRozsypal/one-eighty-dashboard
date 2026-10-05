/**
 * The headline metric card.
 *
 * Carries every state the data actually produces, because on this warehouse the
 * unusual states are common: a client with no Google account, a source that's
 * connected but never loaded, a last day that's structurally incomplete.
 *
 * The two rules it enforces:
 *
 *  1. **"No data" is not "zero."** A client with no Google Ads account has
 *     unknown Google spend; rendering `$0` would claim we checked and found
 *     none. A null value renders as a muted "n/a", and a state renders one
 *     short line instead of the figure:
 *       - `{ kind: "no-account" }`              -> "Not connected"
 *       - `{ kind: "no-data", reason: "No cost data" }` -> the reason (3 words or fewer)
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
import { NO_VALUE, isNoValue, type DeltaInput } from "@/lib/format";

const PLATFORM_COLORS: Record<string, string> = {
  shopify: "bg-platform-shopify",
  shoptet: "bg-platform-shoptet",
  woocommerce: "bg-platform-woocommerce",
  meta: "bg-platform-meta",
  google: "bg-platform-google",
  klaviyo: "bg-platform-klaviyo",
  ecomail: "bg-platform-ecomail",
  warehouse: "bg-ink-700",
};

/** What a card shows instead of (or beside) its figure. Every non-ok state is one line. */
export type MetricState =
  | { kind: "ok" }
  /** The source is not connected for this client: "Not connected". */
  | { kind: "no-account" }
  /** Connected, but this figure cannot be computed. `reason` is 3 words or fewer, e.g. "No cost data". Default "No data". */
  | { kind: "no-data"; reason?: string }
  /** Figure shown, plus a one-line reason it is incomplete. */
  | { kind: "partial"; reason: string }
  /** The query failed. One line. */
  | { kind: "error"; message: string };

/** The one line a no-account or no-data state renders in place of the figure. */
export function stateLine(state: MetricState): string | null {
  if (state.kind === "no-account") return "Not connected";
  if (state.kind === "no-data") return state.reason ?? "No data";
  return null;
}

export function MetricCard({
  label,
  value,
  delta,
  change,
  goodWhen = "up",
  comparisonLabel,
  source,
  series,
  sparkTone = "accent",
  state = { kind: "ok" },
}: {
  label: string;
  /** Preformatted value. Null (or "n/a") renders a muted "n/a". */
  value: string | null;
  /** Legacy: relative change as a fraction, always a percent. Prefer `change`. */
  delta?: number | null;
  /**
   * Current and comparison values plus the metric kind: the chip follows the
   * delta toggle (percent or absolute). Null holds the row with no chip;
   * omitted (with `delta` omitted) holds blank space.
   */
  change?: DeltaInput | null;
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

  const emptyLine = stateLine(state);
  const isEmpty = emptyLine !== null;
  const missing = value === null || isNoValue(value);

  const shell = [
    "flex min-w-0 flex-col gap-4 rounded-card p-[18px_20px_16px]",
    state.kind === "error"
      ? "border border-negative/35 bg-notice-negative"
      : state.kind === "no-account"
        ? "border border-hairline-strong bg-paper"
        : state.kind === "partial"
          ? "border border-warning/40 bg-surface-card shadow-sm"
          : "border border-hairline bg-surface-card shadow-sm",
  ].join(" ");

  return (
    <div className={shell}>
      {/* Wraps: below sm the source tag drops under a long label rather than
          squeezing it onto three lines. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="relative inline-flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase leading-[1.35] tracking-[0.08em] text-content-muted">
          {label}
          {definition && <MetricTooltip definition={definition} />}
        </span>

        {state.kind === "partial" ? (
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
        <span className="text-[13px] font-semibold text-content-strong">
          {state.message}
        </span>
      ) : isEmpty ? (
        <span className="text-[15px] leading-[1.35] text-content-muted">{emptyLine}</span>
      ) : (
        /*
         * Value, then delta, then sparkline, three stacked rows.
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
                missing ? "text-content-muted" : "text-content-strong"
              }`}
            >
              {missing ? NO_VALUE : value}
            </span>

            {state.kind === "partial" ? (
              <span className="text-[12px] leading-[1.5] text-content-body">
                {state.reason}
              </span>
            ) : delta !== undefined || change !== undefined ? (
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap"
                title={comparisonLabel}
              >
                <DeltaChip
                  delta={delta}
                  change={change}
                  goodWhen={goodWhen}
                  after={
                    /* "vs prev period" is dropped below sm, where a two-column
                       card is narrower than the chip plus the text. The title
                       keeps it. Shown only when the chip is. */
                    comparisonLabel ? (
                      <span className="hidden truncate font-mono text-[11.5px] tracking-[0.02em] text-content-muted sm:inline">
                        {comparisonLabel}
                      </span>
                    ) : undefined
                  }
                />
              </span>
            ) : (
              // Comparison off, hold the vertical space so the card grid
              // doesn't reflow when the user switches comparison to None.
              <span className="block h-3" aria-hidden="true" />
            )}
          </div>

          {series && series.length > 1 && (
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
