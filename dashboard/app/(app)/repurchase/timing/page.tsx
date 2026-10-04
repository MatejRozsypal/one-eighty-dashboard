/**
 * Repeat timing, when the second order actually happens.
 *
 * Companion to `/repurchase`, which answers *which* first product brings people
 * back. This answers *when*, so a flow can be timed rather than guessed at.
 *
 * Deliberately not filtered by the page date range: a gap is a property of a
 * customer's own timeline, and clipping it to a window would count people who
 * had a fortnight to return against people who had a year.
 */

import type { Metadata } from "next";
import { AppLink } from "@/components/ui/AppLink";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { PageControls } from "@/components/controls/PageControls";
import { getRepeatTiming } from "@/lib/queries/repeatTiming";
import { optional } from "@/lib/queries/errors";
import { formatNumber, formatPercent } from "@/lib/currency";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { NotConnected, NoData } from "@/components/ui/EmptyState";
import { pageAvailability, missingSource } from "@/lib/capabilities";
import { RepeatTimingChart } from "@/components/dashboard/RepeatTimingChart";

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

  if (pageAvailability(client, "/repurchase") !== "available") {
    return (
      <>
        <Header title="Repeat timing" />
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <NotConnected source={missingSource(client, "/repurchase") ?? "Shop"} />
        </main>
      </>
    );
  }

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
      <Header title="Repeat timing" />
      <PageControls client={client} params={params} />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {HORIZONS.map((h) => (
            <AppLink
              key={h}
              href={qs(h)}
              className={`rounded-control border px-3 py-1.5 font-mono text-[11px] transition-colors duration-fast ${
                h === horizon
                  ? "border-hairline-strong bg-bg-inverse text-content-inverse"
                  : "border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              {h} days
            </AppLink>
          ))}
        </div>

        {!timing || timing.repeaters === 0 ? (
          <NoData />
        ) : (
          <>
            <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <Eyebrow>
                  First to second order
                  <InfoTip
                    text={`Only first to second orders, from customers whose first order is ${horizon} to ${horizon + 365} days old. Percentages are of repeat orders. Ignores the date range.`}
                  />
                </Eyebrow>
                {timing.peak && (
                  <span className="rounded-full border border-hairline-strong px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-content-body">
                    Peak {timing.peak.from}-{timing.peak.to}d
                  </span>
                )}
              </div>

              <RepeatTimingChart timing={timing} />

              <p className="max-w-[92ch] text-[12.5px] leading-relaxed text-content-body">
                {timing.peak && (
                  <>
                    Peak week holds{" "}
                    <b>{formatPercent(timing.peak.share, { decimals: 1 })}</b> of
                    repeats.{" "}
                  </>
                )}
                {timing.medianDay !== null && (
                  <>
                    Half land by <b>day {timing.medianDay}</b>
                    {timing.p80Day !== null && <> and 80% by day {timing.p80Day}</>}.{" "}
                  </>
                )}
                {formatNumber(timing.repeaters)} of {formatNumber(timing.cohort)}{" "}
                came back ({formatPercent(timing.repeaters / timing.cohort, { decimals: 1 })}).
              </p>
            </section>

            <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
              <div className="flex items-center border-b border-hairline px-5 py-4 lg:px-[26px]">
                <Eyebrow>Exact breakdown by window</Eyebrow>
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

            <AppLink
              href={params.clientId ? `/gaps?client=${params.clientId}` : "/gaps"}
              className="text-[12.5px] text-content-body underline"
            >
              Time between orders
            </AppLink>
          </>
        )}
      </main>
    </>
  );
}
