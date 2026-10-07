/**
 * Loading state. Creative concepts: concept cards.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["cards"]} />;
}
