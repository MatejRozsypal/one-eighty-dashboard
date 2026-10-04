/**
 * Loading state. Creative velocity: scorecard and launch cadence.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "chart"]} tabs />;
}
