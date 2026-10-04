/**
 * Year-over-year, with the running year capped and projected.
 *
 * Two things are shown side by side and they must not be confused, so they are
 * in separate sections with separate headings: the **capped** comparison, which
 * is real measured revenue over identical months, and the **projection**, which
 * is arithmetic on top of an assumption. The capped column is the one to argue
 * from; the projection answers "are we on track", and its tooltip says how it
 * was built.
 */

import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DeltaChip } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { formatMoney, formatPercent } from "@/lib/currency";
import { NO_VALUE } from "@/lib/format";
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
      ? `Jan to ${monthName(cappedThroughMonth)}`
      : "no closed month yet";

  const current = years.find((y) => y.isCurrent);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
        <span className="inline-flex items-center gap-1.5">
          <Eyebrow>Year over year</Eyebrow>
          <InfoTip text="The running year is compared over the same months in every year, so seven months are never set against twelve." />
        </span>

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
                      title="No prior year data"
                    >
                      {NO_VALUE}
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
        <Eyebrow>Where {data.currentYear} lands</Eyebrow>

        {projection === null ? (
          <span className="text-[13.5px] text-content-muted">
            {projectionBlockedBy ?? "No projection."}
          </span>
        ) : (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <span className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                Projected full year
                <InfoTip text={projectionNote(projection, capLabel, cappedThroughMonth)} />
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
                {money(projection.low)} to {money(projection.high)}
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
        )}
      </section>
    </div>
  );
}

/**
 * The projection tooltip: how it is built, and the one caveat that applies.
 * At most 40 words, so the two warnings that used to be banners fold into it.
 */
function projectionNote(
  projection: NonNullable<YoYSummary["projection"]>,
  capLabel: string,
  cappedThroughMonth: number
): string {
  const caveat =
    projection.basisYears < 2
      ? " Built on one prior year, so it restates that year's shape."
      : projection.shareSpread > 1.25
        ? ` Prior years disagree (${projection.shareSpread.toFixed(1)}x), so read the range.`
        : "";
  return (
    `Not a target. ${capLabel} revenue divided by the share of the year banked by ${monthName(cappedThroughMonth)} in the latest full year.` +
    caveat
  );
}
