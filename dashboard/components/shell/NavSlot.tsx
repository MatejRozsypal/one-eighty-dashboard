"use client";

/**
 * A place in the sidebar that a section layout can fill.
 *
 * The sidebar is rendered by the app layout, but some second-level content
 * belongs to data only a section's own layout has: the Reports list is read by
 * `app/(app)/reports/layout.tsx` and handed down through `ReportsDirectory`,
 * which the app layout sits outside of. Rather than read every report on every
 * page of the app to fill a list that shows on one section, the sidebar marks
 * a slot and the section portals its rows into it.
 *
 * Mount order does not matter: the slot element is held in a tiny external
 * store, so a portal rendered before the slot exists simply renders once the
 * sidebar registers it, and goes away when the sidebar removes it.
 */

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type NavSlotId = "reports";

const slots = new Map<NavSlotId, HTMLElement>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSlot(id: NavSlotId, el: HTMLElement | null) {
  if (el) slots.set(id, el);
  else slots.delete(id);
  listeners.forEach((l) => l());
}

/** The sidebar side: a container that registers itself while mounted. */
export function NavSlotHost({ id, className }: { id: NavSlotId; className?: string }) {
  const ref = useCallback((el: HTMLDivElement | null) => setSlot(id, el), [id]);
  return <div ref={ref} className={className} />;
}

/** The section side: renders `children` into the slot while the sidebar shows it, else nothing. */
export function NavSlotFill({ id, children }: { id: NavSlotId; children: ReactNode }) {
  const host = useSyncExternalStore(
    subscribe,
    () => slots.get(id) ?? null,
    () => null
  );
  return host ? createPortal(children, host) : null;
}
