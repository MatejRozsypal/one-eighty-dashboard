/**
 * Loading state. Creative breakdown: chart and table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["chart", "table"]} />;
}
