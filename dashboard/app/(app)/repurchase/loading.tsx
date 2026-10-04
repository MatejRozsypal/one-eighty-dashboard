/**
 * Loading state. Repurchase group. It holds /repurchase and /timing, which share one boundary.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["chart", "table"]} />;
}
