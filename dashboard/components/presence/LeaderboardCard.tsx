"use client";

/**
 * The team leaderboard as a small side card, in the top-right corner of Home
 * (where the Shopify admin has its globe): the top three of the chosen window
 * with 🏆 🥈 🥉, then the viewer's own place and the bar to their next level.
 * "See all" opens the whole team inside the card.
 *
 * Ranked by XP in the window, then current streak, then name. A trophy needs
 * XP in the window, so an empty morning hands out none; 🔥 marks a streak of
 * three or more. XP rules and levels: lib/presence/xp.ts. Data in by props
 * (`getPresenceBoard`); `TeamLeaderboard` in ./Presence loads it.
 */

import { useMemo, useState } from "react";
import { InfoTip } from "@/components/ui/InfoTip";
import { FlameStreak } from "@/components/presence/StreakBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNumber } from "@/lib/format";
import { XP_RULES, levelFor, type XpWindow } from "@/lib/presence/xp";
import type { PresenceRow } from "@/lib/presence/types";

type CardWindow = Exclude<XpWindow, "all">;

const WINDOWS: { value: CardWindow; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const TROPHIES = ["🏆", "🥈", "🥉"] as const;
const FIRE_FROM = 3;
const CARD = "flex w-full flex-col gap-3 rounded-card border border-hairline bg-surface-card p-4 shadow-sm";

export function rankRows(rows: PresenceRow[], window: XpWindow): PresenceRow[] {
  return [...rows].sort(
    (a, b) =>
      b.xp[window] - a.xp[window] ||
      b.currentStreak - a.currentStreak ||
      a.name.localeCompare(b.name),
  );
}

function Streak({ row }: { row: PresenceRow }) {
  if (row.currentStreak <= 0) return null;
  const live = row.todayCounted;
  return (
    <span
      className="whitespace-nowrap text-[12px] font-semibold tabular"
      style={{ color: live ? "var(--h-positive-text)" : "var(--h-neutral-text)" }}
      title={`${row.currentStreak} day streak`}
    >
      {row.currentStreak >= FIRE_FROM ? <span aria-hidden="true">🔥 </span> : null}
      {row.currentStreak}d
    </span>
  );
}

function LevelBar({ xp, label }: { xp: number; label: string }) {
  const l = levelFor(xp);
  const pct = Math.round(l.progress * 100);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="block h-1.5 w-full overflow-hidden rounded-pill"
      style={{ background: "var(--h-neutral-tint)" }}
    >
      <span
        className="block h-full rounded-pill transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${pct}%`, background: "var(--h-positive)" }}
      />
    </span>
  );
}

function Row({ row, rank, win }: { row: PresenceRow; rank: number; win: CardWindow }) {
  const trophy = rank <= TROPHIES.length && row.xp[win] > 0 ? TROPHIES[rank - 1] : null;
  return (
    <li
      className={`-mx-2 flex items-center gap-2.5 rounded-[10px] px-2 py-1 ${row.isViewer ? "bg-[var(--h-info-tint)]" : ""}`}
      aria-current={row.isViewer ? "true" : undefined}
    >
      <span className="flex w-6 shrink-0 justify-center text-[15px] leading-none">
        <span className="sr-only">Rank {rank}</span>
        {trophy ? (
          <span aria-hidden="true">{trophy}</span>
        ) : (
          <span aria-hidden="true" className="text-[12px] tabular text-content-muted">
            {rank}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px] font-semibold text-content-strong">
          {row.name}
          {row.isViewer && <span className="sr-only"> (you)</span>}
        </span>
        <span className="truncate text-[11.5px] text-content-muted">Lv {levelFor(row.xp.all).level}</span>
      </span>
      <Streak row={row} />
      <span className="w-[52px] shrink-0 text-right text-[13.5px] font-semibold tabular text-content-strong">
        {formatNumber(row.xp[win])}
      </span>
    </li>
  );
}

export function LeaderboardCard({
  rows,
  initialWindow = "week",
  countsWeekends = true,
}: {
  rows: PresenceRow[];
  initialWindow?: CardWindow;
  countsWeekends?: boolean;
}) {
  const [win, setWin] = useState<CardWindow>(initialWindow);
  const [all, setAll] = useState(false);
  const ranked = useMemo(() => rankRows(rows, win), [rows, win]);
  const shown = all ? ranked : ranked.slice(0, 3);
  const viewerRank = ranked.findIndex((r) => r.isViewer) + 1;
  const viewer = viewerRank > 0 ? ranked[viewerRank - 1] : null;
  const level = viewer ? levelFor(viewer.xp.all) : null;

  return (
    <div className={CARD}>
      {viewer && <FlameStreak row={viewer} countsWeekends={countsWeekends} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 inline-flex items-center gap-1 text-[15px] font-semibold text-content-strong">
          Leaderboard
          <span className="text-[11px] font-normal leading-none">
            <InfoTip text={`Ranked by XP in the window. ${XP_RULES} Level: square root of all-time XP / 100, plus 1.`} label="About XP" />
          </span>
        </h2>
        <div role="group" aria-label="Time window" className="flex rounded-pill p-0.5" style={{ background: "var(--h-neutral-tint)" }}>
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              aria-pressed={win === w.value}
              onClick={() => setWin(w.value)}
              className={`rounded-pill px-2 py-0.5 text-[11.5px] font-semibold transition-colors duration-fast ${
                win === w.value ? "bg-surface-card text-content-strong shadow-xs" : "text-content-muted hover:text-content-strong"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-content-muted">
        <span>Team</span>
        <span>XP</span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((row) => (
          <Row key={row.key} row={row} rank={ranked.indexOf(row) + 1} win={win} />
        ))}
      </ol>

      {viewer && level && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-[12.5px]">
            <span className="font-semibold text-content-strong">You · #{viewerRank}</span>
            <span className="font-semibold text-content-strong">Lv {level.level}</span>
          </div>
          <LevelBar xp={viewer.xp.all} label={`Level ${level.level}, ${Math.round(level.progress * 100)}% to level ${level.level + 1}`} />
          <span className="text-right text-[11.5px] tabular text-content-muted">
            {formatNumber(Math.max(0, level.nextXp - viewer.xp.all))} XP to Lv {level.level + 1}
          </span>
        </div>
      )}

      {ranked.length > 3 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="self-start text-[12.5px] font-semibold text-content-muted transition-colors duration-fast hover:text-content-strong"
        >
          {all ? "Show top 3" : `See all ${ranked.length}`}
        </button>
      )}
    </div>
  );
}

export function LeaderboardCardSkeleton() {
  return (
    <div className={CARD} aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-[96px] rounded-pill" />
        <Skeleton className="h-6 w-[132px] rounded-pill" />
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-8 w-full rounded-xs" />
      ))}
      <Skeleton className="h-12 w-full rounded-[12px]" />
    </div>
  );
}
