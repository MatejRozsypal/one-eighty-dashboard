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
 * the corner for `AccountMenu`, which is positioned fixed: `--account-reserve`
 * (globals.css), measured inside the same `page-frame` the menu aligns to.
 */

/*
 * The bottom edge is `--border-strong`, not `--border`. On the house look the
 * page behind was grey, so the bar read as a layer whatever its hairline did.
 * The page is white now and the skin's hairline is a third as strong, which
 * left the bar and the content it floats over with no visible join. The
 * control bars that stick beneath this one carry the same step for the same
 * reason.
 */
export function Header({
  title,
}: {
  title: string;
  /** Deprecated and ignored. Pages drop it in wave 2. */
  eyebrow?: string;
}) {
  // Below lg the bar is visually hidden rather than `hidden`, so the page keeps
  // its only <h1> for screen readers on a phone. `lg:not-sr-only` resets
  // position, height and padding, so the bar's own are restated after it at lg.
  return (
    <header className="sr-only top-0 z-30 items-center border-b border-hairline-strong bg-paper/[0.86] backdrop-blur-[12px] lg:not-sr-only lg:sticky lg:flex lg:h-[var(--header-h)] lg:pt-[var(--safe-top)]">
      <div className="page-frame flex items-center gap-3 px-5 lg:px-8 lg:pr-[var(--account-reserve)]">
        <h1 className="m-0 min-w-0 truncate text-[17px] font-bold tracking-heading text-content-strong">
          {title}
        </h1>
      </div>
    </header>
  );
}
