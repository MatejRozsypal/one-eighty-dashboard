/**
 * Loading state. Snapshot: metric cards, then the composition charts.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi-8", "split", "split"]} />;
}
