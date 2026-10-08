"use client";

/**
 * The long date ("THURSDAY 8 OCTOBER") and the large greeting, centred.
 *
 * Rendered first in Prague time, where the founders are, so the first paint
 * is right for them; after mount the browser's own clock takes over, which
 * only changes anything for someone travelling.
 */

import { useEffect, useState } from "react";
import { HOME_TIME_ZONE, hourIn, longDate, partOfDay } from "@/lib/home/greeting";

export function GreetingHeader({ name, now }: { name: string | null; now: string }) {
  const [moment, setMoment] = useState(() => {
    const d = new Date(now);
    return { part: partOfDay(hourIn(d, HOME_TIME_ZONE)), date: longDate(d, HOME_TIME_ZONE) };
  });

  useEffect(() => {
    const local = new Date();
    setMoment({ part: partOfDay(local.getHours()), date: longDate(local) });
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-content-muted">{moment.date}</span>
      <h1 className="m-0 text-[32px] font-bold leading-[1.1] tracking-heading text-content-strong sm:text-[40px]">
        {name ? `${moment.part}, ${name}.` : `${moment.part}.`}
      </h1>
    </div>
  );
}
