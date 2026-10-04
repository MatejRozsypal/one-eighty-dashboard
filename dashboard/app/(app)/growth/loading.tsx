/**
 * Loading state. Growth: metric cards, the year-over-year chart and a table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "chart", "table"]} />;
}
