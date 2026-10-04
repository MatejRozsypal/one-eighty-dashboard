"use client";

/**
 * The left list panel of the Reports section (design 1.2): pinned reports and
 * the recent ones, a link to the full list, and "+" to start a new report.
 * Desktop only (the report page has its own switcher on mobile).
 *
 * It replaces the analytics sidebar, which `Sidebar` hides on `/reports`. It
 * is light, like the pages beside it, so the dark rail stays the one dark
 * spine. Data comes from `ReportsDirectory`, filled by the layout.
 *
 * Owner: RS9.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useGroupedReports, type DirectoryEntry } from "./ReportsDirectory";

const MAX_RECENT = 8;

function Row({ entry, active }: { entry: DirectoryEntry; active: boolean }) {
  return (
    <Link
      href={`/reports/${entry.id}`}
      aria-current={active ? "page" : undefined}
      title={entry.name}
      className={`block truncate rounded-sm px-2.5 py-[7px] text-[13px] transition-colors duration-fast ${
        active ? "bg-gray-100 font-medium text-content-strong" : "text-content-body hover:bg-gray-50"
      }`}
    >
      {entry.name}
    </Link>
  );
}

function Section({ label, entries, activeId }: { label: string; entries: readonly DirectoryEntry[]; activeId: string | null }) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">{label}</span>
      {entries.map((e) => (
        <Row key={e.id} entry={e} active={e.id === activeId} />
      ))}
    </div>
  );
}

export function ReportListPanel() {
  const pathname = usePathname();
  const { pinned, recent } = useGroupedReports();
  const activeId = /^\/reports\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
  const onList = pathname === "/reports";

  return (
    <aside aria-label="Reports" className="sticky top-0 hidden h-screen w-[232px] flex-none flex-col border-r border-hairline bg-paper lg:flex">
      <div className="flex h-[var(--header-h)] flex-none items-center justify-between gap-2 border-b border-hairline px-4 pt-[var(--safe-top)]">
        <Link
          href="/reports"
          aria-current={onList ? "page" : undefined}
          className="text-[14px] font-bold tracking-heading text-content-strong"
        >
          Reports
        </Link>
        <Link
          href="/reports?new=1"
          aria-label="New report"
          title="New report"
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-strong"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M7 2v10M2 7h10" />
          </svg>
        </Link>
      </div>

      <nav aria-label="Saved reports" className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-4">
        <Section label="Pinned" entries={pinned} activeId={activeId} />
        <Section label="Recent" entries={recent.slice(0, MAX_RECENT)} activeId={activeId} />
        {pinned.length + recent.length === 0 && <p className="px-2.5 text-[13px] text-content-muted">No reports.</p>}
      </nav>
    </aside>
  );
}
