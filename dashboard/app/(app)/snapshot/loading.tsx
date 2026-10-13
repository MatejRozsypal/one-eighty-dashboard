/**
 * Loading state. Snapshot: the four headline cards, the five acquisition
 * ratios, the revenue mix chart, composition beside the bottom line, then the
 * margin stack.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "kpi-5", "chart", "split", "chart"]} />;
}
