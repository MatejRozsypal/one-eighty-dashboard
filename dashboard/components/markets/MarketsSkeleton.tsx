/**
 * The Markets body while its queries run: one placeholder per widget, in the
 * widgets' own layout (view and currency pills, map beside the leaderboard,
 * the matrix), so nothing moves when the figures land. Server-safe.
 */

import { Skeleton, SkeletonChart, SkeletonList, SkeletonTable } from "@/components/ui/Skeleton";

export function MarketsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading markets" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-[30px] w-[196px] rounded-pill" />
        <Skeleton className="h-[30px] w-[112px] rounded-pill" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SkeletonChart height={300} />
        <SkeletonList rows={4} />
      </div>
      <SkeletonTable rows={12} cols={5} />
    </div>
  );
}
