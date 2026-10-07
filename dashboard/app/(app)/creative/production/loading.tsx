/**
 * Loading state. Creative production: scorecard and table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "table"]} />;
}
