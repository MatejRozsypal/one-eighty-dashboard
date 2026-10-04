/**
 * Products: revenue against margin.
 *
 * Sorted by revenue, but margin % is given equal visual weight, because the
 * two disagree more often than people expect: the biggest seller is frequently
 * not the most profitable one, and a table sorted by revenue alone hides that.
 *
 * Margin is null for a product with no cost data. That shows as "n/a" and a
 * "No cost data" card, never as a zero margin.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, comparisonLabel, type SearchParams } from "@/lib/params";
import { delta } from "@/lib/period";
import { getProducts, type ProductRow } from "@/lib/queries/products";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { NO_VALUE } from "@/lib/format";
import { safeDiv } from "@/lib/coerce";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { MetricCard, type MetricState } from "@/components/dashboard/MetricCard";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { DataTable } from "@/components/ui/DataTable";
import { NoData, NotConnected, Value } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

/** Totals over every product in a range, with margin read over costed products only. */
function totalsOf(products: ProductRow[]) {
  const revenue = products.reduce((s, p) => s + (p.revenue ?? 0), 0);
  const costed = products.filter((p) => p.margin !== null);
  const margin = costed.length
    ? costed.reduce((s, p) => s + (p.margin ?? 0), 0)
    : null;
  const costedRevenue = costed.reduce((s, p) => s + (p.revenue ?? 0), 0);
  return {
    count: products.length,
    revenue,
    margin,
    marginPct: safeDiv(margin, costedRevenue),
  };
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/products") !== "available") {
    return (
      <>
        <Header title="Products" />
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/products") ?? "Shop"} />
        </main>
      </>
    );
  }

  const comparison = params.period.comparison;
  const [all, previous] = await Promise.all([
    getProducts(client.clientId, params.range, 1000),
    comparison ? getProducts(client.clientId, comparison, 1000) : Promise.resolve(null),
  ]);
  const products = all.slice(0, 40);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <>
      <Header title="Products" />

      <PageControls client={client} params={params} compare />
    </>
  );

  if (all.length === 0) {
    return (
      <>
        {header}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const now = totalsOf(all);
  const before = previous ? totalsOf(previous) : null;
  const compareLabel = comparisonLabel(params);
  const source = client.shopPlatform ?? "Shop";
  const noCost: MetricState = { kind: "no-data", reason: "No cost data" };
  const marginState: MetricState = now.margin === null ? noCost : { kind: "ok" };
  const d = (pick: (t: typeof now) => number | null) =>
    before ? delta(pick(now), pick(before)) : undefined;

  // Margin % clusters in a narrow band. Scaling a bar 0-100% would push every
  // product to the right and show nothing; scale to the data.
  const marginValues = products
    .map((p) => p.marginPct)
    .filter((v): v is number => v !== null);
  const minMargin = marginValues.length ? Math.min(...marginValues) : 0;
  const maxMargin = marginValues.length ? Math.max(...marginValues) : 1;
  const marginSpan = maxMargin - minMargin || 1;

  const lines = Array.from(
    new Set(all.map((p) => p.productLine).filter(Boolean))
  ) as string[];

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          <MetricCard
            label="Products"
            value={formatNumber(now.count)}
            delta={d((t) => t.count)}
            goodWhen="neutral"
            comparisonLabel={compareLabel}
            source={source}
          />
          <MetricCard
            label="Revenue"
            value={money(now.revenue)}
            delta={d((t) => t.revenue)}
            comparisonLabel={compareLabel}
            source={source}
          />
          <MetricCard
            label="Margin"
            value={money(now.margin)}
            delta={d((t) => t.margin)}
            comparisonLabel={compareLabel}
            source="Warehouse"
            state={marginState}
          />
          <MetricCard
            label="Margin %"
            value={formatPercent(now.marginPct)}
            delta={d((t) => t.marginPct)}
            comparisonLabel={compareLabel}
            source="Warehouse"
            state={marginState}
          />
        </section>

        {lines.length > 1 && (
          <section className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <Eyebrow>By product line</Eyebrow>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              {lines.map((line) => {
                const inLine = all.filter((p) => p.productLine === line);
                const lineTotals = totalsOf(inLine);
                return (
                  <div key={line} className="flex flex-col gap-2 border-t border-hairline pt-3">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      {line}
                    </span>
                    <span className="font-mono text-[18px] font-semibold tracking-heading tabular text-content-strong">
                      <Value>{money(lineTotals.revenue)}</Value>
                    </span>
                    <span className="text-[11.5px] text-gray-300">
                      {lineTotals.marginPct !== null
                        ? `${formatPercent(lineTotals.marginPct)} margin \u00b7 `
                        : ""}
                      {formatPercent(safeDiv(lineTotals.revenue, now.revenue), { decimals: 0 })} of
                      revenue
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="border-b border-hairline px-5 py-4">
            <Eyebrow>Products</Eyebrow>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <DataTable
                gridClass="grid grid-cols-[2.2fr_0.7fr_0.7fr_1fr_1fr_1.4fr] items-center gap-2"
                columns={[
                  { key: "product", label: "Product" },
                  { key: "line", label: "Line" },
                  { key: "units", label: "Units", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right" },
                  { key: "margin", label: "Margin", align: "right" },
                  {
                    key: "marginPct",
                    label: "Margin %",
                    info: "Bars are scaled to the range present, not 0 to 100%. Read bar length as rank, the number as the value.",
                  },
                ]}
                rows={products.map((p) => ({
                  key: `${p.productName}|${p.productLine ?? ""}`,
                  sort: [
                    p.productName,
                    p.productLine,
                    p.units,
                    p.revenue,
                    p.margin,
                    p.marginPct,
                  ],
                  cells: [
                    <span
                      className="block truncate text-[13px] text-content-strong"
                      title={p.productName}
                    >
                      {p.productName}
                    </span>,
                    <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-content-muted">
                      {p.productLine ?? NO_VALUE}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-body">
                      {formatNumber(p.units)}
                    </span>,
                    <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                      <Value>{money(p.revenue)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-growth-700">
                      <Value>{money(p.margin)}</Value>
                    </span>,
                    <span className="flex items-center gap-2.5">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-gray-100">
                        <span
                          className="block h-1.5 rounded-pill bg-accent"
                          style={{
                            width:
                              p.marginPct !== null
                                ? `${Math.max(4, ((p.marginPct - minMargin) / marginSpan) * 100)}%`
                                : "0%",
                          }}
                        />
                      </span>
                      <span className="w-[46px] shrink-0 text-right font-mono text-[12px] tabular text-content-strong">
                        <Value>{formatPercent(p.marginPct, { decimals: 0 })}</Value>
                      </span>
                    </span>,
                  ],
                }))}
              />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
