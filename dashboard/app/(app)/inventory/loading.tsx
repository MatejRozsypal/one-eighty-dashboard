/**
 * Loading state. Inventory group. It holds /inventory, /buying and /catalogue, which share one
 * boundary, so without this none of the three shows a fallback.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "table"]} />;
}
