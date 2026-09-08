/**
 * The line under the page title: what the numbers are measured on, and what is
 * missing.
 *
 * ── Why the attribution is always on screen ────────────────────────────────
 * Every figure in this section is 7-day click with existing customers excluded,
 * and that is not a detail. The learnings file records four months where
 * attribution windows differed between ad sets — some on 7-day click, some on
 * click-or-view — and the packs measured most strictly looked worst. The
 * numbers were not comparable and nobody could see it, because nothing on
 * screen said what they were.
 *
 * ── Why the unmapped count is a permanent badge ────────────────────────────
 * There is always a window between an ad going live and somebody mapping it,
 * and during that window its spend is invisible to every tag breakdown. A
 * queue you have to visit is a queue that does not get worked, so the count
 * follows you across all five screens.
 */

import Link from "next/link";

export function CreativeBar({
  unmapped,
  window,
  through,
  currency,
  href,
}: {
  unmapped: number;
  /** Which window the tag figures are on. */
  window: "lifetime" | "30d";
  through: string | null;
  currency: string | null;
  /** Where the unmapped pill points. */
  href: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
      <span className="font-mono text-[11.5px] text-content-muted">
        7-day click · customers excluded
      </span>

      <span className="font-mono text-[11.5px] text-content-muted">
        {window === "lifetime" ? "lifetime to date" : "last 30 days · diagnostic only"}
      </span>

      {currency && (
        <span className="font-mono text-[11.5px] text-content-muted">{currency}</span>
      )}

      {through && (
        <span className="font-mono text-[11.5px] text-content-muted">
          through {through}
        </span>
      )}

      {unmapped > 0 && (
        <Link
          href={href}
          className="inline-flex items-center gap-2 rounded-pill border border-warning/25 bg-warning/10 px-3 py-1 text-[12.5px] font-medium text-warning transition-colors duration-fast hover:bg-warning/20"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {unmapped} {unmapped === 1 ? "ad" : "ads"} unmapped
        </Link>
      )}
    </div>
  );
}
