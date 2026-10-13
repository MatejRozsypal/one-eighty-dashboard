/**
 * Loading state. Creatives: the eight-tile scorecard, the hit-rate trend, then
 * the grid. The other Creative pages have their own, next to each page.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi-8", "chart", "cards"]} />;
}
