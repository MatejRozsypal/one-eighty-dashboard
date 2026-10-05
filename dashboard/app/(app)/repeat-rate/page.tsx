/**
 * Repeat rate.
 *
 * How many first-time customers come back, and how many move to a full-size
 * product, by first-order month and by what the first order contained. Built
 * on the per-customer entry table, so every rate is a pooled count (k of n)
 * with its 95% range, immature months are n/a instead of a partial number, and
 * customers from the first months of data (who may be returning customers from
 * before it) never reach a headline.
 *
 * Deliberately not filtered by the date range: a rate is a property of a
 * customer's own timeline, and cutting it to a window would mix customers who
 * had a week with customers who had a year. The page has its own controls
 * (entry, event, horizon, comparison).
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { RangeNote, EmptyNote } from "@/components/ui/PageNotes";
import { Header } from "@/components/shell/Header";
import { NotConnected } from "@/components/ui/EmptyState";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { getRetention } from "@/lib/queries/retention";
import { RepeatRateBody } from "@/components/retention/RepeatRateBody";

export const metadata: Metadata = { title: "Repeat rate" };
export const dynamic = "force-dynamic";

export default async function RepeatRatePage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/repeat-rate") !== "available") {
    return (
      <>
        <Header title="Repeat rate" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/repeat-rate") ?? "Shop"} />
        </main>
      </>
    );
  }

  const data = await getRetention(client.clientId);

  return (
    <>
      <Header title="Repeat rate" />
      <PageControls client={client} params={params} />
      <RangeNote />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {data === null ? <EmptyNote>No customers yet.</EmptyNote> : <RepeatRateBody data={data} params={searchParams} />}
      </main>
    </>
  );
}
