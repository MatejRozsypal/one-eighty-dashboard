/**
 * Markets, Trends & analysis: the deeper reads the Overview leaves out.
 *
 *   1. Portfolio        nCAC against GP per customer, LTGP:CAC diagonals
 *   2. Weekly trends    revenue, new customers, nCAC, MER, GP after ads by market
 *   3. What changed     GP after ads vs Compare, by market and by driver
 *   4. Spend response   weekly spend vs new customers, fitted curve, calculator
 *   5. Funnel           GA4 sessions to purchase, indexed to the home market
 *   6. Order value      order value bins vs the inferred free-shipping threshold
 *
 * Every read starts at once and each widget streams behind its own skeleton.
 * Portfolio and the bridge read the Overview's own query and model
 * (getMarkets, buildModel), so the two pages can never disagree on a period
 * figure; the weekly, GA4 and order-value reads are lib/queries/marketsTrends.
 *
 * Shared by the route and the dev harness (app/dev/markets-trends).
 */

import { Suspense } from "react";
import type { Client } from "@/lib/clients";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { parseViewParams, comparisonLabel, rangeLabel, type SearchParams } from "@/lib/params";
import { Header } from "@/components/shell/Header";
import { PageControls } from "@/components/controls/PageControls";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import { EmptyNote } from "@/components/ui/PageNotes";
import { InfoTip } from "@/components/ui/InfoTip";
import { SkeletonChart, SkeletonTable } from "@/components/ui/Skeleton";
import { NO_VALUE } from "@/lib/format";
import { isDemo } from "@/lib/demo/client";
import { DEMO_REGIONS, parseDemoRegion, type DemoRegion } from "@/lib/demo/markets";
import { getMarkets } from "@/lib/queries/markets";
import { getGa4Funnel, getOrderBins, getResponseWeeks, getTrendWeeks } from "@/lib/queries/marketsTrends";
import { buildModel, gapReason, isNa, sumSums, type MarketsModel } from "@/lib/markets/model";
import { MARKET_OTHER, MARKET_UNALLOCATED, type MarketPeriodRaw, type MarketsRaw } from "@/lib/markets/types";
import {
  bridge,
  funnelRows,
  histogram,
  marketColors,
  portfolioPoints,
  responseByMarket,
  weeklyTrends,
  type Ga4Raw,
  type OrderBinsRaw,
  type ResponseRaw,
  type TrendsRaw,
} from "@/lib/markets/analysis";
import { TrendCard } from "@/components/markets/trends/bits";
import { PortfolioChart } from "@/components/markets/trends/PortfolioChart";
import { TrendCharts } from "@/components/markets/trends/TrendCharts";
import { BridgeView } from "@/components/markets/trends/BridgeView";
import { ResponseView, type ResponseMarket } from "@/components/markets/trends/ResponseView";
import { FunnelTable } from "@/components/markets/trends/FunnelTable";
import { AovView } from "@/components/markets/trends/AovView";

/** Same default as the Overview: a quarter. */
const DEFAULT_PRESET = "90d";

type Range = { from: string; to: string };

interface Base {
  raw: MarketsRaw;
  model: MarketsModel;
  /** Sold markets in the Overview's order, then Other when it has orders. */
  keys: string[];
  sold: string[];
  colors: Record<string, string>;
}

type BaseResult = Base | { empty: "not-built" | "no-data" };

async function loadBase(rawP: Promise<MarketsRaw | null>): Promise<BaseResult> {
  const raw = await rawP;
  if (!raw) return { empty: "not-built" };
  if (raw.current.every((r) => r.sums.orders === 0)) return { empty: "no-data" };
  const model = buildModel(raw);
  const sold = model.markets.filter((m) => m.kind === "sold").map((m) => m.key);
  const keys = model.markets.filter((m) => m.kind === "sold" || m.kind === "other").map((m) => m.key);
  return { raw, model, keys, sold, colors: marketColors(keys, model.homeMarket) };
}

