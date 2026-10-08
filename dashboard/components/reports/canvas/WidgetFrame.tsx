"use client";

/**
 * The card around every report widget (design 1.4): a header with the drag
 * handle, the title, an optional override chip and a menu, over a body slot.
 *
 * Only `.widget-drag` starts a drag (the canvas passes that selector to the
 * grid), so chart tooltips and table scrolling in the body are untouched. The
 * title is a button that opens the widget config; the menu button sits outside
 * the handle so opening it never starts a drag.
 *
 * The frame itself is focusable. The canvas hangs the keyboard move/resize
 * handler on it (`useGridKeyboard`), and the focus ring comes from `grid.css`
 * (`--focus-ring`).
 *
 * Owner: RS6 (canvas).
 */

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

export interface FrameMenuItem {
  id: string;
  label: string;
  onSelect(): void;
  /** Rendered in the negative colour (Remove). */
  danger?: boolean;
}

/** What the page returns from `renderWidget` for one canvas item. */
export interface WidgetRender {
  title: string;
  chip?: string;
  /** The widget body (RS7 widgets). It fills the frame, so it should size to 100% of its parent. */
  body: ReactNode;
  /** Extra menu entries, for example "Use report filters". Shown between Edit and Remove. */
  menu?: readonly FrameMenuItem[];
}

export interface WidgetFrameProps {
  id: string;
  title: string;
  /** Small chip for a widget-level override, for example "12m" or "EUR". */
  chip?: string;
  /** Edit mode: shows the grip and the grab cursor on the handle. */
  editing?: boolean;
  menu?: readonly FrameMenuItem[];
  onOpen?(): void;
  onKeyDown?(e: KeyboardEvent<HTMLElement>): void;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0 text-content-muted">
      {[2, 7, 12].map((y) => (
        <g key={y} fill="currentColor">
          <circle cx="2" cy={y} r="1.1" />
          <circle cx="8" cy={y} r="1.1" />
        </g>
      ))}
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13" cy="8" r="1.3" />
    </svg>
  );
}

/** Popover menu, portalled to the body so neither the card nor the grid item's stacking context clips it. */
// Hovers and the unit chip read `--gray-100` / `--gray-50`, not `--bg-subtle`.
// That token is the page background and the Health skin paints it white, so a
// hover drawn in it stopped being a hover at all.
function FrameMenu({ items, label }: { items: readonly FrameMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useIsoLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open || !pos) return;
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close(false);
    };
    const onDismiss = () => close(false);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [open, pos, close]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label} menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="report-widget-menu-button -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-content-muted transition-colors hover:bg-gray-100 hover:text-content-strong"
      >
        <DotsIcon />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={listRef}
              id={menuId}
              role="menu"
              aria-label={`${label} menu`}
              onKeyDown={onListKey}
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="report-widget-menu z-50 min-w-[140px] rounded-md border border-hairline bg-surface-card p-1 shadow-lg"
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    close(true);
                    item.onSelect();
                  }}
                  className={cx(
                    "flex w-full items-center rounded-xs px-3 py-1.5 text-left text-body-sm outline-none hover:bg-gray-100 focus-visible:bg-gray-100",
                    item.danger ? "text-negative-700" : "text-content-strong",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export const WidgetFrame = forwardRef<HTMLElement, WidgetFrameProps>(function WidgetFrame(
  { id, title, chip, editing = false, menu, onOpen, onKeyDown, style, className, children },
  ref,
) {
  return (
    <section
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={title}
      data-widget-id={id}
      data-editing={editing ? "true" : "false"}
      onKeyDown={onKeyDown}
      style={style}
      className={cx("report-widget flex h-full min-h-0 flex-col rounded-card border border-hairline bg-surface-card shadow-sm", className)}
    >
      <header className="flex min-h-[40px] items-center gap-2 px-4 pt-3 pb-1">
        <div className={cx("widget-drag flex min-w-0 flex-1 items-center gap-2", editing && "cursor-grab active:cursor-grabbing")}>
          {editing ? <GripIcon /> : null}
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 truncate rounded-xs text-left text-body-sm font-medium text-content-strong hover:text-content-accent"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-body-sm font-medium text-content-strong">{title}</span>
          )}
        </div>
        {chip ? (
          <span className="shrink-0 rounded-pill border border-hairline bg-gray-50 px-2 py-0.5 font-mono text-caption text-content-muted">{chip}</span>
        ) : null}
        {menu && menu.length > 0 ? <FrameMenu items={menu} label={title} /> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">{children}</div>
    </section>
  );
});
