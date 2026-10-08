/**
 * Loading state of Sidekick home: the strip, the greeting and box, the cards.
 */

import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="page-frame flex flex-col gap-6 px-4 pb-14 pt-5 sm:px-5 lg:px-8" aria-busy="true">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-[220px] rounded-pill" />
          <Skeleton className="h-8 w-[140px] rounded-pill" />
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline shadow-sm lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={`flex flex-col gap-2.5 bg-surface-card px-5 py-4 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
              <Skeleton className="h-[11px] w-[60%] rounded-pill" />
              <Skeleton className="h-[22px] w-[70%] rounded-xs" />
              <Skeleton className="h-[26px] w-full rounded-xs" />
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-5 py-6 sm:py-10">
        <Skeleton className="h-10 w-[70%] rounded-xs" />
        <Skeleton className="h-4 w-[45%] rounded-pill" />
        <Skeleton className="h-[112px] w-full rounded-[22px]" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-[150px] rounded-pill" />
          <Skeleton className="h-9 w-[130px] rounded-pill" />
          <Skeleton className="h-9 w-[140px] rounded-pill" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[190px] w-full rounded-card" />
        ))}
      </div>
    </main>
  );
}
