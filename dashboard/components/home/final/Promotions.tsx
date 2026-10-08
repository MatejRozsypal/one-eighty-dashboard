/**
 * Promotions: every promo running today for any client, and those starting
 * within 7 days, from the ClickUp promo calendars through the plan layer
 * (lib/home/alerts/promos.ts). Ending soonest first. Hidden when there is
 * nothing to show; n/a with the source when the read failed.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { formatMoney, formatNumber } from "@/lib/format";
import { toneVars } from "@/lib/plan/health";
import { endsLabel, shortDay, startsLabel, type PromoItem } from "@/lib/home/alerts/promos";

const SECTION_TIP =
  "Running today and starting within 7 days, from the ClickUp promo calendars. Orders and revenue are the plan layer's attribution (mart.plan_promo_perf) up to each client's last day of data, against the task's targets.";

function perfTip(p: PromoItem): string {
  const f = p.perf!;
  const how = f.isStorewide
    ? "Every order in the window counts: the task has no code, SKU or UTM campaign."
    : "Orders matching the task's codes, SKUs or UTM campaign.";
  const window =
    f.windowStart !== p.start || f.windowEnd !== p.end
      ? ` Attribution window ${shortDay(f.windowStart)} to ${shortDay(f.windowEnd)} (ClickUp dates differ).`
      : "";
  return `${how}${window} Through ${f.asOf ? shortDay(f.asOf) : "n/a"}.`;
}

function Stat({ label, value, goal }: { label: string; value: string; goal: string | null }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[12px] text-content-muted">{label}</span>
      <span className="truncate text-[16px] font-bold leading-[1.25] tracking-heading tabular text-content-strong">{value}</span>
      <span className="truncate text-[12px] text-content-muted tabular">{goal ? `of ${goal}` : " "}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
      <span className="flex-none text-content-muted">{label}</span>
      <span className={`truncate font-medium ${value ? "text-content-strong" : "text-content-muted"}`}>{value ?? "n/a"}</span>
    </div>
  );
}

function PromoCard({ p }: { p: PromoItem }) {
  const running = p.state === "running";
  const tone = toneVars(running ? (p.endsIn <= 2 ? "warning" : "positive") : "neutral");
  const f = p.perf;
  const perf = running && p.hasPerf && f;
  const elapsed = running ? Math.min(1, p.day / p.totalDays) : 0;

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm sm:p-5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted">{p.clientName}</span>
        <span
          className="flex-none rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
          style={{ color: tone.text, background: tone.tint }}
        >
          {running ? endsLabel(p.endsIn) : startsLabel(p.startsIn)}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="m-0 line-clamp-2 text-[17px] font-semibold leading-[1.25] text-content-strong">{p.name}</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          <Field label="Mechanic" value={p.mechanic} />
          <Field label="Code" value={p.couponCodes} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-[12.5px] text-content-muted tabular">
          <span>
            {shortDay(p.start)} to {shortDay(p.end)}
          </span>
          <span>{running ? `Day ${p.day} of ${p.totalDays}` : `${p.totalDays} ${p.totalDays === 1 ? "day" : "days"}`}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-bg-subtle" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${elapsed * 100}%`, background: tone.graphic }} />
        </div>
      </div>

      {running ? (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          <div className="flex items-center gap-1 text-[12px] font-semibold text-content-muted">
            <span>So far</span>
            {f && <InfoTip text={perfTip(p)} label="How orders are attributed" />}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Orders"
              value={perf ? formatNumber(perf.orders) : "n/a"}
              goal={p.targetOrders !== null ? formatNumber(p.targetOrders) : null}
            />
            <Stat
              label="Revenue"
              value={perf ? formatMoney(perf.revenue, p.currency) : "n/a"}
              goal={p.targetRevenue !== null ? formatMoney(p.targetRevenue, p.currency) : null}
            />
            {p.targetUnits !== null ? (
              <Stat label="Units" value={perf ? formatNumber(perf.units) : "n/a"} goal={formatNumber(p.targetUnits)} />
            ) : (
              <span />
            )}
          </div>
        </div>
      ) : (
        (p.targetRevenue !== null || p.targetOrders !== null || p.targetUnits !== null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-t border-hairline pt-3 text-[13px] tabular">
            <span className="text-content-muted">Goal</span>
            {p.targetRevenue !== null && <span className="font-medium text-content-strong">{formatMoney(p.targetRevenue, p.currency)}</span>}
            {p.targetOrders !== null && <span className="font-medium text-content-strong">{formatNumber(p.targetOrders)} orders</span>}
            {p.targetUnits !== null && <span className="font-medium text-content-strong">{formatNumber(p.targetUnits)} units</span>}
          </div>
        )
      )}

      <div className="mt-auto flex items-center justify-end gap-2 pt-1">
        <a
          href={p.clickupUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-none items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-content-muted hover:bg-bg-subtle hover:text-content-strong"
        >
          ClickUp
        </a>
        <AppLink
          href={p.goalsUrl}
          className="inline-flex flex-none items-center gap-1 rounded-full bg-bg-subtle px-3 py-1.5 text-[13px] font-semibold text-content-strong hover:bg-gray-150"
        >
          Open in Goals
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </AppLink>
      </div>
    </article>
  );
}

export function Promotions({ items, note }: { items: PromoItem[] | null; note: string | null }) {
  if (items !== null && items.length === 0) return null;
  return (
    <section aria-label="Promotions" className="flex flex-col gap-3.5">
      <div className="flex items-center gap-1.5">
        <SectionTitle>Promotions</SectionTitle>
        <InfoTip text={SECTION_TIP} label="About promotions" />
      </div>
      {items === null ? (
        <div className="flex items-center justify-center gap-1.5 rounded-card border border-hairline bg-surface-card px-5 py-6 text-[14px] text-content-muted shadow-sm">
          n/a
          <InfoTip text={note ?? "The promo calendars could not be read."} label="Why n/a" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <PromoCard key={`${p.clientId}:${p.taskId}`} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}
