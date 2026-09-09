/**
 * Repeat timing — when the second order actually happens.
 *
 * Companion to `/repurchase`, which answers *which* first product brings people
 * back. This answers *when*, so a flow can be timed rather than guessed at.
 *
 * Deliberately not filtered by the page date range: a gap is a property of a
 * customer's own timeline, and clipping it to a window would count people who
 * had a fortnight to return against people who had a year.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { getRepeatTiming } from "@/lib/queries/repeatTiming";
import { optional } from "@/lib/queries/errors";
import { formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { RepeatTimingChart } from "@/components/dashboard/RepeatTimingChart";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Repeat timing" };
export const dynamic = "force-dynamic";

const HORIZONS = [90, 180, 365];

export default async function RepeatTimingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  const requested = Number(
    Array.isArray(searchParams.horizon) ? searchParams.horizon[0] : searchParams.horizon
  );
  const horizon = HORIZONS.includes(requested) ? requested : 90;

  const timing = await optional(() => getRepeatTiming(client.clientId, horizon), null);

  const qs = (h: number) => {
    const p = new URLSearchParams();
    if (params.clientId) p.set("client", params.clientId);
    p.set("horizon", String(h));
    return `/repurchase/timing?${p.toString()}`;
  };

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/repurchase/timing", client.name)}
        title="Repeat timing"
      />
      {/* The horizon below is this page's own control; the range is not.
          The note under the horizon buttons already said "ignores the date
          range above", which was written against a bar that was not there. */}
      <PageControls
        client={client}
        params={params}
        scope="the horizon set below"
      />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {HORIZONS.map((h) => (
            <Link
              key={h}
              href={qs(h)}
              className={`rounded-control border px-3 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
                h === horizon
                  ? "border-hairline-strong bg-bg-inverse text-content-inverse"
                  : "border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              {h} days
            </Link>
          ))}
          <span className="text-[12px] text-content-muted">
            Ignores the date range above — a gap belongs to the customer&rsquo;s
            own timeline, not to a calendar window.
          </span>
        </div>

        {!timing || timing.repeaters === 0 ? (
          <section className="rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
            <Eyebrow>Not enough repeat orders</Eyebrow>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-content-body">
              No second orders inside {horizon} days for {client.name} from
              customers whose first order is old enough to have been observed
              for that long.
            </p>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-[5px]">
                  <Eyebrow>First → second · 1-day buckets</Eyebrow>
                  <span className="max-w-[70ch] text-[12.5px] leading-[1.5] text-content-muted">
                    Bars are the share of repeat orders landing on each day; the
                    dashed line is the running total of those same bars.
                  </span>
                </div>
                {timing.peak && (
                  <span className="rounded-full border border-hairline-strong px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-content-body">
                    Peak {timing.peak.from}–{timing.peak.to}d
                  </span>
                )}
              </div>

              <RepeatTimingChart timing={timing} />

              <p className="max-w-[92ch] text-[12.5px] leading-relaxed text-content-body">
                {timing.peak && (
                  <>
                    The heaviest week is{" "}
                    <b>
                      days {timing.peak.from}–{timing.peak.to}
                    </b>
                    , holding {formatPercent(timing.peak.share, { decimals: 1 })} of
                    all repeats on its own.{" "}
                  </>
                )}
                {timing.medianDay !== null && (
                  <>
                    Half land by <b>day {timing.medianDay}</b>
                    {timing.p80Day !== null && <> and 80% by day {timing.p80Day}</>}.{" "}
                  </>
                )}
                Of {formatNumber(timing.cohort)} customers who had a full{" "}
                {horizon} days to come back, {formatNumber(timing.repeaters)} did —{" "}
                {formatPercent(timing.repeaters / timing.cohort, { decimals: 1 })}.
                {timing.beyondHorizon > 0 && (
                  <>
                    {" "}
                    A further {formatNumber(timing.beyondHorizon)} returned later
                    than day {horizon} and are not on this chart, so the window
                    captures{" "}
                    {formatPercent(
                      timing.repeaters / (timing.repeaters + timing.beyondHorizon),
                      { decimals: 0 }
                    )}{" "}
                    of everyone who eventually came back.
                  </>
                )}
                {timing.sameDay > 0 && (
                  <>
                    {" "}
                    {formatNumber(timing.sameDay)} of them ordered again the same
                    day, which is usually a split order rather than a return.
                  </>
                )}
              </p>
            </section>

            <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
              <div className="flex flex-col gap-[5px] border-b border-hairline px-5 py-4 lg:px-[26px]">
                <Eyebrow>Exact breakdown by window</Eyebrow>
                <span className="text-[12.5px] leading-[1.5] text-content-muted">
                  Share of repeat orders in each window, and the running total by
                  the end of it.
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[620px]">
                  <div className="grid grid-cols-[1.4fr_1fr_1fr_1.6fr] gap-2 border-b border-hairline bg-gray-50 px-5 py-3 lg:px-[26px]">
                    {["Window", "Customers", "Share", "Cumulative"].map((h) => (
                      <span
                        key={h}
                        className={`font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted ${
                          h === "Window" ? "" : "text-right"
                        }`}
                      >
                        {h}
                      </span>
                    ))}
                  </div>

                  {timing.windows.map((w) => {
                    const isPeak =
                      timing.peak !== null &&
                      w.from <= timing.peak.to &&
                      w.to >= timing.peak.from;
                    return (
                      <div
                        key={w.label}
                        className={`grid grid-cols-[1.4fr_1fr_1fr_1.6fr] items-center gap-2 border-b border-hairline px-5 py-2.5 lg:px-[26px] ${
                          isPeak ? "bg-growth-50" : ""
                        }`}
                      >
                        <span className="text-[13px] text-content-strong">
                          {w.label}
                        </span>
                        <span className="text-right text-[13px] tabular-nums">
                          {formatNumber(w.customers)}
                        </span>
                        <span className="text-right text-[13px] font-semibold tabular-nums">
                          {formatPercent(w.share, { decimals: 1 })}
                        </span>
                        <span className="flex items-center justify-end gap-2">
                          <span
                            aria-hidden="true"
                            className="h-[5px] w-[90px] overflow-hidden rounded-full bg-gray-100"
                          >
                            <span
                              className="block h-full rounded-full bg-growth-500"
                              style={{ width: `${Math.round(w.cumulative * 100)}%` }}
                            />
                          </span>
                          <span className="w-[42px] text-right font-mono text-[11.5px] tabular-nums text-content-muted">
                            {formatPercent(w.cumulative, { decimals: 0 })}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
              <Eyebrow>How to read this</Eyebrow>
              <p className="mt-2 max-w-[92ch] text-[12.5px] leading-relaxed text-content-body">
                Only the first→second gap is counted, from customers whose first
                order is between {horizon} and {horizon + 365} days old — twelve
                months of cohorts, every one observed for the whole window. That
                exclusion matters: a customer who bought last week has not failed
                to reorder within {horizon} days, and counting them would make the
                distribution look worse the better recent acquisition has been.
              </p>
              <p className="mt-2 max-w-[92ch] text-[12.5px] leading-relaxed text-content-body">
                Percentages are of repeat orders, not of all customers, so the
                bars sum to 100%. The separate share of the cohort that came back
                at all is in the paragraph above.{" "}
                <Link href="/gaps" className="underline">
                  Time between orders
                </Link>{" "}
                answers a different question — it pools every consecutive gap,
                including 2nd→3rd and later, which run on a different clock.
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
