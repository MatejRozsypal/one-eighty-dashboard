"use client";

/**
 * Error boundary for Creative. It renders inside the Creative layout and the app shell, so navigation survives a failing view.
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
