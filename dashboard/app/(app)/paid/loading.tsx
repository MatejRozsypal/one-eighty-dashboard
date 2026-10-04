/**
 * Loading state. Paid group. It holds the overview, Meta, Google and GA4, which share one
 * boundary (the layout keeps the tab bar). Their shapes are close enough that
 * one skeleton serves all four.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "chart", "table"]} />;
}
