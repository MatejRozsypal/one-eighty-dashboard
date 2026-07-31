/**
 * Page header.
 *
 * Two shapes, because the two contexts want different things:
 *
 *  · **Desktop** — light, translucent, blurs content scrolling under it, lifted
 *    from the marketing site's sticky nav. Navigation lives in the sidebar, so
 *    this only has to say where you are.
 *
 *  · **Mobile** — nothing. The black notch-aware bar lives in the app layout
 *    (`MobileTopBar`), because the content beneath it has to be one continuous
 *    surface for the layout to round the top corners of. It takes its title
 *    from the route, so nothing is lost by moving it out of here.
 *
 * Deliberately one line tall. Eyebrow and title sit side by side rather
 * than stacked, and the header carries no date-range caption — the date picker
 * is directly beneath it and said the same thing twice. Together with the
 * control bar this block used to run past 150px, which on a laptop is a
 * meaningful slice of the screen spent on chrome instead of numbers.
 *
 * Its height is `--header-h` (globals.css), status-bar inset included, because
 * ControlBar sticks beneath it and needs to know.
 */

export function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
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
  );
}
