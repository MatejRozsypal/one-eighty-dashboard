"use client";

/**
 * The control bar's building blocks: a soft grey pill that opens a popover.
 *
 *   [ (icon) Last month  v ]  [ (icon) Sep 1-30, 2025  v ]  [ (icon) EUR  v ]
 *
 * Every control in the bar is one of these, so they share one height, one
 * fill and one open state (darker, with a heavier ring). The popover is
 * anchored under its pill from `sm` up and pulled back inside the viewport when
 * the pill sits too far right for it. Below `sm` it is a full-width bottom
 * sheet over a dimmed page, so a phone never scrolls sideways to reach Apply.
 *
 * The closed pill carries a hairline ring as well as its fill. The bar is
 * papered only from `lg` up; below that it sits straight on the page surface,
 * which is `--gray-100`, the same step the pill fills with, so fill alone
 * would leave the controls invisible on a phone.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const PHONE = "(max-width: 639.98px)";

/** Open state, closed by an outside click or Escape; locks page scroll on phones. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A tall sheet over a scrollable page invites scrolling the page behind it.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!window.matchMedia(PHONE).matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return { open, setOpen, wrapRef };
}

export function Pill({
  icon,
  label,
  open,
  onClick,
  pending = false,
  title,
  ariaLabel,
}: {
  icon: ReactNode;
  label: ReactNode;
  open: boolean;
  onClick: () => void;
  pending?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-busy={pending}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex h-8 max-w-full items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-[13.5px] font-medium text-content-strong transition-colors duration-fast ${
        open
          ? "bg-gray-150 shadow-[inset_0_0_0_1px_var(--gray-200)]"
          : "bg-gray-100 shadow-[inset_0_0_0_1px_var(--gray-150)] hover:bg-gray-150"
      } ${pending ? "oe-pulse" : ""}`}
    >
      <span aria-hidden="true" className="flex-none">
        {icon}
      </span>
      <span className="min-w-0 truncate tabular">{label}</span>
      <ChevronIcon up={open} />
    </button>
  );
}

/**
 * The panel under a pill. Rendered inside the pill's wrapper (`usePopover`'s
 * ref), so a click inside it is not an outside click.
 */
export function Popover({
  label,
  onClose,
  className = "",
  children,
}: {
  label: string;
  onClose: () => void;
  /** Width and layout of the panel from `sm` up. */
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  // Keep the panel inside the viewport: a pill near the right edge would
  // otherwise open a calendar half off screen. Re-measured when the panel
  // changes size (Compare grows into a calendar on "Custom").
  const place = useCallback(() => {
    const panel = panelRef.current;
    const anchor = panel?.parentElement;
    if (!panel || !anchor || window.matchMedia(PHONE).matches) {
      setShift(0);
      return;
    }
    const left = anchor.getBoundingClientRect().left;
    const room = window.innerWidth - 16 - panel.offsetWidth;
    setShift(Math.max(16 - left, Math.min(0, room - left)));
  }, []);

  useLayoutEffect(() => {
    place();
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(panel);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [place]);

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-[89] block w-full cursor-default bg-ink-950/45 sm:hidden"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        style={{ left: shift }}
        className={`fixed inset-x-0 bottom-0 z-[90] flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-paper pb-[var(--safe-bottom)] shadow-lg sm:absolute sm:bottom-auto sm:right-auto sm:top-[calc(100%+8px)] sm:max-h-none sm:rounded-lg sm:border sm:border-hairline sm:pb-0 ${className}`}
      >
        {children}
      </div>
    </>
  );
}

/** One row of a popover list: grey fill and bold when selected. */
export function MenuRow({
  selected,
  disabled = false,
  title,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-sm px-3 py-2 text-left text-[14px] transition-colors duration-fast ${
        selected
          ? "bg-gray-100 font-semibold text-content-strong"
          : disabled
            ? "cursor-not-allowed text-gray-250"
            : "text-content-strong hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

/** Cancel / Apply, with the resolved range on the left. Pinned to the sheet's foot. */
export function PopoverFooter({
  summary,
  canApply,
  onCancel,
  onApply,
}: {
  summary: ReactNode;
  canApply: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-hairline bg-paper px-4 py-3 sm:px-5">
      <span className="min-w-0 text-[14px] tabular text-content-strong">{summary}</span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-sm bg-gray-100 px-3.5 text-[14px] font-medium text-content-strong transition-colors duration-fast hover:bg-gray-150"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={onApply}
          className="h-9 rounded-sm bg-ink-900 px-3.5 text-[14px] font-medium text-content-inverse transition-colors duration-fast hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-gray-150 disabled:text-paper"
        >
          Apply
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
//
// Same construction as the nav rail's `NavIcon`: a 24 grid at 1.7 stroke with
// round caps, drawn in `currentColor`, so the bar and the sidebar read as one
// icon set. Rendered at 16, a touch smaller than the nav's 17, because these
// sit inside a 32px pill beside text.
// ---------------------------------------------------------------------------

const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "flex-none",
};

export function ChevronIcon({ up = false }: { up?: boolean }) {
  return (
    <svg {...ICON} width={12} height={12} aria-hidden="true">
      <path d={up ? "M7.5 14 12 9.5l4.5 4.5" : "M7.5 10 12 14.5l4.5-4.5"} />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3.4" />
      <path d="M3.5 9.5h17M8.25 2.5v4M15.75 2.5v4" />
    </svg>
  );
}

export function CompareIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M20.5 10.5V8a3.4 3.4 0 0 0-3.4-3.4H6.9A3.4 3.4 0 0 0 3.5 8v9.1a3.4 3.4 0 0 0 3.4 3.4h3.6" />
      <path d="M3.5 9.5h17M8.25 2.5v4M15.75 2.5v4" />
      <path d="M14.25 15.5h6.25L18.25 13.25M21 18.5h-6.25l2.25 2.25" />
    </svg>
  );
}

export function CurrencyIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M10.9 6.75H6.6a2.4 2.4 0 0 0 0 4.8h1.8a2.4 2.4 0 0 1 0 4.8H3.75M7.35 4.5v2.25M7.35 16.35v2.25" />
      <path d="M14.25 8.6h6.25L18.25 6.35M21 14.6h-6.25l2.25 2.25" />
    </svg>
  );
}

export function MarketIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.2 12 20.6C9.6 18.2 8.4 15.3 8.4 12S9.6 5.9 12 3.5Z" />
    </svg>
  );
}

export function ArrowIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d={dir === "left" ? "M15 5.5 8.5 12l6.5 6.5" : "M9 5.5 15.5 12 9 18.5"} />
    </svg>
  );
}
