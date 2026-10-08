/**
 * The compact client row at the foot of the page: status, the month's ring
 * (only where a plan sets the goal), and revenue month to date in the
 * client's own currency. Each tile opens Goals, or Snapshot without a plan.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { GoalRing } from "@/components/plan/GoalRing";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { NO_VALUE } from "@/lib/format";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { fmtValue } from "@/lib/plan/format";
import type { ClientHealth } from "@/lib/home/types";

function capitalise(s: string | null): string | null {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

function Tile({ c }: { c: ClientHealth }) {
  const tone = c.focus ? toneOfRow(c.focus) : "neutral";
  const href = c.clientId ? `${c.focus ? "/goals" : "/snapshot"}?client=${encodeURIComponent(c.clientId)}` : c.crmUrl;
  const status = capitalise(c.crmStatus) ?? capitalise(c.registryStatus) ?? NO_VALUE;
  const revenue = c.clientId && c.currency ? fmtValue(c.revenue.actual, "revenue", c.currency, { compact: true }) : NO_VALUE;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14.5px] font-semibold leading-[1.3] text-content-strong">{c.name}</span>
          <span className="truncate text-[12px] leading-[1.35] text-content-muted">{status}</span>
        </div>
        {c.clientId && (
          <GoalRing row={c.focus ?? { actual: null, targetToDate: null, target: null }} periodType="month" tone={tone} size={40} />
        )}
      </div>
      <div className="flex flex-col">
        <span className={`text-[19px] font-bold leading-[1.15] tracking-heading tabular ${revenue === NO_VALUE ? "text-content-muted" : "text-content-strong"}`}>
          {revenue}
        </span>
        <span className="text-[12px] leading-[1.35] text-content-muted">
          {c.clientId ? "Revenue MTD" : "No shop data"}
          {c.focus && (
            <>
              {" · "}
              <span className="font-semibold" style={{ color: toneVars(tone).text }}>
                {planStatusLabel(c.focus)}
              </span>
            </>
          )}
        </span>
      </div>
    </>
  );

  const frame = "flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-4 shadow-sm";
  if (!href) return <div className={frame}>{body}</div>;
  if (!c.clientId)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${frame} transition-shadow hover:shadow-md`}>
        {body}
      </a>
    );
  return (
    <AppLink href={href} className={`${frame} transition-shadow hover:shadow-md`}>
      {body}
    </AppLink>
  );
}

export function ClientStrip({ clients }: { clients: ClientHealth[] }) {
  return (
    <section aria-label="Clients" className="flex flex-col gap-3.5">
      <div className="flex items-center gap-1.5">
        <SectionTitle>Clients</SectionTitle>
        <InfoTip
          text="Status from ClickUp Client Success, else the registry. The ring is this month's Goals pacing (CM3 when targeted, else revenue); no plan, no arc. Revenue month to date from mart.plan_actuals_daily."
          label="About the client tiles"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {clients.map((c) => (
          <Tile key={c.key} c={c} />
        ))}
      </div>
    </section>
  );
}
