/**
 * Buying plan, what to order, how much, and what the cash bill is.
 *
 * ── What this page can honestly answer today ────────────────────────────────
 * Quantity and cash need only velocity, current stock and a target cover, all
 * of which the warehouse has. **When to place the order** needs the supplier's
 * lead time, and **what quantity is actually orderable** needs the MOQ and case
 * pack. Neither exists for any client yet, so this shows the raw recommendation
 * and says plainly what is missing rather than inventing a date.
 *
 * That split is the one every serious tool makes, Inventory Planner separates
 * `Replenishment` from `To order`, Prediko separates `To Buy (Live)` from
 * `Units to Order (Next PO)`, because the gap between the two is the MOQ tax
 * and the buyer should see it, not have it folded in silently.
 *
 * The cash total in the footer is the point of the page. A buying plan is a
 * cash-flow event before it is an ops task, and the number that decides whether
 * a plan is executable is the one at the bottom.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { getInventory } from "@/lib/queries/inventory";
import {
  buildReorderPlan,
  formatCover,
  COVER_TARGET_DAYS,
} from "@/lib/inventory/model";
import { formatMoney, formatNumber } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { InfoTip } from "@/components/ui/InfoTip";
import { NoData, NotConnected, Value } from "@/components/ui/EmptyState";
import { NO_VALUE } from "@/lib/format";
import { TrustBar } from "@/components/inventory/TrustBar";

export const metadata: Metadata = { title: "Buying plan" };
export const dynamic = "force-dynamic";

export default async function BuyingPlanPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <>
      <Header title="Buying plan" />
      <PageControls client={client} params={params} />
    </>
  );

  if (pageAvailability(client, "/inventory/buying") !== "available") {
    return (
      <>
        {header}
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected
            source={missingSource(client, "/inventory/buying") ?? "Shopify"}
          />
        </main>
      </>
    );
  }

  const { rows, summary } = await getInventory(client.clientId);

  if (rows.length === 0) {
    return (
      <>
        {header}
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const plan = buildReorderPlan(rows);
  const totalCash = plan.reduce((s, l) => s + l.cost, 0);
  const totalUnits = plan.reduce((s, l) => s + l.suggestedUnits, 0);
  const unpriceable = rows.filter(
    (r) => !r.hasCost && r.velocityPerDay > 0
  ).length;

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <TrustBar summary={summary} />

        <section className="flex flex-wrap items-center gap-2.5 rounded-card border border-hairline bg-paper px-5 py-3.5">
          <Badge variant="outline" size="sm">
            Incomplete
          </Badge>
          <span className="text-[13px] text-content-body">
            Quantities only, not orders.
          </span>
          <InfoTip text="Order dates need supplier lead times. Orderable quantities need MOQ and case pack. Neither is set, so every quantity is a raw recommendation." />
        </section>

        {plan.length === 0 ? (
          <section className="rounded-card border border-hairline bg-surface-card px-5 py-6 text-[13px] text-content-body shadow-sm">
            Nothing to order.
          </section>
        ) : (
          <>
            <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
              {[
                { label: "Products to order", value: formatNumber(plan.length) },
                { label: "Units", value: formatNumber(totalUnits) },
                {
                  label: "Cash required",
                  value: money(totalCash),
                  accent: true,
                  info:
                    unpriceable > 0
                      ? `${formatNumber(unpriceable)} selling SKUs have no cost and are excluded.`
                      : undefined,
                },
                {
                  label: "Target cover",
                  value: `${COVER_TARGET_DAYS} days`,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
                >
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                    {s.label}
                    {s.info && (
                      <>
                        {" "}
                        <InfoTip text={s.info} />
                      </>
                    )}
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

            <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
              <div className="border-b border-hairline px-5 py-4">
                <Eyebrow>Suggested order</Eyebrow>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <DataTable
                    gridClass="grid grid-cols-[2.2fr_0.5fr_0.9fr_0.7fr_0.7fr_0.9fr_1fr] items-center gap-2"
                    columns={[
                      { key: "product", label: "Product" },
                      { key: "abc", label: "ABCD" },
                      { key: "cover", label: "Cover now", align: "right" },
                      {
                        key: "perDay",
                        label: "Per day",
                        align: "right",
                        info: "Units sold per calendar day.",
                      },
                      { key: "onHand", label: "On hand", align: "right" },
                      {
                        key: "units",
                        label: "Order",
                        align: "right",
                        info: `Velocity times ${COVER_TARGET_DAYS} days, minus on hand. Priced at the last unit cost.`,
                      },
                      { key: "cost", label: "Cost", align: "right" },
                    ]}
                    rows={plan.map((l) => ({
                      key: l.itemName,
                      sort: [
                        l.itemName,
                        l.abc,
                        l.daysCover,
                        l.velocityPerDay,
                        l.onHand,
                        l.suggestedUnits,
                        l.cost,
                      ],
                      cells: [
                        <span className="flex min-w-0 flex-col">
                          <span
                            className="truncate text-[13px] text-content-strong"
                            title={l.itemName}
                          >
                            {l.itemName}
                          </span>
                          {l.variantCount > 1 && (
                            <span className="truncate font-mono text-[10.5px] text-content-muted">
                              {l.variantCount} variants
                            </span>
                          )}
                        </span>,
                        <span className="font-mono text-[11px] font-semibold text-content-muted">
                          <Value>{l.abc ?? NO_VALUE}</Value>
                        </span>,
                        <span
                          className={`font-mono text-[12.5px] font-semibold tabular ${
                            (l.daysCover ?? 0) <= 0
                              ? "text-negative"
                              : "text-content-body"
                          }`}
                        >
                          {formatCover(l.daysCover)}
                        </span>,
                        <span className="font-mono text-[12.5px] tabular text-content-muted">
                          {l.velocityPerDay.toFixed(2)}
                        </span>,
                        <span className="font-mono text-[12.5px] tabular text-content-body">
                          {formatNumber(l.onHand)}
                        </span>,
                        <span className="font-mono text-[13px] font-semibold tabular text-content-strong">
                          {formatNumber(l.suggestedUnits)}
                        </span>,
                        <span className="font-mono text-[12.5px] tabular text-growth-700">
                          {money(l.cost)}
                        </span>,
                      ],
                    }))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-4">
                <span className="text-[12.5px] text-content-body">
                  {formatNumber(plan.length)} products ·{" "}
                  {formatNumber(totalUnits)} units
                </span>
                <span className="font-mono text-[18px] font-semibold tracking-heading tabular text-content-strong">
                  {money(totalCash)}
                </span>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
