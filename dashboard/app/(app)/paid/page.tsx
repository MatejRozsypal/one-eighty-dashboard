/**
 * Paid media — the Meta funnel and ad-level performance.
 *
 * Everything here is platform-reported and labelled as such. Meta's attributed
 * revenue systematically overstates: it will claim a purchase it merely showed
 * an ad before. Presenting it beside warehouse revenue without that label is
 * the confusion this whole warehouse exists to end.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getMetaTotals, getTopAds } from "@/lib/queries/paid";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Funnel } from "@/components/dashboard/Funnel";
import { DataTable } from "@/components/ui/DataTable";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Paid" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

export default async function PaidPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const [totals, ads] = await Promise.all([
    getMetaTotals(client.clientId, params.range),
    getTopAds(client.clientId, params.range, 10),
  ]);

  const money = (v: number | null) => formatMoney(v, client.currency);

  // Funnel steps, top to bottom. Each is a real Meta column — no interpolation.
  const funnel = [
    { label: "Impressions", value: totals.impressions },
    { label: "Link clicks", value: totals.linkClicks ?? totals.clicks },
    { label: "Landing page views", value: totals.landingPageViews },
    { label: "Add to cart", value: totals.addToCart },
    { label: "Initiate checkout", value: totals.initiateCheckout },
    { label: "Purchases", value: totals.purchases },
  ].filter((s) => s.value !== null) as Array<{ label: string; value: number }>;

  const kpis = [
    { label: "Spend", value: money(totals.spend) },
    { label: "Reach", value: formatNumber(totals.reach) },
    {
      label: "Frequency",
      value: totals.frequency !== null ? totals.frequency.toFixed(2) : "—",
    },
    { label: "CTR", value: totals.ctr !== null ? formatPercent(totals.ctr, { decimals: 2 }) : "—" },
    { label: "CPC", value: money(totals.cpc) },
    { label: "CPM", value: money(totals.cpm) },
  ];

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/paid", client.name)}
        title="Paid"
      />

      <PageControls client={client} params={params} />

      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {funnel.length > 1 ? (
          <section className="flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex flex-col gap-1.5">
                <Eyebrow>Meta funnel</Eyebrow>
                <h2 className="m-0 text-[20px] font-bold tracking-heading text-content-strong">
                  Impressions to purchases, <i className="font-medium">step by step.</i>
                </h2>
              </div>
              <span className="inline-flex items-center gap-[7px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                <span aria-hidden="true" className="h-[9px] w-[9px] rounded-[3px] bg-platform-meta" />
                Meta · platform-reported
              </span>
            </div>

            <Funnel steps={funnel} />
          </section>
        ) : (
          <div className="flex flex-col gap-3 rounded-card border border-dashed border-hairline-strong bg-paper p-[24px]">
            <span className="text-[15px] font-semibold text-content-strong">
              No Meta data in this range.
            </span>
            <span className="text-[13px] text-content-body">
              Either no campaigns ran, or Meta hasn&apos;t reported yet for these
              dates.
            </span>
          </div>
        )}

        <section className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
            >
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                {k.label}
              </span>
              <span className="font-mono text-[22px] font-semibold leading-none tracking-heading tabular text-content-strong">
                {k.value}
              </span>
            </div>
          ))}
        </section>

        <div className="flex items-start gap-3 rounded-card border border-warning/[0.38] bg-[#FFFBF4] p-[14px_18px]">
          <span aria-hidden="true" className="text-[13px] leading-[1.4] text-warning">
            ⚠
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-[13.5px] font-semibold text-content-strong">
              Rate columns are recomputed, never summed.
            </span>
            <span className="text-[12.5px] leading-[1.6] text-content-body">
              frequency_per_day, ctr_per_day, cpc_per_day and roas_per_day cannot
              be averaged across a date range — doing so is 10–30% wrong. Every
              rate on this page is derived from summed components.
            </span>
          </span>
        </div>

        {ads.length > 0 && (
          <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
              <Eyebrow>Ad-level performance · mart_meta_ad_perf</Eyebrow>
              <span className="text-[12px] text-content-muted">
                Top {ads.length} by spend
              </span>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[1000px]">
                <DataTable
                  gridClass="grid grid-cols-[2.1fr_1.2fr_0.9fr_0.9fr_0.7fr_0.9fr_0.7fr_0.7fr_0.7fr_0.8fr] items-center gap-2"
                  columns={[
                    { key: "ad", label: "Ad" },
                    { key: "campaign", label: "Campaign" },
                    { key: "spend", label: "Spend", align: "right" },
                    { key: "revenue", label: "Revenue", align: "right" },
                    { key: "roas", label: "ROAS", align: "right" },
                    { key: "reach", label: "Reach", align: "right" },
                    { key: "ctr", label: "CTR", align: "right" },
                    { key: "cpc", label: "CPC", align: "right" },
                    { key: "freq", label: "Freq.", align: "right" },
                    { key: "cpa", label: "CPA", align: "right" },
                  ]}
                  rows={ads.map((a) => ({
                    key: `${a.adName}-${a.campaignName}`,
                    sort: [
                      a.adName,
                      a.campaignName,
                      a.spend,
                      a.revenue,
                      a.roas,
                      a.reach,
                      a.ctr,
                      a.cpc,
                      a.frequency,
                      a.cpa,
                    ],
                    cells: [
                      <span className="block truncate text-[13px] text-content-strong" title={a.adName}>
                        {a.adName}
                      </span>,
                      <span
                        className="block truncate font-mono text-[11px] text-content-muted"
                        title={a.campaignName}
                      >
                        {a.campaignName}
                      </span>,
                      <span className="font-mono text-[12.5px] font-semibold tabular text-content-strong">
                        {money(a.spend)}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        {money(a.revenue)}
                      </span>,
                      // Null ROAS means nothing was attributed — not 0.00×.
                      <span
                        className={`font-mono text-[12.5px] tabular ${
                          a.roas === null ? "text-gray-250" : "text-growth-700"
                        }`}
                        title={a.roas === null ? "No conversions attributed" : undefined}
                      >
                        {formatRatio(a.roas)}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        {formatNumber(a.reach)}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        {a.ctr !== null ? formatPercent(a.ctr, { decimals: 2 }) : "—"}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        {money(a.cpc)}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-muted">
                        {a.frequency !== null ? a.frequency.toFixed(2) : "—"}
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        {money(a.cpa)}
                      </span>,
                    ],
                  }))}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
              A dash in ROAS or CPA means Meta attributed no conversions to that
              ad — the money was spent and nothing came back measured. That is not
              the same as a 0.00× return, and sorting by ROAS will rank a
              rounding-error campaign above a real one, so read spend alongside it.
            </div>
          </section>
        )}
      </main>
    </>
  );
}
