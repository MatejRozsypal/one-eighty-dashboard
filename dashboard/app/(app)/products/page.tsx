/**
 * Products — revenue against margin.
 *
 * Sorted by revenue, but margin % is given equal visual weight, because the
 * two disagree more often than people expect: the biggest seller is frequently
 * not the most profitable one, and a table sorted by revenue alone hides that.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getProducts } from "@/lib/queries/products";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  const products = await getProducts(client.clientId, params.range, 40);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <Header
      eyebrow={pageEyebrow("/products", client.name)}
      title="Products"
      rangeLabel={`${params.range.from} → ${params.range.to}`}
    />
  );

  if (products.length === 0) {
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
              No product rows in this range.
            </span>
            <span className="text-[13px] leading-[1.6] text-content-body">
              Either nothing sold, or product-level cost data hasn&apos;t been
              ingested for {client.name}.
            </span>
          </div>
        </main>
      </>
    );
  }

  const totalRevenue = products.reduce((s, p) => s + (p.revenue ?? 0), 0);
  const totalMargin = products.reduce((s, p) => s + (p.margin ?? 0), 0);
  const maxRevenue = Math.max(...products.map((p) => p.revenue ?? 0), 1);

  // Margin % clusters in a narrow band (70–89% on Dobias). Scaling a bar 0–100%
  // would push every product to the right and show nothing; scale to the data.
  const marginValues = products
    .map((p) => p.marginPct)
    .filter((v): v is number => v !== null);
  const minMargin = marginValues.length ? Math.min(...marginValues) : 0;
  const maxMargin = marginValues.length ? Math.max(...marginValues) : 1;
  const marginSpan = maxMargin - minMargin || 1;

  const lines = Array.from(
    new Set(products.map((p) => p.productLine).filter(Boolean))
  ) as string[];

  return (
    <>
      {header}
      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          {[
            { label: "Products", value: formatNumber(products.length) },
            { label: "Revenue", value: money(totalRevenue) },
            { label: "Margin", value: money(totalMargin), accent: true },
            {
              label: "Margin %",
              value: formatPercent(safeDiv(totalMargin, totalRevenue)),
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
                  s.accent ? "text-growth-700" : "text-content-strong"
                }`}
              >
                {s.value}
              </span>
            </div>
          ))}
        </section>

        {lines.length > 1 && (
          <section className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <Eyebrow>By product line</Eyebrow>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              {lines.map((line) => {
                const inLine = products.filter((p) => p.productLine === line);
                const rev = inLine.reduce((s, p) => s + (p.revenue ?? 0), 0);
                const mar = inLine.reduce((s, p) => s + (p.margin ?? 0), 0);
                return (
                  <div key={line} className="flex flex-col gap-2 border-t border-hairline pt-3">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      {line}
                    </span>
                    <span className="font-mono text-[18px] font-semibold tracking-heading tabular text-content-strong">
                      {money(rev)}
                    </span>
                    <span className="text-[11.5px] text-gray-300">
                      {formatPercent(safeDiv(mar, rev))} margin ·{" "}
                      {formatPercent(safeDiv(rev, totalRevenue), { decimals: 0 })} of
                      revenue
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Products · mart_product_perf</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Sorted by revenue
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[2.2fr_0.7fr_0.7fr_1fr_1fr_1.4fr] gap-2 border-b border-hairline bg-gray-50 px-5 py-3">
                {["Product", "Line", "Units", "Revenue", "Margin", "Margin %"].map(
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

              {products.map((p) => (
                <div
                  key={p.productName}
                  className="grid grid-cols-[2.2fr_0.7fr_0.7fr_1fr_1fr_1.4fr] items-center gap-2 border-b border-hairline px-5 py-3 transition-colors duration-fast hover:bg-gray-50"
                >
                  <span
                    className="truncate text-[13px] text-content-strong"
                    title={p.productName}
                  >
                    {p.productName}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-content-muted">
                    {p.productLine ?? "—"}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-body">
                    {formatNumber(p.units)}
                  </span>
                  <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                    {money(p.revenue)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-growth-700">
                    {money(p.margin)}
                  </span>
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
                      {p.marginPct !== null
                        ? formatPercent(p.marginPct, { decimals: 0 })
                        : "—"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
            Margin bars are scaled to the range actually present (
            {formatPercent(minMargin, { decimals: 0 })}–
            {formatPercent(maxMargin, { decimals: 0 })}), not to 0–100% — on a
            0–100% scale every product would sit in the same place and the
            comparison would show nothing. Read bar length as rank, the number as
            the value.
          </div>
        </section>
      </main>
    </>
  );
}
