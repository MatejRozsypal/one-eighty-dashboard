/**
 * Loading state. Repeat rate: tiles, the cohort table, two charts and a table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "table-long", "chart", "chart", "table"]} />;
}
