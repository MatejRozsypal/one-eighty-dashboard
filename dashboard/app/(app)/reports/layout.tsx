/**
 * The Reports section's shell.
 *
 * Two jobs.
 *
 * Access. Reports reads every client at once, so it has its own gate:
 * `requireReportsAccess()` (admin or agency on an internal domain, never the
 * client role). Enforcing it here covers every page under /reports, including
 * ones added later; each page calls it again, cheaply (design 3.1, points 1
 * and 2). The rail only hides the link; presentation is not access control.
 *
 * Layout. The analytics sidebar is hidden on /reports (`Sidebar`), so this draws
 * the section's own list panel beside the page, and mounts the report switcher
 * (Cmd/Ctrl+K) once for every page. The grid's two stylesheets load here, the
 * library's first and the token restyle second (RS6): the restyle is one class
 * deeper than the library, so the order only matters for equal specificity.
 */

import "react-grid-layout/css/styles.css";
import "./grid.css";

import { Suspense } from "react";
import { requireReportsAccess } from "@/lib/authz";
import { listReports } from "@/lib/reports/store";
import { ReportListPanel } from "@/components/reports/ReportListPanel";
import { ReportSwitcher } from "@/components/reports/ReportSwitcher";
import { ReportsDirectory, toDirectory } from "@/components/reports/ReportsDirectory";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireReportsAccess();

  // Mine and Team overlap (a report of mine that is shared appears in both).
  const [mine, team] = await Promise.all([listReports("mine"), listReports("team")]);
  const seen = new Set<string>();
  const entries = toDirectory([...mine, ...team].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))));

  return (
    <ReportsDirectory entries={entries}>
      <div className="flex min-h-screen min-w-0 flex-1 items-start">
        <ReportListPanel />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col bg-bg-subtle">{children}</div>
      </div>
      <Suspense fallback={null}>
        <ReportSwitcher />
      </Suspense>
    </ReportsDirectory>
  );
}
