"use client";

/**
 * Error boundary for Paid. It renders inside the Paid layout, so the tab bar stays and the other tabs keep working when one tab's queries fail.
 * One line and a Retry button, see `components/ui/ErrorState.tsx`.
 */

import { ErrorState } from "@/components/ui/ErrorState";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
