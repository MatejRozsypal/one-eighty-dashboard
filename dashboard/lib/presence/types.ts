/**
 * What the presence components render. Safe in client components: no emails,
 * only display names and a stable key.
 */

import type { XpWindow } from "@/lib/presence/xp";

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
  /** XP per window, by the rules in lib/presence/xp.ts. `all` sets the level. */
  xp: Record<XpWindow, number>;
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
