/**
 * Loading state. Goals: attainment bars.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "list"]} />;
}
