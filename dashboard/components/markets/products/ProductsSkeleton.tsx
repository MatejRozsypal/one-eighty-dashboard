/**
 * The Products body while its query runs: the differs-most strip, the matrix
 * and the per-market lists, in their own layout so nothing moves when the
 * figures land. Server-safe.
 */

import { Skeleton, SkeletonList, SkeletonTable } from "@/components/ui/Skeleton";

export function ProductsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading products by market" className="flex flex-col gap-5">
      <SkeletonList rows={5} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-[30px] w-[220px] rounded-pill" />
      </div>
      <SkeletonTable rows={12} cols={5} />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <SkeletonList rows={5} />
        <SkeletonList rows={5} />
        <SkeletonList rows={5} />
      </div>
    </div>
  );
}
