/**
 * Loading state for the Reports group. It sits under the layout, so the rail
 * and the list panel stay put; only the page area is a skeleton. This is the
 * list shape (header strip, table); a single report has its own, next to its
 * page, with the filter strip and the tiles.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["table-long"]} controls={false} />;
}
