/**
 * The row of small tiles above the client cards: how many clients, how many
 * are on plan this month, what the retainers add up to, and what was received.
 * Counts and sums of the cards below; nothing here is computed anywhere else.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE, formatMoney } from "@/lib/format";
import type { HomeSummary as Summary } from "@/lib/home/types";

const TILE = "flex min-w-0 flex-col gap-1.5 rounded-card border border-hairline bg-surface-card px-[18px] py-4 shadow-sm";
const LABEL = "inline-flex items-center gap-1 text-[13px] font-semibold text-content-muted";
const FIGURE = "text-[24px] font-bold leading-[1.1] tracking-heading tabular text-content-strong";

function Tile({ label, tip, value }: { label: string; tip?: string; value: string }) {
  return (
    <div className={TILE}>
      <span className={LABEL}>
        {label}
        {tip && <InfoTip text={tip} label={`About ${label}`} />}
      </span>
      <span className={`${FIGURE} ${value === NO_VALUE ? "text-content-muted" : ""}`}>{value}</span>
    </div>
  );
}

export function HomeSummary({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Clients" value={String(summary.clients)} />
      <Tile
        label="On plan"
        tip="Clients whose ring metric is on track or ahead this month, of those with a plan."
        value={summary.withPlan ? `${summary.onPlan} of ${summary.withPlan}` : NO_VALUE}
      />
      <Tile
        label="Retainers / mo"
        tip={summary.retainersNote ?? "Sum of monthly retainers: ref.contracts, else ClickUp Retainer CZK. Agreed, not received."}
        value={formatMoney(summary.retainersCzk, "CZK")}
      />
      <Tile
        label="Received"
        tip="No payments source. Payments are booked in Pohoda, which is not connected."
        value={NO_VALUE}
      />
    </div>
  );
}
