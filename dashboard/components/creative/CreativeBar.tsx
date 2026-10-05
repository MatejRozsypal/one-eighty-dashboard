/**
 * The line under the page title: what the numbers are measured on, and what is
 * missing.
 *
 * ── Why the attribution is always on screen ────────────────────────────────
 * The learnings file records four months where attribution windows differed
 * between ad sets, some on 7-day click, some on click-or-view, and the packs
 * measured most strictly looked worst. The numbers were not comparable and
 * nobody could see it, because nothing on screen said what they were. What the
 * line says comes from one constant (`ATTRIBUTION_LABEL`), and it says only what
 * is true: today the ingest pins no window, so the figures follow each ad set's
 * own Meta setting.
 *
 * The range itself is NOT repeated here. It moved to the shared control bar
 * directly above, the same picker every other screen in the dashboard uses,
 * and printing it twice on one screen was how the old two-position toggle and
 * the app's date picker came to disagree about what "last 30 days" meant.
 *
 * ── Why the unmapped count is a permanent badge ────────────────────────────
 * There is always a window between an ad going live and somebody mapping it,
 * and during that window its spend is invisible to every tag breakdown. A
 * queue you have to visit is a queue that does not get worked, so the count
 * follows you across all five screens.
 *
 * ── Why "Updated" is here ──────────────────────────────────────────────────
 * The hit rate reads a snapshot table. `through` is the last day of data; the
 * time the snapshot was built is a different fact, and a stale tile must look
 * stale.
 */

import { AppLink } from "@/components/ui/AppLink";
import { ATTRIBUTION_LABEL } from "@/lib/creative/attribution";

export function CreativeBar({
  unmapped,
  through,
  updated = null,
  currency,
  href,
}: {
  unmapped: number;
  through: string | null;
  /** "Updated 10:10": when the hit rate snapshot was built. Null shows nothing. */
  updated?: string | null;
  currency: string | null;
  /** Where the unmapped pill points. */
  href: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
      <span className="font-mono text-[11.5px] text-content-muted">
        {ATTRIBUTION_LABEL}
      </span>

      {currency && (
        <span className="font-mono text-[11.5px] text-content-muted">{currency}</span>
      )}

      {through && (
        <span className="font-mono text-[11.5px] text-content-muted">
          through {through}
        </span>
      )}

      {updated && (
        <span
          className="font-mono text-[11.5px] text-content-muted"
          title="When the hit rate snapshot was last built"
        >
          {updated}
        </span>
      )}

      {unmapped > 0 && (
        <AppLink
          href={href}
          className="inline-flex items-center gap-2 rounded-pill border border-warning/25 bg-warning/10 px-3 py-1 text-[12.5px] font-medium text-warning transition-colors duration-fast hover:bg-warning/20"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {unmapped} {unmapped === 1 ? "ad" : "ads"} unmapped
        </AppLink>
      )}
    </div>
  );
}
