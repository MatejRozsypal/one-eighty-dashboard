"use client";

/**
 * The keyboard map (design 1.11), opened with `?`. A modal dialog with a focus
 * trap: Tab cycles inside, Esc closes and returns focus to where it was.
 *
 * Owner: RS9.
 */

import { useEffect, useRef } from "react";

const MOD = "Cmd/Ctrl";

export const SHORTCUTS: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: "/ or N", action: "Add widget" },
  { keys: "E", action: "Toggle edit mode" },
  { keys: `${MOD}+K`, action: "Switch report" },
  { keys: "Tab, Shift+Tab", action: "Move between widgets" },
  { keys: "Arrows", action: "Move widget" },
  { keys: "Shift+Arrows", action: "Resize widget" },
  { keys: "Enter", action: "Open widget settings" },
  { keys: `${MOD}+D`, action: "Duplicate widget" },
  { keys: "Delete", action: "Remove widget" },
  { keys: `${MOD}+Z`, action: "Undo" },
  { keys: `${MOD}+Shift+Z`, action: "Redo" },
  { keys: `${MOD}+S`, action: "Save filters as default" },
  { keys: "Esc", action: "Close panel" },
];

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => back.current?.focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink-900/40 px-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-[min(440px,100%)] rounded-lg border border-hairline bg-paper p-5 shadow-lg outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[15px] font-bold tracking-heading text-content-strong">Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-control text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-strong"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
        <dl className="m-0 flex flex-col">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-6 border-b border-hairline py-2 last:border-b-0">
              <dt className="text-[13px] text-content-body">{s.action}</dt>
              <dd className="m-0 font-mono text-[12px] text-content-strong">{s.keys}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
