/**
 * Route-level loading state.
 *
 * Every page in this group is `force-dynamic` and awaits BigQuery, which runs
 * 2 to 5 seconds on wide ranges. Without a boundary the App Router holds the
 * previous page on screen, fully interactive, for that entire time, so
 * clicking a nav item looks like nothing happened and users click it again.
 *
 * This is the generic fallback for navigation between pages. Segments with a
 * distinct shape (and every group of sibling pages, which share a boundary and
 * would otherwise never show one) have their own `loading.tsx` next to the
 * page. Changing a search param on the page you are already on does not remount
 * the segment and never reaches any of them; that case is handled by
 * `NavigationPendingProvider`, which drives the progress bar and pulses the
 * figures. Together no interaction is ever silent.
 *
 * Deliberately generic: header, control strip, a row of metric cards and a
 * chart pair. A skeleton that guesses wrong is worse than one that stays vague.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi-8", "split"]} />;
}
