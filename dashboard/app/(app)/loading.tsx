/**
 * Route-level loading state.
 *
 * Every page in this group is `force-dynamic` and awaits BigQuery, which runs
 * 2–5 seconds on wide ranges. Without this file the App Router holds the
 * previous page on screen, fully interactive, for that entire time — so
 * clicking a nav item looks like nothing happened and users click it again.
 *
 * This covers navigation *between* pages. Changing a search param on the page
 * you are already on does not remount the segment and never reaches here; that
 * case is handled by `RouteProgress`, driven from each control's own
 * `useTransition`. The two together mean no interaction is ever silent.
 *
 * Deliberately generic. The pages differ below the fold, but all of them open
 * with a header, a control strip and a row of metric cards, and a skeleton
 * that guesses wrong is worse than one that stays vague.
 */

import { MetricCardSkeleton } from "@/components/dashboard/MetricCard";

const shimmer =
  "bg-[linear-gradient(90deg,var(--gray-100)_25%,var(--gray-150)_37%,var(--gray-100)_63%)] bg-[length:320px_100%] animate-[oe-shimmer_1.3s_linear_infinite]";

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3 border-b border-hairline bg-paper px-5 lg:px-8">
        <span className={`h-[15px] w-[132px] rounded-xs ${shimmer}`} />
        <span className={`h-[9px] w-[104px] rounded-pill ${shimmer}`} />
      </div>

      <div className="sticky top-[var(--header-h)] z-20 flex items-center gap-4 border-b border-hairline bg-paper px-5 py-2 lg:px-8">
        <span className={`h-[34px] w-[232px] rounded-control ${shimmer}`} />
        <span className={`h-[30px] w-[216px] rounded-pill ${shimmer}`} />
        <span className={`hidden h-[30px] w-[188px] rounded-pill lg:block ${shimmer}`} />
      </div>

      <main
        aria-busy="true"
        aria-label="Loading dashboard"
        className="flex max-w-[1440px] flex-col gap-6 px-5 pb-14 pt-6 lg:px-8"
      >
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>

        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <span
            className={`h-[268px] rounded-card border border-hairline ${shimmer}`}
          />
          <span
            className={`h-[268px] rounded-card border border-hairline ${shimmer}`}
          />
        </div>
      </main>
    </>
  );
}
