"use client";

/**
 * Every internal person: streak, best streak, active time and when they
 * started today. The viewer's own row is tinted.
 *
 * The control picks the time window. That window's column leads the time
 * columns and breaks ties in the ranking, which is current streak first.
 * Data in by props (`getPresenceBoard`); `TeamLeaderboard` in ./Presence
 * loads it.
 */

import { useMemo, useState } from "react";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import { formatMinutes } from "@/lib/presence/streak";
import type { PresencePeriod, PresenceRow } from "@/lib/presence/types";

const PERIODS: { value: PresencePeriod; label: string; column: string }[] = [
  { value: "today", label: "Today", column: "Today" },
  { value: "week", label: "This week", column: "Week" },
  { value: "month", label: "This month", column: "Month" },
];

const CARD = "flex min-w-0 flex-col rounded-card border border-hairline bg-surface-card px-2 py-2 shadow-sm sm:px-3";
const TH = "px-2.5 pb-2 pt-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted";
const TD = "px-2.5 py-2.5 align-middle";
const NUM = "text-right tabular";

export function rankRows(rows: PresenceRow[], period: PresencePeriod): PresenceRow[] {
  return [...rows].sort(
    (a, b) =>
      b.currentStreak - a.currentStreak ||
      b.minutes[period] - a.minutes[period] ||
      a.name.localeCompare(b.name),
  );
}

function Head({ children, tip, className = "" }: { children: string; tip?: string; className?: string }) {
  return (
    <th scope="col" className={`${TH} ${className}`}>
      <span className="inline-flex items-center gap-1">
        {children}
        {tip && <InfoTip text={tip} label={`About ${children}`} />}
      </span>
    </th>
  );
}

export function Leaderboard({
  rows,
  initialPeriod = "week",
  title = "Leaderboard",
}: {
  rows: PresenceRow[];
  initialPeriod?: PresencePeriod;
  title?: string;
}) {
  const [period, setPeriod] = useState<PresencePeriod>(initialPeriod);
  const ranked = useMemo(() => rankRows(rows, period), [rows, period]);
  const lead = PERIODS.find((p) => p.value === period) ?? PERIODS[1];
  const others = PERIODS.filter((p) => p.value !== period);

  return (
    <section className="flex flex-col gap-3.5" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{title}</SectionTitle>
        <SegmentPills
          ariaLabel="Time window"
          segments={PERIODS.map(({ value, label }) => ({ value, label }))}
          shown={period}
          onSelect={(v) => setPeriod(v as PresencePeriod)}
        />
      </div>

      <div className={CARD}>
        <table className="w-full border-separate border-spacing-0 text-[13.5px]">
          <thead>
            <tr>
              <th scope="col" className={`${TH} w-8`}>
                <span className="sr-only">Rank</span>
              </th>
              <Head>Name</Head>
              <Head
                className="text-right"
                tip="Days in a row on the dashboard, today included once visited. Grey: not yet today, still alive until midnight Prague."
              >
                Streak
              </Head>
              <Head className="hidden text-right sm:table-cell">Best</Head>
              <Head className="text-right" tip="Active time: minutes with the tab visible and input in the last 5 minutes.">
                {lead.column}
              </Head>
              {others.map((p) => (
                <Head key={p.value} className="hidden text-right md:table-cell">
                  {p.column}
                </Head>
              ))}
              <Head className="hidden text-right sm:table-cell" tip="First visit today, Prague time.">
                Started
              </Head>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, i) => {
              const cell = `${TD} ${row.isViewer ? "bg-[var(--h-info-tint)]" : "border-t border-hairline"}`;
              return (
                <tr key={row.key} aria-current={row.isViewer ? "true" : undefined}>
                  <td className={`${cell} rounded-l-[10px] tabular text-content-muted`}>{i + 1}</td>
                  <td className={`${cell} min-w-0`}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold text-content-strong">
                        {row.name}
                        {row.isViewer && <span className="font-medium text-content-muted"> · you</span>}
                      </span>
                      <span className="text-[12px] text-content-muted sm:hidden">
                        Best {row.bestStreak} · {row.startedToday ?? NO_VALUE}
                      </span>
                    </span>
                  </td>
                  <td
                    className={`${cell} ${NUM} font-semibold`}
                    style={{ color: row.todayCounted && row.currentStreak > 0 ? "var(--h-positive-text)" : "var(--h-neutral-text)" }}
                  >
                    {row.currentStreak}
                  </td>
                  <td className={`${cell} ${NUM} hidden text-content-body sm:table-cell`}>{row.bestStreak}</td>
                  <td className={`${cell} ${NUM} rounded-r-[10px] font-semibold text-content-strong sm:rounded-r-none`}>
                    {formatMinutes(row.minutes[period])}
                  </td>
                  {others.map((p) => (
                    <td key={p.value} className={`${cell} ${NUM} hidden text-content-body md:table-cell`}>
                      {formatMinutes(row.minutes[p.value])}
                    </td>
                  ))}
                  <td
                    className={`${cell} ${NUM} hidden rounded-r-[10px] sm:table-cell ${
                      row.startedToday ? "text-content-body" : "text-content-muted"
                    }`}
                  >
                    {row.startedToday ?? NO_VALUE}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
