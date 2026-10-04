/**
 * Loading state. Customers: two tables.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["table", "table-long"]} />;
}
