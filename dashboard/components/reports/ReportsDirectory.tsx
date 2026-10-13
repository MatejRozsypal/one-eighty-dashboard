"use client";

/**
 * The list of reports the signed-in user can see, handed down once by
 * `app/(app)/reports/layout.tsx` so the list panel and the switcher (Cmd/Ctrl+K)
 * share it without each fetching. It is a snapshot from the last server render:
 * actions revalidate `/reports`, and callers `router.refresh()` after a change.
 *
 * Two halves, because the list streams. `ReportsDirectory` wraps the whole
 * section and owns the overlay and its actions, so a page can patch the list
 * before the list has even arrived. `ReportsDirectoryEntries` sits inside the
 * layout's Suspense boundary with the list and lays the overlay over it for the
 * panel and the switcher. The page itself never waits for the list.
 *
 * Owner: RS9.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DirectoryEntry } from "@/lib/reports/directory";
export type { DirectoryEntry } from "@/lib/reports/directory";

const DirectoryContext = createContext<readonly DirectoryEntry[]>([]);

/** What a page can change in the list before the server has re-rendered it. */
export type DirectoryPatch = Partial<Pick<DirectoryEntry, "name" | "pinned">>;

interface DirectoryActions {
  /** Show a rename or a pin change in the list panel and the switcher at once. */
  patch(id: string, patch: DirectoryPatch): void;
  /** Remove a deleted report from the list panel and the switcher at once. */
  drop(id: string): void;
}

const NO_ACTIONS: DirectoryActions = { patch: () => undefined, drop: () => undefined };
const ActionsContext = createContext<DirectoryActions>(NO_ACTIONS);

type Overlay = Record<string, DirectoryPatch | "dropped">;

const OverlayContext = createContext<{ overlay: Overlay; reset(): void }>({ overlay: {}, reset: () => undefined });

/**
 * A layout is not re-rendered by a plain navigation, so after a rename, a pin or
 * a delete the list would keep the old state until the next refresh. Writers
 * call `useDirectoryActions()` to lay their change over the snapshot
 * immediately; the next snapshot replaces the overlay (`ReportsDirectoryEntries`
 * resets it), so the server stays the source of truth.
 */
export function ReportsDirectory({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>({});

  const patch = useCallback((id: string, next: DirectoryPatch) => {
    setOverlay((o) => ({ ...o, [id]: o[id] === "dropped" ? "dropped" : { ...(o[id] as DirectoryPatch | undefined), ...next } }));
  }, []);
  const drop = useCallback((id: string) => setOverlay((o) => ({ ...o, [id]: "dropped" })), []);
  const reset = useCallback(() => setOverlay({}), []);
  const actions = useMemo(() => ({ patch, drop }), [patch, drop]);
  const store = useMemo(() => ({ overlay, reset }), [overlay, reset]);

  return (
    <ActionsContext.Provider value={actions}>
      <OverlayContext.Provider value={store}>{children}</OverlayContext.Provider>
    </ActionsContext.Provider>
  );
}

/** `entries` is the server snapshot from the layout, with the overlay laid over it for everything below. */
export function ReportsDirectoryEntries({ entries, children }: { entries: readonly DirectoryEntry[]; children: ReactNode }) {
  const { overlay, reset } = useContext(OverlayContext);
  useEffect(() => reset(), [entries, reset]);

  const shown = useMemo(() => {
    if (Object.keys(overlay).length === 0) return entries;
    const lastPin = entries.reduce((m, e) => (e.pinned ? Math.max(m, e.pinPosition) : m), -1);
    return entries.flatMap((e) => {
      const o = overlay[e.id];
      if (o === undefined) return [e];
      if (o === "dropped") return [];
      const pinned = o.pinned ?? e.pinned;
      return [{ ...e, ...o, pinned, pinPosition: pinned && !e.pinned ? lastPin + 1 : e.pinPosition }];
    });
  }, [entries, overlay]);

  return <DirectoryContext.Provider value={shown}>{children}</DirectoryContext.Provider>;
}

export function useReportsDirectory(): readonly DirectoryEntry[] {
  return useContext(DirectoryContext);
}

export function useDirectoryActions(): DirectoryActions {
  return useContext(ActionsContext);
}

const byRecent = (a: DirectoryEntry, b: DirectoryEntry) => {
  const at = a.lastOpenedAt ?? "";
  const bt = b.lastOpenedAt ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
};

/** Pinned (in pin order), then the rest by last opened, then updated. */
export function useGroupedReports(): { pinned: DirectoryEntry[]; recent: DirectoryEntry[]; all: DirectoryEntry[] } {
  const entries = useReportsDirectory();
  return useMemo(() => {
    const pinned = entries.filter((e) => e.pinned).sort((a, b) => a.pinPosition - b.pinPosition);
    const rest = entries.filter((e) => !e.pinned).sort(byRecent);
    const all = [...entries].sort((a, b) => a.name.localeCompare(b.name, "en"));
    return { pinned, recent: rest, all };
  }, [entries]);
}
