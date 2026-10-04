/**
 * Loading state. Unit economics: metric cards, charts and a table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "split", "table"]} />;
}
