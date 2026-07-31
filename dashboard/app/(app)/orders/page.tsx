/**
 * Orders — order-level detail and the market split.
 *
 * The page you open when a number on the Snapshot looks wrong. Its job is to
 * let you get from a total down to the individual orders behind it.
 *
 * Serves both platforms. Where they differ, the page drops the column rather
 * than printing a row of dashes: Shoptet has no address on the order and no
 * separable shipping or discounts, so those columns simply aren't rendered for
 * it, and the market split is cut by transacting currency (CZK = CZ, EUR =
 * SK/EU for Manami) under a heading that says so.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getOrdersSummary, getRecentOrders } from "@/lib/queries/orders";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const REGION = new Intl.DisplayNames(["en"], { type: "region" });
const CURRENCY_MARKETS: Record<string, string> = {
  CZK: "Czechia (CZK)",
  EUR: "Eurozone / SK (EUR)",
  USD: "United States (USD)",
  CAD: "Canada (CAD)",
};

function marketLabel(key: string, dimension: "country" | "currency"): string {
  if (!key) return "Not set";
  if (dimension === "currency") return CURRENCY_MARKETS[key] ?? key;
  try {
    return REGION.of(key) ?? key;
  } catch {
    return key;
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
    <>
      <Header
        eyebrow={pageEyebrow("/orders", client.name)}
        title="Orders"
      />

      <PageControls client={client} params={params} />
    </>
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
              <code className="font-mono">mart_orders</code> returned no rows for{" "}
              {client.name} in this range. It carries both Shopify and Shoptet,
              so this is an empty range rather than an unsupported platform —
              try widening the dates.
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

  const isCurrencySplit = summary.dimension === "currency";

  // Columns follow the platform. Shoptet exposes neither per-order discounts
  // nor a shipping/merchandise split, so those columns are dropped rather than
  // rendered as a column of em dashes that looks like missing data.
  const columns: Array<{ key: string; label: string; align?: "right" }> = [
    { key: "date", label: "Date" },
    { key: "order", label: "Order" },
    { key: "customer", label: "Customer" },
    { key: "market", label: isCurrencySplit ? "Currency" : "Country" },
    { key: "revenue", label: "Revenue", align: "right" as const },
    { key: "net", label: "Net sales", align: "right" as const },
    ...(summary.margin !== null
      ? [{ key: "margin", label: "Margin", align: "right" as const }]
      : []),
    ...(summary.hasDiscounts
      ? [{ key: "discounts", label: "Discounts", align: "right" as const }]
      : []),
    { key: "status", label: "Type" },
  ];

  const grid = `grid grid-cols-[0.85fr_0.75fr_1.5fr_0.6fr_repeat(${
    columns.length - 5
  },minmax(0,1fr))_0.85fr] items-center gap-2`;

  const cards = [
    { label: "Orders", value: formatNumber(summary.orders) },
    { label: "Revenue", value: money(summary.revenue) },
    { label: "AOV (net)", value: money(summary.aovNet), note: "net sales ÷ orders" },
    ...(summary.hasShippingSplit
      ? [
          {
            label: "AOV incl. shipping",
            value: money(summary.aovInclShipping),
            muted: true,
          },
        ]
      : []),
    ...(summary.margin !== null
      ? [
          {
            label: "Gross profit",
            value: money(summary.margin),
            note:
              summary.marginRate !== null
                ? `${formatPercent(summary.marginRate, { decimals: 1 })} of net sales`
                : undefined,
          },
        ]
      : []),
    {
      label: "Returning",
      value:
        summary.returningShare !== null
          ? formatPercent(summary.returningShare)
          : "—",
    },
  ];

  return (
    <>
      {header}
      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          {cards.map((s) => (
            <div
              key={s.label}
              className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                {s.label}
              </span>
              <span
                className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${
                  "muted" in s && s.muted ? "text-gray-400" : "text-content-strong"
                }`}
              >
                {s.value}
              </span>
              {"note" in s && s.note && (
                <span className="text-[11.5px] text-gray-300">{s.note}</span>
              )}
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <div className="flex flex-col gap-[5px]">
            <Eyebrow>
              {isCurrencySplit ? "Market split · by currency" : "Market split"}
            </Eyebrow>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              {isCurrencySplit ? (
                <>
                  Shoptet puts no address on an order, so this is split by the
                  currency the customer transacted in — the closest thing to a
                  market boundary that the data actually contains. Amounts are
                  still shown in CZK.
                </>
              ) : (
                <>Where the orders shipped. One store, several markets.</>
              )}
            </span>
          </div>

          <div className="flex flex-col">
            {summary.markets.map((m) => (
              <div
                key={m.key || "unset"}
                className="grid grid-cols-[minmax(110px,1.2fr)_minmax(60px,2fr)_repeat(3,minmax(64px,0.8fr))] items-center gap-3 border-b border-hairline py-2.5"
              >
                <span
                  className={`truncate text-[13px] ${
                    m.key ? "text-content-strong" : "text-gray-400 italic"
                  }`}
                >
                  {marketLabel(m.key, summary.dimension)}
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
            customers.
            {!isCurrencySplit && (
              <>
                {" "}
                A blank market means the order carried no shipping country —
                that&apos;s missing data, not a place.
              </>
            )}
          </span>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Recent orders · mart_orders</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Latest {orders.length} · click a heading to sort
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <DataTable
                gridClass={grid}
                columns={columns}
                rows={orders.map((o, i) => ({
                  key: `${o.orderNumber}-${i}`,
                  cells: columns.map((c) => {
                    switch (c.key) {
                      case "date":
                        return (
                          <span className="font-mono text-[12px] tabular text-content-muted">
                            {o.date ?? "—"}
                          </span>
                        );
                      case "order":
                        return (
                          <span className="block truncate font-mono text-[12px] text-content-strong">
                            {o.orderNumber}
                          </span>
                        );
                      case "customer":
                        return (
                          <span className="block truncate font-mono text-[12px] text-content-body">
                            {o.customerEmail}
                          </span>
                        );
                      case "market":
                        return (
                          <span className="font-mono text-[12px] text-content-muted">
                            {o.market || "—"}
                          </span>
                        );
                      case "revenue":
                        return (
                          <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                            {money(o.revenue)}
                          </span>
                        );
                      case "net":
                        return (
                          <span className="font-mono text-[12.5px] tabular text-content-body">
                            {money(o.netSales)}
                          </span>
                        );
                      case "margin":
                        return (
                          <span className="font-mono text-[12.5px] tabular text-content-body">
                            {o.margin !== null ? money(o.margin) : "—"}
                          </span>
                        );
                      case "discounts":
                        return (
                          <span className="font-mono text-[12.5px] tabular text-content-muted">
                            {o.discounts ? `−${money(o.discounts)}` : "—"}
                          </span>
                        );
                      default:
                        return (
                          <Badge
                            variant={o.isReturning ? "positive" : "neutral"}
                            size="sm"
                          >
                            {o.isReturning ? "Returning" : "New"}
                          </Badge>
                        );
                    }
                  }),
                  sort: columns.map((c) => {
                    switch (c.key) {
                      case "date":
                        return o.date;
                      case "order":
                        return o.orderNumber;
                      case "customer":
                        return o.customerEmail;
                      case "market":
                        return o.market;
                      case "revenue":
                        return o.revenue;
                      case "net":
                        return o.netSales;
                      case "margin":
                        return o.margin;
                      case "discounts":
                        return o.discounts;
                      default:
                        return o.isReturning ? 1 : 0;
                    }
                  }),
                }))}
              />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
