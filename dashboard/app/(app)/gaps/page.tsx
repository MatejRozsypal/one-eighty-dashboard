/**
 * Time between orders.
 *
 * The most actionable retention question there is: when should a reorder
 * reminder go out? The distribution answers it, and the median, not the mean,
 * is the number to act on.
 *
 * Until the underlying view is deployed, or for a client with too few repeat
 * orders to say anything, the page renders its empty state rather than an error.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { getGapStats } from "@/lib/queries/gaps";
import { formatNumber } from "@/lib/currency";
import { NO_VALUE } from "@/lib/format";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData, Value } from "@/components/ui/EmptyState";
import { pageAvailability, missingSource } from "@/lib/capabilities";

export const metadata: Metadata = { title: "Time between orders" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

export default async function GapsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  if (pageAvailability(client, "/gaps") !== "available") {
    return (
      <>
        <Header title="Time between orders" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/gaps") ?? "Shop"} />
        </main>
      </>
    );
  }

  const stats = await getGapStats(client.clientId, client.currency);

  const header = (
    <>
      <Header title="Time between orders" />
      <PageControls client={client} params={params} />
    </>
  );

  if (!stats) {
    return (
      <>
        {header}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const maxCount = Math.max(...stats.buckets.map((b) => b.count));

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3.5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            <Eyebrow>Median gap between orders</Eyebrow>
            <div className="flex items-end gap-3.5">
              <span className="font-mono text-[56px] font-semibold leading-none tracking-heading tabular text-content-strong">
                <Value>{formatNumber(stats.median)}</Value>
              </span>
              <span className="pb-1.5 font-mono text-[15px] text-content-muted">
                days
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] content-start gap-x-3.5 gap-y-5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            {[
              { label: "Mean", value: stats.mean, muted: true },
              { label: "p25", value: stats.p25 },
              { label: "p75", value: stats.p75 },
              { label: "p90", value: stats.p90 },
            ].map((s) => (
              <span key={s.label} className="flex flex-col gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  {s.label}
                </span>
                <span
                  className={`font-mono text-[20px] font-semibold tracking-heading tabular ${
                    s.muted ? "text-gray-400" : "text-content-strong"
                  }`}
                >
                  <Value>{formatNumber(s.value)}</Value>
                </span>
              </span>
            ))}
            <span className="flex flex-col gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                Gaps measured
              </span>
              <span className="font-mono text-[20px] font-semibold tracking-heading tabular text-content-strong">
                {formatNumber(stats.totalGaps)}
              </span>
              <span className="text-[11.5px] text-gray-300">{stats.windowLabel}</span>
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <Eyebrow>
                Distribution of order-to-order gaps
                <InfoTip text="The 0-7 day bucket is mostly split orders and corrections, not reorders. The tallest bucket is the product's natural reorder cycle." />
              </Eyebrow>
              <h2 className="m-0 text-[20px] font-bold tracking-heading text-content-strong">
                Peak at <Value>{stats.buckets.find((b) => b.isModal)?.label ?? NO_VALUE}</Value> days
              </h2>
            </div>
            <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-muted">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
              Modal bucket
            </span>
          </div>

          {/* Vertical bars on desktop, horizontal rows on mobile */}
          <div className="hidden h-[250px] items-end gap-3 md:flex">
            {stats.buckets.map((b) => (
              <div
                key={b.label}
                className="flex h-full flex-1 flex-col justify-end gap-2.5"
              >
                <span className="text-center font-mono text-[12.5px] font-semibold tabular text-content-strong">
                  {formatNumber(b.count)}
                </span>
                <span
                  className={`block rounded-t-md ${
                    b.isModal
                      ? "bg-accent"
                      : b.isOrderHygiene
                        ? "hatched border border-hairline-strong"
                        : "bg-ink-700"
                  }`}
                  style={{ height: `${(b.count / maxCount) * 200}px` }}
                />
              </div>
            ))}
          </div>
          <div className="hidden gap-3 border-t border-hairline pt-2.5 md:flex">
            {stats.buckets.map((b) => (
              <span
                key={b.label}
                className={`flex-1 text-center font-mono text-[11px] ${
                  b.isModal ? "text-growth-700" : "text-content-muted"
                }`}
              >
                {b.label}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {stats.buckets.map((b) => (
              <div
                key={b.label}
                className="grid grid-cols-[56px_minmax(0,1fr)_52px] items-center gap-2.5"
              >
                <span
                  className={`font-mono text-[11px] ${
                    b.isModal ? "text-growth-700" : "text-content-muted"
                  }`}
                >
                  {b.label}
                </span>
                <span className="block h-3.5 overflow-hidden rounded-[4px] bg-gray-100">
                  <span
                    className={`block h-3.5 rounded-[4px] ${
                      b.isModal
                        ? "bg-accent"
                        : b.isOrderHygiene
                          ? "hatched border border-hairline-strong"
                          : "bg-ink-700"
                    }`}
                    style={{ width: `${(b.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[11.5px] tabular text-content-strong">
                  {formatNumber(b.count)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
