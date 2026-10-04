"use client";

/**
 * The one error state a route boundary renders: a header, the page frame and
 * one line with a Retry button. Used by `app/(app)/error.tsx` and the segment
 * boundaries under it (`paid`, `creative`, `reports`).
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 * A query that throws inside a server component used to escape to the root and
 * replace the whole app with a bare error page: no sidebar, no client switcher,
 * no way back. A boundary under the app layout keeps that shell mounted, so
 * one failing view costs one view.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It shows no error text, no digest and no hint. The cause is already in the
 * server log: Next.js logs the real error for every failed server render, and
 * the digest ties the two together. The browser console gets the digest only.
 *
 * ── Retry ───────────────────────────────────────────────────────────────────
 * `reset()` alone re-renders the boundary's children from the cached payload,
 * which for a failed server component is the same failure. Refreshing the route
 * first re-runs the server render, then `reset()` clears the boundary.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Header } from "@/components/shell/Header";
import { pageTitle } from "@/lib/nav";

export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    console.error("[view] render failed", error.digest ?? "");
  }, [error]);

  const retry = () => {
    // A failure that persists mounts a fresh boundary, so `pending` starts over.
    setPending(true);
    router.refresh();
    reset();
  };

  return (
    <>
      <Header title={pageTitle(pathname)} />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-hairline-strong bg-paper px-5 py-6 text-[13.5px] text-content-muted"
        >
          <span>Could not load this view.</span>
          <button
            type="button"
            onClick={retry}
            disabled={pending}
            aria-busy={pending}
            className={`rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50 ${pending ? "oe-pulse" : ""}`}
          >
            Retry
          </button>
        </div>
      </main>
    </>
  );
}
