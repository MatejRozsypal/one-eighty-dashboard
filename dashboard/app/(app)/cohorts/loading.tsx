/**
 * Loading state. Cohorts: the retention heatmap and its table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["heatmap", "table"]} />;
}
