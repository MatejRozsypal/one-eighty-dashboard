/**
 * One report (design 1.4). The server half: gate, the stored report and the
 * reference data (clients, metric lists), handed to the client half once.
 *
 * Not visible to this user (missing, deleted, or private to someone else) is
 * `notFound()`, the same answer for all three so ids cannot be probed. The
 * client half owns everything after: the canvas, edits, filters and data.
 *
 * Filter overrides live in the query string and are read by the client half;
 * this page never needs them, so changing a filter re-renders it cheaply.
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireReportsAccess } from "@/lib/authz";
import { getReportClients } from "@/lib/reports/clients";
import { buildPageMetrics } from "@/lib/reports/pageData";
import { getReport } from "@/lib/reports/store";
import { ReportClient } from "@/components/reports/ReportClient";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: { reportId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requireReportsAccess();
  if (!UUID.test(params.reportId)) notFound();

  const [loaded, clients] = await Promise.all([getReport(params.reportId), getReportClients()]);
  if (!loaded || !loaded.permissions.canView) notFound();

  const { pickerMetrics, widgetMetrics, caveatTexts } = buildPageMetrics();
  const edit = Array.isArray(searchParams.edit) ? searchParams.edit[0] : searchParams.edit;

  return (
    <Suspense fallback={null}>
      <ReportClient
        key={loaded.report.id}
        report={loaded.report}
        widgets={loaded.widgets}
        permissions={loaded.permissions}
        pinned={loaded.pinned}
        clients={clients}
        pickerMetrics={pickerMetrics}
        widgetMetrics={widgetMetrics}
        caveatTexts={caveatTexts}
        initialEdit={edit === "1"}
      />
    </Suspense>
  );
}
