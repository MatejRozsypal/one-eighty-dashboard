/**
 * Repurchase, which first purchase predicts a second, and what comes after it.
 *
 * ── Two questions, deliberately on one page ─────────────────────────────────
 * The table answers "what should we acquire on", which first product produces
 * customers who come back. The Sankey answers "and then what", whether those
 * customers replenish the same thing or move across the range. Either alone
 * invites the wrong conclusion: a high repeat rate on a product nobody moves on
 * from is a different business than one that opens a range.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { RangeNote } from "@/components/ui/PageNotes";
import {
  getFirstProductRepeat,
  getProductJourney,
} from "@/lib/queries/journey";
import { optional } from "@/lib/queries/errors";
import { formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData, Value } from "@/components/ui/EmptyState";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { ProductJourneyChart } from "@/components/dashboard/ProductJourney";
import { DataTable } from "@/components/ui/DataTable";

export const metadata: Metadata = { title: "Repurchase" };
export const dynamic = "force-dynamic";

/** Customers need time to come back; the views only count those who had it. */
const MATURITY_DAYS = 180;

export default async function RepurchasePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/repurchase") !== "available") {
    return (
      <>
        <Header title="Repurchase" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/repurchase") ?? "Shop"} />
        </main>
      </>
    );
  }

  const [journey, breakdown] = await Promise.all([
    optional(() => getProductJourney(client.clientId, 3), null),
    optional(() => getFirstProductRepeat(client.clientId, 15), []),
  ]);

  const hasJourney = journey !== null && journey.links.length > 0;

  return (
    <>
      <Header title="Repurchase" />
      <PageControls client={client} params={params} />
      <RangeNote />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {!hasJourney && breakdown.length === 0 ? (
          <NoData />
        ) : (
          <>
            {hasJourney && journey ? (
              <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
                <Eyebrow>
                  Journey
                  <InfoTip text="Each column is an order number, not a date. Ribbon thickness is the number of customers on that route." />
                </Eyebrow>
                <ProductJourneyChart journey={journey} />
              </section>
            ) : (
              <section className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
                <Eyebrow>Journey</Eyebrow>
                <NoData />
              </section>
            )}

            {breakdown.length > 0 && (
              <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
                <div className="flex items-center border-b border-hairline px-5 py-4 lg:px-[26px]">
                  <Eyebrow>
                    First product
                    <InfoTip
                      text={`Customers whose first order is at least ${MATURITY_DAYS} days old. Repeat counts any later order. Grouped by product code.`}
                    />
                  </Eyebrow>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[720px]">
                    <DataTable
                      gridClass="grid grid-cols-[2.4fr_0.9fr_0.9fr_1fr_1fr] items-center gap-2"
                      columns={[
                        { key: "product", label: "First product" },
                        { key: "customers", label: "Customers", align: "right" },
                        { key: "repeaters", label: "Came back", align: "right" },
                        { key: "rate", label: "Repeat rate", align: "right" },
                        { key: "orders", label: "Avg orders", align: "right" },
                      ]}
                      rows={breakdown.map((r) => ({
                        key: r.product,
                        sort: [
                          r.product,
                          r.customers,
                          r.repeaters,
                          r.repeatRate,
                          r.avgLifetimeOrders,
                        ],
                        cells: [
                          <span key="p" className="truncate text-[13px] text-content-strong">
                            {r.product}
                          </span>,
                          <span key="c" className="text-[13px] tabular-nums">
                            <Value>{formatNumber(r.customers)}</Value>
                          </span>,
                          <span key="r" className="text-[13px] tabular-nums">
                            <Value>{formatNumber(r.repeaters)}</Value>
                          </span>,
                          <span
                            key="rate"
                            className="text-[13px] font-semibold tabular-nums text-content-strong"
                          >
                            <Value>{formatPercent(r.repeatRate, { decimals: 1 })}</Value>
                          </span>,
                          <span key="o" className="text-[13px] tabular-nums">
                            <Value>{formatNumber(r.avgLifetimeOrders, { decimals: 2 })}</Value>
                          </span>,
                        ],
                      }))}
                    />
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
