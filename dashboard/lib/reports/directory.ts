/**
 * Report directory entries: the slim list the reports layout passes to the
 * client switcher and list panel. Lives outside the "use client" component so
 * the server layout can call toDirectory().
 */
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
