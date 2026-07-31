/**
 * Page header.
 *
 * Two shapes, because the two contexts want different things:
 *
 *  · **Desktop** — light, translucent, blurs content scrolling under it, lifted
 *    from the marketing site's sticky nav. Navigation lives in the sidebar, so
 *    this only has to say where you are.
 *
 *  · **Mobile** — black and notch-aware, and the title doubles as the page
 *    switcher. See `MobileTopBar` for why it owns the status-bar strip.
 *
 * Deliberately one line tall in both. Eyebrow and title sit side by side rather
 * than stacked, and the header carries no date-range caption — the date picker
 * is directly beneath it and said the same thing twice. Together with the
 * control bar this block used to run past 150px, which on a laptop is a
 * meaningful slice of the screen spent on chrome instead of numbers.
 *
 * Its height is `--header-h` (globals.css), status-bar inset included, because
 * ControlBar sticks beneath it and needs to know.
 */

import { MobileTopBar } from "@/components/shell/MobileTopBar";

export function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <MobileTopBar title={title} />

      <header className="sticky top-0 z-30 hidden h-[var(--header-h)] items-center gap-3 border-b border-hairline bg-paper/[0.86] px-5 pt-[var(--safe-top)] backdrop-blur-[12px] lg:flex lg:px-8">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="m-0 shrink-0 text-[17px] font-bold tracking-heading text-content-strong">
            {title}
          </h1>
          <span className="truncate font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
            {eyebrow}
          </span>
        </div>
      </header>
    </>
  );
}
