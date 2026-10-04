/**
 * Loading state for the Assistant: a few message blocks above the composer.
 * The page draws no header, so neither does this.
 */

import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="flex h-[100dvh] min-h-0 flex-col lg:pt-[var(--header-h)]"
    >
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-5 py-8 lg:px-8">
        <Skeleton className="h-[56px] w-[60%] self-end rounded-card" />
        <Skeleton className="h-[112px] w-[80%] rounded-card" />
        <Skeleton className="h-[56px] w-[45%] self-end rounded-card" />
      </div>
      <div className="mx-auto w-full max-w-[760px] px-5 pb-6 lg:px-8">
        <Skeleton className="h-[52px] w-full rounded-card" />
      </div>
    </div>
  );
}
