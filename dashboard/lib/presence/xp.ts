/**
 * XP and levels for the presence leaderboard. Pure: no database, no clock of
 * its own, safe in client components. Every date is a Prague calendar day as
 * "YYYY-MM-DD", the same days `presence_days` holds.
 *
 * ── XP for one day present ─────────────────────────────────────────────────
 *   +10            for showing up (any presence row that day)
 *   +1 a minute    of active time, at most 300 a day, so a tab left open
 *                  cannot farm (the heartbeat already drops idle and hidden
 *                  tabs; the cap stops a jiggled mouse too)
 *   +5 x streak    the streak length that day, counted to at most 10,
 *                  so at most +50
 * A day with no row earns nothing.
 *
 * "Streak length that day" is the run of consecutive streak days ending on
 * that day, by the same calendar as `computeStreak` in ./streak: with
 * weekends switched off, a weekend neither extends nor breaks a run, and a
 * visit on a weekend earns the show-up and minutes XP but no streak bonus.
 *
 * ── Windows ────────────────────────────────────────────────────────────────
 * Today, this week (Monday to today), this month (the 1st to today) and all
 * time, all ending today. Days after today are ignored.
 *
 * ── Level ──────────────────────────────────────────────────────────────────
 * level = floor(sqrt(allTimeXP / 100)) + 1, so level n starts at
 * 100 x (n - 1)^2 XP: 0, 100, 400, 900, 1600 ...
 *
 * Check: npx tsx --tsconfig scripts/tsconfig.json scripts/check-presence-xp.ts
 */

import { STREAK_COUNTS_WEEKENDS, addDays, isStreakDay, monthStart, weekStart } from "@/lib/presence/streak";

export const XP_SHOW_UP = 10;
export const XP_PER_MINUTE = 1;
export const XP_MINUTE_CAP = 300;
export const XP_PER_STREAK_DAY = 5;
export const XP_STREAK_CAP = 10;

/** The rules in one line, for the (i). */
export const XP_RULES =
  "+10 XP a day you show up, +1 per active minute (max 300 a day), +5 per streak day (max +50).";

export type XpWindow = "today" | "week" | "month" | "all";

export interface XpDay {
  /** "YYYY-MM-DD", Prague. */
  day: string;
  activeMinutes: number;
}

/** XP for one day present, given its active minutes and the streak length that day. */
export function dayXp(activeMinutes: number, streak: number): number {
  const minutes = Math.min(Math.max(0, Math.round(activeMinutes)), XP_MINUTE_CAP);
  const run = Math.min(Math.max(0, Math.floor(streak)), XP_STREAK_CAP);
  return XP_SHOW_UP + XP_PER_MINUTE * minutes + XP_PER_STREAK_DAY * run;
}

function previousStreakDay(day: string, countsWeekends: boolean): string {
  let d = addDays(day, -1);
  while (!isStreakDay(d, countsWeekends)) d = addDays(d, -1);
  return d;
}

/** The streak length on each visited streak day (non-streak days are absent). */
export function streakByDay(days: Iterable<string>, countsWeekends = STREAK_COUNTS_WEEKENDS): Map<string, number> {
  const sorted = Array.from(new Set(days))
    .filter((d) => isStreakDay(d, countsWeekends))
    .sort();
  const out = new Map<string, number>();
  let prev: string | null = null;
  let run = 0;
  for (const d of sorted) {
    run = prev !== null && previousStreakDay(d, countsWeekends) === prev ? run + 1 : 1;
    out.set(d, run);
    prev = d;
  }
  return out;
}

/** XP earned on each day present. Two rows for one day are summed as one day. */
export function xpByDay(days: XpDay[], countsWeekends = STREAK_COUNTS_WEEKENDS): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const d of days) minutes.set(d.day, (minutes.get(d.day) ?? 0) + (Number(d.activeMinutes) || 0));
  const streaks = streakByDay(minutes.keys(), countsWeekends);
  const out = new Map<string, number>();
  for (const [day, m] of minutes) out.set(day, dayXp(m, streaks.get(day) ?? 0));
  return out;
}

/** XP in each window ending `today`. */
export function xpWindows(
  days: XpDay[],
  today: string,
  countsWeekends = STREAK_COUNTS_WEEKENDS,
): Record<XpWindow, number> {
  const week = weekStart(today);
  const month = monthStart(today);
  const sums: Record<XpWindow, number> = { today: 0, week: 0, month: 0, all: 0 };
  for (const [day, xp] of xpByDay(days, countsWeekends)) {
    if (day > today) continue;
    sums.all += xp;
    if (day >= month) sums.month += xp;
    if (day >= week) sums.week += xp;
    if (day === today) sums.today += xp;
  }
  return sums;
}

export interface Level {
  level: number;
  /** All-time XP where this level starts. */
  floorXp: number;
  /** All-time XP where the next level starts. */
  nextXp: number;
  /** 0 to 1 of the way to the next level. */
  progress: number;
}

/** level = floor(sqrt(totalXP / 100)) + 1, with the bar to the next one. */
export function levelFor(totalXp: number): Level {
  const xp = Math.max(0, Number.isFinite(totalXp) ? totalXp : 0);
  let level = Math.floor(Math.sqrt(xp / 100)) + 1;
  // Guard against sqrt rounding at an exact boundary.
  while (100 * level * level <= xp) level += 1;
  while (level > 1 && 100 * (level - 1) * (level - 1) > xp) level -= 1;
  const floorXp = 100 * (level - 1) * (level - 1);
  const nextXp = 100 * level * level;
  return { level, floorXp, nextXp, progress: (xp - floorXp) / (nextXp - floorXp) };
}
