/**
 * Loading state. Settings: the tab bar, people and forms.
 */

import { SkeletonPage } from "@/components/ui/Skeleton";

export default function Loading() {
  return <SkeletonPage blocks={["table", "list"]} tabs controls={false} />;
}
