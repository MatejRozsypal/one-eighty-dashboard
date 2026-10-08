/**
 * Loading state. Velocity track record: the chart and the monthly table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["chart", "table"]} controls={false} />;
}
