/**
 * Page header: the page title, nothing else.
 *
 * Desktop only. On mobile the black notch-aware bar lives in the app layout
 * (`MobileTopBar`) and takes its title from the route.
 *
 * Copy policy: no eyebrow, no kicker, no subtitle. `eyebrow` is still accepted
 * so pages compile while they drop it, and it is ignored.
 *
 * Its height is `--header-h` (globals.css), status-bar inset included, because
 * ControlBar sticks beneath it and needs to know. The right padding reserves
 * the corner for `AccountMenu`, which is positioned fixed.
 */

export function Header({
  title,
}: {
  title: string;
  /** Deprecated and ignored. Pages drop it in wave 2. */
  eyebrow?: string;
}) {
  return (
    <header className="sticky top-0 z-30 hidden h-[var(--header-h)] items-center border-b border-hairline bg-paper/[0.86] pt-[var(--safe-top)] backdrop-blur-[12px] lg:flex">
      <div className="page-frame flex items-center gap-3 px-5 lg:px-8 lg:pr-[336px]">
        <h1 className="m-0 min-w-0 truncate text-[17px] font-bold tracking-heading text-content-strong">
          {title}
        </h1>
      </div>
    </header>
  );
}
