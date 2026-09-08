"use client";

/**
 * Collapses the navigation panel — the second column, not the icon rail.
 *
 * State is written straight to `document.documentElement` and mirrored into
 * localStorage, deliberately *not* held in React state or in the URL:
 *
 *  - The URL is reserved for things that change the numbers (client, range,
 *    currency). A panel being open is a preference about this browser, not a
 *    property of the view, and putting it in the query string would make every
 *    shared link carry someone else's chrome.
 *  - Going through React would mean a re-render, and the whole point of a
 *    collapse is that it feels like moving a door, not like loading a page.
 *
 * Everything that has to react to it — the panel, its widths, the account menu
 * in the corner — keys off the same `data-nav` attribute in CSS, so there is
 * one source of truth and no state to keep in sync.
 */

const KEY = "one-eighty:nav-collapsed";

function toggle() {
  const root = document.documentElement;
  const next = root.dataset.nav === "collapsed" ? "" : "collapsed";
  if (next) root.dataset.nav = next;
  else delete root.dataset.nav;
  try {
    localStorage.setItem(KEY, next === "collapsed" ? "1" : "0");
  } catch {
    // Private mode, or site data blocked. The toggle still works for this
    // session; it just will not be remembered. Not worth failing over.
  }
}

/**
 * Read before first paint so a remembered collapse does not flash open.
 * Injected by the root layout; kept beside the toggle so the storage key and
 * the attribute cannot drift apart.
 */
export const NAV_COLLAPSE_BOOT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  KEY
)})==="1"){document.documentElement.dataset.nav="collapsed"}}catch(e){}})()`;

export function NavCollapseToggle({
  variant = "panel",
}: {
  /** `panel` sits in the open panel's header; `rail` is the reopen affordance. */
  variant?: "panel" | "rail";
}) {
  const label = variant === "panel" ? "Collapse menu" : "Expand menu";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center rounded-sm text-gray-400 transition-colors duration-fast hover:bg-white/[0.06] hover:text-gray-250 ${
        variant === "panel" ? "h-7 w-7" : "h-9 w-9"
      }`}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path d="M10 4.5v15" />
      </svg>
    </button>
  );
}
