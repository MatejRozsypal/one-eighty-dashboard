/**
 * Loading state. A report: filter strip, KPI tiles and two charts.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "split"]} />;
}
