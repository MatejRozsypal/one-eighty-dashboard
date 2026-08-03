/**
 * Inventory — cash on the shelf, and what is about to go wrong.
 *
 * ── Why this page is shaped as an exception list, not a report ───────────────
 * The published base rate for BI adoption is bad, and the diagnosed cause is
 * dashboards that show what data is *available* rather than what a decision
 * needs. So the top of this page is one number with its decomposition, then at
 * most five things to actually do. The full catalogue is below, for checking the
 * five — not for browsing.
 *
 * The five is a budget, not a coincidence: process-industry alarm standards
 * (EEMUA 191 / ISA-18.2) are the only body of work with measured limits on how
 * many alerts a human absorbs, and scaled to a weekly review they land at about
 * five, of which one may be urgent. See INVENTORY_DESIGN_PROPOSAL.md §3.
 *
 * ── Why there are no date controls ──────────────────────────────────────────
 * The window is fixed at the 90 days ending on the stock snapshot, because
 * days-of-cover is only meaningful when stock and velocity describe the same
 * moment. A date picker here would imply a freedom the number does not have.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getInventory } from "@/lib/queries/inventory";
import {
  buildExceptions,
  formatCover,
  stockState,
  COVER_AT_RISK_DAYS,
  COVER_OVERSTOCK_DAYS,
  type InventoryRow,
} from "@/lib/inventory/model";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  // The confinement gate — a client-role account gets its own client here no
  // matter what `?client=` asks for.
  const client = await resolveClient(params.clientId, clients);
  const { rows, summary } = await getInventory(client.clientId);

  const money = (v: number | null) => formatMoney(v, client.currency);

  const header = (
    <Header
      eyebrow={pageEyebrow("/inventory", client.name)}
      title="Inventory"
    />
  );

  if (rows.length === 0) {
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
              No stock data for {client.name}.
            </span>
            <span className="text-[13px] leading-[1.6] text-content-body">
              This page reads{" "}
              <code className="font-mono text-[12px]">mart.mart_sku_inventory</code>,
              which is fed from the Shopify products snapshot. A client on
              Shoptet has no snapshot at all yet — the current workflow pulls
              orders only.
            </span>
          </div>
        </main>
      </>
    );
  }

  const exceptions = buildExceptions(rows);
  const costCoverage = safeDiv(summary.skusWithCost, summary.skuCount);

  const buckets = [
    { label: "Healthy", value: summary.valueHealthy, tone: "text-growth-700" },
    { label: "At risk", value: summary.valueAtRisk, tone: "text-negative" },
    { label: "Overstocked", value: summary.valueOverstocked, tone: "text-content-strong" },
    { label: "Dead", value: summary.valueDead, tone: "text-content-strong" },
  ];

  return (
    <>
      {header}
      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {/* ── Trust bar ───────────────────────────────────────────────────
            Persistent, not a footnote. The published literature puts inventory
            record inaccuracy at 65%, and this warehouse already shows a stale
            snapshot, missing costs and negative stock. A reader who discovers
            one wrong number unaided stops believing the right ones. */}
        <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-hairline bg-paper px-5 py-3.5 text-[12px] text-content-body">
          <span>
            Stock counted{" "}
            <strong className="font-semibold text-content-strong">
              {summary.snapshotDate ?? "—"}
            </strong>
            {summary.snapshotAgeDays !== null && (
              <span
                className={
                  summary.snapshotAgeDays > 7
                    ? "text-negative"
                    : "text-content-muted"
                }
              >
                {" "}
                · {formatNumber(summary.snapshotAgeDays)} days ago
              </span>
            )}
          </span>
          <span className="text-hairline-strong">·</span>
          <span>
            Cost known for{" "}
            <strong
              className={
                (costCoverage ?? 0) < 0.8
                  ? "font-semibold text-negative"
                  : "font-semibold text-content-strong"
              }
            >
              {formatPercent(costCoverage, { decimals: 0 })}
            </strong>{" "}
            of SKUs
          </span>
          {summary.negativeStockCount > 0 && (
            <>
              <span className="text-hairline-strong">·</span>
              <span className="text-negative">
                {formatNumber(summary.negativeStockCount)} SKUs with negative
                stock
              </span>
            </>
          )}
          <span className="text-hairline-strong">·</span>
          <span className="text-content-muted">
            Velocity on calendar days — stockout days not yet excluded
          </span>
        </section>

        {/* ── The one number ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[26px]">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>Cash in stock · at cost</Eyebrow>
            <span className="font-mono text-[34px] font-semibold leading-none tracking-heading tabular text-content-strong">
              {money(summary.stockValueAtCost)}
            </span>
            <span className="text-[12.5px] text-content-muted">
              across {formatNumber(summary.skuCount)} SKUs
              {summary.skusWithCost < summary.skuCount && (
                <>
                  {" "}
                  — excludes{" "}
                  {formatNumber(summary.skuCount - summary.skusWithCost)} with no
                  cost on file, so the real figure is higher
                </>
              )}
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 border-t border-hairline pt-4">
            {buckets.map((b) => (
              <div key={b.label} className="flex flex-col gap-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  {b.label}
                </span>
                <span
                  className={`font-mono text-[19px] font-semibold leading-none tracking-heading tabular ${b.tone}`}
                >
                  {money(b.value)}
                </span>
                <span className="text-[11.5px] text-gray-300">
                  {formatPercent(safeDiv(b.value, summary.stockValueAtCost), {
                    decimals: 0,
                  })}
                </span>
              </div>
            ))}
          </div>

          <p className="border-t border-hairline pt-3.5 text-[12px] leading-[1.6] text-content-muted">
            At risk = under {COVER_AT_RISK_DAYS} days of cover. Overstocked =
            over {COVER_OVERSTOCK_DAYS}. Dead = nothing sold in the window. Those
            two thresholds are placeholders for real supplier lead times, which
            no client has given us yet — until then they are assumptions, not
            measurements.
          </p>
        </section>

        {/* ── The ranked action list ──────────────────────────────────────── */}
        <section className="flex flex-col rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>What to do</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Top {exceptions.length} by money at stake
            </span>
          </div>

          {exceptions.length === 0 ? (
            <div className="px-5 py-6 text-[13px] text-content-body">
              Nothing is outside its thresholds. Given the age of this snapshot,
              read that as &ldquo;nothing was wrong when it was taken&rdquo;
              rather than as an all-clear.
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {exceptions.map((e) => (
                <li key={e.sku} className="flex flex-col gap-1.5 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Badge
                      variant={e.severity === "high" ? "negative" : "outline"}
                      size="sm"
                    >
                      {e.action}
                    </Badge>
                    <span className="text-[14px] font-semibold text-content-strong">
                      {e.itemName}
                    </span>
                    {e.abc && (
                      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-content-muted">
                        {e.abc}-class
                      </span>
                    )}
                  </div>
                  <span className="text-[13px] leading-[1.6] text-content-body">
                    {e.evidence}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── The catalogue ───────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Catalogue · mart_sku_inventory</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Click a heading to sort
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <DataTable
                gridClass="grid grid-cols-[2fr_0.5fr_0.7fr_0.7fr_0.8fr_0.8fr_0.8fr_0.9fr] items-center gap-2"
                columns={[
                  { key: "product", label: "Product" },
                  { key: "abc", label: "ABCD" },
                  { key: "units", label: "Units 90d", align: "right" },
                  { key: "perDay", label: "Per day", align: "right" },
                  { key: "onHand", label: "On hand", align: "right" },
                  { key: "cover", label: "Days cover", align: "right" },
                  { key: "str", label: "Sell-thr.", align: "right" },
                  { key: "value", label: "Stock value", align: "right" },
                ]}
                rows={rows.map((r) => ({
                  key: r.sku + r.itemName,
                  sort: [
                    r.itemName,
                    r.abc,
                    r.unitsSold,
                    r.velocityPerDay,
                    r.onHand,
                    r.daysCover,
                    r.sellThrough,
                    r.stockValueAtCost,
                  ],
                  cells: [
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="truncate text-[13px] text-content-strong"
                        title={r.itemName}
                      >
                        {r.itemName}
                      </span>
                      <span className="truncate font-mono text-[10.5px] text-content-muted">
                        {r.sku}
                        {!r.inCatalogue && " · not in catalogue"}
                        {!r.hasCost && " · no cost"}
                      </span>
                    </span>,
                    <GradeChip grade={r.abc} />,
                    <span className="font-mono text-[12.5px] tabular text-content-body">
                      {formatNumber(r.unitsSold)}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      {r.velocityPerDay > 0
                        ? r.velocityPerDay.toFixed(2)
                        : "—"}
                    </span>,
                    <span
                      className={`font-mono text-[12.5px] tabular ${
                        r.negativeStock
                          ? "text-negative"
                          : "text-content-body"
                      }`}
                    >
                      {r.onHand === null ? "—" : formatNumber(r.onHand)}
                    </span>,
                    <CoverCell row={r} />,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      {r.sellThrough === null
                        ? "—"
                        : formatPercent(r.sellThrough, { decimals: 0 })}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      {r.hasCost ? money(r.stockValueAtCost) : "—"}
                    </span>,
                  ],
                }))}
              />
            </div>
          </div>

          <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
            <strong className="font-semibold text-content-body">ABCD</strong> is
            ours, not Shopify&apos;s: it ranks on contribution margin over 90
            days, where Shopify ranks on revenue over a fixed 28 and has no D
            grade at all. A/B/C are cumulative — first 80% of contribution, next
            15%, the rest. <strong className="font-semibold text-content-body">D</strong>{" "}
            sold nothing in the window;{" "}
            <strong className="font-semibold text-content-body">U</strong> has
            under 8 weeks of history and is too new to grade.{" "}
            <strong className="font-semibold text-content-body">Sell-through</strong>{" "}
            is units sold ÷ (sold + still on hand) over the same 90 days — one of
            five definitions in circulation, so compare it only with itself.
          </div>
        </section>
      </main>
    </>
  );
}

function GradeChip({ grade }: { grade: InventoryRow["abc"] }) {
  if (!grade) {
    return <span className="font-mono text-[11px] text-content-muted">—</span>;
  }
  const tone =
    grade === "A"
      ? "bg-accent-soft text-growth-700"
      : grade === "D"
        ? "bg-negative/10 text-negative"
        : "bg-gray-100 text-content-body";
  return (
    <span
      className={`inline-flex h-[21px] w-[21px] items-center justify-center rounded-pill font-mono text-[11px] font-semibold ${tone}`}
    >
      {grade}
    </span>
  );
}

function CoverCell({ row }: { row: InventoryRow }) {
  if (row.daysCover === null) {
    return (
      <span className="font-mono text-[12.5px] tabular text-content-muted">
        —
      </span>
    );
  }
  const state = stockState(row);
  const tone =
    state === "at-risk"
      ? "text-negative"
      : state === "overstocked"
        ? "text-content-muted"
        : "text-content-body";
  return (
    <span className={`font-mono text-[12.5px] font-semibold tabular ${tone}`}>
      {formatCover(row.daysCover)}
    </span>
  );
}
