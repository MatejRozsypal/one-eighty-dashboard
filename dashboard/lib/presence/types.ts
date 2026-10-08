/**
 * What the presence components render. Safe in client components: no emails,
 * only display names and a stable key.
 */

export type PresencePeriod = "today" | "week" | "month";

export interface PresenceRow {
  /** Stable React key; not the email. */
  key: string;
  name: string;
  isViewer: boolean;
  currentStreak: number;
  bestStreak: number;
  /** Today already has a visit, so the current streak includes it. */
  todayCounted: boolean;
  minutes: Record<PresencePeriod, number>;
  /** First heartbeat today, "HH:MM" Prague. Null before the first visit. */
  startedToday: string | null;
}

export interface PresenceBoard {
  /** "YYYY-MM-DD", Prague. */
  today: string;
  countsWeekends: boolean;
  rows: PresenceRow[];
  /** The viewer's own row, for the streak badge. Null when they are not internal. */
  viewer: PresenceRow | null;
}
