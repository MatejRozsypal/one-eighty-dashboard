/**
 * Channels — where the traffic came from.
 *
 * This page has no data, and says so plainly. GA4 is the only source of session,
 * channel and funnel information, and its BigQuery export has never been
 * enabled. That is a structural gap, not a missing tile: the dashboard cannot
 * currently answer "where did the traffic come from" at all.
 *
 * It's built rather than omitted because a quietly absent channel view lets
 * everyone forget the gap exists. Stated, it stays on the list.
 */

import type { Metadata } from "next";
import { getClients, resolveClient } from "@/lib/clients";
import { parseViewParams, type SearchParams } from "@/lib/params";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";

export const metadata: Metadata = { title: "Channels" };

const PENDING_VIEWS = [
  {
    title: "Channel overview",
    note: "Sessions and revenue by acquisition channel. Needs the GA4 sessions export.",
    shape: "donut" as const,
  },
  {
    title: "Site funnel",
    note: "Session → add to cart → checkout → purchase. Needs the GA4 events export.",
    shape: "funnel" as const,
  },
  {
    title: "Active users trend",
    note: "Daily active users. Needs the GA4 sessions export.",
    shape: "bars" as const,
  },
];

const OTHER_BLOCKERS = [
  {
    title: "Instagram organic",
    note: "Partial — media rows land, account insights are blocked on token scope.",
  },
  {
    title: "Facebook organic posts",
    note: "Blocked — needs a Page Access Token swap.",
  },
  {
    title: "Email list growth",
    note: "Blocked on a Klaviyo segment mirroring the master list — unknown, not zero.",
  },
  {
    title: "Google Ads detail",
    note: "Live in staging, no mart view yet — spend totals work, per-campaign detail does not.",
  },
];

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseViewParams(searchParams);
  const clients = await getClients();
  const client = await resolveClient(params.clientId, clients);

  return (
    <>
      <Header
        eyebrow={pageEyebrow("/channels", client.name)}
        title="Channels (GA4)"
      />

      <main className="flex max-w-[1180px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <div className="flex flex-col items-start gap-3.5 rounded-card border border-dashed border-hairline-strong bg-paper p-[20px] lg:flex-row lg:p-[20px_24px]">
          <Badge variant="outline" size="sm">
            Not connected
          </Badge>
          <span className="flex flex-col gap-1.5">
            <span className="text-[14.5px] font-semibold leading-[1.5] text-content-strong">
              GA4 is the only source of traffic and funnel data, and its BigQuery
              export isn&apos;t enabled.
            </span>
            <span className="max-w-[760px] text-[13px] leading-[1.6] text-content-body">
              Until it is, this dashboard cannot answer &ldquo;where did the traffic
              come from.&rdquo; That is a structural gap, not a missing tile — so it
              is stated here rather than quietly omitted. Enabling the GA4 →
              BigQuery link backfills all three views below.
            </span>
          </span>
        </div>

        <section className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          {PENDING_VIEWS.map((view) => (
            <div
              key={view.title}
              className="flex min-h-[280px] flex-col gap-4 rounded-card border border-dashed border-hairline-strong bg-paper p-[22px_24px]"
            >
              <Eyebrow>{view.title}</Eyebrow>

              <div className="flex flex-1 items-center justify-center">
                {view.shape === "donut" && (
                  <span
                    aria-hidden="true"
                    className="block h-[150px] w-[150px] rounded-full border-[22px] border-gray-100"
                  />
                )}
                {view.shape === "funnel" && (
                  <span
                    aria-hidden="true"
                    className="flex w-full flex-col justify-center gap-2.5"
                  >
                    {["100%", "64%", "31%", "12%"].map((w) => (
                      <span
                        key={w}
                        className="block h-5 rounded-xs bg-gray-100"
                        style={{ width: w }}
                      />
                    ))}
                  </span>
                )}
                {view.shape === "bars" && (
                  <span
                    aria-hidden="true"
                    className="flex h-full w-full items-end gap-1.5"
                  >
                    {[40, 62, 48, 76, 58, 88].map((h, i) => (
                      <span
                        key={i}
                        className="flex-1 rounded-xs bg-gray-100"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </span>
                )}
              </div>

              <span className="text-[12.5px] leading-[1.6] text-content-muted">
                {view.note}
              </span>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3.5 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <Eyebrow>Also pending — same treatment, different blocker</Eyebrow>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
            {OTHER_BLOCKERS.map((b) => (
              <span
                key={b.title}
                className="flex flex-col gap-1.5 border-t border-hairline pt-3"
              >
                <span className="text-[13px] font-semibold text-content-strong">
                  {b.title}
                </span>
                <span className="text-[12.5px] leading-[1.6] text-content-muted">
                  {b.note}
                </span>
              </span>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
