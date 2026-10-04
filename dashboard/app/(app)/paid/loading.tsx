/**
 * Loading state. Paid group. It holds the overview, Meta, Google and GA4, which share one
 * boundary (the layout keeps the tab bar). Their shapes are close enough that
 * one skeleton serves all four.
 *
 * The frame is drawn here rather than by `SkeletonPage`: the real header and
 * control bar centre their content in `page-frame`, and the shared page
 * skeleton does not, so on a wide screen its header and control strip started
 * at the page edge and everything shifted when the page landed. Eight tiles is
 * the Overview (4 + 4) and close to the Meta tab (5 + 8).
 */

import {
  Skeleton,
  SkeletonChart,
  SkeletonKpiRow,
  SkeletonTable,
} from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <>
      <header className="sticky top-0 z-30 hidden h-[var(--header-h)] items-center border-b border-hairline bg-paper pt-[var(--safe-top)] lg:flex">
        <div className="page-frame flex items-center gap-3 px-5 lg:px-8">
          <Skeleton className="h-[15px] w-[132px] rounded-xs" />
        </div>
      </header>
      <div className="z-20 py-2 lg:sticky lg:top-[var(--header-h)] lg:border-b lg:border-hairline lg:bg-paper">
        <div className="page-frame flex items-center gap-4 px-5 lg:px-8">
          <Skeleton className="h-[34px] w-[232px] rounded-control" />
          <Skeleton className="h-[30px] w-[216px] rounded-pill" />
          <Skeleton className="hidden h-[30px] w-[188px] rounded-pill lg:block" />
        </div>
      </div>
      <main
        aria-busy="true"
        aria-label="Loading"
        className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8"
      >
        <SkeletonKpiRow count={8} />
        <SkeletonChart />
        <SkeletonTable />
      </main>
    </>
  );
}
