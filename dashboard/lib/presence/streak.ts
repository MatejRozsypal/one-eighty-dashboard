/**
 * Streaks and calendar windows for presence. Pure: no database, no clock of
 * its own. Every date is a Prague calendar day as "YYYY-MM-DD".
 *
 * A day counts when the person has any `presence_days` row for it, which the
 * heartbeat writes the first time they are on the dashboard that day.
 *
 * Current streak: consecutive counted days ending today. When today has no
 * visit yet the streak ends yesterday instead and is still alive: it only
 * breaks once a whole day passes with no visit.
 */

/** The founders' "every day". Flip to false and Saturday and Sunday neither count nor break a streak. */
export const STREAK_COUNTS_WEEKENDS = true;

/** Presence days are Prague calendar days, whatever the server's own zone. */
export const PRESENCE_TIME_ZONE = "Europe/Prague";

/** "YYYY-MM-DD" for an instant, in Prague. */
export function pragueDay(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PRESENCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "HH:MM" for an instant, in Prague. */
export function pragueClock(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: PRESENCE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function toUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** 0 Sunday to 6 Saturday. */
function weekday(day: string): number {
  return toUtc(day).getUTCDay();
}

/** Whether a day takes part in streaks at all. */
export function isStreakDay(day: string, countsWeekends = STREAK_COUNTS_WEEKENDS): boolean {
  if (countsWeekends) return true;
  const w = weekday(day);
  return w !== 0 && w !== 6;
}

function previousStreakDay(day: string, countsWeekends: boolean): string {
  let d = addDays(day, -1);
  while (!isStreakDay(d, countsWeekends)) d = addDays(d, -1);
  return d;
}

/** Monday of the day's week (weeks run Monday to Sunday). */
export function weekStart(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** First day of the day's month. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export interface Streak {
  current: number;
  best: number;
  /** Today already has a visit. False means the current streak is waiting on today. */
  todayCounted: boolean;
}

/**
 * Current and best streak from the set of visited days.
 *
 * With weekends switched off, a Saturday or Sunday is skipped over: it neither
 * extends nor breaks a run, so Friday then Monday is two in a row.
 */
export function computeStreak(
  visited: Iterable<string>,
  today: string,
  countsWeekends = STREAK_COUNTS_WEEKENDS,
): Streak {
  const days = new Set<string>();
  for (const d of visited) if (isStreakDay(d, countsWeekends)) days.add(d);

  const todayCounted = days.has(today);

  // Today counts if visited; otherwise the run may still end on the last streak day before it.
  // A weekend today (with weekends off) is not a streak day, so it also starts from the day before.
  let cursor = todayCounted ? today : previousStreakDay(today, countsWeekends);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = previousStreakDay(cursor, countsWeekends);
  }

  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of Array.from(days).sort()) {
    run = prev !== null && previousStreakDay(d, countsWeekends) === prev ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }

  return { current, best: Math.max(best, current), todayCounted };
}

/** "3h 05m", "45m", "0m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return `${h}h ${String(rest).padStart(2, "0")}m`;
}
