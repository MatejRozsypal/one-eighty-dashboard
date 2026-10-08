/**
 * Loading state. Home, Today: the greeting, the source pills, the list.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "table"]} controls={false} />;
}
