/**
 * Loading state. Orders: six metric cards and the orders table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi-6", "table-long"]} />;
}
