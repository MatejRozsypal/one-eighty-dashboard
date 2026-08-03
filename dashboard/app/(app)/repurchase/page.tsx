/**
 * Repurchase — which first purchase predicts a second, and what comes after it.
 *
 * The last nav item that was marked "Soon". It was scoped in the design brief
 * as needing a warehouse view that nobody had written; migration 213 is that
 * view.
 *
 * ── Two questions, deliberately on one page ─────────────────────────────────
 * The table answers "what should we acquire on" — which first product produces
 * customers who come back. The Sankey answers "and then what" — whether those
 * customers replenish the same thing or move across the range. Either alone
 * invites the wrong conclusion: a high repeat rate on a product nobody moves on
 * from is a different business than one that opens a range.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import {
  getFirstProductRepeat,
  getProductJourney,
} from "@/lib/queries/journey";
import { optional } from "@/lib/queries/errors";
import { formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ProductJourneyChart } from "@/components/dashboard/ProductJourney";
import { DataTable } from "@/components/ui/DataTable";
import { pageEyebrow } from "@/lib/nav";

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

  const [journey, breakdown] = await Promise.all([
    optional(() => getProductJourney(client.clientId, 3), null),
    optional(() => getFirstProductRepeat(client.clientId, 15), []),
  ]);

  const blendedRate = (() => {
    const customers = breakdown.reduce((a, r) => a + r.customers, 0);
    const repeaters = breakdown.reduce((a, r) => a + r.repeaters, 0);
    return customers > 0 ? repeaters / customers : null;
  })();

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/repurchase", client.name)}
        title="Repurchase"
      />

      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {/*
          Deliberately not range-filtered. A repurchase rate is a property of a
          customer's whole life, not of a date window — clipping it to "last 30
          days" would count people who had days rather than months to come back
          and report a collapse that is an artefact of the filter.
        */}
        <div className="rounded-card border border-hairline bg-gray-50 p-[14px_18px] text-[12.5px] leading-relaxed text-content-body">
          This page ignores the date range. Repurchasing is a property of a
          customer&rsquo;s lifetime, not of a window, and only customers whose
          first order is at least {MATURITY_DAYS} days old are counted — someone
          who bought last week has not failed to return, they have not had the
          chance. {blendedRate !== null && (
            <>
              Across every product, {formatPercent(blendedRate, { decimals: 1 })}{" "}
              of matured customers came back.
            </>
          )}
        </div>

        {journey && journey.links.length > 0 ? (
          <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <div className="flex flex-col gap-[5px]">
              <Eyebrow>Journey · what they buy next</Eyebrow>
              <span className="text-[12.5px] leading-[1.5] text-content-muted">
                Each column is an order number, not a date. A ribbon&rsquo;s
                thickness is how many customers took that route.
              </span>
            </div>
            <ProductJourneyChart journey={journey} />
          </section>
        ) : (
          <section className="rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <Eyebrow>Journey</Eyebrow>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-content-body">
              Not enough repeat orders to draw a journey for {client.name} yet.
            </p>
          </section>
        )}

        {breakdown.length > 0 && (
          <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
            <div className="flex flex-col gap-[5px] border-b border-hairline px-5 py-4 lg:px-[26px]">
              <Eyebrow>First product · did they come back</Eyebrow>
              <span className="text-[12.5px] leading-[1.5] text-content-muted">
                Ranked by repeat rate. Products with fewer than 30 matured
                customers are left out — a rate over twelve people is noise.
              </span>
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
                        {formatNumber(r.customers)}
                      </span>,
                      <span key="r" className="text-[13px] tabular-nums">
                        {formatNumber(r.repeaters)}
                      </span>,
                      <span
                        key="rate"
                        className={`text-[13px] font-semibold tabular-nums ${
                          blendedRate !== null &&
                          r.repeatRate !== null &&
                          r.repeatRate >= blendedRate
                            ? "text-positive"
                            : "text-content-strong"
                        }`}
                      >
                        {formatPercent(r.repeatRate, { decimals: 1 })}
                      </span>,
                      <span key="o" className="text-[13px] tabular-nums">
                        {formatNumber(r.avgLifetimeOrders, { decimals: 2 })}
                      </span>,
                    ],
                  }))}
                />
              </div>
            </div>
          </section>
        )}

        <section className="rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <Eyebrow>How to read this</Eyebrow>
          <p className="mt-2 max-w-[86ch] text-[12.5px] leading-relaxed text-content-body">
            An order can contain several products, so each one is attributed to
            its highest-revenue line — what the basket was built around. And
            which product someone buys first is partly decided by what you
            advertised to them, so a high repeat rate may be telling you about
            the customer that product attracts rather than the product itself.
            Treat a difference here as a reason to test acquiring on that
            product, not as proof it causes loyalty.
          </p>
        </section>
      </main>
    </>
  );
}
