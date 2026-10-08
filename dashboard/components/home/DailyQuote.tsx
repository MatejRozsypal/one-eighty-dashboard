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
    <figure className="m-0 flex max-w-[620px] flex-col gap-1 border-l-2 border-hairline pl-3">
      <blockquote className="m-0 text-[15px] leading-[1.45] text-content-body">{quote.text}</blockquote>
      <figcaption className="text-[13px] font-medium text-content-muted">
        <span title={quote.source}>{quote.author}</span>
      </figcaption>
    </figure>
  );
}
