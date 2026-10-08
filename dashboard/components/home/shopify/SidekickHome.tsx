/**
 * Sidekick home, laid out in the order of the Shopify admin home: the 30-day
 * strip across the top, a large greeting with the assistant's box in the
 * middle, chips of waiting work under it, then cards and the clients.
 */

import type { SidekickHome as Data } from "@/lib/home/shopify/types";
import { KpiStrip } from "./KpiStrip";
import { Hero } from "./Hero";
import { ActionChips } from "./ActionChips";
import { Recommendations } from "./Recommendations";
import { ClientStrip } from "./ClientStrip";
import { WeatherChip } from "./WeatherChip";

/** "2026-10-07" -> "7 Oct". */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline bg-surface-card px-3 text-[13px] font-semibold text-content-strong shadow-xs";

export function SidekickHome({ data, name, now }: { data: Data; name: string | null; now: string }) {
  const through = shortDate(data.kpiThrough);
  return (
    <main className="page-frame flex flex-col gap-6 px-4 pb-14 pt-5 sm:px-5 lg:px-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={PILL}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-content-muted">
                <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
              </svg>
              Last 30 days
              {through && <span className="font-medium text-content-muted">to {through}</span>}
            </span>
            <span className={PILL}>All clients · CZK</span>
          </div>
          <WeatherChip />
        </div>
        <KpiStrip kpis={data.kpis} />
      </div>

      <div className="flex flex-col gap-5 py-6 sm:py-10">
        <Hero name={name} now={now} line={data.greetingLine} />
        <ActionChips chips={data.chips} />
      </div>

      <Recommendations items={data.recommendations} />
      <ClientStrip clients={data.clients} />
    </main>
  );
}
