/**
 * Loading state. Velocity plan: the inputs, the outputs and the ladder.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi-8", "split", "table"]} controls={false} />;
}
