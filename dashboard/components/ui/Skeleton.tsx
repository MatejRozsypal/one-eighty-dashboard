/**
 * The one skeleton primitive, and the page-shaped skeletons built from it.
 *
 * Every placeholder in the dashboard is a `Skeleton`: a block that carries
 * `.oe-skeleton`, whose pulse is defined once in `app/globals.css` (tokens
 * `--pulse-*`, `--skeleton-bg`), so loading looks the same on every route and
 * reduced motion is handled in one place. No colours or timings here.
 *
 * Server-safe (no state), so a `loading.tsx` can render it directly.
 *
 * `SkeletonPage` mirrors a page's own frame: the header, the control strip and
 * a `<main>` of blocks. The header and control strip are siblings of `<main>`
 * on purpose, exactly as the pages render them, so layouts that order their
 * children (Paid slots its tab bar between header and controls) work the same
 * on a skeleton. The `<main>` is `aria-busy`, which keeps the pending-region
 * pulse off it (it already pulses through its blocks).
 */

import type { CSSProperties, ReactNode } from "react";

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`oe-skeleton block ${className}`} style={style} />;
}

/** A filled card frame for blocks that hold several placeholders. */
function Frame({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-card border border-hairline bg-surface-card p-[18px_20px] shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** One metric card: label, figure, delta. Same box as `MetricCard`. */
export function SkeletonMetric({ label }: { label?: ReactNode }) {
  return (
    <div className="flex min-h-[132px] flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[18px_20px] shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-content-muted">
          {label ?? " "}
        </span>
        <Skeleton className="h-[9px] w-[52px] rounded-pill" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[30px] w-[70%] rounded-xs" />
        <Skeleton className="h-3 w-[40%] rounded-pill" />
      </div>
    </div>
  );
}

export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonMetric key={i} />
      ))}
    </div>
  );
}

/** A chart card: a title bar over a plot area. */
export function SkeletonChart({ height = 268 }: { height?: number }) {
  return (
    <Frame>
      <Skeleton className="mb-4 h-[11px] w-[132px] rounded-pill" />
      <Skeleton className="w-full rounded-md" style={{ height }} />
    </Frame>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex gap-6 border-b border-hairline px-5 py-3.5">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className={`h-[9px] rounded-pill ${c === 0 ? "w-[22%]" : "w-[10%]"}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 border-b border-hairline px-5 py-4 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={`h-[12px] rounded-pill ${c === 0 ? "w-[22%]" : "w-[10%]"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A wall of cards (creative tiles, concept cards). */
export function SkeletonCards({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-3 shadow-sm">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-[11px] w-[70%] rounded-pill" />
          <Skeleton className="h-[9px] w-[40%] rounded-pill" />
        </div>
      ))}
    </div>
  );
}

/** Stacked bars: attainment, ranked lists. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <Frame className="flex flex-col gap-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-[11px] w-[160px] rounded-pill" />
            <Skeleton className="h-[11px] w-[64px] rounded-pill" />
          </div>
          <Skeleton className="h-[8px] w-full rounded-pill" />
        </div>
      ))}
    </Frame>
  );
}

export type SkeletonBlock =
  | "kpi"
  | "kpi-6"
  | "kpi-8"
  | "chart"
  | "split"
  | "table"
  | "table-long"
  | "heatmap"
  | "cards"
  | "list";

function renderBlock(block: SkeletonBlock, key: number): ReactNode {
  switch (block) {
    case "kpi":
      return <SkeletonKpiRow key={key} count={4} />;
    case "kpi-6":
      return <SkeletonKpiRow key={key} count={6} />;
    case "kpi-8":
      return <SkeletonKpiRow key={key} count={8} />;
    case "chart":
      return <SkeletonChart key={key} />;
    case "split":
      return (
        <div key={key} className="grid gap-3.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      );
    case "table":
      return <SkeletonTable key={key} />;
    case "table-long":
      return <SkeletonTable key={key} rows={10} cols={6} />;
    case "heatmap":
      return <SkeletonChart key={key} height={320} />;
    case "cards":
      return <SkeletonCards key={key} />;
    case "list":
      return <SkeletonList key={key} />;
  }
}

/** Desktop page header strip: where `Header` sits. */
export function SkeletonHeader() {
  return (
    <header className="sticky top-0 z-30 hidden h-[var(--header-h)] items-center gap-3 border-b border-hairline bg-paper px-5 pt-[var(--safe-top)] lg:flex lg:px-8">
      <Skeleton className="h-[15px] w-[132px] rounded-xs" />
    </header>
  );
}

/** A tab bar (Creative, Settings): a row of labels under the header. */
export function SkeletonTabs({ count = 4 }: { count?: number }) {
  return (
    <div className="flex items-center gap-6 border-b border-hairline bg-paper px-5 py-4 lg:px-8">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[11px] w-[72px] rounded-pill" />
      ))}
    </div>
  );
}

/** Where `PageControls` sits: date range, comparison, a chip. */
export function SkeletonControls() {
  return (
    <div className="z-20 flex items-center gap-4 px-5 py-2 lg:sticky lg:top-[var(--header-h)] lg:border-b lg:border-hairline lg:bg-paper lg:px-8">
      <Skeleton className="h-[34px] w-[232px] rounded-control" />
      <Skeleton className="h-[30px] w-[216px] rounded-pill" />
      <Skeleton className="hidden h-[30px] w-[188px] rounded-pill lg:block" />
    </div>
  );
}

export function SkeletonPage({
  blocks,
  tabs = false,
  controls = true,
}: {
  /** What the page is made of, top to bottom. */
  blocks: readonly SkeletonBlock[];
  /** Tab bar under the header (pages that draw their own). */
  tabs?: boolean;
  /** The control strip. Off for pages with none. */
  controls?: boolean;
}) {
  return (
    <>
      {/*
        No mobile bar here: `MobileTopBar` lives in the layout, outside this
        boundary, so it stays put across the transition. Only the desktop
        header is inside the swapped subtree.
      */}
      <SkeletonHeader />
      {tabs && <SkeletonTabs />}
      {controls && <SkeletonControls />}
      <main
        aria-busy="true"
        aria-label="Loading"
        className="page-frame flex flex-col gap-6 px-5 pb-14 pt-6 lg:px-8"
      >
        {blocks.map((b, i) => renderBlock(b, i))}
      </main>
    </>
  );
}
