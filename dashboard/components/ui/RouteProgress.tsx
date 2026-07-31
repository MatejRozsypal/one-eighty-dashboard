"use client";

/**
 * Indeterminate progress bar for server navigations.
 *
 * Every control in this dashboard writes to the URL and lets the server
 * re-render, because the numbers come from BigQuery and BigQuery takes 2–5
 * seconds on wide ranges. That is a fine architecture and a terrible feeling:
 * React keeps the *old* page mounted and fully interactive for the whole
 * round trip, so a click looks like it did nothing and users click again.
 *
 * `loading.tsx` doesn't cover this. It fires when the route segment changes,
 * and most of these controls only change search params on the route you are
 * already on — same segment, no fallback, no feedback.
 *
 * So each control drives this bar from its own `useTransition` pending flag.
 * It is `fixed`, so it reads as a page-level signal no matter which control
 * mounted it, and it renders nothing at all when idle.
 */

export function RouteProgress({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <span
      role="status"
      aria-label="Loading data"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] block h-[2px] overflow-hidden bg-accent-soft"
    >
      <span className="block h-full w-1/3 rounded-pill bg-accent animate-[oe-indeterminate_1.1s_ease-in-out_infinite]" />
    </span>
  );
}
