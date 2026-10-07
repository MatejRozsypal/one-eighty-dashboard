/**
 * Loading state. Goals: tiles, burn-up, daily bars, breakdown.
 *
 * Wrapped in the Health skin like the page itself, so the placeholders are the
 * shape and colour of what replaces them and the page does not change
 * character halfway through loading.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="oe-health flex min-w-0 flex-1 flex-col">
      <SkeletonPage blocks={["kpi", "chart", "chart", "table"]} />
    </div>
  );
}
