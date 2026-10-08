/**
 * Clients on Home: the Health variant's pinned ring card per client, each
 * opening that client's Goals page, with the ClickUp status and the retainer
 * under the rings. A ClickUp-only client gets a plain card with the same two
 * facts and a link to its task.
 *
 * The ring colours are custom properties (`SUMMARY_VARS`), set on the section.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { Skeleton } from "@/components/ui/Skeleton";
import { CHIP } from "@/components/home/health/ClientList";
import { PinnedCard } from "@/components/home/health/PinnedCard";
import { SUMMARY_VARS, family } from "@/components/home/health/palette";
import { NO_VALUE } from "@/lib/format";
import type { ClientTile } from "@/lib/home/final/clients";

const CLIENTS_TIP =
  "With a Goals plan: outer ring revenue, middle CM3, inner aMER, each actual to date over the plan to date (mart.plan_pacing). Without a plan: one grey ring, revenue month to date over the same days last year (mart.plan_actuals_daily). Status from ClickUp Client Success > Clients. Retainer from ref.contracts, else ClickUp.";

function Footer({ tile }: { tile: ClientTile }) {
  const money = family("money");
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-hairline pt-3">
      {tile.status ? (
        <span
          title={tile.status.tip}
          className="inline-flex items-center rounded-full px-2 py-[2px] text-[11.5px] font-semibold leading-[1.4]"
          style={{ color: CHIP[tile.status.tone].text, background: CHIP[tile.status.tone].bg }}
        >
          {tile.status.label}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[12.5px] text-content-muted">
          Status {NO_VALUE}
          <InfoTip text={tile.statusNote} label="Why the status is n/a" />
        </span>
      )}
      <span className="inline-flex min-w-0 items-center gap-1 text-[12.5px] tabular">
        <span className="text-content-muted">Retainer</span>
        {tile.retainer.text === null ? (
          <span className="text-content-muted">{NO_VALUE}</span>
        ) : (
          <>
            <span className="font-semibold" style={{ color: money.text }}>
              {tile.retainer.text}
            </span>
            <span className="text-content-muted">/ mo</span>
          </>
        )}
        <InfoTip text={tile.retainer.tip} label="About the retainer" />
      </span>
    </div>
  );
}

function CrmOnlyCard({ tile }: { tile: ClientTile }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-4 shadow-sm sm:p-[18px]">
      <div className="flex min-w-0 items-center gap-2">
        {tile.crmUrl ? (
          <a
            href={tile.crmUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[1.3] text-content-strong hover:underline"
          >
            {tile.name}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[1.3] text-content-strong">{tile.name}</span>
        )}
        <InfoTip text="In ClickUp Client Success > Clients, not in the warehouse registry (ref.clients)." label="About this client" />
      </div>
      <span className="text-[13px] text-content-muted">No shop data</span>
      <div className="mt-auto">
        <Footer tile={tile} />
      </div>
    </article>
  );
}

export function ClientCardsView({ tiles }: { tiles: ClientTile[] }) {
  return (
    <section aria-label="Clients" className="flex flex-col gap-3.5" style={SUMMARY_VARS}>
      <div className="flex items-center gap-1.5">
        <SectionTitle>Clients</SectionTitle>
        <InfoTip text={CLIENTS_TIP} label="About the client cards" />
      </div>
      {tiles.length === 0 ? (
        <p className="m-0 rounded-card border border-hairline bg-surface-card px-[18px] py-4 text-[14px] text-content-muted shadow-sm">
          No clients
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tiles.map((t) =>
            t.pinned ? <PinnedCard key={t.key} card={t.pinned} footer={<Footer tile={t} />} /> : <CrmOnlyCard key={t.key} tile={t} />
          )}
        </div>
      )}
    </section>
  );
}

export function ClientCardsSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3.5">
      <Skeleton className="h-[18px] w-[90px] rounded-pill" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[236px] w-full rounded-card" />
        ))}
      </div>
    </section>
  );
}
