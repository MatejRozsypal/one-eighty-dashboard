"use client";

/**
 * The permanent way into the release tour.
 *
 * ── Where it lives, and why ───────────────────────────────────────────────
 * Two places, because the shell has two menus and neither covers both sizes:
 *
 *   - the account menu in the top right (desktop), beside Settings;
 *   - the foot of the page sheet (mobile), which is the only global menu a
 *     phone has, since the account menu is `hidden lg:block`.
 *
 * The account menu is the right home on desktop for the same reason Settings
 * is already there: it is the drawer for things about the application and the
 * person using it, rather than about the numbers on the page. It is also where
 * this item sits in most products of this shape, so it is the first place
 * somebody looks.
 *
 * What was rejected:
 *   - The Settings page. It is internal only (`showSettings` is false for a
 *     client-role account), so the people most likely to want the tour are
 *     exactly the ones who could never reach it. It is also two navigations
 *     away and loses the page you were on.
 *   - The foot of the sidebar. Every row in that column goes to a page; one
 *     that opens a dialog instead quietly breaks the one promise the column
 *     makes. It collapses to nothing behind `data-nav="collapsed"`, so the
 *     item would vanish for anyone who prefers it collapsed, and it is hidden
 *     below `lg` anyway, which leaves the same hole on a phone.
 *
 * ── Why it carries no styling of its own ──────────────────────────────────
 * The two menus are styled differently and both are somebody else's design.
 * This renders the icon, the label and the behaviour; each call site passes
 * the row classes its own neighbours use, so the item matches what is above
 * and below it instead of introducing a third look.
 */

import { openWhatsNew } from "@/components/whatsnew/open";

/** The sparkle, drawn in the same hand as the account menu's other glyphs. */
function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-content-muted"
    >
      <path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" />
      <path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </svg>
  );
}

export function WhatsNewMenuItem({
  className,
  onOpen,
  restoreFocusTo,
}: {
  /** Row classes from the menu this sits in, so it matches its neighbours. */
  className: string;
  /** Closes the menu. Called before the tour opens. */
  onOpen: () => void;
  /**
   * The control that opened this menu, which focus returns to when the tour
   * closes. A ref rather than the clicked item, because the clicked item goes
   * away with the menu.
   */
  restoreFocusTo: () => HTMLElement | null;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onOpen();
        // Put focus somewhere real before the menu unmounts, so the tour has
        // a live element to hand it back to and a keyboard user does not land
        // on the body when they close it.
        const target = restoreFocusTo();
        target?.focus({ preventScroll: true });
        openWhatsNew(target);
      }}
      className={className}
    >
      <SparkleIcon />
      What&rsquo;s new
    </button>
  );
}
