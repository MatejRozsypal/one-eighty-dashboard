/**
 * The strip across the top of Home: six cross-client tiles for the last 30
 * days, in the Shopify variant's frame and cells (`KpiCell`).
 *
 *   Client revenue · Meta spend · CM3 · New ads launched ·
 *   New concepts launched · Incremental CM3
 *
 * The four money tiles share one read of the daily actuals; new ads and new
 * concepts each have their own, slower source. Every tile streams in its own
 * Suspense boundary, so a slow source holds only its own cell.
 */

import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { KpiCell } from "@/components/home/shopify/KpiStrip";
import { loadMoneyKpis, loadNewAdsKpi, loadNewConceptsKpi } from "@/lib/home/final/data";

type MoneyTile = "revenue" | "meta" | "cm3" | "incremental";

async function MoneyTileCell({ tile }: { tile: MoneyTile }) {
  const money = await loadMoneyKpis();
  return <KpiCell k={money[tile]} />;
}

async function NewAdsCell() {
  return <KpiCell k={await loadNewAdsKpi()} />;
}

async function NewConceptsCell() {
  return <KpiCell k={await loadNewConceptsKpi()} />;
}

export function CellSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:px-5" aria-busy="true">
      <Skeleton className="h-[11px] w-[60%] rounded-pill" />
      <Skeleton className="h-[22px] w-[70%] rounded-xs" />
      <Skeleton className="h-[26px] w-full rounded-xs" />
    </div>
  );
}

/** Hairlines between cells are 1px gaps letting the frame's colour through. */
export function StripFrame({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Last 30 days, all clients"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline shadow-sm md:grid-cols-3 xl:grid-cols-6"
    >
      {children}
    </section>
  );
}

export function HomeKpiStrip() {
  const cells: Array<{ key: string; node: ReactNode }> = [
    { key: "revenue", node: <MoneyTileCell tile="revenue" /> },
    { key: "meta", node: <MoneyTileCell tile="meta" /> },
    { key: "cm3", node: <MoneyTileCell tile="cm3" /> },
    { key: "new_ads", node: <NewAdsCell /> },
    { key: "new_concepts", node: <NewConceptsCell /> },
    { key: "incremental", node: <MoneyTileCell tile="incremental" /> },
  ];
  return (
    <StripFrame>
      {cells.map((c) => (
        <div key={c.key} className="min-w-0 bg-surface-card">
          <Suspense fallback={<CellSkeleton />}>{c.node}</Suspense>
        </div>
      ))}
    </StripFrame>
  );
}

/** "to 7 Oct" in the period pill, once the money read knows the last day. */
export async function StripThrough() {
  const { through } = await loadMoneyKpis();
  if (!through) return null;
  const [y, m, d] = through.split("-").map(Number);
  const text = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return <span className="font-medium text-content-muted">to {text}</span>;
}
