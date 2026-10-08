/**
 * Stock health, cash on the shelf, and what is about to go wrong.
 *
 * ── Why this page is an exception list, not a report ────────────────────────
 * The published base rate for BI adoption is bad, and the diagnosed cause is
 * dashboards that show what data is *available* rather than what a decision
 * needs. So this is one number with its decomposition, then at most five things
 * to actually do. The catalogue that proves them is one click away, on its own
 * page.
 *
 * Five is a budget, not a coincidence: process-industry alarm standards
 * (EEMUA 191 / ISA-18.2) are the only body of work with measured limits on how
 * many alerts a human absorbs, and scaled to a weekly review they land at about
 * five. See INVENTORY_DESIGN_PROPOSAL.md §3.
 *
 * ── Why there are no date controls ──────────────────────────────────────────
 * The window is fixed at the 90 days ending on the stock snapshot, because
 * days-of-cover is only meaningful when stock and velocity describe the same
 * moment. A date picker would imply a freedom the number does not have.
 */

import type { Metadata } from "next";
import { AppLink } from "@/components/ui/AppLink";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { RangeNote } from "@/components/ui/PageNotes";
import { getInventory } from "@/lib/queries/inventory";
import {
  buildExceptions,
  snapshotTooOldForBuying,
  COVER_AT_RISK_DAYS,
  COVER_OVERSTOCK_DAYS,
} from "@/lib/inventory/model";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { InfoTip } from "@/components/ui/InfoTip";
import { NoData, NotConnected } from "@/components/ui/EmptyState";
import { TrustBar } from "@/components/inventory/TrustBar";

export const metadata: Metadata = { title: "Stock health" };
export const dynamic = "force-dynamic";

export default async function StockHealthPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  // The confinement gate, a client-role account gets its own client here no
  // matter what `?client=` asks for.
  const client = await resolveClient(params.clientId, clients);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const qs = params.clientId ? `?client=${params.clientId}` : "";

  const header = (
    <>
      <Header title="Stock health" />
      <PageControls client={client} params={params} />
      <RangeNote />
    </>
  );

  // Stock comes from the Shopify products snapshot only.
  if (pageAvailability(client, "/inventory") !== "available") {
    return (
      <>
        {header}
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/inventory") ?? "Shopify"} />
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

  // Past 30 days the count is too old to buy from: the reorder lines and the
  // Buying plan link go, the markdown and dead-stock lines stay. TrustBar says so.
  const buyingOff = snapshotTooOldForBuying(summary);
  const exceptions = buildExceptions(rows, client.currency, {
    includeReorder: !buyingOff,
  });

  const buckets: Array<{ label: string; value: number; tone: string; info?: string }> = [
    { label: "Healthy", value: summary.valueHealthy, tone: "text-growth-700" },
    {
      label: "At risk",
      value: summary.valueAtRisk,
      tone: "text-negative-text",
      info: `Under ${COVER_AT_RISK_DAYS} days of cover.`,
    },
    {
      label: "Overstocked",
      value: summary.valueOverstocked,
      tone: "text-content-strong",
      info: `Over ${COVER_OVERSTOCK_DAYS} days of cover.`,
    },
    {
      label: "Dead",
      value: summary.valueDead,
      tone: "text-content-strong",
      info: "Nothing sold in the 90 days to the count.",
    },
  ];

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <TrustBar summary={summary} />

        {/* ── The one number ──────────────────────────────────────────────── */}
        <section className="flex flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[26px]">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>Cash in stock</Eyebrow>
            <span className="font-mono text-[34px] font-semibold leading-none tracking-heading tabular text-content-strong">
              {money(summary.stockValueAtCost)}
            </span>
            <span className="text-[12.5px] text-content-muted">
              across {formatNumber(summary.skuCount)} SKUs
            </span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 border-t border-hairline pt-4">
            {buckets.map((b) => (
              <div key={b.label} className="flex flex-col gap-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  {b.label}
                  {b.info && (
                    <>
                      {" "}
                      <InfoTip text={b.info} />
                    </>
                  )}
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

        </section>

        {/* ── The ranked action list ──────────────────────────────────────── */}
        <section className="flex flex-col rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>What to do</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Top {exceptions.length} by value at risk
            </span>
          </div>

          {exceptions.length === 0 ? (
            <div className="px-5 py-6 text-[13px] text-content-body">
              Nothing outside thresholds.
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

          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline px-5 py-3.5 text-[12px]">
            <AppLink
              href={`/inventory/catalogue${qs}`}
              className="font-semibold text-content-body underline underline-offset-2"
            >
              Full catalogue
            </AppLink>
            {!buyingOff && (
              <AppLink
                href={`/inventory/buying${qs}`}
                className="font-semibold text-content-body underline underline-offset-2"
              >
                Buying plan
              </AppLink>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
