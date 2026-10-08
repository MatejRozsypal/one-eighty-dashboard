/**
 * The signal that opens the release tour from somewhere else in the shell.
 *
 * ── Why an event and not a context ────────────────────────────────────────
 * The tour is mounted once, by the app layout. The controls that open it are
 * in the account menu and in the mobile page sheet, which are siblings of it,
 * not children. Reaching them with a provider would mean wrapping the layout
 * in yet another context and threading a callback through two components that
 * otherwise know nothing about the tour. A named window event costs one
 * listener and leaves both call sites holding nothing but a function call.
 *
 * It also keeps the tour out of the account menu's import graph: this module
 * is a few lines and a string, so a menu that only needs to ask for the tour
 * does not have to pull in every beat to do it.
 *
 * ── Focus ─────────────────────────────────────────────────────────────────
 * The caller passes the element that focus should return to when the tour
 * closes. It has to be named explicitly because the obvious answer, whatever
 * had focus when the tour opened, is the menu item that was just clicked, and
 * that item is unmounted along with its menu a moment later. The right target
 * is the control that opens the menu, which is still there afterwards.
 */

export const WHATS_NEW_OPEN = "one-eighty:whats-new:open";

export interface OpenWhatsNewDetail {
  /** Where focus goes when the tour closes. Must outlive the tour. */
  restoreFocusTo: HTMLElement | null;
}

/** Opens the tour at the first beat. Safe to call before the tour has mounted. */
export function openWhatsNew(restoreFocusTo?: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenWhatsNewDetail>(WHATS_NEW_OPEN, {
      detail: { restoreFocusTo: restoreFocusTo ?? null },
    })
  );
}
