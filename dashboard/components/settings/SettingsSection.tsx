/**
 * A collapsible settings card.
 *
 * ── Why `<details>` and not state ───────────────────────────────────────────
 * Settings is a server component, and every panel inside it renders server-side
 * with server actions for forms. Making the sections collapsible with React
 * state would have pushed the whole screen across the client boundary for the
 * sake of a disclosure triangle. `<details>` does it in HTML: no JavaScript, no
 * hydration, keyboard and screen-reader behaviour for free, and "collapsed by
 * default" is simply the absence of an attribute.
 *
 * ── Why a collapsed section still says something ────────────────────────────
 * An accordion of bare headings makes you open all of them to find the one you
 * want, which is worse than the long page it replaced. So each section carries
 * a one-line `summary` of its own state — "OpEx 28% · fulfilment $4.20",
 * "9 of 12 months set", "3 with access" — and the collapsed screen becomes a
 * status overview rather than a menu. Where a section has nothing set, saying
 * so is the most useful thing it can show.
 */

import type { ReactNode } from "react";

export function SettingsSection({
  title,
  /** One line describing what is currently configured. Shown while collapsed. */
  summary,
  description,
  children,
  /**
   * Sections start closed. The exception is a panel that is the entire content
   * of its tab, where collapsing it leaves the reader looking at an empty page.
   */
  defaultOpen = false,
}: {
  title: string;
  summary?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-card border border-hairline bg-surface-card shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-[18px_20px] lg:p-[18px_26px] [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="flex-none text-content-muted transition-transform duration-fast group-open:rotate-90"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>

        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
            {title}
          </span>
          {/*
            Hidden once open: the panel below then states everything this line
            summarised, and leaving it visible reads as a stale duplicate.
          */}
          {summary !== undefined && (
            <span className="truncate text-[12.5px] text-content-body group-open:hidden">
              {summary}
            </span>
          )}
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-hairline p-[18px_20px_22px] lg:p-[18px_26px_22px]">
        {description && (
          <span className="text-[12.5px] leading-[1.5] text-content-muted">
            {description}
          </span>
        )}
        {children}
      </div>
    </details>
  );
}
