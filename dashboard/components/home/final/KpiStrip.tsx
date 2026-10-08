/**
 * The strip across the top of Home: six cross-client figures for the last 30
 * days in one centred row, without a card, in the manner of the Shopify admin
 * home. Each figure is a small muted label with its (i), then the value, a
 * tiny line of the days and the change, on one line.
 *
 *   Client revenue · Meta spend · CM3 · New ads launched ·
 *   New concepts launched · Incremental CM3
 *
 * What used to sit under a tile ("4 of 5 clients") is in its (i). The four money figures share one read of the daily actuals; new ads
 * and new concepts each have their own, slower source. Every figure streams
 * in its own Suspense boundary, so a slow source holds only its own slot.
 * Wraps to three a row or two (see StripFrame), never scrolls sideways.
 */

import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { InfoTip } from "@/components/ui/InfoTip";
import { DeltaChip } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { NO_VALUE, formatMoney, formatNumber, formatRatio } from "@/lib/format";
import type { Kpi } from "@/lib/home/shopify/types";
import { loadMoneyKpis, loadNewAdsKpi, loadNewConceptsKpi } from "@/lib/home/final/data";

function display(k: Kpi): string {
  if (k.value === null) return NO_VALUE;
  if (k.kind === "money") return formatMoney(k.value, "CZK", { compact: true });
  if (k.kind === "ratio") return formatRatio(k.value);
  return formatNumber(k.value);
}

/**
 * The (i) text: what the figure is, then the client count the tile used to
 * show under it. The old caption ("vs last year") is already in the tip.
 */
export function compactTip(k: Kpi): string {
  const partial = k.value !== null && k.clients.included < k.clients.total;
  return [k.tip, k.note, partial ? `${k.clients.included} of ${k.clients.total} clients.` : null]
    .filter(Boolean)
    .join(" ");
}

/** One figure of the strip: label and (i), then value, line and change. */
export function CompactKpi({ k }: { k: Kpi }) {
  const missing = k.value === null;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <span className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium leading-[1.2] text-content-muted">
        <span className="truncate">{k.label}</span>
        <span className="shrink-0 text-[11px] leading-none">
          <InfoTip text={compactTip(k)} label={`About ${k.label}`} />
        </span>
      </span>
      <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
        <span
          className={`whitespace-nowrap text-[15.5px] font-semibold leading-[1.2] tracking-heading tabular ${
            missing ? "text-content-muted" : "text-content-strong"
          }`}
        >
          {display(k)}
        </span>
        {!missing && (
          <span className="inline-block w-8 shrink-0" aria-hidden="true">
            <Sparkline data={k.series} tone="accent" width={32} height={16} />
          </span>
        )}
        <DeltaChip
          className="text-[12px]"
          change={
            k.kind === "money"
              ? { current: k.value, previous: k.previous, kind: "money", currency: "CZK", compact: true }
              : { current: k.value, previous: k.previous, kind: k.kind === "ratio" ? "ratio" : "count" }
          }
          goodWhen={k.goodWhen}
        />
      </span>
    </div>
  );
}

type MoneyTile = "revenue" | "meta" | "cm3" | "incremental";

async function MoneyTileCell({ tile }: { tile: MoneyTile }) {
  const money = await loadMoneyKpis();
  return <CompactKpi k={money[tile]} />;
}

async function NewAdsCell() {
  return <CompactKpi k={await loadNewAdsKpi()} />;
}

async function NewConceptsCell() {
  return <CompactKpi k={await loadNewConceptsKpi()} />;
}

export function CellSkeleton() {
  return (
    <div className="flex flex-col items-center gap-1.5" aria-busy="true">
      <Skeleton className="h-[12px] w-[96px] rounded-pill" />
      <Skeleton className="h-[16px] w-[120px] rounded-xs" />
    </div>
  );
}

/**
 * The row, sized by the content area (a container query), not the window, so
 * the sidebar's width counts: two a row on a phone, three from 560 px, all
 * six on one centred line from 1100 px (they need about 1100 px at their
 * natural width, so none of them is squeezed into wrapping), never five and
 * an orphan.
 */
export function StripFrame({ children }: { children: ReactNode }) {
  return (
    <div className="[container-type:inline-size]">
      <section
        aria-label="Last 30 days, all clients"
        className="grid grid-cols-2 gap-x-3 gap-y-4 [@container(min-width:560px)]:grid-cols-3 [@container(min-width:1100px)]:flex [@container(min-width:1100px)]:flex-wrap [@container(min-width:1100px)]:items-start [@container(min-width:1100px)]:justify-center [@container(min-width:1100px)]:gap-x-6 [&>*]:shrink-0"
      >
        {children}
      </section>
    </div>
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
        <div key={c.key} className="min-w-0">
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
