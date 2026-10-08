"use client";

/**
 * "Summary", the date above it, a small greeting under it and the avatar on
 * the right, as at the top of Health's Summary tab.
 *
 * Rendered first in Prague time (where the founders are), then the browser's
 * own clock takes over after mount, as the Home greeting does.
 */

import { useEffect, useState } from "react";
import { HOME_TIME_ZONE, hourIn, longDate, partOfDay } from "@/lib/home/greeting";

function initials(name: string | null): string {
  if (!name) return "";
  return name.trim().charAt(0).toUpperCase();
}

export function SummaryHeader({ name, now }: { name: string | null; now: string }) {
  const [moment, setMoment] = useState(() => {
    const d = new Date(now);
    return { part: partOfDay(hourIn(d, HOME_TIME_ZONE)), date: longDate(d, HOME_TIME_ZONE) };
  });

  useEffect(() => {
    const local = new Date();
    setMoment({ part: partOfDay(local.getHours()), date: longDate(local) });
  }, []);

  return (
    <header className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-content-muted">{moment.date}</span>
        <h2 className="m-0 text-[34px] font-bold leading-[1.1] tracking-display text-content-strong">Summary</h2>
        <span className="mt-1 text-[15px] leading-[1.35] text-content-muted">
          {name ? `${moment.part}, ${name}` : moment.part}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="mb-1 flex h-10 w-10 flex-none items-center justify-center rounded-full text-[16px] font-semibold text-paper"
        style={{ background: "var(--sm-neutral-text)" }}
      >
        {initials(name)}
      </span>
    </header>
  );
}
