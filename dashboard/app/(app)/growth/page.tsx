/**
 * Growth — revenue and new customers, month by month.
 *
 * The partial month is the trap this page has to defuse. A month three days old
 * always looks like a collapse next to a closed one, and a MoM figure computed
 * against it is arithmetically correct and commercially meaningless. So partial
 * rows are marked, excluded from the averages, and drawn in a lighter fill.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getGrowth } from "@/lib/queries/growth";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DeltaChip } from "@/components/ui/Delta";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Growth" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

const W = 700;
const H = 170;

function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  const { months, avgMonthlyGrowth, cumulativeGrowth } = await getGrowth(
    client.clientId,
    client.currency
  );

  // Chronological for the chart, newest-first for the table — a chart reads
  // left to right, a table reads most-recent first.
  const chrono = [...months].reverse();
  const maxRevenue = Math.max(...chrono.map((m) => m.revenue ?? 0), 1) * 1.08;
  const maxNew = Math.max(...chrono.map((m) => m.newCustomerOrders ?? 0), 1) * 1.25;
  const slot = chrono.length > 0 ? W / chrono.length : W;

  const linePoints = chrono.map((m, i) => ({
    x: i * slot + slot * 0.5,
    y: H - ((m.newCustomerOrders ?? 0) / maxNew) * H,
  }));
  const linePath = linePoints
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/growth", client.name)}
        title="Growth (MoM)"
      />

      <main className="flex max-w-[1240px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <Eyebrow>Month over month</Eyebrow>
              <h2 className="m-0 text-[20px] font-bold tracking-heading text-content-strong">
                Revenue and new customers, <i className="font-medium">month by month.</i>
              </h2>
            </div>
            <div className="flex items-center gap-[18px]">
              <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-muted">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-ink-700" />
                Revenue
              </span>
              <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-content-muted">
                <span aria-hidden="true" className="h-0.5 w-3.5 bg-accent" />
                New customer orders
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-[190px] w-full"
            role="img"
            aria-label="Monthly revenue with new customer orders overlaid"
          >
            {chrono.map((m, i) => {
              const h = ((m.revenue ?? 0) / maxRevenue) * H;
              return (
                <rect
                  key={m.monthStart}
                  x={i * slot + slot * 0.18}
                  y={H - h}
                  width={slot * 0.64}
                  height={h}
                  rx={3}
                  // Partial months are drawn faded — the bar is real, the
                  // comparison isn't.
                  fill={m.isPartial ? "rgba(38,38,43,0.35)" : "var(--ink-700)"}
                />
              );
            })}
            <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {linePoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="var(--accent)" />
            ))}
          </svg>

          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${chrono.length || 1}, 1fr)` }}
          >
            {chrono.map((m) => (
              <span
                key={m.monthStart}
                className="text-center font-mono text-[11px] text-content-muted"
              >
                {monthLabel(m.monthStart).slice(0, 3)}
              </span>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[1fr_1fr_0.8fr_1fr_0.8fr_0.7fr] gap-2.5 border-b border-hairline bg-gray-50 px-5 py-3">
                {["Month", "Revenue", "MoM", "New cust. orders", "MoM", ""].map(
                  (h, i) => (
                    <span
                      key={i}
                      className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                    >
                      {h}
                    </span>
                  )
                )}
              </div>

              {months.map((m) => (
                <div
                  key={m.monthStart}
                  className={`grid grid-cols-[1fr_1fr_0.8fr_1fr_0.8fr_0.7fr] items-center gap-2.5 border-b border-hairline px-5 py-3 ${
                    m.isPartial ? "bg-gray-50" : ""
                  }`}
                >
                  <span className="text-[13px] text-content-body">
                    {monthLabel(m.monthStart)}
                  </span>
                  <span className="font-mono text-[14px] font-semibold tracking-heading tabular text-content-strong">
                    {formatMoney(m.revenue, client.currency)}
                  </span>
                  <DeltaChip delta={m.revenueMoM} goodWhen="up" />
                  <span className="font-mono text-[14px] tracking-heading tabular text-content-strong">
                    {formatNumber(m.newCustomerOrders)}
                  </span>
                  <DeltaChip delta={m.newCustomerOrdersMoM} goodWhen="up" />
                  <span className="justify-self-start">
                    {m.isPartial && (
                      <Badge variant="neutral" size="sm" dot>
                        Partial
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 px-5 py-3.5">
            <span className="text-[12.5px] leading-[1.6] text-content-body">
              Average monthly growth across the closed months:{" "}
              <b className="text-content-strong">
                {avgMonthlyGrowth !== null ? formatPercent(avgMonthlyGrowth) : "—"}
              </b>{" "}
              · cumulative across the range:{" "}
              <b className="text-content-strong">
                {cumulativeGrowth !== null ? formatPercent(cumulativeGrowth) : "—"}
              </b>
              .
            </span>
            <span className="text-[12px] leading-[1.6] text-content-muted">
              Both are computed over the visible closed months only — change the
              range and they change. The current month is partial, so its MoM is
              not comparable to a closed one and is excluded from these figures.
            </span>
          </div>
        </section>
      </main>
    </>
  );
}
