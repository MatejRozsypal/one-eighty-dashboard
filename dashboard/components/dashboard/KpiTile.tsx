/**
 * One KPI tile on the Paid page.
 *
 * Extracted so the two scope rows cannot drift apart: the all-platform row and
 * the Meta-only row are the same object shown twice.
 *
 * A null or "n/a" value renders a muted "n/a". A `state` renders one short line
 * in place of the figure ("Not connected", or a reason of 3 words or fewer).
 */

import { NO_VALUE, isNoValue } from "@/lib/format";
import { stateLine, type MetricState } from "@/components/dashboard/MetricCard";

export interface Kpi {
  label: string;
  /** Preformatted value. Null (or "n/a") renders a muted "n/a". */
  value: string | null;
  /** Present when the figure covers one platform only. */
  scope?: string;
  /** "no-account" or "no-data" replace the figure with one line. */
  state?: MetricState;
}

export function KpiTile({ label, value, scope, state }: Kpi) {
  const line = state ? stateLine(state) : null;
  const missing = value === null || isNoValue(value);

  return (
    <div className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
          {label}
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
    </div>
  );
}
