/**
 * Loading state. Repurchase timing: the timing charts.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["chart", "chart"]} />;
}
