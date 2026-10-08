/**
 * One quote a day on Home, with its author.
 *
 * A server component with no client JS: it picks the quote for the calendar
 * day in Prague at render time, so the line is fixed in the HTML and cannot
 * change on hydration, and everyone sees the same one all day. Pass `date`
 * only to show another day's quote. The source sits in the author's tooltip;
 * `docs/sessions/2026-10-08/home-quotes-sources.md` lists the URL each quote
 * was checked against.
 */

import { quoteForDay } from "@/lib/home/quotes";

export function DailyQuote({ date }: { date?: Date } = {}) {
  const quote = quoteForDay(date ?? new Date());
  return (
    <figure className="m-0 flex w-full max-w-[560px] flex-col items-center gap-1 text-center">
      <blockquote className="m-0 text-balance text-[14px] leading-[1.5] text-content-muted">{quote.text}</blockquote>
      <figcaption className="text-[12.5px] font-medium text-content-body">
        <span title={quote.source}>{quote.author}</span>
      </figcaption>
    </figure>
  );
}
