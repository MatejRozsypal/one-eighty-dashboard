/**
 * Loading state. Data health: the settings tab bar and a table.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["table-long"]} tabs controls={false} />;
}
