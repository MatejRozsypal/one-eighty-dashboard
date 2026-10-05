/**
 * Cohorts.
 *
 * The whole design problem on this page is that the repeat-rate column looks
 * like a collapse and isn't, it's cohort age. Three things make that visible
 * instead of requiring prior knowledge:
 *
 *  1. An explicit "age" column, so the confound is a variable you can see.
 *  2. Immature cohorts shaded, with their repeat rate rendered muted, the
 *     number is real but not yet comparable to the row below it.
 *  3. Y1 columns, which measure every customer over the same 365 days. Most
 *     rows are empty there, and that emptiness is the honest part.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { RangeNote } from "@/components/ui/PageNotes";
import { getCohorts, weightedY1 } from "@/lib/queries/cohorts";
import { getRepeat365 } from "@/lib/queries/lifetime";
import {
  getCohortGrid,
  metricSpec,
  COHORT_METRICS,
  type CohortMetric,
} from "@/lib/queries/cohortGrid";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData, Value } from "@/components/ui/EmptyState";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { MarketChips } from "@/components/dashboard/MarketChips";
import { CohortHeatmap } from "@/components/dashboard/CohortHeatmap";
import { DataTable } from "@/components/ui/DataTable";

export const metadata: Metadata = { title: "Cohorts" };
export const dynamic = "force-dynamic";

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function CohortsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  if (pageAvailability(client, "/cohorts") !== "available") {
    return (
      <>
        <Header title="Cohorts" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/cohorts") ?? "Shop"} />
        </main>
      </>
    );
  }

  const metric = (COHORT_METRICS.some((m) => m.value === searchParams.metric)
    ? searchParams.metric
    : "retention") as CohortMetric;

  // `market` repeats, so a multi-select stays a plain shareable URL.
  const selectedMarkets =
    typeof searchParams.market === "string"
      ? [searchParams.market]
      : Array.isArray(searchParams.market)
        ? searchParams.market
        : [];

  // 12 rows by default: the current month is still filling, so it is left out
  // and the 12 full months before it are shown. The warehouse holds 60, and at
  // that length the grid is a wall rather than a chart. The longer views stay
  // one click away.
  const RANGES = [
    { value: "12", label: "12 months" },
    { value: "24", label: "24 months" },
    { value: "0", label: "All" },
  ];
  const rangeParam = RANGES.some((r) => r.value === searchParams.cohortMonths)
    ? (searchParams.cohortMonths as string)
    : "12";
  const monthsBack = Number(rangeParam);

  const [cohorts, repeat365, grid] = await Promise.all([
    getCohorts(client.clientId, client.currency, 24),
    getRepeat365(client.clientId),
    getCohortGrid(client.clientId, client.currency, {
      metric,
      markets: selectedMarkets,
      // Offsets tracks the window: the oldest cohort of a 12-month view has
      // 12 full months behind it, which is offsets 0 to 11.
      maxOffset: monthsBack === 0 ? 24 : monthsBack - 1,
      monthsBack,
    }),
  ]);
  const spec = metricSpec(metric);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const mature = cohorts.filter((c) => c.isMature);

  const header = (
    <>
      <Header title="Cohorts" />
      <PageControls client={client} params={params} />
      <RangeNote />
    </>
  );

  if (cohorts.length === 0) {
    return (
      <>
        {header}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NoData />
        </main>
      </>
    );
  }

  const gridHasValues = grid.rows.some((r) => r.cells.some((c) => c !== null));

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-4 overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex flex-col gap-4 px-5 pt-5">
            <div className="flex flex-col gap-[5px]">
              <Eyebrow>
                Cohort grid
                <InfoTip text={`${spec.blurb} Columns are months since the first order. Blank means not yet reached. Cohorts group by first-order month over all data, not the date range. The current month is left out.`} />
              </Eyebrow>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <div className="flex flex-col gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">
                  Metric
                </span>
                <SegmentedControl
                  param="metric"
                  ariaLabel="Cohort metric"
                  active={metric}
                  segments={COHORT_METRICS.map((m) => ({
                    value: m.value,
                    label: m.label,
                  }))}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">
                  Cohorts shown
                </span>
                <SegmentedControl
                  param="cohortMonths"
                  ariaLabel="How many cohort months"
                  active={rangeParam}
                  segments={RANGES}
                />
              </div>

              {grid.markets.length > 1 && (
                <MarketChips
                  markets={grid.markets}
                  kind={grid.marketKind}
                  active={selectedMarkets}
                />
              )}
            </div>
          </div>

          {grid.rows.length === 0 || !gridHasValues ? (
            <div className="px-5 pb-5">
              <NoData />
            </div>
          ) : (
            <CohortHeatmap
              grid={grid}
              format={spec.format}
              currency={client.currency}
            />
          )}
        </section>

        {mature.length > 0 && (
          <section className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
            {[
              {
                label: "Mature cohorts",
                value: formatNumber(mature.length),
                info: "Cohorts at least 12 months old.",
              },
              {
                label: "Y1 LTV",
                value: money(weightedY1(mature, (c) => c.y1Ltv)),
                info: "Per customer over the first 365 days, weighted by customers across mature cohorts.",
                accent: true,
              },
              {
                label: "Y1 LTGP",
                value: money(weightedY1(mature, (c) => c.y1Ltgp)),
                info: "Gross profit per customer over the first 365 days, weighted by customers across mature cohorts.",
              },
              {
                label: "Repeat rate, 365 days",
                value: formatPercent(repeat365?.rate ?? null),
                sub: repeat365
                  ? `${formatNumber(repeat365.repeaters)} of ${formatNumber(repeat365.matured)}${
                      repeat365.matured < 100 ? ", low n" : ""
                    }`
                  : undefined,
                info: "Second order within 365 days of the first. Customers with at least 365 days of history.",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="flex flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm"
              >
                <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  {s.label}
                  <InfoTip text={s.info} />
                </span>
                <span
                  className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${
                    s.accent ? "text-growth-700" : "text-content-strong"
                  }`}
                >
                  <Value>{s.value}</Value>
                </span>
                {s.sub && (
                  <span className="font-mono text-[11px] tabular text-content-muted">
                    {s.sub}
                  </span>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Cohorts</Eyebrow>
            <span className="text-[12px] text-content-muted">
              {cohorts.length} months
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[920px]">
              <DataTable
                gridClass="grid grid-cols-[1fr_0.6fr_0.8fr_1fr_1fr_1fr_1fr_0.9fr] items-center gap-2"
                columns={[
                  { key: "cohort", label: "Cohort" },
                  { key: "age", label: "Age", align: "right" },
                  { key: "customers", label: "Customers", align: "right" },
                  { key: "ltv", label: "LTV", align: "right" },
                  { key: "ltgp", label: "LTGP", align: "right" },
                  { key: "y1ltv", label: "Y1 LTV", align: "right" },
                  { key: "y1ltgp", label: "Y1 LTGP", align: "right" },
                  {
                    key: "repeat",
                    label: "Repeat rate",
                    align: "right",
                    info: "Share of the cohort with a second order, to date.",
                  },
                ]}
                rows={cohorts.map((c) => ({
                  key: c.cohortMonth,
                  sort: [
                    c.cohortMonth,
                    c.ageMonths,
                    c.customerCount,
                    c.ltv,
                    c.ltgp,
                    c.y1Ltv,
                    c.y1Ltgp,
                    c.repeatRate,
                  ],
                  cells: [
                    <span className="text-[13px] text-content-body">
                      {monthLabel(c.cohortMonth)}
                    </span>,
                    <span
                      className={`font-mono text-[12px] tabular ${
                        c.isMature ? "text-content-muted" : "text-warning"
                      }`}
                      title={
                        c.isMature
                          ? "Fully matured"
                          : "Still maturing"
                      }
                    >
                      {c.ageMonths}m
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      {formatNumber(c.customerCount)}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      <Value>{money(c.ltv)}</Value>
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-body">
                      <Value>{money(c.ltgp)}</Value>
                    </span>,
                    <span
                      className="font-mono text-[12.5px] tabular text-growth-700"
                    >
                      <Value>{money(c.y1Ltv)}</Value>
                    </span>,
                    <span
                      className="font-mono text-[12.5px] tabular text-content-strong"
                    >
                      <Value>{money(c.y1Ltgp)}</Value>
                    </span>,
                    // Muted while immature: the figure is real but not yet
                    // comparable to the rows below it.
                    <span
                      className={`font-mono text-[12.5px] tabular ${
                        c.isMature ? "text-content-strong" : "text-gray-400"
                      }`}
                    >
                      <Value>{formatPercent(c.repeatRate)}</Value>
                    </span>,
                  ],
                }))}
              />
            </div>
          </div>

        </section>
      </main>
    </>
  );
}
