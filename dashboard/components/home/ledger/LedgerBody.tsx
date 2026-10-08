/**
 * Home, variant "ledger": the page under the header.
 *
 * The partnership first: three agency figures, then every client as a
 * partnership card (what they made, what they paid us, what they kept), then
 * the setup checklist that turns the remaining n/a into numbers.
 */

import { SectionTitle } from "@/components/plan/SectionTitle";
import type { LedgerData } from "@/lib/home/ledger/types";
import { LedgerHero } from "./LedgerHero";
import { PartnershipCard } from "./PartnershipCard";
import { SetupList } from "./SetupList";

export function LedgerBody({ data, name, now }: { data: LedgerData; name: string | null; now: string }) {
  const open = data.setup.filter((s) => !s.done).length;
  const invoices = data.setup.find((s) => s.id === "invoices");
  const chips = [
    { href: "#partnerships", label: "Partnerships", count: String(data.partnerships.length) },
    ...(invoices && !invoices.done && invoices.href
      ? [{ href: invoices.href, label: invoices.title, count: `${invoices.clients.length} missing` }]
      : []),
    { href: "#setup", label: "Setup", count: open ? `${open} open` : "done" },
  ];

  return (
    <main className="page-frame flex flex-col gap-9 px-5 pb-16 pt-6 lg:px-8">
      <LedgerHero hero={data.hero} name={name} now={now} chips={chips} />

      <section id="partnerships" className="flex scroll-mt-20 flex-col gap-3.5" aria-label="Partnerships">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <SectionTitle>Partnerships</SectionTitle>
          <span className="text-[13px] text-content-muted">
            {data.settledLabel ? `${data.settledLabel} · CZK` : "CZK"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2 2xl:grid-cols-3">
          {data.partnerships.map((p) => (
            <PartnershipCard key={p.key} p={p} />
          ))}
        </div>
      </section>

      <section id="setup" className="flex scroll-mt-20 flex-col gap-3.5" aria-label="Setup">
        <SectionTitle>Setup</SectionTitle>
        <SetupList items={data.setup} />
      </section>
    </main>
  );
}
