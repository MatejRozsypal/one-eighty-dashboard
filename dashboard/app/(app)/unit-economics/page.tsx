/**
 * Unit economics: first-time vs returning.
 *
 * A ledger, not a dashboard: two columns of the same metrics so the difference
 * between acquiring a customer and keeping one reads down the page. Laid out
 * like a shop's "Total sales" breakdown (zebra rows, label left, value right)
 * because the point is comparison line by line, and anything that pushes two
 * numbers apart works against that.
 *
 * Rows the warehouse cannot measure stay in place and say so in one line.
 * Dropping them would leave a section that looks complete and isn't.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, comparisonLabel, type SearchParams } from "@/lib/params";
import { getUnitEconomics, type SegmentEconomics } from "@/lib/queries/unitEconomics";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import type { DeltaKind } from "@/lib/format";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { NoData, NotConnected, Value } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Unit economics" };
export const dynamic = "force-dynamic";

type Row =
  | { kind: "head"; label: string }
  | {
      kind: "row";
      label: string;
      /** Definition shown in an (i) beside the label. */
      info?: string;
      value: (s: SegmentEconomics) => number | null;
      format: (v: number | null) => string;
      goodWhen: GoodWhen;
      /** What the figure is: decides the absolute change ("+CZK 12", "+3 orders") and that rates read in points. */
      delta: DeltaKind;
      /** Decimals of the absolute change, where the default (count 0) is too coarse. */
      deltaDecimals?: number;
      /** Shown in place of both values when the row cannot be measured. */
      unmeasured?: string;
    };

export default async function UnitEconomicsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/unit-economics") !== "available") {
    return (
      <>
        <Header title="Unit economics" />
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/unit-economics") ?? "Shop"} />
        </main>
      </>
    );
  }

  const comparison = params.period.comparison;
  const [data, previous] = await Promise.all([
    getUnitEconomics(client.clientId, client.currency, params.range),
    comparison
      ? getUnitEconomics(client.clientId, client.currency, comparison)
      : Promise.resolve(null),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const unitMoney = (v: number | null) => formatMoney(v, client.currency, { unit: true });
  const pct = (v: number | null) => formatPercent(v, { decimals: 1 });
  const compareLabel = comparisonLabel(params);

  const header = (
    <>
      <Header title="Unit economics" />
      <PageControls client={client} params={params} compare />
    </>
  );

  if (!data) {
    return (
      <>
        {header}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  // Revenue exists but no product costs do: COGS and everything built on it
  // says so, instead of reading as a margin of zero or 100%.
  const noCost =
    (data.first.orders ?? 0) + (data.returning.orders ?? 0) > 0 &&
    data.first.cogsPct === null &&
    data.returning.cogsPct === null;
  const noCostLine = noCost ? "No cost data" : undefined;

  const rows: Row[] = [
    { kind: "head", label: "Basket composition" },
    {
      kind: "row",
      label: "AUR",
      delta: "money",
      info: "Average unit retail: gross retail / units, before discounts.",
      value: (s) => s.aur,
      format: unitMoney,
      goodWhen: "neutral",
    },
    {
      kind: "row",
      label: "UPT",
      delta: "count",
      deltaDecimals: 2,
      info: "Units per transaction.",
      value: (s) => s.upt,
      format: (v) => (v === null ? formatNumber(null) : v.toFixed(2)),
      goodWhen: "up",
    },
    {
      kind: "row",
      label: "Gross per order",
      delta: "money",
      info: "Gross retail per order, before discounts.",
      value: (s) => s.grossRetailPerOrder,
      format: money,
      goodWhen: "neutral",
    },
    {
      kind: "row",
      label: "True AOV",
      delta: "money",
      info: "Net sales / orders, ex-shipping and ex-tax.",
      value: (s) => s.trueAov,
      format: money,
      goodWhen: "up",
    },
    {
      kind: "row",
      label: "Orders",
      delta: "count",
      info: "Only orders whose customer is classified as new or returning, so the total can sit under the Orders page.",
      value: (s) => s.orders,
      format: formatNumber,
      goodWhen: "neutral",
    },

    { kind: "head", label: "Leakage" },
    {
      kind: "row",
      label: "Discount rate",
      delta: "rate",
      value: (s) => s.discountRate,
      format: pct,
      goodWhen: "down",
      unmeasured: data.hasDiscounts ? undefined : "Not measured",
    },
    {
      kind: "row",
      label: "Return rate",
      delta: "rate",
      value: () => null,
      format: pct,
      goodWhen: "down",
      unmeasured: "No refund data",
    },

    { kind: "head", label: "Margin stack" },
    {
      kind: "row",
      label: "COGS %",
      delta: "rate",
      value: (s) => s.cogsPct,
      format: pct,
      goodWhen: "down",
      unmeasured: noCostLine,
    },
    {
      kind: "row",
      label: "Gross profit %",
      delta: "rate",
      value: (s) => s.grossProfitPct,
      format: pct,
      goodWhen: "up",
      unmeasured: noCostLine,
    },
    {
      kind: "row",
      label: "Contribution margin %",
      delta: "rate",
      info: "All paid spend is applied to first-time customers, so returning customers' CM equals gross profit.",
      value: (s) => s.contributionMarginPct,
      format: pct,
      goodWhen: "up",
      unmeasured: noCostLine,
    },
    {
      kind: "row",
      label: "Paid spend applied",
      delta: "money",
      value: (s) => s.paidSpend,
      format: money,
      goodWhen: "neutral",
    },
  ];

  let zebra = 0;

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <h2 className="m-0 text-[17px] font-bold tracking-heading text-content-strong">
            First-time vs returning
          </h2>

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

              const cell = (seg: "first" | "returning") => {
                const now = row.value(data[seg]);
                const change = previous
                  ? {
                      current: now,
                      previous: row.value(previous[seg]),
                      kind: row.delta,
                      currency: row.delta === "money" ? client.currency : undefined,
                      decimals: row.deltaDecimals,
                    }
                  : null;
                return (
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="whitespace-nowrap font-mono text-[14px] tabular text-content-strong">
                      <Value>{row.format(now)}</Value>
                    </span>
                    {change !== null && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <DeltaChip
                          change={change}
                          goodWhen={row.goodWhen}
                          after={
                            compareLabel ? (
                              <span className="font-mono text-[10.5px] text-content-muted">
                                {compareLabel}
                              </span>
                            ) : undefined
                          }
                        />
                      </span>
                    )}
                  </span>
                );
              };

              return (
                <div
                  key={row.label}
                  className={`grid grid-cols-[minmax(0,1.6fr)_minmax(90px,1fr)_minmax(90px,1fr)] items-baseline gap-3 px-3 py-[11px] ${
                    striped ? "bg-gray-50/70" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] text-content-body">
                    {row.label}
                    {row.info && <InfoTip text={row.info} />}
                  </span>
                  {row.unmeasured ? (
                    <span className="col-span-2 text-right text-[12px] leading-[1.5] text-content-muted">
                      {row.unmeasured}
                    </span>
                  ) : (
                    <>
                      {cell("first")}
                      {cell("returning")}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
