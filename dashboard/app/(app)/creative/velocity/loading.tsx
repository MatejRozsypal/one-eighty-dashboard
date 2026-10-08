/**
 * Loading state. Velocity overview: one table of clients.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["table"]} controls={false} />;
}
