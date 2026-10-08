/**
 * Home, "Summary" variant: the whole page body, from finished data.
 *
 * Pinned, Highlights, Clients, top to bottom, as in Health's Summary tab. The
 * page (app/(app)/home/v/health) reads the data and hands it here, so the
 * layout can also be rendered from fixture rows.
 */

import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import type { SummaryData } from "@/lib/home/health/types";
import { ClientList } from "./ClientList";
import { HighlightCard } from "./HighlightCard";
import { PinnedCard } from "./PinnedCard";
import { SummaryHeader } from "./SummaryHeader";
import { SUMMARY_VARS } from "./palette";

function Section({ title, tip, children }: { title: string; tip: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="m-0 inline-flex items-center gap-1.5 text-[22px] font-bold leading-[1.2] tracking-heading text-content-strong">
        {title}
        <InfoTip text={tip} label={`About ${title}`} />
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-card border border-hairline bg-surface-card px-[18px] py-4 text-[14px] text-content-muted shadow-sm">
      {children}
    </p>
  );
}

const PINNED_TIP =
  "With a Goals plan: outer ring revenue, middle CM3, inner aMER, each actual to date over the plan to date (mart.plan_pacing). A closed ring is on plan. Without a plan: one grey ring, revenue month to date over the same days last year.";

const HIGHLIGHTS_TIP =
  "Sentences built by fixed rules from mart.plan_pacing, mart.plan_actuals_daily, mart.plan_targets_daily and mart.mart_velocity_daily. A rule with a missing day stays silent.";

export function SummaryView({ data, name, now }: { data: SummaryData; name: string | null; now: string }) {
  const highlightsTip = data.gaps.length ? `${HIGHLIGHTS_TIP} Not readable now: ${data.gaps.join(", ")}.` : HIGHLIGHTS_TIP;
  return (
    <div style={SUMMARY_VARS} className="flex flex-col gap-8">
      <SummaryHeader name={name} now={now} />

      <Section title="Pinned" tip={PINNED_TIP}>
        {data.pinned.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.pinned.map((card) => (
              <PinnedCard key={card.clientId} card={card} />
            ))}
          </div>
        ) : (
          <Empty>No client with shop data.</Empty>
        )}
      </Section>

      <Section title="Highlights" tip={highlightsTip}>
        {data.highlights.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.highlights.map((h) => (
              <HighlightCard key={h.id} h={h} />
            ))}
          </div>
        ) : (
          <Empty>No highlights today.</Empty>
        )}
      </Section>

      <Section
        title="Clients"
        tip="Status from ClickUp Client Success > Clients and the Goals plan. Retainer from ref.contracts, else ClickUp. Invoices from the ClickUp Invoice Tracker. Profit share from the contract layer (ref.contracts and the profit share mart)."
      >
        {data.clients.length ? <ClientList rows={data.clients} /> : <Empty>No clients.</Empty>}
      </Section>
    </div>
  );
}
