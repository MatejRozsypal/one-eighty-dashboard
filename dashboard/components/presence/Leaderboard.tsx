"use client";

/**
 * Every internal person, ranked by XP in the chosen window: level with its bar
 * to the next one, XP, streak, active time today and when they started today.
 * The viewer's own row is tinted.
 *
 * Trophies go to the top three of the window (🏆 🥈 🥉), only with XP in it,
 * so an empty morning hands out none; 🔥 marks a streak of three or more.
 * XP rules and levels: lib/presence/xp.ts. Data in by props
 * (`getPresenceBoard`); `TeamLeaderboard` in ./Presence loads it.
 */

import { useMemo, useState } from "react";
import { SegmentPills } from "@/components/controls/SegmentedControl";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE, formatNumber } from "@/lib/format";
import { formatMinutes } from "@/lib/presence/streak";
import { XP_RULES, levelFor, type XpWindow } from "@/lib/presence/xp";
import type { PresenceRow } from "@/lib/presence/types";

const WINDOWS: { value: XpWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

const TROPHIES = ["🏆", "🥈", "🥉"] as const;
const FIRE_FROM = 3;

const CARD = "flex min-w-0 flex-col rounded-card border border-hairline bg-surface-card px-2 py-2 shadow-sm sm:px-3";
const TH = "px-2.5 pb-2 pt-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted";
const TD = "px-2.5 py-2.5 align-middle";
const NUM = "text-right tabular";

export function rankRows(rows: PresenceRow[], window: XpWindow): PresenceRow[] {
  return [...rows].sort(
    (a, b) =>
      b.xp[window] - a.xp[window] ||
      b.currentStreak - a.currentStreak ||
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

function LevelCell({ xp }: { xp: number }) {
  const l = levelFor(xp);
  const pct = Math.round(l.progress * 100);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="text-[12.5px] font-semibold text-content-strong">Lv {l.level}</span>
      <span
        role="progressbar"
        aria-label={`Level ${l.level}, ${pct}% to level ${l.level + 1}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="block h-[3px] w-12 overflow-hidden rounded-pill"
        style={{ background: "var(--h-neutral-tint)" }}
      >
        <span className="block h-full rounded-pill" style={{ width: `${pct}%`, background: "var(--h-positive)" }} />
      </span>
    </span>
  );
}

function StreakCell({ row }: { row: PresenceRow }) {
  const live = row.todayCounted && row.currentStreak > 0;
  return (
    <span
      className="inline-flex items-center justify-end gap-1 whitespace-nowrap"
      style={{ color: live ? "var(--h-positive-text)" : "var(--h-neutral-text)" }}
    >
      {row.currentStreak >= FIRE_FROM && <span aria-hidden="true">🔥</span>}
      {row.currentStreak}
    </span>
  );
}

export function Leaderboard({
  rows,
  initialWindow = "week",
  title = "Leaderboard",
}: {
  rows: PresenceRow[];
  initialWindow?: XpWindow;
  title?: string;
}) {
  const [win, setWin] = useState<XpWindow>(initialWindow);
  const ranked = useMemo(() => rankRows(rows, win), [rows, win]);

  return (
    <section className="flex flex-col gap-3.5" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{title}</SectionTitle>
        <SegmentPills
          ariaLabel="Time window"
          segments={WINDOWS}
          shown={win}
          onSelect={(v) => setWin(v as XpWindow)}
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
              <Head className="hidden text-right sm:table-cell" tip="Level from all-time XP: square root of XP / 100, plus 1, rounded down.">
                Level
              </Head>
              <Head className="text-right" tip={XP_RULES}>
                XP
              </Head>
              <Head
                className="text-right"
                tip="Days in a row on the dashboard, today included once visited. Grey: not yet today, still alive until midnight Prague."
              >
                Streak
              </Head>
              <Head className="hidden text-right sm:table-cell" tip="Active time today: minutes with the tab visible and input in the last 5 minutes.">
                Today
              </Head>
              <Head className="hidden text-right md:table-cell" tip="First visit today, Prague time.">
                Started
              </Head>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, i) => {
              const cell = `${TD} ${row.isViewer ? "bg-[var(--h-info-tint)]" : "border-t border-hairline"}`;
              const trophy = i < TROPHIES.length && row.xp[win] > 0 ? TROPHIES[i] : null;
              return (
                <tr key={row.key} aria-current={row.isViewer ? "true" : undefined}>
                  <td className={`${cell} rounded-l-[10px] tabular text-content-muted`}>{i + 1}</td>
                  <td className={`${cell} min-w-0`}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold text-content-strong">
                        {row.name}
                        {trophy && (
                          <span className="ml-1.5" role="img" aria-label={`Number ${i + 1}`}>
                            {trophy}
                          </span>
                        )}
                        {row.isViewer && <span className="font-medium text-content-muted"> · you</span>}
                      </span>
                      <span className="text-[12px] text-content-muted sm:hidden">
                        Lv {levelFor(row.xp.all).level} · {formatMinutes(row.minutes.today)} today
                      </span>
                    </span>
                  </td>
                  <td className={`${cell} ${NUM} hidden sm:table-cell`}>
                    <LevelCell xp={row.xp.all} />
                  </td>
                  <td className={`${cell} ${NUM} font-semibold text-content-strong`}>{formatNumber(row.xp[win])}</td>
                  <td className={`${cell} ${NUM} rounded-r-[10px] font-semibold sm:rounded-r-none`}>
                    <StreakCell row={row} />
                  </td>
                  <td className={`${cell} ${NUM} hidden text-content-body sm:table-cell md:rounded-r-none sm:rounded-r-[10px]`}>
                    {formatMinutes(row.minutes.today)}
                  </td>
                  <td
                    className={`${cell} ${NUM} hidden rounded-r-[10px] md:table-cell ${
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
