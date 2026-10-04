/**
 * Loading state. Growth: the month-over-month chart and its table, nothing else.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["chart", "table"]} />;
}
