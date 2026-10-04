/**
 * Paid > GA4 tab. Placeholder: the capability gate and the empty states.
 * The real content arrives with the tab's own package; keep the gate when it does.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { NotConnected, NoData } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Paid" };
export const dynamic = "force-dynamic";

export default async function PaidGa4Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/paid/ga4") !== "available") {
    return (
      <>
        <Header title="Paid" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/paid/ga4") ?? "GA4"} />
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Paid" />
      <PageControls client={client} params={params} compare />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <NoData />
      </main>
    </>
  );
}
