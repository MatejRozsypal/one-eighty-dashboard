/**
 * Loading state. Markets: the map beside the leaderboard, then the P&L matrix.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["split", "table-long"]} />;
}
