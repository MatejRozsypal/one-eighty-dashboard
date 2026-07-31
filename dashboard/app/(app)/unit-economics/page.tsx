/**
 * Unit economics — first-time vs returning.
 *
 * A ledger, not a dashboard: two columns of the same metrics so the difference
 * between acquiring a customer and keeping one reads down the page. Laid out
 * like Shopify's Total sales breakdown — zebra rows, label left, value right —
 * because the point is comparison line by line, and anything that pushes two
 * numbers apart works against that.
 *
 * Rows the warehouse cannot measure stay in place and say so. Dropping them
 * would leave a leakage section that looks complete and isn't.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getUnitEconomics, type SegmentEconomics } from "@/lib/queries/unitEconomics";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Unit economics" };
export const dynamic = "force-dynamic";

export default async function UnitEconomicsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  const data = await getUnitEconomics(client.clientId, client.currency, params.range);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const pct = (v: number | null) =>
    v === null ? null : formatPercent(v, { decimals: 1 });

  const header = (
    <>
      <Header eyebrow={pageEyebrow("/unit-economics", client.name)} title="Unit economics" />
      <PageControls client={client} params={params} />
    </>
  );

  if (!data) {
    return (
      <>
        {header}
        <main className="flex max-w-[980px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <div className="flex max-w-[640px] flex-col gap-3 rounded-card border border-dashed border-hairline-strong bg-paper p-[32px_24px]">
            <span className="self-start">
              <Badge variant="outline" size="sm">No data</Badge>
            </span>
            <span className="text-[15px] font-semibold text-content-strong">
              No orders for {client.name} in this range.
            </span>
          </div>
        </main>
      </>
    );
  }

  type Row =
    | { kind: "head"; label: string }
    | {
        kind: "row";
        label: string;
        pick: (s: SegmentEconomics) => string | null;
        /** Shown instead of values when the warehouse cannot measure it. */
        unmeasured?: string;
      };

  const rows: Row[] = [
    { kind: "head", label: "Basket composition" },
    { kind: "row", label: "AUR (avg unit retail)", pick: (s) => money(s.aur) },
    {
      kind: "row",
      label: "UPT (units per transaction)",
      pick: (s) => (s.upt === null ? null : s.upt.toFixed(2)),
    },
    { kind: "row", label: "Gross retail / order", pick: (s) => money(s.grossRetailPerOrder) },
    { kind: "row", label: "True AOV", pick: (s) => money(s.trueAov) },
    { kind: "row", label: "Orders", pick: (s) => formatNumber(s.orders) },

    { kind: "head", label: "Leakage" },
    {
      kind: "row",
      label: "Discount rate",
      pick: (s) => pct(s.discountRate),
      unmeasured: data.hasDiscounts
        ? undefined
        : `${client.shopPlatform ?? "This platform"} reports a per-item discount percentage, not an amount — reconstructing the amount would invent money.`,
    },
    {
      kind: "row",
      label: "Return rate",
      pick: () => null,
      unmeasured:
        "No refund data in the warehouse at all. Needs the Shopify orders backfill refetched with totalRefundedSet.",
    },

    { kind: "head", label: "Margin stack" },
    { kind: "row", label: "COGS %", pick: (s) => pct(s.cogsPct) },
    { kind: "row", label: "Gross profit %", pick: (s) => pct(s.grossProfitPct) },
    { kind: "row", label: "Contribution margin %", pick: (s) => pct(s.contributionMarginPct) },
    { kind: "row", label: "Paid spend applied", pick: (s) => money(s.paidSpend) },
  ];

  let zebra = 0;

  return (
    <>
      {header}
      <main className="flex max-w-[980px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <div className="flex flex-col gap-[5px]">
            <h2 className="m-0 text-[17px] font-bold tracking-heading text-content-strong">
              First-time vs returning
            </h2>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              Warehouse definitions, not Shopify defaults. True AOV is net sales
              ÷ orders — ex-shipping, ex-tax.
            </span>
          </div>

          <div className="overflow-hidden rounded-sm">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(90px,1fr)_minmax(90px,1fr)] gap-3 border-b border-hairline px-3 py-2.5">
              {["Metric", "First-time", "Returning"].map((h, i) => (
                <span
                  key={h}
                  className={`font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted ${
                    i > 0 ? "text-right" : ""
                  }`}
                >
                  {h}
                </span>
              ))}
            </div>

            {rows.map((row) => {
              if (row.kind === "head") {
                zebra = 0;
                return (
                  <div
                    key={row.label}
                    className="bg-gray-50 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted"
                  >
                    {row.label}
                  </div>
                );
              }

              const striped = zebra++ % 2 === 1;
              const a = row.pick(data.first);
              const b = row.pick(data.returning);

              return (
                <div
                  key={row.label}
                  className={`grid grid-cols-[minmax(0,1.6fr)_minmax(90px,1fr)_minmax(90px,1fr)] items-baseline gap-3 px-3 py-[11px] ${
                    striped ? "bg-gray-50/70" : ""
                  }`}
                >
                  <span className="min-w-0 text-[13.5px] text-content-body">
                    {row.label}
                  </span>
                  {row.unmeasured ? (
                    <span
                      className="col-span-2 text-right text-[12px] leading-[1.5] text-content-muted"
                      title={row.unmeasured}
                    >
                      <b className="text-gray-400">Not measured</b> — {row.unmeasured}
                    </span>
                  ) : (
                    <>
                      <span className="whitespace-nowrap text-right font-mono text-[14px] tabular text-content-strong">
                        {a ?? "—"}
                      </span>
                      <span className="whitespace-nowrap text-right font-mono text-[14px] tabular text-content-strong">
                        {b ?? "—"}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <span className="flex flex-col gap-1.5 text-[12px] leading-[1.6] text-content-muted">
            <span>
              <b className="text-content-strong">Contribution margin puts every
              paid-media currency unit on first-time customers.</b>{" "}
              Spend cannot be attributed to an individual order, so it cannot be
              split from the data — this is a chosen convention, and it flatters
              returning customers by construction: theirs carries no acquisition
              cost, so their CM equals gross profit.
            </span>
            <span>
              Orders here count only those whose customer could be classified as
              new or returning, so the total can sit slightly under the Orders
              page.
            </span>
          </span>
        </section>
      </main>
    </>
  );
}
