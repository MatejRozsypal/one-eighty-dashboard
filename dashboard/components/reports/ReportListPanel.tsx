"use client";

/**
 * The Reports product's second level in the sidebar (design 1.2): the pinned
 * reports and the latest ones, "See all" for the full list, and "New report".
 *
 * Rendered by the Reports layout, because that is where the list is read, and
 * portalled into the slot the sidebar opens under the Reports row
 * (`NavSlot`), so it reads as the section's own pages, the way Shopify lists
 * Reports under Analytics. Trimmed so the sidebar's other rows stay on screen;
 * the full list is the /reports page. Desktop only, like the sidebar (the
 * report page has its own switcher on mobile). Data comes from
 * `ReportsDirectory`, filled by the layout.
 *
 * Owner: RS9.
 */

import { AppLink } from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { NavSlotFill } from "@/components/shell/NavSlot";
import { SUB_HEAD, SUB_ROW, SUB_ROW_ACTIVE, SUB_ROW_IDLE, SUB_ROW_MUTED } from "@/components/shell/navStyles";
import { useGroupedReports, type DirectoryEntry } from "./ReportsDirectory";

/** Pinned reports listed before "See all". */
const MAX_PINNED = 5;
/** Recent (unpinned) reports listed before "See all". */
const MAX_RECENT = 5;

function Row({ entry, active }: { entry: DirectoryEntry; active: boolean }) {
  return (
    <li>
      <AppLink
        href={`/reports/${entry.id}`}
        aria-current={active ? "page" : undefined}
        title={entry.name}
        className={`${SUB_ROW} ${active ? SUB_ROW_ACTIVE : SUB_ROW_IDLE}`}
      >
        <span className="min-w-0 truncate">{entry.name}</span>
      </AppLink>
    </li>
  );
}

function Section({ label, entries, activeId }: { label: string; entries: readonly DirectoryEntry[]; activeId: string | null }) {
  if (entries.length === 0) return null;
  const id = `nav-reports-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col">
      <span id={id} className={SUB_HEAD}>
        {label}
      </span>
      <ul aria-labelledby={id} className="m-0 flex list-none flex-col gap-px p-0">
        {entries.map((e) => (
          <Row key={e.id} entry={e} active={e.id === activeId} />
        ))}
      </ul>
    </div>
  );
}

export function ReportListPanel() {
  const pathname = usePathname();
  const { pinned, recent } = useGroupedReports();
  const activeId = /^\/reports\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
  const total = pinned.length + recent.length;
  const listed = Math.min(pinned.length, MAX_PINNED) + Math.min(recent.length, MAX_RECENT);

  return (
    <NavSlotFill id="reports">
      <div className="flex flex-col gap-2">
        <Section label="Pinned" entries={pinned.slice(0, MAX_PINNED)} activeId={activeId} />
        <Section label="Recent" entries={recent.slice(0, MAX_RECENT)} activeId={activeId} />
        {total === 0 && <span className={`${SUB_ROW} text-gray-400`}>No reports.</span>}
        <ul className="m-0 flex list-none flex-col gap-px p-0">
          {listed < total && (
            <li>
              <AppLink href="/reports" className={`${SUB_ROW} ${SUB_ROW_MUTED}`}>
                See all ({total})
              </AppLink>
            </li>
          )}
          <li>
            <AppLink href="/reports?new=1" className={`${SUB_ROW} ${SUB_ROW_MUTED}`}>
              New report
            </AppLink>
          </li>
        </ul>
      </div>
    </NavSlotFill>
  );
}
