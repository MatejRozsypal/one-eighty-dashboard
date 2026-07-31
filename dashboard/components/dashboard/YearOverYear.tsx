/**
 * Year-over-year, with the running year capped and projected.
 *
 * Two things are shown side by side and they must not be confused, so they are
 * in separate columns with separate headings: the **capped** comparison, which
 * is real measured revenue over identical months, and the **projection**, which
 * is arithmetic on top of an assumption. The capped column is the one to argue
 * from; the projection is there to answer "are we on track", and it says how it
 * was built.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DeltaChip } from "@/components/ui/Delta";
import { formatMoney, formatPercent } from "@/lib/currency";
import { monthName, type YoYSummary } from "@/lib/queries/yoy";

export function YearOverYear({
  data,
  currency,
}: {
  data: YoYSummary;
  currency: string;
}) {
  const money = (v: number | null) => formatMoney(v, currency);
  const { years, cappedThroughMonth, projection, projectionBlockedBy } = data;
  const capLabel =
    cappedThroughMonth >= 1
      ? `Jan–${monthName(cappedThroughMonth)}`
      : "no closed month yet";

  const current = years.find((y) => y.isCurrent);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
        <div className="flex flex-col gap-[5px]">
          <Eyebrow>Year over year</Eyebrow>
          <span className="text-[12.5px] leading-[1.5] text-content-muted">
            The running year is compared over <b>{capLabel}</b> only — the same
            months in every year. Comparing seven months against twelve is not a
            comparison, it&apos;s a subtraction of five months.
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[0.7fr_1fr_1fr_1fr_0.9fr] items-center gap-3 border-b border-hairline bg-gray-50 px-4 py-2.5">
              {["Year", `${capLabel} revenue`, "vs prior year", "Full year", "CM3"].map(
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

            {years.map((y) => (
              <div
                key={y.year}
                className={`grid grid-cols-[0.7fr_1fr_1fr_1fr_0.9fr] items-center gap-3 border-b border-hairline px-4 py-3 ${
                  y.isCurrent ? "bg-accent-soft/40" : ""
                }`}
              >
                <span className="flex items-center gap-2 font-mono text-[13px] font-semibold tabular text-content-strong">
                  {y.year}
                  {y.isCurrent && (
                    <Badge variant="neutral" size="sm" dot>
                      Running
                    </Badge>
                  )}
                </span>

                <span className="font-mono text-[13px] font-semibold tabular text-content-strong">
                  {money(y.cappedRevenue)}
                </span>

                <span>
                  {y.cappedYoY !== null ? (
                    <DeltaChip delta={y.cappedYoY} goodWhen="up" />
                  ) : (
                    <span
                      className="font-mono text-[12px] text-gray-300"
                      title="No prior year held in the warehouse for these months"
                    >
                      —
                    </span>
                  )}
                </span>

                {/*
                  A year we only hold part of has no full-year total to give.
                  Printing its partial sum in this column would invite reading
                  it as the year, which is how you conclude a business halved.
                */}
                <span className="font-mono text-[13px] tabular text-content-body">
                  {y.isComplete ? (
                    money(y.revenue)
                  ) : (
                    <span
                      className="text-gray-300"
                      title={`Only ${y.monthsWithData} month${y.monthsWithData === 1 ? "" : "s"} held for ${y.year}`}
                    >
                      {y.isCurrent
                        ? "in progress"
                        : `partial · ${y.monthsWithData} mo`}
                    </span>
                  )}
                </span>

                <span className="font-mono text-[13px] tabular text-content-body">
                  {money(y.cm3)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
        <div className="flex flex-col gap-[5px]">
          <Eyebrow>Where {data.currentYear} lands</Eyebrow>
          <span className="text-[12.5px] leading-[1.5] text-content-muted">
            Seasonal projection — not a target, and not measured revenue.
          </span>
        </div>

        {projection === null ? (
          <div className="flex flex-col gap-2 rounded-card border border-dashed border-hairline-strong p-[18px_20px]">
            <span className="text-[13.5px] font-semibold text-content-strong">
              No projection possible.
            </span>
            <span className="text-[12.5px] leading-[1.6] text-content-body">
              {projectionBlockedBy}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <span className="flex flex-col gap-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  Projected full year
                </span>
                <span className="font-mono text-[28px] font-semibold leading-none tracking-display tabular text-content-strong">
                  {money(projection.mid)}
                </span>
              </span>

              <span className="flex flex-col gap-1.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  Range across prior years
                </span>
                <span className="font-mono text-[15px] tabular text-content-body">
                  {money(projection.low)} – {money(projection.high)}
                </span>
              </span>

              {current?.cappedRevenue != null && (
                <span className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                    Banked so far ({capLabel})
                  </span>
                  <span className="font-mono text-[15px] tabular text-content-body">
                    {money(current.cappedRevenue)}
                  </span>
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-card bg-gray-50 p-[14px_16px]">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted">
                How this is built
              </span>
              <span className="text-[12.5px] leading-[1.6] text-content-body">
                In each complete earlier year, this share of the year&apos;s
                revenue had landed by the end of {monthName(cappedThroughMonth)}:{" "}
                {projection.shares
                  .map(
                    (s) =>
                      `${s.year} ${formatPercent(s.share, { decimals: 1 })}`
                  )
                  .join(" · ")}
                . This year&apos;s {capLabel} revenue is divided by the{" "}
                <b>most recent</b> of those, not the average — a business that
                changed size or store setup makes older years a worse model, and
                averaging them in quietly invents growth. The range is what each
                individual year would have implied on its own; it is not a
                confidence interval, since there is no distribution here.
              </span>

              {projection.basisYears >= 2 && projection.shareSpread > 1.25 && (
                <span className="text-[12.5px] leading-[1.6] text-warning">
                  <b>The prior years disagree badly</b> — the highest share is{" "}
                  {projection.shareSpread.toFixed(1)}× the lowest. When a
                  business changes size quickly, the share of the year banked by
                  a given month moves with growth rather than with the calendar,
                  so this is measuring the trend more than the season. Read the
                  range, not the midpoint.
                </span>
              )}

              {projection.basisYears < 2 && (
                <span className="text-[12.5px] leading-[1.6] text-warning">
                  <b>Built on a single prior year.</b> With one year of history
                  this restates {projection.shares[0]?.year}&apos;s shape rather
                  than forecasting — it carries no information about whether
                  that shape repeats. Treat it as an illustration until a second
                  complete year exists.
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
