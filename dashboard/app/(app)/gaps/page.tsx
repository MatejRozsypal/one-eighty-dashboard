/**
 * Time between orders.
 *
 * The most actionable retention question there is: when should a reorder
 * reminder go out? The distribution answers it, and the median — not the mean —
 * is the number to act on.
 *
 * Depends on `mart.mart_order_gaps` (migration 208). Until that view is
 * deployed, or for a client with too few repeat orders to say anything, the
 * page renders its empty state rather than an error.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getGapStats } from "@/lib/queries/gaps";
import { formatNumber } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

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
  const stats = await getGapStats(client.clientId, client.currency);

  const header = (
    <Header
      eyebrow={pageEyebrow("/gaps", client.name)}
      title="Time between orders"
      rangeLabel={stats?.windowLabel}
    />
  );

  if (!stats) {
    return (
      <>
        {header}
        <main className="flex max-w-[1240px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <div className="flex max-w-[640px] flex-col gap-3 rounded-card border border-dashed border-hairline-strong bg-paper p-[32px_24px] lg:p-[32px_34px]">
            <span className="self-start">
              <Badge variant="outline" size="sm">
                No data yet
              </Badge>
            </span>
            <span className="text-[15px] font-semibold text-content-strong">
              Order-to-order gaps haven&apos;t been computed for {client.name} yet.
            </span>
            <span className="max-w-[520px] text-[13px] leading-[1.6] text-content-body">
              This screen reads <code className="font-mono">mart.mart_order_gaps</code>,
              a warehouse view that ships separately from the frontend
              (migration <code className="font-mono">208_mart_order_gaps.sql</code>).
              It may also be empty simply because this client has too few repeat
              orders for the distribution to say anything yet.
            </span>
          </div>
        </main>
      </>
    );
  }

  const maxCount = Math.max(...stats.buckets.map((b) => b.count));

  return (
    <>
      {header}
      <main className="flex max-w-[1240px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3.5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            <Eyebrow>Median gap between orders</Eyebrow>
            <div className="flex items-end gap-3.5">
              <span className="font-mono text-[56px] font-semibold leading-none tracking-heading tabular text-content-strong">
                {stats.median !== null ? Math.round(stats.median) : "—"}
              </span>
              <span className="pb-1.5 font-mono text-[15px] text-content-muted">
                days
              </span>
            </div>
            <span className="text-[13px] leading-[1.6] text-content-body">
              The typical customer comes back in{" "}
              <b className="text-content-strong">
                {stats.median !== null ? Math.round(stats.median) : "—"} days
              </b>
              . The mean is{" "}
              {stats.mean !== null ? Math.round(stats.mean) : "—"} — dragged up by
              a long tail of customers returning after a year. Reorder timing
              follows the median.
            </span>
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
                  {s.value !== null ? Math.round(s.value) : "—"}
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
              <Eyebrow>Distribution of order-to-order gaps</Eyebrow>
              <h2 className="m-0 text-[20px] font-bold tracking-heading text-content-strong">
                The peak sits at{" "}
                {stats.buckets.find((b) => b.isModal)?.label ?? "—"} days —{" "}
                <i className="font-medium">one consumption cycle.</i>
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
                        ? "hatched border border-dashed border-hairline-strong"
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
                          ? "hatched border border-dashed border-hairline-strong"
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

          <div className="flex flex-wrap gap-3">
            <span className="flex min-w-[280px] flex-1 items-start gap-2.5 rounded-control border border-dashed border-hairline-strong bg-gray-50 p-[11px_14px]">
              <span className="font-mono text-[11px] text-gray-400">0–7</span>
              <span className="text-[12.5px] leading-[1.6] text-content-body">
                Mostly <b className="text-content-strong">not</b> reorders — split
                orders, corrections and forgotten items. Read it as order hygiene,
                not loyalty.
              </span>
            </span>
            <span className="flex min-w-[280px] flex-1 items-start gap-2.5 rounded-control border border-growth-100 bg-growth-50 p-[11px_14px]">
              <span className="font-mono text-[11px] text-growth-700">
                {stats.buckets.find((b) => b.isModal)?.label ?? "—"}
              </span>
              <span className="text-[12.5px] leading-[1.6] text-content-body">
                The product&apos;s natural consumption cycle. A reminder timed to
                the median lands while most customers are still deciding; one timed
                to the mean arrives after they already have.
              </span>
            </span>
          </div>
        </section>
      </main>
    </>
  );
}
