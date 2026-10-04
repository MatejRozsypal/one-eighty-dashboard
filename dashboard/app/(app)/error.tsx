"use client";

/**
 * Error boundary for every page under the app shell. It renders inside the app layout, so the sidebar, account menu and client switcher stay mounted when a page's server render throws.
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
