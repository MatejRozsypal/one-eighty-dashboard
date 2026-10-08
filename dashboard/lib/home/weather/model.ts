/**
 * Home, Forecast variant: the data model. Pure types and helpers, safe in
 * client components.
 *
 * The page borrows Apple Weather's layout: a hero with one big reading, an
 * hourly strip, a ten-day list and a grid of condition tiles. Every reading
 * on it is a warehouse or ClickUp figure, or a sum or ratio of them; nothing
 * is projected, scored or smoothed here. Where a source cannot answer, the
 * value is null and travels with the note that says why.
 */

import type { ClientHealth, HomeData, SourceState } from "@/lib/home/types";
import type { HealthTone } from "@/lib/plan/health";

/** Which plan metric the daily strip shows. */
export type StripMetric = "revenue" | "cm3";

/**
 * One day of the month, summed over the clients in the strip.
 *
 * `past`: every client in the strip has data for the day. `future`: none
 * has yet, so only the plan is shown. `partial`: some have, some have not,
 * so the sum would be short and the actual is n/a.
 */
export interface StripDay {
  date: string;
  state: "past" | "future" | "partial";
  /** Sum of the day's plan (the Goals daily curve) over the strip's clients. */
  target: number | null;
  /** Sum of the day's actual. Null unless every client has a measured actual. */
  actual: number | null;
  /** Why `actual` is n/a on a day that has started. */
  note: string | null;
}

export interface StripSeries {
  metric: StripMetric;
  /** The one currency every summed client trades in. */
  currency: string;
  /** Clients summed into the strip. */
  clients: string[];
  /** Clients with a plan for the metric left out because they trade in another currency. */
  excluded: string[];
  days: StripDay[];
  /** Month rows of the same clients, summed: actual to date, plan to date, month target. */
  monthActual: number | null;
  monthTargetToDate: number | null;
  monthTarget: number | null;
}

export interface StripData {
  /** "October 2026", from the pacing rows. */
  monthLabel: string | null;
  /** Every date of the month, `YYYY-MM-DD`. */
  dates: string[];
  revenue: StripSeries | null;
  cm3: StripSeries | null;
  /** Why there is no strip at all (the day rows could not be read). */
  note: string | null;
}

/** One client's ad spend against this month's plan. */
export interface SpendLine {
  clientId: string;
  name: string;
  /** Actual over plan to date, in percent, as the warehouse computes it. */
  pacePct: number | null;
  tone: HealthTone;
  statusLabel: string;
}

export interface SpendTile {
  lines: SpendLine[];
  /** Sum of actual over sum of plan to date, same-currency clients only. Percent. */
  combinedPct: number | null;
  currency: string | null;
  note: string | null;
}

export interface QueueLine {
  clientId: string;
  name: string;
  ready: number;
  inWorks: number;
  briefing: number;
}

export interface QueueTile {
  state: SourceState;
  lines: QueueLine[];
  /** Ready plus in works, all clients. */
  queued: number | null;
  briefing: number | null;
  note: string | null;
}

export interface UnmappedLine {
  clientId: string;
  name: string;
  ads: number;
}

export interface UnmappedTile {
  state: SourceState;
  lines: UnmappedLine[];
  total: number | null;
  note: string | null;
}

export interface FeedLine {
  clientId: string;
  name: string;
  feed: string;
  status: string;
  stalenessHours: number | null;
  maxHours: number | null;
}

export interface FeedTile {
  state: SourceState;
  total: number | null;
  ok: number | null;
  /** Feeds not `ok`, worst first. */
  issues: FeedLine[];
  /** Latest check time of the hourly freshness job. */
  checkedAt: string | null;
  note: string | null;
}

export interface ForecastData {
  home: HomeData;
  strip: StripData;
  spend: SpendTile;
  queue: QueueTile;
  unmapped: UnmappedTile;
  feeds: FeedTile;
}

/* ------------------------------------------------------------------------ */
/* Helpers shared by the components                                         */
/* ------------------------------------------------------------------------ */

/** "2026-10-07" -> { weekday: "Wed", day: 7 } (UTC, so a date never shifts). */
export function dayParts(iso: string): { weekday: string; day: number; month: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return {
    weekday: date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    day: date.getUTCDate(),
    month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
  };
}

/** A client's month as the hero reads it: name and pace of its ring metric. */
export interface PaceExtreme {
  name: string;
  /** Percent of the plan to date, the warehouse's `pace_pct`. */
  pacePct: number;
}

/**
 * The hero's "agency temperature": of the clients with a plan this month, how
 * many have their ring metric on track or ahead (the Goals status), plus the
 * best and worst pace among them. Counts of warehouse statuses, nothing more.
 */
export interface AgencyReading {
  withPlan: number;
  onPlan: number;
  /** onPlan / withPlan. Null without a single plan. */
  share: number | null;
  /** Clients in the registry with no plan this month (named in the tooltip). */
  withoutPlan: string[];
  high: PaceExtreme | null;
  low: PaceExtreme | null;
}

export function agencyReading(clients: ClientHealth[]): AgencyReading {
  const planned = clients.filter((c) => c.focus);
  const onPlan = planned.filter((c) => c.focus && (c.focus.status === "on_track" || c.focus.status === "ahead"));
  const paced = planned
    .filter((c) => c.focus && c.focus.pacePct !== null && Number.isFinite(c.focus.pacePct))
    .map((c) => ({ name: c.name, pacePct: c.focus?.pacePct as number }))
    .sort((a, b) => b.pacePct - a.pacePct);
  return {
    withPlan: planned.length,
    onPlan: onPlan.length,
    share: planned.length ? onPlan.length / planned.length : null,
    withoutPlan: clients.filter((c) => !c.focus && c.clientId).map((c) => c.name),
    high: paced[0] ?? null,
    low: paced.length > 1 ? paced[paced.length - 1] : null,
  };
}

/** Today's date in a time zone, `YYYY-MM-DD`. */
export function isoToday(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
