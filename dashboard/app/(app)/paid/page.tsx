/**
 * Paid media: the Meta funnel and ad-level performance.
 *
 * Everything here is platform-reported and labelled as such. Meta's attributed
 * revenue systematically overstates: it will claim a purchase it merely showed
 * an ad before.
 *
 * Minimum fix only (the page is redesigned separately): Meta is gated on the
 * client's capability flag, and the Meta block is one line when it is off.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getMetaTotals, getTopAds, getChannelTotals } from "@/lib/queries/paid";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData, Value } from "@/components/ui/EmptyState";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { Funnel } from "@/components/dashboard/Funnel";
import { KpiTile, type Kpi } from "@/components/dashboard/KpiTile";
import { DataTable } from "@/components/ui/DataTable";

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

  if (pageAvailability(client, "/paid") !== "available") {
    return (
      <>
        <Header title="Paid" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/paid") ?? "Ads"} />
        </main>
      </>
    );
  }

  const hasMeta = client.capabilities.meta;

  // Meta queries only run for a client that has Meta.
  const [totals, ads, channels] = await Promise.all([
    hasMeta ? getMetaTotals(client.clientId, params.range) : null,
    hasMeta ? getTopAds(client.clientId, params.range, 10) : [],
    getChannelTotals(
      client.clientId,
      params.range,
      client.capabilities.googleAds,
      hasMeta
    ),
  ]);

  // Meta is connected but reported nothing in the range.
  const hasMetaRows =
    totals !== null && (totals.impressions !== null || totals.spend !== null);

  const money = (v: number | null) => formatMoney(v, client.currency);

  // Funnel steps, top to bottom. Each is a real Meta column, no interpolation.
  const funnel = [
    { label: "Impressions", value: totals?.impressions ?? null },
    { label: "Link clicks", value: totals?.linkClicks ?? totals?.clicks ?? null },
    { label: "Landing page views", value: totals?.landingPageViews ?? null },
    { label: "Add to cart", value: totals?.addToCart ?? null },
    { label: "Initiate checkout", value: totals?.initiateCheckout ?? null },
    { label: "Purchases", value: totals?.purchases ?? null },
  ].filter((s) => s.value !== null) as Array<{ label: string; value: number }>;

  const paidRevenue = channels.reduce<number | null>(
    (acc, c) => (c.revenue === null ? acc : (acc ?? 0) + c.revenue),
    null
  );
  const paidSpend = channels.reduce<number | null>(
    (acc, c) => (c.spend === null ? acc : (acc ?? 0) + c.spend),
    null
  );
  const paidRoas =
    paidRevenue !== null && paidSpend ? paidRevenue / paidSpend : null;

  const livePlatforms = channels.filter((c) => c.connected && c.spend !== null);

  // ── Scope is part of the metric, not a footnote ────────────────────────────
  // This row used to mix two of them silently: Spend was Meta-only while
  // Revenue and ROAS covered every platform. With Google spending CZK 13,008
  // against Meta's 75,904, the tile understated paid spend by 15%, and because
  // ROAS was (correctly) computed on the combined figure, the ROAS shown could
  // not be reproduced from the two numbers next to it. A row of numbers you
  // cannot check against each other is how a dashboard quietly loses its
  // reader.
  //
  // Spend now matches Revenue and ROAS. Reach, Frequency, CTR and CPM stay
  // Meta-only because they genuinely are, Google reports no comparable reach
  // or frequency, so they carry the platform on the tile instead.
  const kpis: Kpi[] = [
    { label: "Spend", value: money(paidSpend) },
    { label: "Revenue", value: money(paidRevenue) },
    { label: "ROAS", value: formatRatio(paidRoas) },
    { label: "Reach", value: formatNumber(totals?.reach), scope: "meta" },
    {
      label: "Frequency",
      value: formatNumber(totals?.frequency, { decimals: 2 }),
      scope: "meta",
    },
    { label: "CTR", value: formatPercent(totals?.ctr, { decimals: 2 }), scope: "meta" },
    {
      label: "CPM",
      value: formatMoney(totals?.cpm, client.currency, { unit: true }),
      scope: "meta",
    },
  ];

  // ── Two rows, split on the seam that already exists ────────────────────────
  // Seven tiles in one auto-fit row left each a 130px content box, and
  // `CZK 108,357` measures 140px at 22px mono, so the two money tiles drew
  // their numbers outside their own cards. Wrapping on the scope boundary
  // rather than wherever the grid happened to run out gives the widest tiles to
  // the widest numbers, and puts the four Meta-only rates on a line of their
  // own where the platform dots read as a set instead of as four exceptions.
  //
  // The money row goes full-width on phones rather than two-up: at 390px, two
  // columns leave a 123px content box, which is the same overflow moved.
  const outcomeKpis = kpis.filter((k) => !k.scope);
  const metaKpis = kpis.filter((k) => k.scope === "meta");

  return (
    <>
      <Header title="Paid" />

      <PageControls client={client} params={params} />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {outcomeKpis.map((k) => (
              <KpiTile key={k.label} {...k} />
            ))}
          </div>
          {!hasMeta ? (
            <NotConnected source="Meta" />
          ) : !hasMetaRows ? (
            <NoData />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {metaKpis.map((k) => (
                <KpiTile key={k.label} {...k} />
              ))}
            </div>
          )}
        </section>

        {livePlatforms.length > 1 && (
          <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <div className="flex flex-col gap-[5px]">
              <Eyebrow>
                By platform
                <InfoTip text="Each platform reports conversions in its own attribution window, so revenues can claim the same order twice and do not sum to shop revenue." />
              </Eyebrow>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {livePlatforms.map((c) => {
                const roas =
                  c.revenue !== null && c.spend ? c.revenue / c.spend : null;
                return (
                  <div
                    key={c.channel}
                    className="flex flex-col gap-3 rounded-card border border-hairline p-[16px_18px]"
                  >
                    <span className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      <span
                        aria-hidden="true"
                        className={`h-[9px] w-[9px] rounded-[3px] ${
                          c.channel === "meta"
                            ? "bg-platform-meta"
                            : "bg-platform-google"
                        }`}
                      />
                      {c.channel}
                    </span>
                    <div className="flex flex-wrap gap-x-7 gap-y-2">
                      {[
                        { k: "Spend", v: money(c.spend) },
                        { k: "Revenue", v: money(c.revenue) },
                        { k: "ROAS", v: formatRatio(roas) },
                      ].map((x) => (
                        <span key={x.k} className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                            {x.k}
                          </span>
                          <span className="font-mono text-[16px] font-semibold tabular text-content-strong">
                            <Value>{x.v}</Value>
                          </span>
                        </span>
                      ))}
                    </div>
                    {c.revenue === null && (
                      <span className="text-[12px] leading-[1.5] text-content-muted">
                        No attributed revenue.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {hasMetaRows && funnel.length > 1 && (
          <section className="flex flex-col gap-[18px] rounded-card border border-hairline bg-surface-card p-[24px_20px] shadow-sm lg:p-[24px_28px]">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <Eyebrow>Meta funnel</Eyebrow>
              <span className="inline-flex items-center gap-[7px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                <span aria-hidden="true" className="h-[9px] w-[9px] rounded-[3px] bg-platform-meta" />
                Meta · platform-reported
              </span>
            </div>

            <Funnel steps={funnel} />
          </section>
        )}

        {hasMetaRows && ads.length > 0 && (
          <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
              <Eyebrow>Top ads</Eyebrow>
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
                    {
                      key: "roas",
                      label: "ROAS",
                      align: "right",
                      info: "n/a means Meta attributed no conversions to the ad. That is not a 0.00× return, so read it next to spend.",
                    },
                    { key: "reach", label: "Reach", align: "right" },
                    { key: "ctr", label: "CTR", align: "right" },
                    { key: "cpc", label: "CPC", align: "right" },
                    { key: "freq", label: "Freq.", align: "right" },
                    {
                      key: "cpa",
                      label: "CPA",
                      align: "right",
                      info: "n/a means Meta attributed no purchases to the ad.",
                    },
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
                        <Value>{money(a.spend)}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        <Value>{money(a.revenue)}</Value>
                      </span>,
                      // Null ROAS means nothing was attributed, not 0.00×.
                      <span className="font-mono text-[12.5px] tabular text-growth-700">
                        <Value>{formatRatio(a.roas)}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        <Value>{formatNumber(a.reach)}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        <Value>{formatPercent(a.ctr, { decimals: 2 })}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        <Value>{formatMoney(a.cpc, client.currency, { unit: true })}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-muted">
                        <Value>{formatNumber(a.frequency, { decimals: 2 })}</Value>
                      </span>,
                      <span className="font-mono text-[12.5px] tabular text-content-strong">
                        <Value>{formatMoney(a.cpa, client.currency, { unit: true })}</Value>
                      </span>,
                    ],
                  }))}
                />
              </div>
            </div>

          </section>
        )}
      </main>
    </>
  );
}
