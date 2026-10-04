/**
 * Reports: the list. Mine, Team, Templates, and a new-report picker.
 * Design 1.3. Every report page re-checks the gate (the layout does too).
 */

import type { Metadata } from "next";
import { requireReportsAccess } from "@/lib/authz";
import { listReports } from "@/lib/reports/store";
import { listTemplates } from "@/lib/reports/templates";
import { Header } from "@/components/shell/Header";
import { ReportListTable } from "@/components/reports/ReportListTable";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function ReportsPage({ searchParams }: { searchParams: Params }) {
  await requireReportsAccess();
  const [mine, team] = await Promise.all([listReports("mine"), listReports("team")]);
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <>
      <Header title="Reports" />
      <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
        <ReportListTable
          mine={mine}
          team={team}
          templates={listTemplates()}
          openNew={first(searchParams.new) === "1"}
          deletedId={first(searchParams.deleted)}
        />
      </main>
    </>
  );
}
