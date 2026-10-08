"use client";

/**
 * "Good morning, Matt" and today's date.
 *
 * The server renders it in Prague time, where the founders are, so the first
 * paint is already right for them; after mount the browser's own clock takes
 * over, which only changes anything for someone travelling. Rendering it on
 * the client alone would flash an empty line on every visit.
 */

import { useEffect, useState } from "react";
import { HOME_TIME_ZONE, hourIn, longDate, partOfDay } from "@/lib/home/greeting";

export function Greeting({ name, now }: { name: string | null; now: string }) {
  const [moment, setMoment] = useState(() => {
    const d = new Date(now);
    return { part: partOfDay(hourIn(d, HOME_TIME_ZONE)), date: longDate(d, HOME_TIME_ZONE) };
  });

  useEffect(() => {
    const local = new Date();
    setMoment({ part: partOfDay(local.getHours()), date: longDate(local) });
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-content-muted">{moment.date}</span>
      <h2 className="m-0 text-[30px] font-bold leading-[1.1] tracking-heading text-content-strong sm:text-[34px]">
        {name ? `${moment.part}, ${name}` : moment.part}
      </h2>
    </div>
  );
}
