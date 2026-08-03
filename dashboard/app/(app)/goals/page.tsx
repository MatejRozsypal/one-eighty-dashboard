/**
 * Goals — targets against what actually happened.
 *
 * Targets are set per client in Settings; this page only reads them. The split
 * matters: a page that both sets and reports a target invites editing the plan
 * to match the result.
 *
 * Actuals come from the same daily spine as the snapshot, so a month here and
 * the headline figure for that month are the same number.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { getGoalActuals, getGoals } from "@/lib/queries/goals";
import { GOAL_METRICS, GOAL_METRIC_KEYS, type GoalMetric } from "@/lib/goals/store";
import {
  monthsOfQuarter,
  monthsOfYear,
  quarterOf,
  rollUp,
  type Attainment,
} from "@/lib/goals/progress";
import { formatMoney, formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Goals" };
export const dynamic = "force-dynamic";

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function formatValue(
  value: number | null,
  metric: GoalMetric,
  currency: string
): string {
  if (value === null) return "—";
  const spec = GOAL_METRICS.find((m) => m.key === metric)!;
  return spec.format === "money"
    ? formatMoney(value, currency, { compact: true })
    : formatNumber(value, { compact: true });
}

/**
 * Colour follows pace while a period is open and attainment once it closes.
 *
 * Judging an in-flight month on attainment alone paints everything red on the
 * 3rd; judging a closed month on pace is meaningless, since there is no time
 * left to pace against.
 */
function toneOf(a: Attainment): string {
  if (a.target === null) return "text-content-muted";
  if (a.isOpen) {
    if (a.pace === "ahead") return "text-positive";
    if (a.pace === "behind") return "text-negative";
    return "text-content-strong";
  }
  if (a.ratio === null) return "text-content-muted";
  if (a.ratio >= 1) return "text-positive";
  if (a.ratio >= 0.9) return "text-warning";
  return "text-negative";
}

function AttainmentBar({ a }: { a: Attainment }) {
  if (a.target === null) {
    return (
      <span className="text-[12px] text-content-muted">No target set</span>
    );
  }

  const pct = a.ratio === null ? 0 : Math.min(1.25, a.ratio);
  const width = `${Math.round((pct / 1.25) * 100)}%`;
  // Where an even pace would have reached by now — the line to beat.
  const markAt = `${Math.round((Math.min(1.25, a.elapsed) / 1.25) * 100)}%`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-[7px] w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${
            a.isOpen
              ? a.pace === "behind"
                ? "bg-negative"
                : "bg-growth-500"
              : (a.ratio ?? 0) >= 1
                ? "bg-positive"
                : "bg-negative"
          }`}
          style={{ width }}
        />
        {a.isOpen && (
          <span
            aria-hidden="true"
            className="absolute top-0 h-full w-px bg-content-strong/45"
            style={{ left: markAt }}
          />
        )}
      </div>
      <span className="font-mono text-[10.5px] text-content-muted">
        {formatPercent(a.ratio, { decimals: 0 })} of target
        {a.isOpen && a.expected !== null && (
          <> · {formatPercent(a.elapsed, { decimals: 0 })} of period elapsed</>
        )}
      </span>
    </div>
  );
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  // Anchored on today rather than the page's date range: a target belongs to a
  // calendar month, and letting the range picker move it would let someone read
  // "March's goal" against April's numbers.
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const thisMonth = `${today.slice(0, 7)}-01`;

  const [goals, actuals] = await Promise.all([
    getGoals(client.clientId, year),
    getGoalActuals(client.clientId, client.currency, year),
  ]);

  const metrics = GOAL_METRIC_KEYS;
  const quarter = quarterOf(thisMonth);

  const periods = [
    rollUp("This month", [thisMonth], goals, actuals, metrics, today),
    rollUp(`Q${quarter}`, monthsOfQuarter(year, quarter), goals, actuals, metrics, today),
    rollUp(String(year), monthsOfYear(year), goals, actuals, metrics, today),
  ];

  const anyTarget = periods.some((p) =>
    metrics.some((m) => p.byMetric[m].target !== null)
  );

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/goals", client.name)}
        title="Goals"
      />

      <main className="flex max-w-[1320px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {!anyTarget && (
          <section className="rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <Eyebrow>No targets yet</Eyebrow>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-content-body">
              Nothing has been set for {client.name} in {year}. Targets are
              entered per month under Settings → Clients → {client.name} →
              Goals. Until then this page has nothing to measure against, which
              is why it shows no attainment rather than 0%.
            </p>
          </section>
        )}

        {periods.map((period) => (
          <section
            key={period.label}
            className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>{period.label}</Eyebrow>
              <span className="text-[12px] text-content-muted">
                {period.months.length === 1
                  ? monthLabel(period.months[0])
                  : `${monthLabel(period.months[0])}–${monthLabel(
                      period.months[period.months.length - 1]
                    )}`}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => {
                const a = period.byMetric[metric];
                const spec = GOAL_METRICS.find((m) => m.key === metric)!;
                return (
                  <div key={metric} className="flex flex-col gap-2">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      {spec.label}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-[22px] font-bold tracking-heading ${toneOf(a)}`}
                      >
                        {formatValue(a.actual, metric, client.currency)}
                      </span>
                      <span className="text-[12px] text-content-muted">
                        {a.target === null
                          ? ""
                          : `of ${formatValue(a.target, metric, client.currency)}`}
                      </span>
                    </div>
                    <AttainmentBar a={a} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <Eyebrow>Month by month · {year}</Eyebrow>

          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] gap-2 border-b border-hairline bg-gray-50 px-5 py-3">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  Month
                </span>
                {GOAL_METRICS.map((m) => (
                  <span
                    key={m.key}
                    className="text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                  >
                    {m.label}
                  </span>
                ))}
              </div>

              {monthsOfYear(year).map((month) => {
                const row = rollUp(month, [month], goals, actuals, metrics, today);
                const future = month > thisMonth;
                return (
                  <div
                    key={month}
                    className={`grid grid-cols-[1.4fr_repeat(4,1fr)] items-center gap-2 border-b border-hairline px-5 py-3 ${
                      month === thisMonth ? "bg-gray-50" : ""
                    }`}
                  >
                    <span className="text-[13px] text-content-strong">
                      {monthLabel(month)}
                      {month === thisMonth && (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                          in flight
                        </span>
                      )}
                    </span>
                    {metrics.map((metric) => {
                      const a = row.byMetric[metric];
                      return (
                        <span
                          key={metric}
                          className={`text-right text-[13px] tabular-nums ${
                            future ? "text-content-muted" : toneOf(a)
                          }`}
                        >
                          {a.target === null ? (
                            <span className="text-content-muted">—</span>
                          ) : (
                            formatPercent(a.ratio, { decimals: 0 })
                          )}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="max-w-[76ch] text-[12px] leading-relaxed text-content-muted">
            Attainment is actual ÷ target. An em dash means no target was set for
            that month — not that the target was missed. Months still in flight
            are judged against an even pace through the month, shown as the
            marker on the bars above; a closed month is judged on the final
            figure alone.
          </p>
        </section>
      </main>
    </>
  );
}
