/**
 * Loading state. Creative group. It holds five pages that share one boundary.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "cards"]} />;
}
