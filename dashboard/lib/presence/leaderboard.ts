import "server-only";

/**
 * Everything the streak badge and the leaderboard need, for the signed-in
 * viewer. Memoised per request, so a page can render both components and pay
 * for one load.
 *
 * Opening a page that renders this records the viewer's presence first. The
 * browser heartbeat does the same a moment later, but the server render comes
 * before it, and without this the first visit of the day would show the
 * viewer's own streak as "not yet today" on the very page they are looking at.
 * Same minute, same row, so it never adds a second minute.
 *
 * Returns null for a client-role viewer, for no session, and when Postgres is
 * unavailable: the components then render nothing rather than break the page.
 */

import * as React from "react";
import { currentAccess, isInternal } from "@/lib/authz";
import { firstName } from "@/lib/home/greeting";
import { internalPeople, presenceDays, recordHeartbeat } from "@/lib/presence/store";
import {
  STREAK_COUNTS_WEEKENDS,
  computeStreak,
  monthStart,
  pragueClock,
  pragueDay,
  weekStart,
} from "@/lib/presence/streak";
import type { PresenceBoard, PresencePeriod, PresenceRow } from "@/lib/presence/types";

const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  (React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn);

async function load(): Promise<PresenceBoard | null> {
  const access = await currentAccess();
  if (!access || !isInternal(access.role)) return null;
  const viewerEmail = access.email.toLowerCase();

  try {
    await recordHeartbeat(viewerEmail).catch((error: unknown) => {
      console.error("[presence] could not record the page view", error);
    });

    const people = await internalPeople();
    if (!people.some((p) => p.email === viewerEmail)) people.push({ email: viewerEmail, name: null });
    const days = await presenceDays(people.map((p) => p.email));

    const today = pragueDay(new Date());
    const week = weekStart(today);
    const month = monthStart(today);

    const byEmail = new Map<string, typeof days>();
    for (const d of days) {
      const list = byEmail.get(d.email) ?? [];
      list.push(d);
      byEmail.set(d.email, list);
    }

    const rows: PresenceRow[] = people.map((person, i) => {
      const own = byEmail.get(person.email) ?? [];
      const streak = computeStreak(own.map((d) => d.day), today, STREAK_COUNTS_WEEKENDS);
      const sum = (from: string) => own.filter((d) => d.day >= from && d.day <= today).reduce((n, d) => n + d.activeMinutes, 0);
      const todayRow = own.find((d) => d.day === today);
      const minutes: Record<PresencePeriod, number> = {
        today: todayRow?.activeMinutes ?? 0,
        week: sum(week),
        month: sum(month),
      };
      return {
        key: `p${i}`,
        name: firstName(person.name, person.email) ?? person.email.split("@")[0] ?? "n/a",
        isViewer: person.email === viewerEmail,
        currentStreak: streak.current,
        bestStreak: streak.best,
        todayCounted: streak.todayCounted,
        minutes,
        startedToday: todayRow ? pragueClock(new Date(todayRow.firstSeen)) : null,
      };
    });

    return {
      today,
      countsWeekends: STREAK_COUNTS_WEEKENDS,
      rows,
      viewer: rows.find((r) => r.isViewer) ?? null,
    };
  } catch (error) {
    console.error("[presence] could not load the leaderboard", error);
    return null;
  }
}

export const getPresenceBoard: () => Promise<PresenceBoard | null> = perRequest(load);