function Empty({ base }: { base: { empty: "not-built" | "no-data" } }) {
  return base.empty === "not-built" ? <EmptyNote>Markets data is not built for this client yet.</EmptyNote> : <NoData />;
}

function NaLine({ text, reason }: { text: string; reason: string }) {
  return (
    <p className="m-0 inline-flex items-center gap-1.5 text-[13px] text-content-muted">
      {text} {NO_VALUE}
      <InfoTip text={reason} label="Why n/a" />
    </p>
  );
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function daysIn(r: Range): number {
  return Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function PortfolioSection({ baseP, rangeText }: { baseP: Promise<BaseResult>; rangeText: string }) {
  const base = await baseP;
  return (
    <TrendCard
      title="Portfolio"
      info="Each market by what a new customer costs (nCAC, this period) and what one is worth: gross profit per customer 365 days after the first order, from the latest complete cohorts (up to 12 months). Where no cohort has reached 365 days, first-order GP per new customer in this period, drawn hollow. The diagonals are LTGP:CAC 3:1 and 1:1. Bubble size is net revenue."
      aside={<span className="text-[12px] text-content-muted">{rangeText}</span>}
    >
      {"empty" in base ? <Empty base={base} /> : <PortfolioChart points={portfolioPoints(base.model)} colors={base.colors} currency={base.model.baseCurrency} />}
    </TrendCard>
  );
}

async function TrendsSection({
  baseP,
  weeksP,
  range,
  compareRange,
}: {
  baseP: Promise<BaseResult>;
  weeksP: Promise<TrendsRaw | null>;
  range: Range;
  compareRange: Range | null;
}) {
  const [base, weeks] = await Promise.all([baseP, weeksP]);
  let body;
  if ("empty" in base) body = <Empty base={base} />;
  else if (!weeks) body = <EmptyNote>Markets data is not built for this client yet.</EmptyNote>;
  else {
    const series = weeklyTrends({
      weeks: weeks.weeks,
      compareWeeks: weeks.compareWeeks,
      range,
      compareRange,
      lastDay: base.raw.lastCompleteDay,
      markets: base.keys,
      platform: base.raw.platform,
      costCards: base.raw.costCards,
    });
    body = series[0]?.points.length ? (
      <TrendCharts series={series} markets={base.keys} colors={base.colors} currency={base.model.baseCurrency} comparing={!!weeks.compareWeeks} />
    ) : (
      <NoData />
    );
  }
  return (
    <TrendCard
      title="Weekly trends"
      info="Monday to Sunday weeks inside the range. A week the range or the data cuts short is hollow and marked partial. nCAC, MER, GP after ads and CM3 are n/a in a week with days that have no spend data; CM3 shows once a market has a cost card. With Compare on, the compare period is the dotted line, week 1 against week 1."
    >
      {body}
    </TrendCard>
  );
}

/** Rows keyed like the page: sold markets, Other (every other country) and Unallocated. */
function poolRows(rows: MarketPeriodRaw[], sold: string[]): MarketPeriodRaw[] {
  const groups = new Map<string, MarketPeriodRaw[]>();
  for (const r of rows) {
    const k = sold.includes(r.market) ? r.market : r.market === MARKET_UNALLOCATED ? MARKET_UNALLOCATED : MARKET_OTHER;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()].map(([market, list]) => ({ market, sums: sumSums(list.map((l) => l.sums))!, extras: null }));
}

async function BridgeSection({ baseP, compareLabel }: { baseP: Promise<BaseResult>; compareLabel: string | undefined }) {
  const base = await baseP;
  const info =
    "Change in GP after ads (gross profit minus ad spend) against the compare period, by market, then for one market split into the drivers that moved it: orders, AOV, discount rate, COGS % and ad spend, in that order.";
  if ("empty" in base) return <TrendCard title="What changed" info={info}><Empty base={base} /></TrendCard>;
  if (!compareLabel || !base.raw.previous) {
    return (
      <TrendCard title="What changed" info={info}>
        <EmptyNote>Turn on Compare to see what changed against another period.</EmptyNote>
      </TrendCard>
    );
  }
  const raw = base.raw;
  const gap = Math.max(raw.spendGapDays.current, raw.spendGapDays.previous ?? 0);
  const changes = bridge({
    current: poolRows(raw.current, base.sold),
    previous: poolRows(raw.previous ?? [], base.sold),
    markets: base.keys,
    noGpReason: gapReason("cogs", raw.platform),
    spendGap: gap > 0 ? `Spend data is missing on ${gap} days of one of the two periods, so GP after ads would not compare like with like` : null,
  });
  return (
    <TrendCard title="What changed" info={info}>
      <BridgeView changes={changes} currency={base.model.baseCurrency} compareLabel={compareLabel} />
    </TrendCard>
  );
}

async function ResponseSection({ baseP, respP, range }: { baseP: Promise<BaseResult>; respP: Promise<ResponseRaw | null>; range: Range }) {
  const [base, resp] = await Promise.all([baseP, respP]);
  const info =
    "Each point is one complete week of one market: paid spend allocated to it against its new customers. The curve is the fit new customers = a + b ln(spend): returns fall as spend rises. Weeks cut by the range or with spend data gaps are left out; the fit is hidden below 8 weeks.";
  let body;
  if ("empty" in base) body = <Empty base={base} />;
  else if (!resp) body = <EmptyNote>Markets data is not built for this client yet.</EmptyNote>;
  else {
    const responses = responseByMarket({ rows: resp.rows, markets: base.sold, window: resp.window, range, lastDay: base.raw.lastCompleteDay });
    const markets: ResponseMarket[] = responses
      .filter((r) => r.points.some((p) => p.spend > 0))
      .map((r) => {
        const col = base.model.markets.find((c) => c.key === r.market);
        const fo = col?.cur.firstOrderGp;
        const spent = r.points.filter((p) => p.spend > 0);
        const s = spent.reduce((t, p) => t + p.spend, 0);
        const n = spent.reduce((t, p) => t + p.newCustomers, 0);
        return {
          ...r,
          gpPerNew: fo && !isNa(fo) ? fo.v : null,
          gpWhy: fo && isNa(fo) ? fo.na : fo ? null : "No first-order GP for this market",
          avgNcac: n > 0 ? s / n : null,
        };
      });
    body = markets.length ? (
      <ResponseView markets={markets} colors={base.colors} currency={base.model.baseCurrency} windowText={`${fmtDay(resp.window.from)} to ${fmtDay(resp.window.to)}`} />
    ) : (
      <NaLine text="Spend response:" reason="No market has a complete week with paid spend in the 52 weeks to the end of this range" />
    );
  }
  return (
    <TrendCard title="Spend vs new customers" info={info}>
      {body}
    </TrendCard>
  );
}

async function FunnelSection({
  baseP,
  ga4P,
  range,
  compareRange,
}: {
  baseP: Promise<BaseResult>;
  ga4P: Promise<Ga4Raw | null>;
  range: Range;
  compareRange: Range | null;
}) {
  const [base, ga4] = await Promise.all([baseP, ga4P]);
  const info = "GA4 sessions by the visitor's country, grouped into the client's markets; countries outside them are Other. Rates are indexed to the home market (home = 100).";
  let body;
  if ("empty" in base) body = <Empty base={base} />;
  else if (!ga4 || !ga4.firstDay) body = <NotConnected source="GA4" />;
  else if (ga4.current.length === 0) body = <NoData />;
  else {
    const rows = funnelRows({ current: ga4.current, previous: ga4.previous, sold: base.sold, home: base.model.homeMarket });
    const days = daysIn(range);
    const coverage = [
      `GA4 by country from ${fmtDay(ga4.firstDay)}`,
      `${ga4.daysCurrent} of ${days} days in this range`,
      ...(compareRange && ga4.daysPrevious !== null ? [`${ga4.daysPrevious} of ${daysIn(compareRange)} in the compare period`] : []),
    ].join(", ");
    body = (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12px] text-content-muted">{coverage}</p>
        <FunnelTable rows={rows} home={base.model.homeMarket} comparing={!!ga4.previous && (ga4.daysPrevious ?? 0) > 0} />
      </div>
    );
  }
  return (
    <TrendCard title="Funnel by market" info={info}>
      {body}
    </TrendCard>
  );
}

async function AovSection({ baseP, binsP }: { baseP: Promise<BaseResult>; binsP: Promise<OrderBinsRaw | null> }) {
  const [base, bins] = await Promise.all([baseP, binsP]);
  const info =
    "Orders by value (net sales, ex VAT, ex shipping) and whether they shipped free. The threshold is inferred from the orders: the lowest value from which at least 80 % of orders shipped free.";
  let body;
  if ("empty" in base) body = <Empty base={base} />;
  else if (!bins) body = <EmptyNote>Markets data is not built for this client yet.</EmptyNote>;
  else if (!bins.markets) body = <NaLine text="Order value vs free shipping:" reason={bins.reason ?? gapReason("shipping", base.raw.platform)} />;
  else {
    const order = (m: string) => {
      const i = base.keys.indexOf(m);
      return i === -1 ? 99 : i;
    };
    const hs = bins.markets
      .filter((m) => m.market !== MARKET_UNALLOCATED)
      .sort((a, b) => order(a.market) - order(b.market))
      .map(histogram)
      .filter((h) => h.orders > 0);
    body = hs.length ? <AovView histograms={hs} currency={base.model.baseCurrency} /> : <NoData />;
  }
  return (
    <TrendCard title="Order value vs free shipping" info={info}>
      {body}
    </TrendCard>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function TrendsScreen({ client, searchParams }: { client: Client; searchParams: SearchParams }) {
  const params = parseViewParams(searchParams, DEFAULT_PRESET);
  const title = "Trends & analysis";

  if (pageAvailability(client, "/markets") !== "available") {
    return (
      <>
        <Header title={title} />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/markets") ?? "Shop"} />
        </main>
      </>
    );
  }

  const region: DemoRegion = parseDemoRegion(searchParams.region);
  const opts = { demoRegion: region };
  const range = params.range;
  const compare = params.period.comparison;

  // Every read starts now; each section awaits only its own.
  const baseP = loadBase(getMarkets(client, range, compare, opts));
  const weeksP = getTrendWeeks(client, range, compare, opts);
  const respP = getResponseWeeks(client, range, opts);
  const ga4P = getGa4Funnel(client, range, compare, opts);
  const binsP = getOrderBins(client, range, opts);
  const rangeText = rangeLabel(params).dates;

  return (
    <>
      <Header title={title} />
      <PageControls client={client} params={params} compare />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {isDemo(client.clientId) && (
          <div className="flex">
            <SegmentedControl
              param="region"
              ariaLabel="Demo markets"
              active={region}
              segments={DEMO_REGIONS.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>
        )}
        <Suspense fallback={<SkeletonChart height={380} />}>
          <PortfolioSection baseP={baseP} rangeText={rangeText} />
        </Suspense>
        <Suspense fallback={<SkeletonChart height={760} />}>
          <TrendsSection baseP={baseP} weeksP={weeksP} range={range} compareRange={compare} />
        </Suspense>
        <Suspense fallback={<SkeletonChart height={480} />}>
          <BridgeSection baseP={baseP} compareLabel={compare ? comparisonLabel(params) : undefined} />
        </Suspense>
        <Suspense fallback={<SkeletonChart height={460} />}>
          <ResponseSection baseP={baseP} respP={respP} range={range} />
        </Suspense>
        <Suspense fallback={<SkeletonTable rows={4} cols={6} />}>
          <FunnelSection baseP={baseP} ga4P={ga4P} range={range} compareRange={compare} />
        </Suspense>
        <Suspense fallback={<SkeletonChart height={380} />}>
          <AovSection baseP={baseP} binsP={binsP} />
        </Suspense>
      </main>
    </>
  );
}
