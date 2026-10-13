/**
 * A widget's loading state, shaped like the widget it stands in for.
 *
 * One grey block for every type said nothing about what was coming, and a KPI
 * tile and a line chart were indistinguishable until the data landed. So each
 * type gets its own outline, built from the shared `Skeleton` (pulse and
 * reduced motion are handled there): a KPI is a big figure and a delta pill, a
 * chart is a plot area with axis stubs, a table or ranked list is rows.
 *
 * Plain HTML, no Recharts: `index.tsx` uses the chart shape as the placeholder
 * while the charting bundle downloads, so it must not import it.
 */

import { Skeleton } from "@/components/ui/Skeleton";
import type { WidgetType } from "@/lib/reports/types";

/** The figure and its delta, top left, as `KpiWidget` lays them out. */
function KpiSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <Skeleton className="h-[28px] w-[55%] max-w-[180px] rounded-xs" />
      <Skeleton className="h-[18px] w-[72px] rounded-pill" />
    </div>
  );
}

/** A plot area with y-axis ticks down the left and x-axis ticks along the bottom. */
export function ChartSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex w-7 flex-none flex-col justify-between py-0.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[7px] w-full rounded-pill" />
          ))}
        </div>
        <Skeleton className="min-h-0 flex-1 rounded-md" />
      </div>
      <div className="flex justify-between pl-9">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[7px] w-8 rounded-pill" />
        ))}
      </div>
    </div>
  );
}

/** Label, bar and value per row, the `RankedWidget` grid. */
function RankedSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="grid grid-cols-[minmax(64px,0.9fr)_minmax(56px,2fr)_minmax(72px,auto)] items-center gap-x-3 py-1.5">
          <Skeleton className="h-[10px] w-[80%] rounded-pill" />
          <Skeleton className="h-2 rounded-[4px]" style={{ width: `${92 - i * 13}%` }} />
          <Skeleton className="h-[10px] w-[56px] justify-self-end rounded-pill" />
        </div>
      ))}
    </div>
  );
}

/** A header row over value rows, the `TableWidget` columns. */
function TableSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
        <Skeleton className="h-[8px] w-[28%] rounded-pill" />
        <Skeleton className="h-[8px] w-[18%] rounded-pill" />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 border-b border-hairline py-2 last:border-b-0">
          <Skeleton className="h-[10px] w-[36%] rounded-pill" />
          <Skeleton className="h-[10px] w-[16%] rounded-pill" />
        </div>
      ))}
    </div>
  );
}

/** The loading outline for one widget of `type`. Busy for assistive tech, never read as content. */
export function WidgetSkeleton({ type }: { type: WidgetType }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="h-full w-full">
      {type === "kpi" ? (
        <KpiSkeleton />
      ) : type === "table" ? (
        <TableSkeleton />
      ) : type === "ranked" ? (
        <RankedSkeleton />
      ) : (
        <ChartSkeleton />
      )}
    </div>
  );
}
