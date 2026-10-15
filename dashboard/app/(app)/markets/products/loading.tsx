/**
 * Loading state. Products by market: the differs-most strip, the matrix, the
 * per-market lists.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["list", "table-long", "cards"]} />;
}
