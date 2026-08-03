/**
 * Data Health — is the warehouse current, and does it agree with itself?
 *
 * Boring on purpose. This is the page that makes every other number
 * trustworthy: it says how fresh each source is, where the configuration
 * disagrees with the data, and what the known measurement limits are.
 *
 * The registry drift section has two live examples, both real: the registry
 * says Dobias trades in CAD when every warehouse row is USD, and says Manami
 * has no Google Ads when Google has been spending since October. Neither is
 * worked around in code — a workaround buries the problem and rots the moment
 * a third client lands. They're reported, and fixing them is one UPDATE.
 */

import type { Metadata } from "next";
import { getClients, detectRegistryDrift } from "@/lib/clients";
import { getSourceFreshness, getPipelineRuns } from "@/lib/queries/health";
import { KNOWN_CAVEATS } from "@/lib/metrics";
import { optional } from "@/lib/queries/errors";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { formatNumber } from "@/lib/currency";
import { requireInternalRole } from "@/lib/authz";

export const metadata: Metadata = { title: "Data Health" };
// Rendered per request: every page is behind auth and parameterised by the URL,
// so there is nothing to prerender. Repeat cost is absorbed by BigQuery's own
// 24-hour result cache, which serves byte-identical queries for free.
export const dynamic = "force-dynamic";

const PLATFORM_DOT: Record<string, string> = {
  shopify: "bg-platform-shopify",
  shoptet: "bg-platform-shoptet",
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
};

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function HealthPage() {
  // Internal-only: this page names every client and shows the agency's own
  // pipeline runs. A client-role account has no business reading either — under
  // an NDA, even the roster of who else is a customer is not theirs to see.
  await requireInternalRole();

  const clients = await getClients();

  const [freshness, drift, runs] = await Promise.all([
    getSourceFreshness(clients),
    optional(() => detectRegistryDrift(clients), []),
    getPipelineRuns(12),
  ]);

  const checkedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <>
      <Header eyebrow="Admin" title="Data Health" />

      <main className="flex max-w-[1240px] flex-col gap-[22px] px-5 pb-14 pt-6 lg:px-8">
        {drift.length > 0 && (
          <section className="flex flex-col gap-3">
            <Eyebrow>Registry drift — {drift.length} open</Eyebrow>
            {drift.map((d) => (
              <div
                key={`${d.clientId}-${d.field}`}
                className="flex flex-col items-start gap-3.5 rounded-card border border-warning/[0.38] bg-[#FFFBF4] p-[16px_20px] lg:flex-row lg:items-start"
              >
                <span className="mt-px">
                  <Badge variant="neutral" size="sm" dot>
                    Drift
                  </Badge>
                </span>
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[14px] font-semibold tracking-[-0.01em] text-content-strong">
                    {d.clientId} · <code className="font-mono">{d.field}</code>{" "}
                    disagrees with the warehouse
                  </span>
                  <span className="text-[12.5px] leading-[1.6] text-content-body">
                    {d.consequence}
                  </span>
                  <span className="font-mono text-[11px] tabular text-content-muted">
                    registry: {d.registryValue} · warehouse: {d.actualValue}
                  </span>
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] text-content-muted">
                  Read-only — fix in registry
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <Eyebrow>Source freshness</Eyebrow>
            <span className="text-[12px] text-content-muted">
              Measured by data landed, not by workflow runs
            </span>
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
                  // Worst first when sorted descending — the point of sorting
                  // this column is to find what is broken, not to alphabetise.
                  const severity = { blocked: 3, stale: 2, late: 1, ok: 0 }[s.status];
                  return {
                    key: `${s.clientId}-${s.source}`,
                    sort: [s.clientName, s.source, s.lastDate, s.expected, severity],
                    cells: [
                      <span className="text-[13px] text-content-body">
                        {s.clientName}
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
                        {fmtDate(s.lastDate)}
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

          <div className="px-5 py-3.5 text-[12px] leading-[1.6] text-content-muted">
            &ldquo;OK&rdquo; means different things per source. Shops land same-day;
            ad platforms are structurally a day behind and cannot be queried for
            today at all; email lands on send, so a quiet fortnight is not a
            failure. Each row is judged against its own expectation.
          </div>
        </section>

        <section className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
          <div className="border-b border-hairline px-5 py-4">
            <Eyebrow>Recent pipeline runs</Eyebrow>
          </div>

          {runs === null ? (
            <div className="px-5 py-5 text-[12.5px] leading-[1.6] text-content-body">
              Not readable from here. The frontend service account holds Data
              Viewer on the <code className="font-mono">mart</code> dataset only —
              deliberately, so the app cannot reach raw PII — and{" "}
              <code className="font-mono">ops.pipeline_log</code> sits outside that
              grant. The freshness table above is the better signal anyway: a
              workflow can run, succeed, and land nothing.
            </div>
          ) : runs.length === 0 ? (
            <div className="px-5 py-5 text-[12.5px] text-content-muted">
              No runs in the last 7 days.
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
                      {r.durationSeconds !== null ? `${r.durationSeconds}s` : "—"}
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

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <div className="flex flex-col gap-1.5">
            <Eyebrow>Known caveats — surfaced, not buried</Eyebrow>
            <span className="text-[12.5px] leading-[1.6] text-content-muted">
              Every one of these also appears in the tooltip of the metric it
              affects. The dashboard is more trustworthy than the reports it
              replaces not because the numbers are perfect, but because it says
              where they aren&apos;t.
            </span>
          </div>

          {KNOWN_CAVEATS.map((c) => (
            <div key={c.title} className="flex gap-3 border-t border-hairline pt-3.5">
              <span aria-hidden="true" className="text-[13px] leading-[1.4] text-warning">
                ⚠
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[13.5px] font-semibold text-content-strong">
                  {c.title}
                </span>
                <span className="text-[12.5px] leading-[1.6] text-content-body">
                  {c.body}
                </span>
              </span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
