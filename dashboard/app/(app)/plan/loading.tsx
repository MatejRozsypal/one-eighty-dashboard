/**
 * Loading state. Plan: tiles, burn-up, daily bars, breakdown.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "chart", "chart", "table"]} />;
}
