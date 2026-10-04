/**
 * Data Health: is the data current, and does the registry agree with it?
 *
 * Boring on purpose. This is the page that makes every other number
 * trustworthy: it says how fresh each source is and where the configuration
 * disagrees with the data. Registry drift is reported, never worked around in
 * code, because a workaround buries the problem and rots the moment a third
 * client lands. Fixing drift is one registry UPDATE.
 */

import type { Metadata } from "next";
import { getClientsIncludingInactive, detectRegistryDrift } from "@/lib/clients";
import { getSourceFreshness, getPipelineRuns } from "@/lib/queries/health";
import { optional } from "@/lib/queries/errors";
import { probeClickUp } from "@/lib/creative/clickup";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { InfoTip } from "@/components/ui/InfoTip";
import { NoValue } from "@/components/ui/EmptyState";
import { formatNumber } from "@/lib/currency";
import { requireInternalRole } from "@/lib/authz";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

export const metadata: Metadata = { title: "Data Health" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

const PLATFORM_DOT: Record<string, string> = {
  shopify: "bg-platform-shopify",
  shoptet: "bg-platform-shoptet",
  woocommerce: "bg-platform-woocommerce",
  meta: "bg-platform-meta",
  google: "bg-platform-google",
  klaviyo: "bg-platform-klaviyo",
  ecomail: "bg-platform-ecomail",
};

const STATUS_BADGE = {
  ok: { variant: "positive" as const, label: "OK" },
  late: { variant: "neutral" as const, label: "Late" },
  stale: { variant: "negative" as const, label: "Stale" },
  blocked: { variant: "outline" as const, label: "Blocked" },
  // Not a fault: no workflow fetches for a client that is not active, so the
  // data is frozen deliberately. It still has to be visible, a client parked
  // mid-onboarding was previously seen by nothing at all.
  paused: { variant: "outline" as const, label: "Not live" },
};

/** Registry columns as people say them. Unknown fields pass through. */
const DRIFT_FIELD: Record<string, string> = {
  currency: "Currency",
  has_gads: "Google Ads",
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function HealthPage() {
  // Internal-only: this page names every client and shows the agency's own
  // pipeline runs. A client-role account has no business reading either, under
  // an NDA, even the roster of who else is a customer is not theirs to see.
  await requireInternalRole();

  const clients = await getClientsIncludingInactive();

  const [freshness, drift, runs, clickup] = await Promise.all([
    getSourceFreshness(clients),
    optional(
      () => detectRegistryDrift(clients.filter((c) => c.status === "active")),
      []
    ),
    getPipelineRuns(12),
    // Live, on every load. The alternative is a cached verdict, and a cached
    // "working" is exactly the thing that was wrong for a day.
    probeClickUp(),
  ]);

  return (
    <>
      <Header title="Data Health" />
      <SettingsTabs />

      <main className="page-frame flex flex-col gap-[22px] px-5 pb-14 pt-6 lg:px-8">
        {drift.length > 0 && (
          <section className="flex flex-col gap-3">
            <Eyebrow>Registry drift ({drift.length})</Eyebrow>
            {drift.map((d) => (
              <div
                key={`${d.clientId}-${d.field}`}
                className="flex flex-col items-start gap-3.5 rounded-card border border-warning/[0.38] bg-notice-warning p-[16px_20px] lg:flex-row lg:items-start"
              >
                <span className="mt-px">
                  <Badge variant="neutral" size="sm" dot>
                    Drift
                  </Badge>
                </span>
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[14px] font-semibold tracking-[-0.01em] text-content-strong">
                    {d.clientId} · {DRIFT_FIELD[d.field] ?? d.field} mismatch
                  </span>
                  <span className="text-[12.5px] leading-[1.6] text-content-body">
                    {d.consequence}
                  </span>
                  <span className="font-mono text-[11px] tabular text-content-muted">
                    Registry {d.registryValue} · data {d.actualValue}
                  </span>
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Source freshness answers "did data land". This answers "can the app
            still talk to ClickUp", which nothing else on any screen asks. */}
        <section
          className={`flex items-center gap-3 rounded-card border p-[16px_20px] ${
            clickup.ok
              ? "border-hairline bg-surface-card shadow-sm"
              : "border-warning/[0.38] bg-notice-warning"
          }`}
        >
          <Eyebrow>ClickUp</Eyebrow>
          <Badge variant={clickup.ok ? "neutral" : "outline"} size="sm" dot>
            {clickup.ok ? "Connected" : clickup.configured ? "Rejected" : "Not set"}
          </Badge>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-hairline px-5 py-4">
            <Eyebrow>Source freshness</Eyebrow>
            <InfoTip text="Judged per source by the latest date of data landed. Shops land same day, ad platforms a day behind, email on send." />
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <DataTable
                gridClass="grid grid-cols-[1.1fr_1fr_1.1fr_1fr_0.8fr] items-center gap-2.5"
                columns={[
                  { key: "client", label: "Client" },
                  { key: "source", label: "Source" },
                  { key: "last", label: "Last date landed" },
                  { key: "expected", label: "Expected" },
                  { key: "status", label: "Status" },
                ]}
                rows={freshness.map((s) => {
                  const badge = STATUS_BADGE[s.status];
                  // Worst first when sorted descending, the point of sorting
                  // this column is to find what is broken, not to alphabetise.
                  // Worst first, with "not live" below OK: it is information,
                  // not a defect, and sorting it to the top would bury the rows
                  // that actually need attention.
                  const severity = {
                    blocked: 3,
                    stale: 2,
                    late: 1,
                    ok: 0,
                    paused: -1,
                  }[s.status];
                  return {
                    key: `${s.clientId}-${s.source}`,
                    sort: [s.clientName, s.source, s.lastDate, s.expected, severity],
                    cells: [
                      <span className="text-[13px] text-content-body">
                        {s.clientName}
                        {s.clientStatus !== "active" && (
                          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                            {s.clientStatus}
                          </span>
                        )}
                      </span>,
                      <span className="inline-flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.04em] text-content-strong">
                        <span
                          aria-hidden="true"
                          className={`h-[9px] w-[9px] flex-none rounded-[3px] ${
                            PLATFORM_DOT[s.platform] ?? "bg-gray-400"
                          }`}
                        />
                        {s.source}
                      </span>,
                      <span
                        className={`font-mono text-[12px] tabular ${
                          s.status === "ok" ? "text-content-body" : "text-content-muted"
                        }`}
                      >
                        {s.lastDate ? fmtDate(s.lastDate) : <NoValue />}
                      </span>,
                      <span className="font-mono text-[12px] text-content-muted">
                        {s.expected}
                      </span>,
                      <Badge variant={badge.variant} size="sm">
                        {badge.label}
                      </Badge>,
                    ],
                  };
                })}
              />
            </div>
          </div>

        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="border-b border-hairline px-5 py-4">
            <Eyebrow>Recent pipeline runs</Eyebrow>
          </div>

          {runs === null ? (
            <div className="px-5 py-5 text-[12.5px] text-content-muted">
              Pipeline log not readable.
            </div>
          ) : runs.length === 0 ? (
            <div className="px-5 py-5 text-[12.5px] text-content-muted">
              No recent runs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[680px]">
                {runs.map((r, i) => (
                  <div
                    key={`${r.startedAt}-${i}`}
                    className="grid grid-cols-[0.9fr_1.3fr_0.6fr_0.7fr_0.7fr] items-center gap-2.5 border-b border-hairline px-5 py-3"
                  >
                    <span className="font-mono text-[12px] tabular text-content-muted">
                      {new Date(r.startedAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="truncate font-mono text-[12px] text-content-strong">
                      {r.workflow}
                    </span>
                    <span className="font-mono text-[12px] tabular text-content-body">
                      {formatNumber(r.rows)}
                    </span>
                    <span className="font-mono text-[12px] tabular text-content-muted">
                      {r.durationSeconds !== null ? `${r.durationSeconds}s` : <NoValue />}
                    </span>
                    <span className="justify-self-start">
                      <Badge
                        variant={r.status === "success" ? "positive" : "negative"}
                        size="sm"
                      >
                        {r.status}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
