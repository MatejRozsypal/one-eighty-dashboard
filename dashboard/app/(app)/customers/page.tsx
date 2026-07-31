/**
 * Customers — lifetime value and the gap between it and gross profit.
 *
 * LTV next to LTGP is the point of this page. The distance between them is the
 * cost of goods, so the pair answers "what is a customer worth" and "what do we
 * keep" in one read, where either number alone invites the wrong conclusion.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getLifetimeSummary, getTopCustomers } from "@/lib/queries/lifetime";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { optional } from "@/lib/queries/errors";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Customers" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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

  const [summary, rows] = await Promise.all([
    getLifetimeSummary(client.clientId, client.currency),
    optional(() => getTopCustomers(client.clientId, client.currency, 25), []),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const stats = [
    { label: "Customers", value: formatNumber(summary.customers) },
    {
      label: "Orders / customer",
      value:
        summary.ordersPerCustomer !== null
          ? summary.ordersPerCustomer.toFixed(2)
          : "—",
      accent: true,
    },
    { label: "Avg AOV", value: money(summary.avgAov) },
    {
      label: "Repeat rate",
      value: summary.repeatRate !== null ? formatPercent(summary.repeatRate) : "—",
      note: "≥2 orders",
    },
    {
      label: "Days active",
      value:
        summary.avgDaysActive !== null
          ? Math.round(summary.avgDaysActive).toString()
          : "—",
      note: "repeat customers",
    },
  ];

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/customers", client.name)}
        title="Customers"
      />

      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {/*
          Lifetime figures are cumulative over everything we hold, so this page
          is not filtered by the date picker. Stated next to the numbers rather
          than in the header, where it read as a range that had been applied.
        */}
        <span className="text-[12.5px] leading-[1.5] text-content-muted">
          Lifetime values across the full 36-month window — not the selected date
          range.
        </span>

        <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
          <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            <Eyebrow>Lifetime value vs lifetime gross profit</Eyebrow>

            <div className="flex flex-wrap items-end gap-5">
              <span className="flex min-w-0 flex-col gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  LTV
                </span>
                <span className="whitespace-nowrap font-mono text-[clamp(22px,2.4vw,32px)] font-semibold leading-none tracking-heading tabular text-content-strong">
                  {money(summary.ltv)}
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
                  {money(summary.ltgp)}
                </span>
              </span>
            </div>

            <span className="block h-2.5 overflow-hidden rounded-pill bg-gray-100">
              <span
                className="block h-2.5 bg-accent"
                style={{
                  width:
                    summary.ltgpRatio !== null
                      ? `${Math.min(100, summary.ltgpRatio * 100)}%`
                      : "0%",
                }}
              />
            </span>

            <span className="text-[12.5px] leading-[1.6] text-content-body">
              <b className="text-content-strong">
                {summary.ltgpRatio !== null
                  ? formatPercent(summary.ltgpRatio)
                  : "—"}
              </b>{" "}
              of lifetime revenue survives as gross profit. The gap between the two
              numbers is the cost of goods.
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-x-4 gap-y-5 rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            {stats.map((s) => (
              <span key={s.label} className="flex flex-col gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  {s.label}
                </span>
                <span
                  className={`font-mono text-[22px] font-semibold tracking-heading tabular ${
                    s.accent ? "text-growth-700" : "text-content-strong"
                  }`}
                >
                  {s.value}
                </span>
                {s.note && (
                  <span className="text-[11.5px] text-gray-300">{s.note}</span>
                )}
              </span>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Customer lifetime · mart_customer_lifetime</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Top {rows.length} by lifetime revenue
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[1.6fr_1fr_1fr_0.6fr_1fr_1fr_0.9fr_0.7fr_0.8fr] gap-2 border-b border-hairline bg-gray-50 px-5 py-3">
                {[
                  "Email",
                  "First order",
                  "Last order",
                  "Orders",
                  "Lifetime rev.",
                  "Lifetime GP",
                  "AOV",
                  "Days",
                  "Type",
                ].map((h) => (
                  <span
                    key={h}
                    className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                  >
                    {h}
                  </span>
                ))}
              </div>

              {rows.map((r) => (
                <div
                  key={r.email}
                  className="grid grid-cols-[1.6fr_1fr_1fr_0.6fr_1fr_1fr_0.9fr_0.7fr_0.8fr] items-center gap-2 border-b border-hairline px-5 py-3 transition-colors duration-fast hover:bg-gray-50"
                >
                  <span className="truncate font-mono text-[12px] text-content-strong">
                    {r.email}
                  </span>
                  <span className="font-mono text-[12px] text-content-muted">
                    {fmtDate(r.firstOrder)}
                  </span>
                  <span className="font-mono text-[12px] text-content-muted">
                    {fmtDate(r.lastOrder)}
                  </span>
                  <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                    {formatNumber(r.orders)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-strong">
                    {money(r.lifetimeRevenue)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-growth-700">
                    {money(r.lifetimeGrossProfit)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-strong">
                    {money(r.aov)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-muted">
                    {formatNumber(r.daysActive)}
                  </span>
                  <span className="justify-self-start">
                    {r.isReturning && (
                      <Badge variant="positive" size="sm">
                        Returning
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
            All figures cover a <b className="text-content-strong">36-month window</b>,
            not true all-time history. Customers whose first order predates the
            window are misclassified as new, which understates both repeat rate and
            LTV. Email addresses are masked server-side — the full address never
            reaches the browser.
          </div>
        </section>
      </main>
    </>
  );
}
