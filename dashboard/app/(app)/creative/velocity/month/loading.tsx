/**
 * Loading state. Velocity this month: two rings and the tiles.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "kpi-6"]} controls={false} />;
}
