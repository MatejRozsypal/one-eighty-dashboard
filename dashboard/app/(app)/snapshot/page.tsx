/**
 * Profitability Snapshot, the headline page.
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
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { includesToday } from "@/lib/period";
import { parseViewParams, viewQuery, comparisonLabel, type SearchParams } from "@/lib/params";
import {
  getPnlSnapshot,
  hasNoCostData,
  metric,
  paidSpendDelta as paidSpendDeltaOf,
  spendGapNotice,
} from "@/lib/queries/pnl";
import { getLifetimeSummary, getPayback } from "@/lib/queries/lifetime";
import { getClientSettings } from "@/lib/users/settings";
import { getDiscounts, getExcludedCurrencies } from "@/lib/queries/context";
import { ROLLUP_CURRENCY, formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { safeDiv } from "@/lib/coerce";
import { optional } from "@/lib/queries/errors";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { NotConnected } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { MetricCard, type MetricState } from "@/components/dashboard/MetricCard";
import { MarginStack } from "@/components/dashboard/MarginStack";
import { AcquisitionEconomics } from "@/components/dashboard/AcquisitionEconomics";
import { RevenueMix } from "@/components/dashboard/RevenueMix";
import { RevenueComposition } from "@/components/dashboard/RevenueComposition";
import { BottomLine } from "@/components/dashboard/BottomLine";

export const metadata: Metadata = { title: "Snapshot" };

/** "Apr 20, 2026" from an ISO date. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

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

  if (pageAvailability(client, "/snapshot") !== "available") {
    return (
      <>
        <Header title="Snapshot" />
        <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/snapshot") ?? "Shop"} />
        </main>
      </>
    );
  }

  const display =
    params.displayCurrency === ROLLUP_CURRENCY ? ROLLUP_CURRENCY : "native";

  // Settings are fetched first, not alongside: the P&L needs the stated
  // per-order rates to build CM1 and CM2 at all. The warehouse pins both cost
  // steps to zero, so without these the margin stack silently reports a
  // business with no fulfilment cost.
  const settings = await optional(() => getClientSettings(client.clientId), null);
  const costs = {
    fulfilmentPerOrder: settings?.fulfilmentPerOrder ?? null,
    otherCm1PerOrder: settings?.otherCm1PerOrder ?? null,
  };

  const [snapshot, lifetime, payback, nativeDiscounts, excluded] =
    await Promise.all([
      getPnlSnapshot(
        client.clientId,
        client.currency,
        params.period,
        display,
        costs,
        client.capabilities.meta || client.capabilities.googleAds
      ),
      optional(() => getLifetimeSummary(client.clientId, client.currency), null),
      optional(() => getPayback(client.clientId, client.currency), null),
      getDiscounts(client.clientId, params.range),
      optional(
        () => getExcludedCurrencies(client.clientId, client.currency, params.range),
        []
      ),
    ]);

  const t = snapshot.current;
  const currency = snapshot.currency;
  const compareLabel = comparisonLabel(params);
  const hasComparison = snapshot.previous !== null;
  const qs = viewQuery({ ...params, clientId: client.clientId });

  // Discounts are a native-currency figure. Next to a converted P&L it would be
  // mislabelled, so the row says which currency it exists in ("USD only").
  // Lifetime and payback are formatted in the native currency by BottomLine.
  const discounts = display === "native" ? nativeDiscounts : null;

  const shopSource = client.shopPlatform ?? "Shop";
  const { meta, googleAds } = client.capabilities;
  const paidSource = meta && googleAds ? "Meta + Google" : googleAds ? "Google" : meta ? "Meta" : "Warehouse";

  // Cost-dependent figures say "No cost data" when revenue exists without COGS.
  const noCost = hasNoCostData(t);
  const costState: MetricState = noCost
    ? { kind: "no-data", reason: "No cost data" }
    : { kind: "ok" };

  const newShare = safeDiv(t.newCustomerRevenue, t.revenue);

  // Leading spend gap: the ratios over spend are withheld, and one line says
  // where spend starts (in the current range, whatever the compare toggle is).
  // A paid spend delta against a period that only partly had spend would be a
  // fiction too, so the tile and the margin stack share one rule.
  const gapNotice = spendGapNotice(snapshot);
  const paidSpendDelta = paidSpendDeltaOf(snapshot);

  return (
    <>
      <Header title="Snapshot" />

      <PageControls client={client} params={params} compare currency />

      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-6 lg:px-8">
        {excluded.length > 0 && display === "native" && (
          <Notice tone="warning">
            {excluded
              .map((e) => `${formatNumber(e.orders)} ${e.currency} orders`)
              .join(", ")}{" "}
            excluded from totals.
          </Notice>
        )}

        {googleAds && !meta && <Notice>Paid spend is Google only.</Notice>}

        {gapNotice && (
          <Notice>
            {gapNotice.scope === "comparison" ? "Comparison ad spend from" : "Ad spend from"}{" "}
            {formatDay(gapNotice.from)}.
          </Notice>
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
            state={costState}
          />
          <MetricCard
            label="CM3 %"
            value={formatPercent(t.cm3Pct)}
            delta={hasComparison ? metric(snapshot, (x) => x.cm3Pct).delta : undefined}
            goodWhen="up"
            comparisonLabel={compareLabel}
            source="Warehouse"
            series={snapshot.series.map((d) =>
              d.revenue && d.cm3 !== null ? d.cm3 / d.revenue : null
            )}
            sparkTone="muted"
            state={costState}
          />
          <MetricCard
            label="Paid spend"
            value={formatMoney(t.paidSpend, currency)}
            delta={hasComparison ? paidSpendDelta : undefined}
            // Spend rising is neither good nor bad on its own. It depends
            // entirely on what it bought. Colouring it would assert a judgement
            // the number doesn't support.
            goodWhen="neutral"
            comparisonLabel={compareLabel}
            source={paidSource}
            series={snapshot.series.map((d) => d.paidSpend)}
            sparkTone="muted"
          />
        </section>

        <AcquisitionEconomics
          snapshot={snapshot}
          comparisonLabel={compareLabel}
          shopPlatform={shopSource}
        />

        <RevenueMix
          series={snapshot.series}
          range={params.range}
          partialLast={includesToday(params.range)}
          newShare={newShare}
        />

        <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <RevenueComposition
            totals={t}
            currency={currency}
            discounts={discounts}
            discountsNativeOnly={display === "native" ? null : client.currency}
          />
          <BottomLine
            payback={payback}
            opexRate={settings?.opexRate ?? null}
            totals={t}
            currency={currency}
            lifetime={lifetime}
            lifetimeCurrency={client.currency}
            customersHref={`/customers?${qs}`}
          />
        </section>

        {/*
          Last on the page on purpose. The stack explains how revenue becomes
          CM3, which is worth having but is reference material: you read it
          once to understand the model, not every time you open the page.
        */}
        <MarginStack snapshot={snapshot} />
      </main>
    </>
  );
}
