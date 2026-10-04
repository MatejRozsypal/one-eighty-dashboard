/**
 * Paid > Overview: shop-first and blended.
 *
 * The question is "is paid working for the shop?", so the hero is shop truth
 * set against paid spend (spend, new-customer revenue, aMER, nCAC) and the
 * platforms appear below as what each one claims. All shop-first figures come
 * from one daily read of the warehouse and are derived here, so a number shown
 * twice is the same sum both times. The platform tabs hold the detail.
 *
 * Compare and the currency toggle are honoured on this tab only (the platform
 * tabs report in the ad account's own currency).
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import {
  parseViewParams,
  viewQuery,
  comparisonLabel,
  type SearchParams,
} from "@/lib/params";
import { ROLLUP_CURRENCY, type DisplayCurrency } from "@/lib/currency";
import { formatMoney, formatNumber, formatRatio } from "@/lib/format";
import { optional } from "@/lib/queries/errors";
import {
  getCampaignsAcross,
  getGa4PlatformTotals,
  getPaidDaily,
} from "@/lib/queries/paidOverview";
import { bucketGrain, ratio, sumOf } from "@/lib/paid/math";
import { tabHref } from "@/lib/paid/links";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { PaidTile } from "@/components/paid/overview/PaidTile";
import { Section } from "@/components/paid/overview/Section";
import { SpendEfficiencyChart } from "@/components/paid/overview/SpendEfficiencyChart";
import { PlatformTable } from "@/components/paid/overview/PlatformTable";
import { SpendMix } from "@/components/paid/overview/SpendMix";
import { CampaignsAcross } from "@/components/paid/overview/CampaignsAcross";
import { PeriodTable } from "@/components/paid/overview/PeriodTable";
import {
  bucketize,
  chartPoints,
  dailySeries,
  deltaOf,
  efficiency,
  rowsIn,
  spendMix,
  sumDays,
  topCampaigns,
  type CampaignAgg,
} from "@/components/paid/overview/model";

export const metadata: Metadata = { title: "Paid" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

const CAMPAIGN_ROWS = 15;

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

  const { meta: hasMeta, googleAds: hasGoogle, ga4: hasGa4 } = client.capabilities;
  const display: DisplayCurrency =
    params.displayCurrency === ROLLUP_CURRENCY ? ROLLUP_CURRENCY : "native";
  const currency = display === "native" ? client.currency : display;
  const { period } = params;
  const comparing = period.comparison !== null;

  // One daily read feeds everything shop-first. The campaign marts are small
  // and read once for both the campaign table and the spend mix. GA4 is read
  // only for a client that has it, and only to fill two optional columns.
  const [daily, campaigns, ga4] = await Promise.all([
    getPaidDaily(client.clientId, period, display, client.currency),
    optional(
      () => getCampaignsAcross(client.clientId, period, display, { meta: hasMeta, google: hasGoogle }),
      [] as CampaignAgg[]
    ),
    hasGa4 ? getGa4PlatformTotals(client.clientId, params.range, display) : Promise.resolve(null),
  ]);

  const controls = <PageControls client={client} params={params} compare currency />;

  const curDays = rowsIn(daily.days, period.current);
  const hasRows = curDays.some(
    (d) => d.revenue !== null || d.paidSpend !== null || d.orders !== null
  );
  if (!hasRows) {
    return (
      <>
        <Header title="Paid" />
        {controls}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const prevDays = period.comparison ? rowsIn(daily.days, period.comparison) : [];
  const cur = sumDays(curDays);
  const prev = sumDays(prevDays);
  const eff = efficiency(cur);
  const prevEff = efficiency(prev);

  const metaMissing = hasGoogle && !hasMeta;
  const badge = metaMissing ? "Meta not connected" : undefined;
  const compareLabel = comparisonLabel(params);
  const delta = (c: number | null, p: number | null) => deltaOf(c, p, comparing);

  const sources = [client.shopPlatform ?? "Shop", hasMeta ? "Meta" : null, hasGoogle ? "Google Ads" : null]
    .filter(Boolean)
    .join(", ");

  const money = (v: number | null) => formatMoney(v, currency);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });

  // Per-day trend lines. A day's ratio is that day's own sums, only for the
  // line; every figure above is a ratio of range sums.
  const spendLine = dailySeries(curDays, (d) => (d.metaGap || d.googleGap ? null : d.paidSpend));
  const ncRevLine = dailySeries(curDays, (d) => d.newCustomerRevenue);
  const amerLine = dailySeries(curDays, (d) =>
    d.metaGap || d.googleGap ? null : ratio(d.newCustomerRevenue, d.paidSpend)
  );
  const ncacLine = dailySeries(curDays, (d) =>
    d.metaGap || d.googleGap ? null : ratio(d.paidSpend, d.newCustomerOrders)
  );

  // Chart and period table share one grain and one set of buckets.
  const grain = bucketGrain(period.current);
  const curBuckets = bucketize(daily.days, period.current, grain);
  const prevBuckets = period.comparison ? bucketize(daily.days, period.comparison, grain) : null;
  const points = chartPoints(curBuckets, prevBuckets, grain);

  // Campaigns and spend mix, from the same rows.
  const topRows = topCampaigns(campaigns, CAMPAIGN_ROWS);
  const campaignSpend = sumOf(campaigns, (c) => c.spend);
  const metaMix = spendMix(campaigns, "meta");
  const googleMix = spendMix(campaigns, "google");

  const baseQuery = viewQuery({ ...params, clientId: client.clientId });
  const withParam = (key: string, value: string) => {
    const q = new URLSearchParams(baseQuery);
    q.set(key, value);
    return q;
  };

  return (
    <>
      <Header title="Paid" />
      {controls}

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {display === "native" && daily.excluded.length > 0 && (
          <Notice tone="warning">
            {daily.excluded
              .map((e) => `${formatNumber(e.orders)} ${e.currency} orders`)
              .join(", ")}{" "}
            excluded from totals.
          </Notice>
        )}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <PaidTile
            label="Paid spend"
            value={money(cur.paidSpend)}
            delta={delta(cur.paidSpend, prev.paidSpend)}
            goodWhen="neutral"
            comparisonLabel={compareLabel}
            series={spendLine}
            sparkTone="muted"
            sources={sources}
          />
          <PaidTile
            label="New-customer revenue"
            value={money(cur.newCustomerRevenue)}
            delta={delta(cur.newCustomerRevenue, prev.newCustomerRevenue)}
            comparisonLabel={compareLabel}
            series={ncRevLine}
            sources={sources}
          />
          <PaidTile
            label="aMER"
            value={formatRatio(eff.amer)}
            delta={delta(eff.amer, prevEff.amer)}
            comparisonLabel={compareLabel}
            series={amerLine}
            badge={badge}
            sources={sources}
          />
          <PaidTile
            label="nCAC"
            value={unit(eff.ncac)}
            delta={delta(eff.ncac, prevEff.ncac)}
            goodWhen="down"
            comparisonLabel={compareLabel}
            series={ncacLine}
            sparkTone="muted"
            badge={badge}
            sources={sources}
          />
        </section>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <PaidTile
            compact
            label="MER"
            value={formatRatio(eff.mer)}
            delta={delta(eff.mer, prevEff.mer)}
            comparisonLabel={compareLabel}
            badge={badge}
          />
          <PaidTile
            compact
            label="CAC (blended)"
            value={unit(eff.cac)}
            delta={delta(eff.cac, prevEff.cac)}
            goodWhen="down"
            comparisonLabel={compareLabel}
            badge={badge}
          />
          <PaidTile
            compact
            label="Revenue"
            value={money(cur.revenue)}
            delta={delta(cur.revenue, prev.revenue)}
            comparisonLabel={compareLabel}
          />
          <PaidTile
            compact
            label="New customers"
            value={formatNumber(cur.newCustomerOrders)}
            delta={delta(cur.newCustomerOrders, prev.newCustomerOrders)}
            comparisonLabel={compareLabel}
          />
        </section>

        <Section title="Spend and efficiency">
          <SpendEfficiencyChart
            points={points}
            currency={currency}
            showMeta={hasMeta}
            showGoogle={hasGoogle}
            comparing={comparing}
          />
        </Section>

        <Section
          title="By platform"
          flush
          info="Meta and Google rows are what each platform reports. The shop total row is all sources."
        >
          <PlatformTable
            sums={cur}
            currency={currency}
            hasMeta={hasMeta}
            hasGoogle={hasGoogle}
            ga4={ga4}
          />
        </Section>

        <Section
          title="Spend mix"
          info="Meta splits by the funnel stage in the campaign name, so unnamed stages show as unclassified. Google splits by brand class."
        >
          <SpendMix
            meta={metaMix}
            google={googleMix}
            hasMeta={hasMeta}
            hasGoogle={hasGoogle}
            currency={currency}
            metaHref={(stage) => tabHref("meta", withParam("stage", stage))}
            googleHref={(cls) => tabHref("google", withParam("class", cls))}
          />
        </Section>

        <Section title="Campaigns" flush>
          {topRows.length === 0 ? (
            <div className="px-5 pb-5">
              <NoData />
            </div>
          ) : (
            <CampaignsAcross
              rows={topRows}
              totalSpend={campaignSpend}
              currency={currency}
              comparing={comparing}
              hrefFor={(c) => tabHref(c.platform, withParam("campaign", c.id))}
            />
          )}
        </Section>

        <Section title="Period" flush>
          <PeriodTable
            buckets={curBuckets}
            grain={grain}
            currency={currency}
            hasMeta={hasMeta}
            hasGoogle={hasGoogle}
          />
        </Section>
      </main>
    </>
  );
}
