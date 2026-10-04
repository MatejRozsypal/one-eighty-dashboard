/**
 * Loading state. Buying: one long table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["table-long"]} />;
}
