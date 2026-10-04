/**
 * Loading state. Products: four metric cards and the product table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "table-long"]} />;
}
