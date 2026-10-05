/**
 * Orders: order-level detail and the market split.
 *
 * The page you open when a number on the Snapshot looks wrong. Its job is to
 * let you get from a total down to the individual orders behind it.
 *
 * Serves every shop platform. Where they differ, the page drops the column
 * rather than printing a row of "n/a": a platform with no per-order discounts
 * or shipping split simply doesn't render those columns, and a platform with no
 * address on the order is split by transacting currency instead of country,
 * under a label that says so.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getOrdersSummary, getRecentOrders } from "@/lib/queries/orders";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { NO_VALUE } from "@/lib/format";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { InfoTip } from "@/components/ui/InfoTip";
import { DataTable } from "@/components/ui/DataTable";
import { NoData, NotConnected, Value } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const REGION = new Intl.DisplayNames(["en"], { type: "region" });
const CURRENCY_MARKETS: Record<string, string> = {
  CZK: "Czechia (CZK)",
  EUR: "Eurozone / SK (EUR)",
  USD: "United States (USD)",
  CAD: "Canada (CAD)",
};

/**
 * Grid template per column count. Literal class strings on purpose: Tailwind
 * only generates classes it can read in the source, so a class assembled from a
 * template literal at runtime never reaches the stylesheet and the table
 * collapses into a stacked list.
 */
const GRID_BY_COLS: Record<number, string> = {
  7: "grid grid-cols-[0.85fr_0.75fr_1.5fr_0.6fr_minmax(0,1fr)_minmax(0,1fr)_0.85fr] items-center gap-2",
  8: "grid grid-cols-[0.85fr_0.75fr_1.5fr_0.6fr_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_0.85fr] items-center gap-2",
  9: "grid grid-cols-[0.85fr_0.75fr_1.5fr_0.6fr_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_0.85fr] items-center gap-2",
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

  if (pageAvailability(client, "/orders") !== "available") {
    return (
      <>
        <Header title="Orders" />
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/orders") ?? "Shop"} />
        </main>
      </>
    );
  }

  const [summary, orders] = await Promise.all([
    getOrdersSummary(client.clientId, params.range),
    getRecentOrders(client.clientId, params.range, 50),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <>
      <Header title="Orders" />

      <PageControls client={client} params={params} />
    </>
  );

  if (!summary) {
    return (
      <>
        {header}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const maxMarketRevenue = Math.max(
    ...summary.markets.map((m) => m.revenue ?? 0),
    1
  );

  const isCurrencySplit = summary.dimension === "currency";
  const source = client.shopPlatform ?? "Shop";

  // Columns follow the platform. A platform with no per-order discounts or
  // shipping split drops those columns rather than rendering a column of "n/a"
  // that looks like missing data.
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

  const grid = GRID_BY_COLS[columns.length] ?? GRID_BY_COLS[9];

  const marketNote = isCurrencySplit
    ? "Split by transacting currency, as this platform carries no address. Amounts are shown in the client currency."
    : "Split by shipping country. A blank market means the order has no shipping country.";

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          <MetricCard label="Orders" value={formatNumber(summary.orders)} source={source} />
          <MetricCard label="Revenue" value={money(summary.revenue)} source={source} />
          <MetricCard label="AOV (net)" value={money(summary.aovNet)} source={source} />
          {summary.hasShippingSplit && (
            <MetricCard
              label="AOV incl. shipping"
              value={money(summary.aovInclShipping)}
              source={source}
            />
          )}
          {summary.margin !== null && (
            <MetricCard label="Gross profit" value={money(summary.margin)} source={source} />
          )}
          <MetricCard
            label="Returning"
            value={formatPercent(summary.returningShare)}
            source={source}
          />
        </section>

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <span className="inline-flex items-center gap-1.5">
            <Eyebrow>Market split</Eyebrow>
            <InfoTip text={marketNote} />
          </span>

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
                  <Value>{money(m.revenue)}</Value>
                </span>
                <span className="text-right font-mono text-[12.5px] tabular text-content-muted">
                  {formatNumber(m.orders)}
                </span>
                <span className="text-right font-mono text-[12.5px] tabular text-content-muted">
                  {formatPercent(m.returningShare, { decimals: 0 })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Recent orders</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Latest {orders.length}
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
                            <Value>{o.date ?? NO_VALUE}</Value>
                          </span>
                        );
                      case "order":
                        return (
                          <span className="block truncate font-mono text-[12px] text-content-strong">
                            <Value>{o.orderNumber || NO_VALUE}</Value>
                          </span>
                        );
                      case "customer":
                        return (
                          <span className="block truncate font-mono text-[12px] text-content-body">
                            <Value>{o.customerEmail || NO_VALUE}</Value>
                          </span>
                        );
                      case "market":
                        return (
                          <span className="font-mono text-[12px] text-content-muted">
                            {o.market || NO_VALUE}
                          </span>
                        );
                      case "revenue":
                        return (
                          <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                            <Value>{money(o.revenue)}</Value>
                          </span>
                        );
                      case "net":
                        return (
                          <span className="font-mono text-[12.5px] tabular text-content-body">
                            <Value>{money(o.netSales)}</Value>
                          </span>
                        );
                      case "margin":
                        return (
                          <span className="font-mono text-[12.5px] tabular text-content-body">
                            <Value>{money(o.margin)}</Value>
                          </span>
                        );
                      case "discounts":
                        return (
                          <span className="font-mono text-[12.5px] tabular text-content-muted">
                            {o.discounts === null
                              ? NO_VALUE
                              : o.discounts > 0
                                ? money(-o.discounts)
                                : "none"}
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
