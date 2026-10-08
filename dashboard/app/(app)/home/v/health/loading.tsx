/**
 * Loading state of Home "Summary": the title, the pinned ring cards, the
 * highlight cards and the client list, in the page's own frame.
 */

import { Skeleton } from "@/components/ui/Skeleton";

const CARD = "rounded-card border border-hairline bg-surface-card p-4 shadow-sm sm:p-[18px]";

function Pinned() {
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <Skeleton className="h-4 w-[45%] rounded-pill" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-[30%] rounded-pill" />
              <Skeleton className="h-5 w-[60%] rounded-xs" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[132px] w-[132px] flex-none rounded-full" />
      </div>
    </div>
  );
}

function Highlight() {
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <Skeleton className="h-4 w-[35%] rounded-pill" />
      <Skeleton className="h-4 w-[90%] rounded-pill" />
      <Skeleton className="h-4 w-[70%] rounded-pill" />
      <Skeleton className="h-[72px] w-full rounded-xs" />
    </div>
  );
}

export default function Loading() {
  return (
    <main aria-busy="true" className="page-frame flex flex-col gap-8 px-4 pb-14 pt-6 sm:px-5 lg:px-8">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-[140px] rounded-pill" />
          <Skeleton className="h-8 w-[180px] rounded-xs" />
          <Skeleton className="h-3.5 w-[160px] rounded-pill" />
        </div>
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Pinned />
        <Pinned />
        <Pinned />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Highlight />
        <Highlight />
        <Highlight />
      </div>
      <div className={`${CARD} flex flex-col gap-4`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 flex-none rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-[30%] rounded-pill" />
              <Skeleton className="h-3 w-[70%] rounded-pill" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
