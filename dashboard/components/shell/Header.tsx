/**
 * Page header — sticky, translucent, blurs content scrolling under it.
 *
 * The blur-on-scroll treatment is lifted from the marketing site's sticky nav,
 * which is the one place the brand system uses transparency.
 *
 * Deliberately one line tall. Eyebrow and title sit side by side rather than
 * stacked, and the header no longer carries a date-range caption — the date
 * picker is directly beneath it and said the same thing twice. Together with
 * the control bar this block used to run past 150px, which on a laptop is a
 * meaningful slice of the screen spent on chrome instead of numbers.
 *
 * Its height is `--header-h` (globals.css) because ControlBar sticks beneath
 * it and needs to know.
 */

import { Logo } from "@/components/ui/Logo";

export function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3 border-b border-hairline bg-paper/[0.86] px-5 backdrop-blur-[12px] lg:px-8">
      {/* The mark stands in for the sidebar logo once the sidebar is gone. */}
      <span className="lg:hidden">
        <Logo markOnly size={22} />
      </span>

      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="m-0 shrink-0 text-[17px] font-bold tracking-heading text-content-strong">
          {title}
        </h1>
        <span className="truncate font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          {eyebrow}
        </span>
      </div>
    </header>
  );
}
