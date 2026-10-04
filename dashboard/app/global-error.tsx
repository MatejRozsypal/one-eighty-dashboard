"use client";

/**
 * Last resort, for a failure in the root layout itself (everything else is
 * caught by `app/(app)/error.tsx` and the segment boundaries). It replaces the
 * root layout, so it brings its own html and body and loads the stylesheet.
 */

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app] root render failed", error.digest ?? "");

  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen max-w-editorial flex-col items-start justify-center gap-3 px-6">
          <p className="m-0 text-[13.5px] text-content-muted">Could not load this view.</p>
          <button
            type="button"
            onClick={reset}
            className="rounded-control border border-hairline-strong px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50"
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
