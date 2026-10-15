/**
 * Loading state. Trends & analysis: the portfolio chart, then the weekly rows.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["chart", "chart"]} />;
}
