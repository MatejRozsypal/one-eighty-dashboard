/**
 * The viewer's streak as a pill: "12 day streak". Green once today counts,
 * grey while the streak is still waiting on today (it stays alive until the
 * day ends). No ring: a streak has no goal for one rotation to stand for.
 *
 * Server friendly, data in by props. `TeamStreak` in ./Presence loads it.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import type { PresenceRow } from "@/lib/presence/types";

export function streakLabel(days: number): string {
  if (days <= 0) return "No streak";
  return `${days} day streak`;
}

export function StreakBadge({
  row,
  countsWeekends = true,
}: {
  row: Pick<PresenceRow, "currentStreak" | "bestStreak" | "todayCounted">;
  countsWeekends?: boolean;
}) {
  const live = row.todayCounted && row.currentStreak > 0;
  const tone = live ? "positive" : "neutral";
  const tip =
    `Days in a row on the dashboard${countsWeekends ? ", weekends included" : ", weekdays only"}. ` +
    `Today counts once you visit; a full day away resets it. Best: ${row.bestStreak}.`;

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
      {streakLabel(row.currentStreak)}
      {!row.todayCounted && row.currentStreak > 0 && <span className="font-medium">· not yet today</span>}
      <InfoTip text={tip} label="About the streak" />
    </span>
  );
}
