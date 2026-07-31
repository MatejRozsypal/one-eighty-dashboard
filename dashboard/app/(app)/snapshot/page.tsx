/**
 * Profitability Snapshot — the headline page.
 *
 * Answers one question: is this client actually making money, and is that
 * getting better or worse? Everything else in the product is a drill-down from
 * here.
 *
 * All queries run in parallel; each is scoped so a failure in a secondary panel
 * (lifetime economics, discounts) can't take down the P&L.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, viewQuery, comparisonLabel, type SearchParams } from "@/lib/params";
import { getPnlSnapshot, metric } from "@/lib/queries/pnl";
import { getLifetimeSummary } from "@/lib/queries/lifetime";
import { getDiscounts, getExcludedCurrencies } from "@/lib/queries/context";
import { getConversionCoverage, ROLLUP_CURRENCY, formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { optional } from "@/lib/queries/errors";
import { Header } from "@/components/shell/Header";
import { ControlBar } from "@/components/controls/ControlBar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { MarginStack } from "@/components/dashboard/MarginStack";
import { AcquisitionEconomics } from "@/components/dashboard/AcquisitionEconomics";
import { RevenueMix } from "@/components/dashboard/RevenueMix";
import { ChannelSplit } from "@/components/dashboard/ChannelSplit";
import { RevenueComposition } from "@/components/dashboard/RevenueComposition";
import { BottomLine } from "@/components/dashboard/BottomLine";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Snapshot" };

// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

export default async function SnapshotPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const display =
    params.displayCurrency === ROLLUP_CURRENCY ? ROLLUP_CURRENCY : "native";

  const [snapshot, lifetime, discounts, excluded, coverage] =
    await Promise.all([
      getPnlSnapshot(client.clientId, client.currency, params.period, display),
      optional(() => getLifetimeSummary(client.clientId, client.currency), null),
      getDiscounts(client.clientId, params.range),
      optional(
        () => getExcludedCurrencies(client.clientId, client.currency, params.range),
        []
      ),
      client.currency === ROLLUP_CURRENCY
        ? Promise.resolve(null)
        : optional(
            () => getConversionCoverage(client.currency, ROLLUP_CURRENCY, params.range),
            null
          ),
    ]);

  const t = snapshot.current;
  const currency = snapshot.currency;
  const compareLabel = comparisonLabel(params);
  const hasComparison = snapshot.previous !== null;
  const qs = viewQuery({ ...params, clientId: client.clientId });

  const shopSource = client.shopPlatform ?? "Shop";
  const paidSource =
    t.googleSpend !== null && t.metaSpend !== null
      ? "Meta"
      : t.googleSpend !== null
        ? "google"
        : "meta";

  const newShare = safeDiv(t.newCustomerRevenue, t.revenue);

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/snapshot", client.name)}
        title="Snapshot"
      />

      <ControlBar
        range={params.range}
        presetKey={params.presetKey}
        comparison={params.period.comparison}
        comparisonMode={params.comparisonMode}
        nativeCurrency={client.currency}
        displayCurrency={params.displayCurrency}
        conversion={coverage}
      />

      <main className="flex max-w-[1440px] flex-col gap-6 px-5 pb-14 pt-6 lg:px-8">
        {excluded.length > 0 && display === "native" && (
          <div className="flex items-start gap-3 rounded-card border border-warning/40 bg-[#FFF9EE] p-[14px_18px]">
            <span
              aria-hidden="true"
              className="mt-1.5 h-2 w-2 flex-none rounded-full bg-warning"
            />
            <span className="flex flex-col gap-[3px]">
              <span className="text-[13.5px] font-semibold leading-[1.5] text-content-strong">
                Mixed currencies in this range —{" "}
                {excluded.map((e) => `${formatNumber(e.orders)} orders in ${e.currency}`).join(", ")}{" "}
                excluded from every total below.
              </span>
              <span className="text-[12.5px] leading-[1.5] text-content-body">
                Summing{" "}
                {excluded.map((e) => e.currency).join(" and ")} with{" "}
                {client.currency} without a rate would be meaningless. Excluded
                value:{" "}
                {excluded
                  .map((e) => formatMoney(e.revenue, e.currency))
                  .join(", ")}
                .
              </span>
            </span>
          </div>
        )}

        <section className="grid grid-cols-[repeat(auto-fit,minmax(252px,1fr))] gap-4">
          <MetricCard
            label="Revenue"
            value={formatMoney(t.revenue, currency)}
            delta={hasComparison ? metric(snapshot, (x) => x.revenue).delta : undefined}
            goodWhen="up"
            comparisonLabel={compareLabel}
            source={shopSource}
            series={snapshot.series.map((d) => d.revenue)}
          />
          <MetricCard
            label="CM3"
            value={formatMoney(t.cm3, currency)}
            delta={hasComparison ? metric(snapshot, (x) => x.cm3).delta : undefined}
            goodWhen="up"
            comparisonLabel={compareLabel}
            source="Warehouse"
            series={snapshot.series.map((d) => d.cm3)}
          />
          <MetricCard
            label="CM3 %"
            value={t.cm3Pct !== null ? formatPercent(t.cm3Pct) : null}
            delta={hasComparison ? metric(snapshot, (x) => x.cm3Pct).delta : undefined}
            goodWhen="up"
            comparisonLabel={compareLabel}
            source="Warehouse"
            series={snapshot.series.map((d) =>
              d.revenue && d.cm3 !== null ? d.cm3 / d.revenue : null
            )}
            sparkTone="muted"
          />
          <MetricCard
            label="Paid spend"
            value={formatMoney(t.paidSpend, currency)}
            delta={hasComparison ? metric(snapshot, (x) => x.paidSpend).delta : undefined}
            // Spend rising is neither good nor bad on its own — it depends
            // entirely on what it bought. Colouring it would assert a judgement
            // the number doesn't support.
            goodWhen="neutral"
            comparisonLabel={compareLabel}
            source={paidSource}
            series={snapshot.series.map((d) => d.paidSpend)}
            sparkTone="muted"
          />
        </section>

        <MarginStack snapshot={snapshot} />

        <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <AcquisitionEconomics snapshot={snapshot} />
            <RevenueMix series={snapshot.series} newShare={newShare} />
          </div>
          <ChannelSplit snapshot={snapshot} client={client} />
        </section>

        <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <RevenueComposition
            totals={t}
            currency={currency}
            shopPlatform={shopSource}
            discounts={discounts}
          />
          <BottomLine
            totals={t}
            currency={currency}
            lifetime={lifetime}
            customersHref={`/customers?${qs}`}
          />
        </section>

        <p className="m-0 max-w-[760px] text-[12px] leading-[1.6] text-content-muted">
          Figures are contribution margin after cost of goods and paid media,
          excluding fixed costs, salaries and platform fees. Meta and Google spend
          is platform-reported; revenue is shop-reported.
        </p>
      </main>
    </>
  );
}
