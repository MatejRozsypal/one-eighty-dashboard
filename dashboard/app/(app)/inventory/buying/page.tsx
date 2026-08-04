/**
 * Buying plan — what to order, how much, and what the cash bill is.
 *
 * ── What this page can honestly answer today ────────────────────────────────
 * Quantity and cash need only velocity, current stock and a target cover, all
 * of which the warehouse has. **When to place the order** needs the supplier's
 * lead time, and **what quantity is actually orderable** needs the MOQ and case
 * pack. Neither exists for any client yet, so this shows the raw recommendation
 * and says plainly what is missing rather than inventing a date.
 *
 * That split is the one every serious tool makes — Inventory Planner separates
 * `Replenishment` from `To order`, Prediko separates `To Buy (Live)` from
 * `Units to Order (Next PO)` — because the gap between the two is the MOQ tax
 * and the buyer should see it, not have it folded in silently.
 *
 * The cash total in the footer is the point of the page. A buying plan is a
 * cash-flow event before it is an ops task, and the number that decides whether
 * a plan is executable is the one at the bottom.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
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
import { TrustBar } from "@/components/inventory/TrustBar";
import { NoStockData } from "@/components/inventory/NoStockData";
import { pageEyebrow } from "@/lib/nav";

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
  const { rows, summary } = await getInventory(client.clientId);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <Header
      eyebrow={pageEyebrow("/inventory/buying", client.name)}
      title="Buying plan"
    />
  );

  if (rows.length === 0) {
    return (
      <>
        {header}
        <NoStockData clientName={client.name} />
      </>
    );
  }

  const plan = buildReorderPlan(rows);
  const totalCash = plan.reduce((s, l) => s + l.cost, 0);
  const totalUnits = plan.reduce((s, l) => s + l.suggestedUnits, 0);
  const priced = rows.filter((r) => r.hasCost && r.velocityPerDay > 0).length;
  const unpriceable = rows.filter(
    (r) => !r.hasCost && r.velocityPerDay > 0
  ).length;

  return (
    <>
      {header}
      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <TrustBar summary={summary} />

        {/* ── What is missing, said before any number is read ─────────────── */}
        <section className="flex flex-col gap-2 rounded-card border border-dashed border-hairline-strong bg-paper px-5 py-4">
          <span className="self-start">
            <Badge variant="outline" size="sm">
              Incomplete
            </Badge>
          </span>
          <span className="text-[13px] leading-[1.6] text-content-body">
            <strong className="font-semibold text-content-strong">
              These are quantities, not orders.
            </strong>{" "}
            The date to place each one needs the supplier&apos;s lead time, and
            the quantity you can actually buy needs the MOQ and case pack.
            Neither is configured for any client yet, so nothing here says{" "}
            <em>when</em>, and every quantity is a raw recommendation that a MOQ
            will round upward. Give us even rough lead times — &ldquo;8–10 weeks
            from China&rdquo; is enough — and both appear.
          </span>
        </section>

        {plan.length === 0 ? (
          <section className="rounded-card border border-hairline bg-surface-card px-5 py-6 text-[13px] leading-[1.6] text-content-body shadow-sm">
            Nothing is below {COVER_TARGET_DAYS} days of cover, so there is
            nothing to order. {unpriceable > 0 && (
              <>
                {formatNumber(unpriceable)} selling SKUs have no cost on file and
                were left out — they may well need ordering, but the cash bill
                for them cannot be computed.
              </>
            )}
          </section>
        ) : (
          <>
            <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
              {[
                { label: "SKUs to order", value: formatNumber(plan.length) },
                { label: "Units", value: formatNumber(totalUnits) },
                { label: "Cash required", value: money(totalCash), accent: true },
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
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
                <Eyebrow>Suggested order · soonest to run out first</Eyebrow>
                <span className="text-[12px] text-content-muted">
                  Click a heading to sort
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <DataTable
                    gridClass="grid grid-cols-[2.2fr_0.5fr_0.9fr_0.7fr_0.7fr_0.9fr_1fr] items-center gap-2"
                    columns={[
                      { key: "product", label: "Product" },
                      { key: "abc", label: "ABCD" },
                      { key: "cover", label: "Cover now", align: "right" },
                      { key: "perDay", label: "Per day", align: "right" },
                      { key: "onHand", label: "On hand", align: "right" },
                      { key: "units", label: "Order", align: "right" },
                      { key: "cost", label: "Cost", align: "right" },
                    ]}
                    rows={plan.map((l) => ({
                      key: l.row.sku + l.row.itemName,
                      sort: [
                        l.row.itemName,
                        l.row.abc,
                        l.daysCover,
                        l.row.velocityPerDay,
                        l.row.onHand,
                        l.suggestedUnits,
                        l.cost,
                      ],
                      cells: [
                        <span className="flex min-w-0 flex-col">
                          <span
                            className="truncate text-[13px] text-content-strong"
                            title={l.row.itemName}
                          >
                            {l.row.itemName}
                          </span>
                          <span className="truncate font-mono text-[10.5px] text-content-muted">
                            {l.row.sku}
                          </span>
                        </span>,
                        <span className="font-mono text-[11px] font-semibold text-content-muted">
                          {l.row.abc ?? "—"}
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
                          {l.row.velocityPerDay.toFixed(2)}
                        </span>,
                        <span className="font-mono text-[12.5px] tabular text-content-body">
                          {formatNumber(l.row.onHand ?? 0)}
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
                  {formatNumber(plan.length)} SKUs ·{" "}
                  {formatNumber(totalUnits)} units
                </span>
                <span className="font-mono text-[18px] font-semibold tracking-heading tabular text-content-strong">
                  {money(totalCash)}
                </span>
              </div>
            </section>
          </>
        )}

        <p className="max-w-[860px] text-[12px] leading-[1.6] text-content-muted">
          Order quantity is{" "}
          <code className="font-mono text-[11.5px]">
            velocity × {COVER_TARGET_DAYS} days − on hand
          </code>
          , at the last known unit cost. {COVER_TARGET_DAYS} days is an
          assumption standing in for{" "}
          <code className="font-mono text-[11.5px]">
            lead time + review period + safety stock
          </code>
          , none of which we hold.{" "}
          {unpriceable > 0 && (
            <>
              {formatNumber(unpriceable)} of {formatNumber(priced + unpriceable)}{" "}
              selling SKUs have no cost and are excluded — the cash total would
              be wrong rather than incomplete if they were counted at zero.{" "}
            </>
          )}
          Velocity still divides by calendar days, so any SKU that spent part of
          the window out of stock is understated here, and understating velocity
          is what causes the next stockout.
        </p>
      </main>
    </>
  );
}
