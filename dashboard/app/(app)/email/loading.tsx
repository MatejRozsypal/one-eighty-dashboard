/**
 * Loading state. Email: metric cards and tables.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "table"]} />;
}
