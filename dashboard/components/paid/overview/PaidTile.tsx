/**
 * One Overview tile.
 *
 * Two sizes on the same shell: the hero row (figure, change, trend line) and
 * the compact secondary row (figure and change). The shell, change chip and
 * definition tooltip are the shared ones; what this adds over `MetricCard` is
 * the one-line badge a figure can carry ("Meta not connected": the ratio is
 * overstated when a platform's spend is missing from the denominator).
 *
 * A null value renders the muted "n/a", never zero. `change` undefined holds
 * the space so the grid does not reflow when comparison is switched off; null
 * shows no chip. The chip follows the delta toggle (percent or absolute).
 */

import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { Badge } from "@/components/ui/Badge";
import { MetricTooltip } from "@/components/dashboard/MetricTooltip";
import { METRIC_DEFINITIONS } from "@/lib/metrics";
import { NO_VALUE, isNoValue, type DeltaInput } from "@/lib/format";

export function PaidTile({
  label,
  value,
  change,
  goodWhen = "up",
  comparisonLabel,
  series,
  sparkTone = "accent",
  badge,
  sources,
  compact = false,
}: {
  label: string;
  /** Preformatted. Null or "n/a" renders the muted "n/a". */
  value: string | null;
  /** Both values and the kind. Null shows no chip, undefined holds the space. */
  change?: DeltaInput | null;
  goodWhen?: GoodWhen;
  comparisonLabel?: string;
  /** Daily values for the trend line (hero tiles only). */
  series?: Array<number | null>;
  sparkTone?: "accent" | "muted";
  /** One line, e.g. "Meta not connected". */
  badge?: string;
  /** Where the figure comes from, shown on hover of the source tag (hero tiles only). */
  sources?: string;
  compact?: boolean;
}) {
  const definition = METRIC_DEFINITIONS[label];
  const missing = value === null || isNoValue(value);

  return (
    <div
      className={`flex min-w-0 flex-col rounded-card border border-hairline bg-surface-card shadow-sm ${
        compact ? "gap-[9px] p-[16px_18px]" : "gap-4 p-[18px_20px_16px]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="relative inline-flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase leading-[1.35] tracking-[0.08em] text-content-muted">
          {label}
          {definition && <MetricTooltip definition={definition} />}
        </span>
        {!compact && (
          <span
            title={sources}
            className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.08em] text-content-muted"
          >
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-[2px] bg-ink-700" />
            Warehouse
          </span>
        )}
      </div>

      <div className={`flex min-w-0 flex-col ${compact ? "gap-[9px]" : "gap-3.5"}`}>
        <div className="flex min-w-0 flex-col gap-[9px]">
          <span
            className={`whitespace-nowrap font-mono font-semibold leading-none tabular ${
              compact
                ? "text-[22px] tracking-heading"
                : "text-[clamp(20px,1.9vw,28px)] tracking-display"
            } ${missing ? "text-content-muted" : "text-content-strong"}`}
          >
            {missing ? NO_VALUE : value}
          </span>

          {change !== undefined ? (
            <span className="inline-flex min-h-3 items-center gap-1.5 whitespace-nowrap">
              <DeltaChip
                change={change}
                goodWhen={goodWhen}
                after={
                  comparisonLabel ? (
                    <span className="font-mono text-[11.5px] tracking-[0.02em] text-content-muted">
                      {comparisonLabel}
                    </span>
                  ) : null
                }
              />
            </span>
          ) : (
            <span className="block h-3" aria-hidden="true" />
          )}
        </div>

        {badge && (
          <span>
            <Badge variant="outline" size="sm">
              {badge}
            </Badge>
          </span>
        )}

        {!compact && series && series.length > 1 && (
          <Sparkline data={series} tone={sparkTone} width={240} height={28} className="-mb-1" />
        )}
      </div>
    </div>
  );
}
