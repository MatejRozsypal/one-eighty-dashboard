/**
 * Loading state. Ledger: the three agency figures, the partnership cards.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["kpi", "cards"]} controls={false} />;
}
