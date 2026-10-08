/**
 * Loading state. Forecast Home: the sky with its strip, the forecast list,
 * the tile grid.
 */

import { Header } from "@/components/shell/Header";
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <>
      <Header title="Home" />
      <main aria-busy="true" className="page-frame flex flex-col gap-[26px] px-4 pb-14 pt-5 sm:px-5 sm:pt-6 lg:px-8">
        <div
          className="flex flex-col gap-6 rounded-[28px] p-5 sm:p-8"
          style={{ background: "linear-gradient(180deg, #1667c4 0%, #3a86cf 100%)", opacity: 0.35 }}
        >
          <div className="h-[64px]" />
          <div className="mx-auto h-[150px] w-[200px]" />
          <div className="h-[150px] rounded-[20px] bg-white/30" />
        </div>
        <div className="flex flex-col gap-3.5">
          <Skeleton className="h-[20px] w-[180px] rounded-pill" />
          <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-5 shadow-sm">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-[30px] w-full rounded-pill" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3.5 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[188px] w-full rounded-card" />
          ))}
        </div>
      </main>
    </>
  );
}
