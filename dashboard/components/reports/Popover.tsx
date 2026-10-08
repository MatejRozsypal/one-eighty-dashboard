"use client";

/**
 * Two small popover primitives for the Reports pages: `Popover` (a button that
 * opens any content) and `PopoverMenu` (a button that opens a list of actions).
 *
 * Behaviour both share: outside press closes, Esc closes and returns focus to
 * the button, the panel is absolutely positioned under the button (so a parent
 * must not clip it: no `overflow-hidden` on an ancestor).
 *
 * PopoverMenu is a `role="menu"`: arrow keys, Home and End move, Enter and
 * Space select, Tab closes. Entries can be headings (a label), plain actions,
 * a danger action, or radio-like (`checked`).
 *
 * Owner: RS9.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const BUTTON =
  "inline-flex items-center gap-2 rounded-control border border-hairline-strong bg-paper px-3 py-1.5 text-[12.5px] text-content-body transition-colors duration-fast hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

export interface PopoverProps {
  /** Accessible name of the button and the panel. */
  label: string;
  /** Button content. */
  button: ReactNode;
  /** Replaces the default button look. */
  buttonClassName?: string;
  /** Panel edge that lines up with the button. */
  align?: "left" | "right";
  panelClassName?: string;
  disabled?: boolean;
  /** Start open (a deep link such as `?new=1`). */
  defaultOpen?: boolean;
  /** Stays open: an outside press and Esc do nothing (a menu entry is running and shows its own progress). */
  locked?: boolean;
  /** Called after the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Panel content; call `close()` to dismiss from inside. */
  children: (close: (returnFocus?: boolean) => void) => ReactNode;
}

export function Popover({ label, button, buttonClassName, align = "left", panelClassName, disabled, defaultOpen = false, locked = false, onOpenChange, children }: PopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (returnFocus = true) => {
      set(false);
      if (returnFocus) buttonRef.current?.focus();
    },
    [set],
  );

  useEffect(() => {
    if (!open || locked) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) set(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, locked, set]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        onClick={() => set(!open)}
        className={buttonClassName ?? BUTTON}
      >
        {button}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (!locked) close(true);
            }
          }}
          className={cx(
            "absolute top-[calc(100%+6px)] z-[90] rounded-lg border border-hairline bg-paper p-2 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export type MenuEntry =
  | { kind: "heading"; label: string }
  | { kind: "item"; id: string; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; checked?: boolean; hint?: string }
  | { kind: "separator" };

export interface PopoverMenuProps {
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  align?: "left" | "right";
  entries: readonly MenuEntry[];
  disabled?: boolean;
}

export function PopoverMenu({ label, button, buttonClassName, align = "right", entries, disabled }: PopoverMenuProps) {
  return (
    <Popover label={label} button={button} buttonClassName={buttonClassName} align={align} disabled={disabled} panelClassName="min-w-[190px] p-1.5">
      {(close) => <MenuList label={label} entries={entries} close={close} />}
    </Popover>
  );
}

function MenuList({ label, entries, close }: { label: string; entries: readonly MenuEntry[]; close: (returnFocus?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") close(false);
  }

  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKeyDown} className="flex flex-col">
      {entries.map((entry, i) => {
        if (entry.kind === "separator") return <div key={`s${i}`} role="separator" className="my-1 h-px bg-hairline" />;
        if (entry.kind === "heading")
          return (
            <span key={`h${i}`} className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">
              {entry.label}
            </span>
          );
        const radio = entry.checked !== undefined;
        return (
          <button
            key={entry.id}
            type="button"
            role={radio ? "menuitemradio" : "menuitem"}
            aria-checked={radio ? entry.checked : undefined}
            aria-disabled={entry.disabled || undefined}
            title={entry.hint}
            tabIndex={-1}
            onClick={() => {
              if (entry.disabled) return;
              close(true);
              entry.onSelect();
            }}
            className={cx(
              "flex w-full items-center justify-between gap-4 rounded-sm px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-fast focus-visible:bg-gray-100",
              entry.disabled ? "cursor-not-allowed text-content-muted" : entry.danger ? "text-negative-700 hover:bg-negative/10" : "text-content-body hover:bg-gray-100",
            )}
          >
            <span>{entry.label}</span>
            {radio && entry.checked && (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 text-growth-700">
                <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The three-dot icon for menu buttons. */
export function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13" cy="8" r="1.3" />
    </svg>
  );
}

export const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-control text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-strong disabled:cursor-not-allowed disabled:opacity-50";
