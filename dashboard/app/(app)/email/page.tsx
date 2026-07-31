/**
 * Email — campaign performance.
 *
 * Ordered by revenue rather than open rate on purpose. On this data open rates
 * are flat across every send while revenue varies by 2×, so open rate has no
 * discriminating power and giving it the lead position would mislead.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getEmailSummary, getFlows } from "@/lib/queries/email";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { pageEyebrow } from "@/lib/nav";

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
  const [summary, flows] = await Promise.all([
    getEmailSummary(client.clientId, params.range, 30),
    getFlows(client.clientId, client.currency),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const esp = client.emailPlatform
    ? client.emailPlatform[0].toUpperCase() + client.emailPlatform.slice(1)
    : "Email";

  const header = (
    <>
      <Header
        eyebrow={pageEyebrow("/email", client.name)}
        title="Email"
      />

      <PageControls client={client} params={params} />
    </>
  );

  if (!summary) {
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
              No campaigns sent in this range.
            </span>
            <span className="text-[13px] leading-[1.6] text-content-body">
              {client.emailPlatform === "ecomail"
                ? "Ecomail campaigns land in the warehouse but have no per-message mart view yet — only Klaviyo does."
                : `No ${esp} sends between ${params.range.from} and ${params.range.to}. Widen the range.`}
            </span>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {header}
      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
          {[
            { label: "Campaign revenue", value: money(summary.totalRevenue), accent: true },
            { label: "Emails sent", value: formatNumber(summary.totalSent) },
            {
              label: "Revenue / recipient",
              value: money(summary.revenuePerRecipient),
              note: "the metric that separates sends",
            },
            {
              label: "Open rate",
              value:
                summary.avgOpenRate !== null
                  ? formatPercent(summary.avgOpenRate)
                  : "—",
            },
            {
              label: "Click rate",
              value:
                summary.avgClickRate !== null
                  ? formatPercent(summary.avgClickRate, { decimals: 2 })
                  : "—",
              note: "÷ delivered, not CTOR",
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
              {s.note && (
                <span className="text-[11.5px] leading-[1.4] text-gray-300">
                  {s.note}
                </span>
              )}
            </div>
          ))}
        </section>

        <div className="flex items-start gap-3 rounded-card border border-hairline bg-gray-50 p-[14px_18px]">
          <span aria-hidden="true" className="mt-0.5 text-[13px] text-content-muted">
            ⓘ
          </span>
          <span className="text-[12.5px] leading-[1.6] text-content-body">
            <b className="text-content-strong">Click rate is unique clicks ÷ delivered</b>,
            not click-to-open. It reads far lower than the number {esp} shows —
            that&apos;s the honest denominator, not a bug. Rates across the period
            are recomputed from summed components, so a 400-recipient send
            doesn&apos;t weigh the same as a 44,000-recipient one.
          </span>
        </div>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Campaigns · mart_email_campaign_message_perf</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Click a heading to sort
            </span>
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
                      title={c.campaignName}
                    >
                      {c.campaignName}
                    </span>,
                    <span className="font-mono text-[12px] tabular text-content-muted">
                      {c.sendDate ?? "—"}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-body">
                      {formatNumber(c.sent)}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      {c.openRate !== null
                        ? formatPercent(c.openRate, { decimals: 0 })
                        : "—"}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-muted">
                      {c.clickRate !== null
                        ? formatPercent(c.clickRate, { decimals: 2 })
                        : "—"}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      {formatNumber(c.uniqueOrders)}
                    </span>,
                    <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                      {money(c.revenue)}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-growth-700">
                      {c.revenuePerRecipient !== null
                        ? money(c.revenuePerRecipient)
                        : "—"}
                    </span>,
                  ],
                }))}
              />
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-1.5 rounded-card border border-dashed border-hairline-strong bg-paper p-[16px_18px]">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gray-400">
            Not here yet
          </span>
          <span className="text-[12.5px] leading-[1.6] text-content-muted">
            <b className="text-content-strong">List growth</b> is missing —
            blocked on a Klaviyo segment mirroring the master list, so it is
            unknown rather than zero. <b className="text-content-strong">Daily
            flow revenue</b> is also unavailable: the series exists for Dobias
            only and stops 2026-06-20, because the backfill was never wired to
            an ongoing sync. Flow totals below are cumulative instead.
          </span>
        </div>
        {flows && (
          <section className="flex flex-col gap-4 overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
            <div className="flex flex-col gap-4 px-5 pt-5">
              <div className="flex flex-col gap-[5px]">
                <Eyebrow>Flows · mart_email_flow_perf</Eyebrow>
                <span className="text-[12.5px] leading-[1.5] text-content-muted">
                  Automated flows, <b>lifetime to date</b> — not the selected
                  range. Klaviyo and Ecomail both report a flow&apos;s totals
                  since it was switched on, so there is no period to filter to.
                  {flows.snapshotDate && ` Snapshot ${flows.snapshotDate}.`}
                </span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
                {[
                  { label: "Flow revenue", value: money(flows.totalRevenue), accent: true },
                  { label: "Conversions", value: formatNumber(flows.totalConversions) },
                  { label: "Emails sent", value: formatNumber(flows.totalEmails) },
                  {
                    label: "Open rate",
                    value: flows.openRate !== null ? formatPercent(flows.openRate) : "—",
                  },
                  {
                    label: "Click rate",
                    value: flows.clickRate !== null ? formatPercent(flows.clickRate) : "—",
                  },
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
                      {k.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

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
                        title={f.flowName}
                      >
                        {f.flowName}
                      </span>,
                      <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-content-muted">
                        {f.status ?? "—"}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        {formatNumber(f.emailsSent)}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        {f.openRate !== null ? formatPercent(f.openRate, { decimals: 1 }) : "—"}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        {f.clickRate !== null ? formatPercent(f.clickRate, { decimals: 1 }) : "—"}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-body">
                        {f.conversionRate !== null
                          ? formatPercent(f.conversionRate, { decimals: 2 })
                          : "—"}
                      </span>,
                      <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                        {money(f.revenue)}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-growth-700">
                        {f.revenuePerEmail !== null ? money(f.revenuePerEmail) : "—"}
                      </span>,
                    ],
                  }))}
                />
              </div>
            </div>

            <div className="px-5 pb-4 text-[12px] leading-[1.6] text-content-muted">
              Rates are delivery-weighted across flows, never a mean of per-flow
              rates — averaging those weights a two-send flow the same as a
              forty-thousand-send one. <b>Rev / email</b> is what one more send
              of that flow has been worth, which is the column to rank by when
              deciding what to build next.
            </div>
          </section>
        )}

      </main>
    </>
  );
}
