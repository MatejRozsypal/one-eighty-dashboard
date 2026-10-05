/**
 * Customers, lifetime value and the gap between it and gross profit.
 *
 * LTV next to LTGP is the point of this page. The distance between them is the
 * cost of goods, so the pair answers "what is a customer worth" and "what do we
 * keep" in one read, where either number alone invites the wrong conclusion.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { RangeNote } from "@/components/ui/PageNotes";
import { getLifetimeSummary, getTopCustomers } from "@/lib/queries/lifetime";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { optional } from "@/lib/queries/errors";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData, Value } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { NO_VALUE } from "@/lib/format";
import { pageAvailability, missingSource } from "@/lib/capabilities";

export const metadata: Metadata = { title: "Customers" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return NO_VALUE;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "May 2024" from an ISO date, null when there is none. */
function fmtMonth(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/customers") !== "available") {
    return (
      <>
        <Header title="Customers" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/customers") ?? "Shop"} />
        </main>
      </>
    );
  }

  const [summary, rows] = await Promise.all([
    getLifetimeSummary(client.clientId, client.currency),
    optional(() => getTopCustomers(client.clientId, client.currency, 25), []),
  ]);

  // Lifetime figures cover the full window and ignore the date picker, so the
  // controls stay out of the way of a page with no data.
  if (!summary) {
    return (
      <>
        <Header title="Customers" />
        <PageControls client={client} params={params} />
      <RangeNote />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const money = (v: number | null) => formatMoney(v, client.currency);

  const r365 = summary.repeat365;
  const stats: Array<{
    label: string;
    value: string;
    sub?: string;
    accent?: boolean;
    info?: string;
  }> = [
    { label: "Customers", value: formatNumber(summary.customers) },
    {
      label: "Orders / customer",
      value: formatNumber(summary.ordersPerCustomer, { decimals: 2 }),
    },
    {
      label: "AOV",
      value: money(summary.avgAov),
      info: "Revenue divided by orders, all orders to date. Weighted by order, so repeat customers count once per order.",
    },
    {
      label: "Days active",
      value: formatNumber(summary.avgDaysActive),
      info: "Mean days between first and last order, repeat customers only.",
    },
    {
      label: "Repeat rate, 365 days",
      value: formatPercent(r365?.rate ?? null),
      sub: r365
        ? `${formatNumber(r365.repeaters)} of ${formatNumber(r365.matured)}${
            r365.matured < 100 ? ", low n" : ""
          }`
        : undefined,
      accent: true,
      info: "Second order within 365 days of the first. Customers with at least 365 days of history.",
    },
    {
      label: "Repeat rate, to date",
      value: formatPercent(summary.repeatRate),
      info: "Customers with 2 or more orders, whatever their age. Recent customers lower it.",
    },
  ];

  const windowStart = fmtMonth(summary.windowStart);
  const ltvTip = windowStart
    ? `Per customer, all orders since ${windowStart}. Ignores the date range. Customers who bought before then count as new.`
    : "Per customer, all orders in the data. Ignores the date range. Customers who bought earlier count as new.";

  return (
    <>
      <Header title="Customers" />
      <PageControls client={client} params={params} />
      <RangeNote />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
          <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            <Eyebrow>
              LTV vs LTGP
              <InfoTip text={ltvTip} />
            </Eyebrow>

            <div className="flex flex-wrap items-end gap-5">
              <span className="flex min-w-0 flex-col gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  LTV
                </span>
                <span className="whitespace-nowrap font-mono text-[clamp(22px,2.4vw,32px)] font-semibold leading-none tracking-heading tabular text-content-strong">
                  <Value>{money(summary.ltv)}</Value>
                </span>
              </span>
              <span aria-hidden="true" className="pb-1 font-mono text-[20px] text-gray-250">
                →
              </span>
              <span className="flex min-w-0 flex-col gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  LTGP
                </span>
                <span className="whitespace-nowrap font-mono text-[clamp(22px,2.4vw,32px)] font-semibold leading-none tracking-heading tabular text-growth-700">
                  <Value>{money(summary.ltgp)}</Value>
                </span>
              </span>
            </div>

            {summary.ltgpRatio !== null && (
              <span className="block h-2.5 overflow-hidden rounded-pill bg-gray-100">
                <span
                  className="block h-2.5 bg-accent"
                  style={{ width: `${Math.min(100, summary.ltgpRatio * 100)}%` }}
                />
              </span>
            )}

            <span className="font-mono text-[12.5px] text-content-body">
              <b className="text-content-strong">
                <Value>{formatPercent(summary.ltgpRatio)}</Value>
              </b>{" "}
              LTGP / LTV
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-x-4 gap-y-5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            {stats.map((s) => (
              <span key={s.label} className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  {s.label}
                  {s.info && <InfoTip text={s.info} />}
                </span>
                <span
                  className={`font-mono text-[22px] font-semibold tracking-heading tabular ${
                    s.accent ? "text-growth-700" : "text-content-strong"
                  }`}
                >
                  <Value>{s.value}</Value>
                </span>
                {s.sub && (
                  <span className="font-mono text-[11px] tabular text-content-muted">
                    {s.sub}
                  </span>
                )}
              </span>
            ))}
          </div>
        </section>

        {rows.length > 0 && (
        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Customer lifetime</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Top {rows.length} by revenue
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <DataTable
                gridClass="grid grid-cols-[1.6fr_1fr_1fr_0.6fr_1fr_1fr_0.9fr_0.7fr_0.8fr] items-center gap-2"
                columns={[
                  { key: "email", label: "Email" },
                  { key: "first", label: "First order" },
                  { key: "last", label: "Last order" },
                  { key: "orders", label: "Orders", align: "right" },
                  { key: "rev", label: "Lifetime rev.", align: "right" },
                  { key: "gp", label: "Lifetime GP", align: "right" },
                  { key: "aov", label: "AOV", align: "right" },
                  { key: "days", label: "Days", align: "right" },
                  { key: "type", label: "Type" },
                ]}
                rows={rows.map((r) => ({
                  key: r.email,
                  sort: [
                    r.email,
                    r.firstOrder,
                    r.lastOrder,
                    r.orders,
                    r.lifetimeRevenue,
                    r.lifetimeGrossProfit,
                    r.aov,
                    r.daysActive,
                    r.isReturning ? 1 : 0,
                  ],
                  cells: [
                    <span className="block truncate font-mono text-[12px] text-content-strong">
                      <Value>{r.email}</Value>
                    </span>,
                    <span className="font-mono text-[12px] text-content-muted">
                      <Value>{fmtDate(r.firstOrder)}</Value>
                    </span>,
                    <span className="font-mono text-[12px] text-content-muted">
                      <Value>{fmtDate(r.lastOrder)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                      <Value>{formatNumber(r.orders)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      <Value>{money(r.lifetimeRevenue)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-growth-700">
                      <Value>{money(r.lifetimeGrossProfit)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      <Value>{money(r.aov)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      <Value>{formatNumber(r.daysActive)}</Value>
                    </span>,
                    r.isReturning ? (
                      <Badge variant="positive" size="sm">
                        Returning
                      </Badge>
                    ) : (
                      <Badge variant="outline" size="sm">
                        New
                      </Badge>
                    ),
                  ],
                }))}
              />
            </div>
          </div>

        </section>
        )}
      </main>
    </>
  );
}
