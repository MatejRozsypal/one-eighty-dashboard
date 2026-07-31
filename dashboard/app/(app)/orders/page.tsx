/**
 * Orders — order-level detail and the market split.
 *
 * The page you open when a number on the Snapshot looks wrong. Its job is to
 * let you get from a total down to the individual orders behind it.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getOrdersSummary, getRecentOrders } from "@/lib/queries/orders";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const REGION = new Intl.DisplayNames(["en"], { type: "region" });

function countryLabel(code: string): string {
  if (!code) return "Not set";
  try {
    return REGION.of(code) ?? code;
  } catch {
    return code;
  }
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const [summary, orders] = await Promise.all([
    getOrdersSummary(client.clientId, params.range),
    getRecentOrders(client.clientId, params.range, 50),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <Header
      eyebrow={pageEyebrow("/orders", client.name)}
      title="Orders"
      rangeLabel={`${params.range.from} → ${params.range.to}`}
    />
  );

  if (!summary) {
    return (
      <>
        {header}
        <main className="flex max-w-[1240px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <div className="flex max-w-[640px] flex-col gap-3 rounded-card border border-dashed border-hairline-strong bg-paper p-[32px_24px]">
            <span className="self-start">
              <Badge variant="outline" size="sm">
                No data
              </Badge>
            </span>
            <span className="text-[15px] font-semibold text-content-strong">
              No order-level data for {client.name}.
            </span>
            <span className="text-[13px] leading-[1.6] text-content-body">
              <code className="font-mono">mart_orders</code> is built from
              Shopify only. {client.name} is on{" "}
              {client.shopPlatform ?? "another platform"}, so the daily totals on
              Snapshot work but there is no per-order view yet.
            </span>
          </div>
        </main>
      </>
    );
  }

  const maxMarketRevenue = Math.max(
    ...summary.markets.map((m) => m.revenue ?? 0),
    1
  );

  return (
    <>
      {header}
      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          {[
            { label: "Orders", value: formatNumber(summary.orders) },
            { label: "Revenue", value: money(summary.revenue) },
            { label: "AOV (net)", value: money(summary.aovNet), accent: true },
            {
              label: "AOV incl. shipping",
              value: money(summary.aovInclShipping),
              muted: true,
            },
            {
              label: "Returning",
              value:
                summary.returningShare !== null
                  ? formatPercent(summary.returningShare)
                  : "—",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                {s.label}
              </span>
              <span
                className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${
                  s.muted ? "text-gray-400" : "text-content-strong"
                }`}
              >
                {s.value}
              </span>
              {s.accent && (
                <span className="text-[11.5px] text-gray-300">
                  net sales ÷ orders
                </span>
              )}
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <div className="flex flex-col gap-[5px]">
            <Eyebrow>Market split</Eyebrow>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              Where the orders shipped. One store, several markets.
            </span>
          </div>

          <div className="flex flex-col">
            {summary.markets.map((m) => (
              <div
                key={m.country || "unset"}
                className="grid grid-cols-[minmax(110px,1.2fr)_minmax(60px,2fr)_repeat(3,minmax(64px,0.8fr))] items-center gap-3 border-b border-hairline py-2.5"
              >
                <span
                  className={`truncate text-[13px] ${
                    m.country ? "text-content-strong" : "text-gray-400 italic"
                  }`}
                >
                  {countryLabel(m.country)}
                </span>
                <span className="h-2 overflow-hidden rounded-pill bg-gray-100">
                  <span
                    className="block h-2 rounded-pill bg-ink-700"
                    style={{
                      width: `${((m.revenue ?? 0) / maxMarketRevenue) * 100}%`,
                    }}
                  />
                </span>
                <span className="text-right font-mono text-[12.5px] tabular text-content-strong">
                  {money(m.revenue)}
                </span>
                <span className="text-right font-mono text-[12.5px] tabular text-content-muted">
                  {formatNumber(m.orders)}
                </span>
                <span className="text-right font-mono text-[12.5px] tabular text-content-muted">
                  {m.returningShare !== null
                    ? formatPercent(m.returningShare, { decimals: 0 })
                    : "—"}
                </span>
              </div>
            ))}
          </div>

          <span className="text-[12px] leading-[1.6] text-content-muted">
            Columns are revenue, orders, and share of orders from returning
            customers. A blank market means the order carried no shipping
            country — that&apos;s missing data, not a place.
          </span>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Recent orders · mart_orders</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Latest {orders.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[0.9fr_0.8fr_1.6fr_0.7fr_1fr_1fr_0.9fr_0.9fr] gap-2 border-b border-hairline bg-gray-50 px-5 py-3">
                {["Date", "Order", "Customer", "Country", "Revenue", "Net sales", "Discounts", "Status"].map(
                  (h) => (
                    <span
                      key={h}
                      className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                    >
                      {h}
                    </span>
                  )
                )}
              </div>

              {orders.map((o, i) => (
                <div
                  key={`${o.orderNumber}-${i}`}
                  className="grid grid-cols-[0.9fr_0.8fr_1.6fr_0.7fr_1fr_1fr_0.9fr_0.9fr] items-center gap-2 border-b border-hairline px-5 py-3 transition-colors duration-fast hover:bg-gray-50"
                >
                  <span className="font-mono text-[12px] tabular text-content-muted">
                    {o.date ?? "—"}
                  </span>
                  <span className="font-mono text-[12px] text-content-strong">
                    {o.orderNumber}
                  </span>
                  <span className="truncate font-mono text-[12px] text-content-body">
                    {o.customerEmail}
                  </span>
                  <span className="font-mono text-[12px] text-content-muted">
                    {o.country || "—"}
                  </span>
                  <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                    {money(o.revenue)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-body">
                    {money(o.netSales)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-muted">
                    {o.discounts ? `−${money(o.discounts)}` : "—"}
                  </span>
                  <span className="justify-self-start">
                    <Badge
                      variant={o.isReturning ? "positive" : "neutral"}
                      size="sm"
                    >
                      {o.isReturning ? "Returning" : "New"}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
