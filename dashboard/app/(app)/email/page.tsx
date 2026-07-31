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
import { getEmailSummary } from "@/lib/queries/email";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
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
  const summary = await getEmailSummary(client.clientId, params.range, 30);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const esp = client.emailPlatform
    ? client.emailPlatform[0].toUpperCase() + client.emailPlatform.slice(1)
    : "Email";

  const header = (
    <Header
      eyebrow={pageEyebrow("/email", client.name)}
      title="Email"
      rangeLabel={`${params.range.from} → ${params.range.to}`}
    />
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
              Sorted by revenue
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[2.4fr_0.8fr_0.8fr_0.7fr_0.7fr_0.7fr_1fr_1fr] gap-2 border-b border-hairline bg-gray-50 px-5 py-3">
                {["Campaign", "Sent", "Recipients", "Open", "Click", "Orders", "Revenue", "Rev / recipient"].map(
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

              {summary.campaigns.map((c, i) => (
                <div
                  key={`${c.campaignName}-${i}`}
                  className="grid grid-cols-[2.4fr_0.8fr_0.8fr_0.7fr_0.7fr_0.7fr_1fr_1fr] items-center gap-2 border-b border-hairline px-5 py-3 transition-colors duration-fast hover:bg-gray-50"
                >
                  <span
                    className="truncate text-[13px] text-content-strong"
                    title={c.campaignName}
                  >
                    {c.campaignName}
                  </span>
                  <span className="font-mono text-[12px] tabular text-content-muted">
                    {c.sendDate ?? "—"}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-body">
                    {formatNumber(c.sent)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-muted">
                    {c.openRate !== null
                      ? formatPercent(c.openRate, { decimals: 0 })
                      : "—"}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-muted">
                    {c.clickRate !== null
                      ? formatPercent(c.clickRate, { decimals: 2 })
                      : "—"}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-content-strong">
                    {formatNumber(c.uniqueOrders)}
                  </span>
                  <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                    {money(c.revenue)}
                  </span>
                  <span className="font-mono text-[12.5px] tabular text-growth-700">
                    {c.revenuePerRecipient !== null
                      ? money(c.revenuePerRecipient)
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-1.5 rounded-card border border-dashed border-hairline-strong bg-paper p-[16px_18px]">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gray-400">
            Not here yet
          </span>
          <span className="text-[12.5px] leading-[1.6] text-content-muted">
            <b className="text-content-strong">Flows</b> and{" "}
            <b className="text-content-strong">list growth</b> are missing. Flow
            revenue is in the warehouse but has no page yet; subscriber growth is
            blocked on a Klaviyo segment mirroring the master list — unknown, not
            zero.
          </span>
        </div>
      </main>
    </>
  );
}
