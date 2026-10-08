/**
 * Loading state of Home, shown only while the session is checked: the page
 * streams its own sections after that. The pills, the six figures, the
 * greeting and the box.
 */

import { Skeleton } from "@/components/ui/Skeleton";
import { CellSkeleton, StripFrame } from "@/components/home/final/KpiStrip";

export default function Loading() {
  return (
    <main className="page-frame flex flex-col gap-6 px-4 pb-14 pt-5 sm:px-5 lg:px-8" aria-busy="true">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-[220px] rounded-pill" />
          <Skeleton className="h-8 w-[140px] rounded-pill" />
        </div>
        <StripFrame>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="min-w-0">
              <CellSkeleton />
            </div>
          ))}
        </StripFrame>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-5 py-6 sm:py-10">
        <Skeleton className="h-3 w-[160px] rounded-pill" />
        <Skeleton className="h-10 w-[70%] rounded-xs" />
        <Skeleton className="h-4 w-[45%] rounded-pill" />
        <Skeleton className="h-[112px] w-full rounded-[22px]" />
      </div>
    </main>
  );
}
