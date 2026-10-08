/**
 * Catalogue, every SKU, sortable.
 *
 * The evidence half of the section. Stock health names five decisions; this is
 * where you check them, and where you look when the question is "what about
 * everything else".
 *
 * The counts strip above the table is deliberately by *count*, not by value -
 * Stock health already owns the money view, and repeating it here would leave
 * two hero numbers competing. What this page adds is how many SKUs are in each
 * state, which is the question a catalogue answers and a P&L does not.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { RangeNote } from "@/components/ui/PageNotes";
import { getInventory } from "@/lib/queries/inventory";
import { stockState, type StockState } from "@/lib/inventory/model";
import { formatNumber } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { TrustBar } from "@/components/inventory/TrustBar";
import { CatalogueTable } from "@/components/inventory/CatalogueTable";
import { NoData, NotConnected } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Catalogue" };
export const dynamic = "force-dynamic";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const header = (
    <>
      <Header title="Catalogue" />
      <PageControls client={client} params={params} />
      <RangeNote />
    </>
  );

  if (pageAvailability(client, "/inventory/catalogue") !== "available") {
    return (
      <>
        {header}
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected
            source={missingSource(client, "/inventory/catalogue") ?? "Shopify"}
          />
        </main>
      </>
    );
  }

  const { rows, summary } = await getInventory(client.clientId);

  if (rows.length === 0) {
    return (
      <>
        {header}
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const count = (state: StockState) =>
    rows.filter((r) => stockState(r) === state).length;

  const tiles = [
    { label: "SKUs", value: summary.skuCount, tone: "text-content-strong" },
    { label: "At risk", value: count("at-risk"), tone: "text-negative-text" },
    { label: "Healthy", value: count("healthy"), tone: "text-growth-700" },
    {
      label: "Overstocked",
      value: count("overstocked"),
      tone: "text-content-strong",
    },
    { label: "Dead", value: count("dead"), tone: "text-content-strong" },
    {
      label: "No cost",
      value: summary.skuCount - summary.skusWithCost,
      tone:
        summary.skusWithCost < summary.skuCount
          ? "text-negative-text"
          : "text-content-strong",
    },
  ];

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <TrustBar summary={summary} />

        <section className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-4">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                {t.label}
              </span>
              <span
                className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${t.tone}`}
              >
                {formatNumber(t.value)}
              </span>
            </div>
          ))}
        </section>

        <CatalogueTable rows={rows} currency={client.currency} />
      </main>
    </>
  );
}
