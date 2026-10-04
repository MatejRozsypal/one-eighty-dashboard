"use client";

/**
 * Error boundary for Reports. It renders inside the Reports layout, so the report list and switcher stay usable when one report fails to load.
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
