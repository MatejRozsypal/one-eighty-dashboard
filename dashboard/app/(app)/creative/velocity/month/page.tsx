/**
 * Velocity, This month: is the testing machine keeping pace (the Monday view).
 *
 * Two rings, the only goal-shaped numbers in the area: new ads launched this
 * month against capacity, and packs launched against the verdicts the budget
 * pays for. One rotation is the month's goal; the dot is where today should
 * be. Verdicts themselves (packs that reached N purchases) are not counted:
 * the launch table holds lifetime totals, not the day a pack crossed N, so the
 * ring counts packs launched, each of which is one planned verdict.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { CreativeNotConnected, Scorecard, SectionHead } from "@/components/creative/primitives";
import { Notice } from "@/components/ui/Notice";
import { InfoTip } from "@/components/ui/InfoTip";
import { GoalRing } from "@/components/plan/GoalRing";
import { loadVelocity, velocityFacts } from "@/lib/creative/velocityData";
import { LONG_WINDOW_DAYS } from "@/lib/creative/capacity";
import { days, perMonth, times, whole } from "@/lib/creative/velocityFormat";
import { isNoValue, NO_VALUE } from "@/lib/format";
import type { HealthTone } from "@/lib/plan/health";

export const metadata: Metadata = { title: "This month" };
export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLabel(month: string | null): string {
  if (!month) return "This month";
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Share of the month gone by `through`, so the ring's dot marks where today should be. */
function elapsed(through: string | null): number | null {
  if (!through) return null;
  const y = Number(through.slice(0, 4));
  const m = Number(through.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(through.slice(8, 10)) / daysInMonth;
}

function toneOf(actual: number | null, toDate: number | null): HealthTone {
  if (actual === null || toDate === null) return "neutral";
  return actual >= toDate ? "positive" : "warning";
}

export default async function VelocityMonthPage({
  searchParams,
}: {
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const loaded = await loadVelocity(searchParams);
  if (loaded.status === "not-connected") {
    return <CreativeNotConnected title="This month" source={loaded.source} />;
  }
  const d = loaded.data;
  const f = velocityFacts(d);
  const share = elapsed(f.through);
  const packsMonth = d.summary?.packsMonth ?? null;

  const rings = [
    {
      label: "New ads",
      of: "capacity",
      actual: f.newAdsMonth,
      target: f.plan.capacity,
      info: "Ads first delivered this month, relaunches excluded, against capacity at the Plan inputs.",
    },
    {
      label: "Packs launched",
      of: "verdicts",
      actual: packsMonth,
      target: f.plan.verdicts,
      info: "New ad sets this month against the verdicts the new-creative budget pays for.",
    },
  ].map((r) => {
    const toDate = r.target !== null && share !== null ? r.target * share : null;
    return { ...r, toDate, tone: toneOf(r.actual, toDate) };
  });

  const q = d.queue;
  const queueText = q ? `${q.ready} / ${q.inWorks} / ${q.briefing}` : NO_VALUE;

  return (
    <>
      <Header title="This month" />
      <main className="page-frame flex flex-col gap-6 px-5 pb-14 pt-4 lg:px-8">
        {f.plan.longWindow && <Notice tone="warning">Window over {LONG_WINDOW_DAYS} days.</Notice>}
        {f.plan.belowPerAdFloor && <Notice tone="warning">Each ad gets less than 0.5× CPA a day.</Notice>}

        <section>
          <SectionHead title={monthLabel(f.month)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rings.map((r) => {
              const value = r.actual === null ? NO_VALUE : whole(r.actual);
              return (
                <div key={r.label} className="glass flex items-center gap-4 px-5 py-4">
                  <GoalRing
                    row={{ actual: r.actual, targetToDate: r.toDate, target: r.target }}
                    periodType="month"
                    tone={r.tone}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
                      {r.label}
                      <InfoTip text={r.info} label={`About ${r.label}`} />
                    </span>
                    <span className="flex items-baseline gap-1.5 whitespace-nowrap font-mono tabular">
                      <b
                        className={`text-[26px] font-medium leading-none tracking-heading ${
                          isNoValue(value) ? "text-content-muted" : "text-content-strong"
                        }`}
                      >
                        {value}
                      </b>
                      <span className="text-[13px] text-content-muted">
                        of {perMonth(r.target)} {r.of}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <Scorecard
          tiles={[
            { label: "Packs launched 30d", value: whole(d.summary?.packs30d ?? null), info: "New ad sets in the last 30 days." },
            { label: "New ads 30d", value: whole(f.newAds30d), info: "Relaunches excluded." },
            {
              label: "Prod. vs capacity",
              value: times(f.production),
              info: "New ads 30d over capacity at the last 30 days' actual spend.",
            },
            {
              label: "Days to verdict",
              value: days(f.plan.windowDays),
              info: "Until a new pack has been paid N x CPA, at least 7.",
            },
            {
              label: "Queue",
              value: queueText,
              sub: "ready / in works / briefing",
              info: "ClickUp ad tasks. Being briefed is not counted as queue.",
            },
            { label: "Brief next month", value: whole(f.brief), info: "Capacity minus ready and in works." },
          ]}
        />
      </main>
    </>
  );
}
