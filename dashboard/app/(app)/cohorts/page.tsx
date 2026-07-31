/**
 * Cohorts.
 *
 * The whole design problem on this page is that the repeat-rate column looks
 * like a collapse and isn't — it's cohort age. Three things make that visible
 * instead of requiring prior knowledge:
 *
 *  1. An explicit "age" column, so the confound is a variable you can see.
 *  2. Immature cohorts shaded, with their repeat rate rendered muted — the
 *     number is real but not yet comparable to the row below it.
 *  3. Y1 columns, which measure every customer over the same 365 days. Most
 *     rows are empty there, and that emptiness is the honest part.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getCohorts } from "@/lib/queries/cohorts";
import {
  getCohortGrid,
  metricSpec,
  COHORT_METRICS,
  type CohortMetric,
} from "@/lib/queries/cohortGrid";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/controls/SegmentedControl";
import { MarketFilter } from "@/components/controls/MarketFilter";
import { CohortHeatmap } from "@/components/dashboard/CohortHeatmap";
import { DataTable } from "@/components/ui/DataTable";
import { pageEyebrow } from "@/lib/nav";

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

  // 13 rows by default — this month plus the previous twelve. The warehouse
  // holds 36, and at that length the grid is 37 columns wide as well, which is
  // a wall rather than a chart. The longer views stay one click away.
  const RANGES = [
    { value: "12", label: "13 months" },
    { value: "24", label: "25 months" },
    { value: "0", label: "All" },
  ];
  const rangeParam = RANGES.some((r) => r.value === searchParams.cohortMonths)
    ? (searchParams.cohortMonths as string)
    : "12";
  const monthsBack = Number(rangeParam);

  const [cohorts, grid] = await Promise.all([
    getCohorts(client.clientId, client.currency, 24),
    getCohortGrid(client.clientId, client.currency, {
      metric,
      markets: selectedMarkets,
      // Offsets tracks the window: a 13-month view has nothing beyond month 12.
      maxOffset: monthsBack === 0 ? 24 : monthsBack,
      monthsBack,
    }),
  ]);
  const spec = metricSpec(metric);

  const money = (v: number | null) => formatMoney(v, client.currency);
  const mature = cohorts.filter((c) => c.isMature);

  const header = (
    <Header
      eyebrow={pageEyebrow("/cohorts", client.name)}
      title="Cohorts"
    />
  );

  if (cohorts.length === 0) {
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
              No cohorts for {client.name} in {client.currency}.
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
        {/*
          This page ignores the date picker: cohorts are cut by the month of a
          customer's FIRST order, not by the selected range. Saying so here
          rather than in the header keeps it next to the numbers it qualifies.
        */}
        <span className="text-[12.5px] leading-[1.5] text-content-muted">
          Grouped by first-order month, across the full 36-month window — not the
          selected date range.
        </span>

        <div className="flex items-start gap-3 rounded-card border border-warning/[0.38] bg-[#FFFBF4] p-[14px_18px]">
          <span aria-hidden="true" className="mt-0.5 text-[13px] text-warning">
            ⚠
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-[13.5px] font-semibold text-content-strong">
              Repeat rate falls as you read down this table. That is age, not
              decline.
            </span>
            <span className="text-[12.5px] leading-[1.6] text-content-body">
              This month&apos;s cohort has had weeks to make a second purchase;
              a year-old cohort has had a year. Only the{" "}
              <b className="text-content-strong">Y1 columns</b> are comparable
              across rows — they measure every customer over the same 365 days,
              which is why they&apos;re empty until a cohort matures.
            </span>
          </span>
        </div>

        <section className="flex flex-col gap-4 overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex flex-col gap-4 px-5 pt-5">
            <div className="flex flex-col gap-[5px]">
              <Eyebrow>Cohort grid · mart_customer_cohort_grid</Eyebrow>
              <span className="text-[12.5px] leading-[1.5] text-content-muted">
                {spec.blurb} Columns are months since the cohort&apos;s first
                order. Blank means the cohort hasn&apos;t lived that long yet —
                not that it went to zero.
              </span>
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
                <MarketFilter
                  markets={grid.markets}
                  kind={grid.marketKind}
                  active={selectedMarkets}
                />
              )}
            </div>

            {grid.marketKind === "currency" && (
              <span className="text-[12px] leading-[1.5] text-content-muted">
                Shoptet puts no address on an order, so these are the currency
                each customer first transacted in — the closest thing to a
                market the data holds, not a country.
              </span>
            )}
          </div>

          {grid.rows.length === 0 ? (
            <div className="px-5 py-8 text-[13px] text-content-muted">
              No cohorts match this filter.
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
                note: "≥12 months old",
              },
              {
                label: "Y1 LTV",
                value: money(
                  mature.reduce((s, c) => s + (c.y1Ltv ?? 0), 0) /
                    (mature.filter((c) => c.y1Ltv !== null).length || 1)
                ),
                note: "mean across mature",
                accent: true,
              },
              {
                label: "Y1 LTGP",
                value: money(
                  mature.reduce((s, c) => s + (c.y1Ltgp ?? 0), 0) /
                    (mature.filter((c) => c.y1Ltgp !== null).length || 1)
                ),
                note: "gross profit per customer",
              },
              {
                label: "Repeat rate",
                value: formatPercent(
                  mature.reduce((s, c) => s + (c.repeatRate ?? 0), 0) /
                    (mature.filter((c) => c.repeatRate !== null).length || 1)
                ),
                note: "mature cohorts only",
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
                <span className="text-[11.5px] text-gray-300">{s.note}</span>
              </div>
            ))}
          </section>
        )}

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Cohorts · mart_customer_cohorts</Eyebrow>
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
                  { key: "repeat", label: "Repeat rate", align: "right" },
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
                          ? "Fully matured — Y1 figures are comparable"
                          : "Still maturing — repeat rate will keep rising"
                      }
                    >
                      {c.ageMonths}m
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      {formatNumber(c.customerCount)}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-strong">
                      {money(c.ltv)}
                    </span>,
                    <span className="font-mono text-[12.5px] tabular text-content-body">
                      {money(c.ltgp)}
                    </span>,
                    <span
                      className={`font-mono text-[12.5px] tabular ${
                        c.y1Ltv === null ? "text-gray-250" : "text-growth-700"
                      }`}
                    >
                      {c.y1Ltv === null ? "—" : money(c.y1Ltv)}
                    </span>,
                    <span
                      className={`font-mono text-[12.5px] tabular ${
                        c.y1Ltgp === null ? "text-gray-250" : "text-content-strong"
                      }`}
                    >
                      {c.y1Ltgp === null ? "—" : money(c.y1Ltgp)}
                    </span>,
                    // Muted while immature: the figure is real but not yet
                    // comparable to the rows below it.
                    <span
                      className={`font-mono text-[12.5px] tabular ${
                        c.isMature ? "text-content-strong" : "text-gray-400"
                      }`}
                    >
                      {c.repeatRate !== null ? formatPercent(c.repeatRate) : "—"}
                    </span>,
                  ],
                }))}
              />
            </div>
          </div>

          <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
            Shaded rows are still maturing — their repeat rate carries a ↗ because
            it will keep rising on its own, with no change in customer behaviour.
            Y1 columns fill in once a cohort passes 12 months. All figures sit
            inside a 36-month data window, so cohorts near its edge understate
            slightly.
          </div>
        </section>
      </main>
    </>
  );
}
