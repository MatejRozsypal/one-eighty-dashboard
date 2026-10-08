/**
 * Loading state. Home: the greeting row, the summary tiles, the client cards.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "cards"]} controls={false} />;
}
