/**
 * The strip across the top: five cross-client totals for the last 30 days,
 * each with its change against the 30 days before and a small line of the
 * days. One card, cells split by hairlines, in the manner of the Shopify
 * admin home. Money is CZK; the (i) says which clients are in a figure.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { DeltaChip } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { NO_VALUE, formatMoney, formatNumber, formatRatio } from "@/lib/format";
import type { Kpi } from "@/lib/home/shopify/types";

function display(k: Kpi): string {
  if (k.value === null) return NO_VALUE;
  if (k.kind === "money") return formatMoney(k.value, "CZK", { compact: true });
  if (k.kind === "ratio") return formatRatio(k.value);
  return formatNumber(k.value);
}

/** One cell of the strip; exported for Home, which lays out its own strip. */
export function KpiCell({ k }: { k: Kpi }) {
  const missing = k.value === null;
  const tip = [k.tip, k.note].filter(Boolean).join(" ");
  const partial = !missing && k.clients.included < k.clients.total;
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5 sm:px-5">
      <span className="inline-flex min-w-0 items-center gap-1 text-[12.5px] font-semibold text-content-muted">
        <span className="truncate">{k.label}</span>
        <InfoTip text={tip} label={`About ${k.label}`} />
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`text-[22px] font-bold leading-[1.15] tracking-heading tabular ${
            missing ? "text-content-muted" : "text-content-strong"
          }`}
        >
          {display(k)}
        </span>
        <DeltaChip
          change={
            k.kind === "money"
              ? { current: k.value, previous: k.previous, kind: "money", currency: "CZK", compact: true }
              : { current: k.value, previous: k.previous, kind: k.kind === "ratio" ? "ratio" : "count" }
          }
          goodWhen={k.goodWhen}
        />
      </div>
      <Sparkline data={k.series} tone={missing ? "muted" : "accent"} width={160} height={26} className="mt-1" />
      {(partial || k.caption) && (
        <span className="text-[11.5px] leading-[1.3] text-content-muted">
          {[k.caption, partial ? `${k.clients.included} of ${k.clients.total} clients` : null].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}

/** The hairlines between cells are 1px gaps letting the frame's colour through. */
export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  return (
    <section
      aria-label="Last 30 days, all clients"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline shadow-sm lg:grid-cols-5"
    >
      {kpis.map((k, i) => (
        <div
          key={k.key}
          className={`min-w-0 bg-surface-card ${i === kpis.length - 1 && kpis.length % 2 === 1 ? "col-span-2 lg:col-span-1" : ""}`}
        >
          <KpiCell k={k} />
        </div>
      ))}
    </section>
  );
}
