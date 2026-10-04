/**
 * Email: campaign and flow performance.
 *
 * Ordered by revenue rather than open rate on purpose. Open rates are flat
 * across sends while revenue varies widely, so open rate has no discriminating
 * power and giving it the lead position would mislead.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getEmailSummary, getFlows } from "@/lib/queries/email";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData, Value } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/ui/DataTable";
import { NO_VALUE, plainDashes } from "@/lib/format";
import { EmptyNote } from "@/components/ui/PageNotes";

export const metadata: Metadata = { title: "Email" };
export const dynamic = "force-dynamic";

export default async function EmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);
  if (pageAvailability(client, "/email") !== "available") {
    return (
      <>
        <Header title="Email" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/email") ?? "Email"} />
        </main>
      </>
    );
  }

  const [summary, flows] = await Promise.all([
    getEmailSummary(client.clientId, params.range, 30, client.emailPlatform),
    // The daily flow series is Klaviyo only.
    client.emailPlatform === "ecomail"
      ? null
      : getFlows(client.clientId, client.currency, params.range),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);
  // Per-send amounts are unit costs: 2 decimals below 100.
  const unitMoney = (v: number | null) =>
    formatMoney(v, client.currency, { unit: true });

  const header = (
    <>
      <Header title="Email" />
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

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          {[
            { label: "Campaign revenue", value: money(summary.totalRevenue), accent: true },
            { label: "Emails sent", value: formatNumber(summary.totalSent) },
            { label: "Revenue / recipient", value: unitMoney(summary.revenuePerRecipient) },
            { label: "Open rate", value: formatPercent(summary.avgOpenRate) },
            {
              label: "Click rate",
              value: formatPercent(summary.avgClickRate, { decimals: 2 }),
              info: "Unique clicks divided by delivered, not click-to-open, so it reads lower than most email platforms show. Period rates are recomputed from sums.",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
            >
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                {s.label}
                {s.info && <InfoTip text={s.info} />}
              </span>
              <span
                className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${
                  s.accent ? "text-growth-700" : "text-content-strong"
                }`}
              >
                <Value>{s.value}</Value>
              </span>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Campaigns</Eyebrow>
            {(summary.campaignCount ?? summary.campaigns.length) >
              summary.campaigns.length && (
              <span className="text-[12px] text-content-muted">
                Top {summary.campaigns.length} by revenue
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <DataTable
                gridClass="grid grid-cols-[2.4fr_0.8fr_0.8fr_0.7fr_0.7fr_0.7fr_1fr_1fr] items-center gap-2"
                columns={[
                  { key: "campaign", label: "Campaign" },
                  { key: "sent", label: "Sent" },
                  { key: "recipients", label: "Recipients", align: "right" },
                  { key: "open", label: "Open", align: "right" },
                  { key: "click", label: "Click", align: "right" },
                  { key: "orders", label: "Orders", align: "right" },
                  { key: "revenue", label: "Revenue", align: "right" },
                  { key: "rpr", label: "Rev / recipient", align: "right" },
                ]}
                rows={summary.campaigns.map((c, i) => ({
                  key: `${c.campaignName}-${i}`,
                  sort: [
                    c.campaignName,
                    c.sendDate,
                    c.sent,
                    c.openRate,
                    c.clickRate,
                    c.uniqueOrders,
                    c.revenue,
                    c.revenuePerRecipient,
                  ],
                  cells: [
                    <span
                      className="block truncate text-[13px] text-content-strong"
                      title={plainDashes(c.campaignName)}
                    >
                      {plainDashes(c.campaignName)}
                    </span>,
                    <span className="font-mono text-[12px] tabular text-content-muted">
                      <Value>{c.sendDate ?? NO_VALUE}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-body">
                      <Value>{formatNumber(c.sent)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      <Value>{formatPercent(c.openRate, { decimals: 0 })}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      <Value>{formatPercent(c.clickRate, { decimals: 2 })}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      <Value>{formatNumber(c.uniqueOrders)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                      <Value>{money(c.revenue)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-growth-700">
                      <Value>{unitMoney(c.revenuePerRecipient)}</Value>
                    </span>,
                  ],
                }))}
              />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4 overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex flex-col gap-4 px-5 pt-5">
            <Eyebrow>
              Flows
              <InfoTip text="Rates are weighted by sends, never a mean of per-flow rates. Rev / email is what one more send of that flow has been worth." />
            </Eyebrow>

            {flows && flows.coverage.covered && flows.flows.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
                {[
                  { label: "Flow revenue", value: money(flows.totalRevenue), accent: true },
                  { label: "Conversions", value: formatNumber(flows.totalConversions) },
                  { label: "Emails sent", value: formatNumber(flows.totalEmails) },
                  { label: "Open rate", value: formatPercent(flows.openRate) },
                  { label: "Click rate", value: formatPercent(flows.clickRate) },
                ].map((k) => (
                  <div key={k.label} className="flex flex-col gap-[7px]">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      {k.label}
                    </span>
                    <span
                      className={`font-mono text-[20px] font-semibold leading-none tracking-heading tabular ${
                        k.accent ? "text-growth-700" : "text-content-strong"
                      }`}
                    >
                      <Value>{k.value}</Value>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pb-5">
                {client.emailPlatform === "ecomail" ? (
                  <EmptyNote>Flows are not available for Ecomail.</EmptyNote>
                ) : (
                  <NoData />
                )}
              </div>
            )}
          </div>

          {flows && flows.coverage.covered && flows.flows.length > 0 && (
            <div className="overflow-x-auto">
              <div className="min-w-[880px]">
                <DataTable
                  gridClass="grid grid-cols-[2.2fr_0.8fr_0.9fr_0.8fr_0.8fr_0.8fr_1fr_0.9fr] items-center gap-2"
                  columns={[
                    { key: "flow", label: "Flow" },
                    { key: "status", label: "Status" },
                    { key: "sent", label: "Sent", align: "right" },
                    { key: "open", label: "Open", align: "right" },
                    { key: "click", label: "Click", align: "right" },
                    { key: "cvr", label: "CVR", align: "right" },
                    { key: "revenue", label: "Revenue", align: "right" },
                    { key: "rpe", label: "Rev / email", align: "right" },
                  ]}
                  rows={flows.flows.map((f) => ({
                    key: f.flowId,
                    sort: [
                      f.flowName,
                      f.status,
                      f.emailsSent,
                      f.openRate,
                      f.clickRate,
                      f.conversionRate,
                      f.revenue,
                      f.revenuePerEmail,
                    ],
                    cells: [
                      <span
                        className="block truncate text-[13px] text-content-strong"
                        title={plainDashes(f.flowName)}
                      >
                        {plainDashes(f.flowName)}
                      </span>,
                      <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-content-muted">
                        <Value>{f.status ?? NO_VALUE}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        <Value>{formatNumber(f.emailsSent)}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        <Value>{formatPercent(f.openRate, { decimals: 1 })}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        <Value>{formatPercent(f.clickRate, { decimals: 1 })}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        <Value>{formatPercent(f.conversionRate, { decimals: 2 })}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                        <Value>{money(f.revenue)}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-growth-700">
                        <Value>{unitMoney(f.revenuePerEmail)}</Value>
                      </span>,
                    ],
                  }))}
                />
              </div>
            </div>
          )}
        </section>

      </main>
    </>
  );
}
