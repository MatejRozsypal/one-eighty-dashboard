"use client";

/**
 * The list of reports the signed-in user can see, handed down once by
 * `app/(app)/reports/layout.tsx` so the list panel and the switcher (Cmd/Ctrl+K)
 * share it without each fetching. It is a snapshot from the last server render:
 * actions revalidate `/reports`, and callers `router.refresh()` after a change.
 *
 * Owner: RS9.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ReportListItem } from "@/lib/reports/contracts";

export interface DirectoryEntry {
  id: string;
  name: string;
  pinned: boolean;
  pinPosition: number;
  lastOpenedAt: string | null;
  updatedAt: string;
  ownerEmail: string;
}

const DirectoryContext = createContext<readonly DirectoryEntry[]>([]);

export function toDirectory(items: readonly ReportListItem[]): DirectoryEntry[] {
  return items.map((r) => ({
    id: r.id,
    name: r.name,
    pinned: r.pinned,
    pinPosition: r.pinPosition,
    lastOpenedAt: r.lastOpenedAt,
    updatedAt: r.updatedAt,
    ownerEmail: r.ownerEmail,
  }));
}

export function ReportsDirectory({ entries, children }: { entries: readonly DirectoryEntry[]; children: ReactNode }) {
  return <DirectoryContext.Provider value={entries}>{children}</DirectoryContext.Provider>;
}

export function useReportsDirectory(): readonly DirectoryEntry[] {
  return useContext(DirectoryContext);
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
