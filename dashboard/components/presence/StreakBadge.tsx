/**
 * The viewer's streak as a pill: "12 day streak · 45 XP today". Green once today counts,
 * grey while the streak is still waiting on today (it stays alive until the
 * day ends). No ring: a streak has no goal for one rotation to stand for.
 *
 * Server friendly, data in by props. `TeamStreak` in ./Presence loads it.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { formatNumber } from "@/lib/format";
import { XP_RULES } from "@/lib/presence/xp";
import type { PresenceRow } from "@/lib/presence/types";

export function streakLabel(days: number): string {
  if (days <= 0) return "No streak";
  return `${days} day streak`;
}

export function StreakBadge({
  row,
  countsWeekends = true,
}: {
  row: Pick<PresenceRow, "currentStreak" | "bestStreak" | "todayCounted"> & Partial<Pick<PresenceRow, "xp">>;
  countsWeekends?: boolean;
}) {
  const live = row.todayCounted && row.currentStreak > 0;
  const tone = live ? "positive" : "neutral";
  const tip =
    `Days in a row on the dashboard${countsWeekends ? ", weekends included" : ", weekdays only"}. ` +
    `A full day away resets it. Best: ${row.bestStreak}. ${XP_RULES}`;
  const xpToday = row.todayCounted && row.xp ? row.xp.today : null;

  return (
    <span
      className="inline-flex w-fit items-center gap-2 rounded-pill py-1 pl-2 pr-2.5 text-[13px] font-semibold leading-none tabular"
      style={{ background: `var(--h-${tone}-tint)`, color: `var(--h-${tone}-text)` }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: live ? `var(--h-${tone})` : "transparent", boxShadow: `inset 0 0 0 1.5px var(--h-${tone})` }}
      />
      <span>
        {streakLabel(row.currentStreak)}
        {!row.todayCounted && row.currentStreak > 0 && <span className="font-medium"> · not yet today</span>}
        {xpToday !== null && <span> · {formatNumber(xpToday)} XP today</span>}
      </span>
      <InfoTip text={tip} label="About the streak" />
    </span>
  );
}

/**
 * The viewer's streak, Duolingo style: a flame and the day count. Orange once
 * today counts, grey while the streak still waits on today.
 */
export function FlameStreak({
  row,
  countsWeekends = true,
}: {
  row: Pick<PresenceRow, "currentStreak" | "bestStreak" | "todayCounted"> & Partial<Pick<PresenceRow, "xp">>;
  countsWeekends?: boolean;
}) {
  const live = row.todayCounted && row.currentStreak > 0;
  const tip =
    `Days in a row on the dashboard${countsWeekends ? ", weekends included" : ", weekdays only"}. ` +
    `A full day away resets it. Best: ${row.bestStreak}. ${XP_RULES}`;
  const xpToday = row.todayCounted && row.xp ? row.xp.today : null;
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true" className="shrink-0">
        <path
          d="M17 1c1.6 6.2 7.4 9.1 10.6 14.2 3.6 5.8 2.9 13.6-2.1 18.6-4.5 4.5-11.8 5.4-17.1 2.1C2.6 32.2.4 24.9 3.6 18.6c1.3-2.6 3.4-4.5 5.1-6.8.3 2.9 1.4 5.4 3.6 7.1C10.9 12.6 13 6.2 17 1z"
          fill={live ? "#FF9600" : "#D7D7D7"}
        />
        <path
          d="M17.6 18.8c3.2 2.9 5.6 6.2 5.1 10.2-.4 3.5-3.3 6.1-6.7 6.1-3.6 0-6.4-2.9-6.4-6.4 0-2.4 1.3-4.2 2.9-5.8.2 1.6.9 2.9 2.2 3.8.3-2.9 1.4-5.6 2.9-7.9z"
          fill={live ? "#FFC800" : "#EDEDED"}
        />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="inline-flex items-baseline gap-1.5">
          <span
            className="text-[26px] font-extrabold tabular"
            style={{ color: live ? "#FF9600" : "var(--content-muted, #8a8a8a)" }}
          >
            {row.currentStreak}
          </span>
          <span className="text-[13px] font-semibold text-content-strong">
            day streak
          </span>
          <span className="text-[11px] font-normal leading-none">
            <InfoTip text={tip} label="About the streak" />
          </span>
        </span>
        <span className="text-[12px] text-content-muted">
          {live
            ? xpToday !== null
              ? `${formatNumber(xpToday)} XP today`
              : "Counted today"
            : row.currentStreak > 0
              ? "Not yet today"
              : "Start one today"}
        </span>
      </div>
    </div>
  );
}
