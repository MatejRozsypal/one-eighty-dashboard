/**
 * Pieces every Trends & analysis widget shares: the card with its heading,
 * the market colour key, number formatting per kind and the axis style.
 * Server-safe (no hooks), so server sections and client charts both use it.
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";
import { formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { MARKET_OTHER, MARKET_UNALLOCATED } from "@/lib/markets/types";
import type { TrendKind } from "@/lib/markets/analysis";

export function TrendCard({
  title,
  info,
  aside,
  children,
  id,
}: {
  title: string;
  info?: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Card as="section" padding="none" className="flex min-w-0 flex-col gap-4 p-4 sm:p-5" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
          {title}
          {info && <InfoTip text={info} label={`About ${title}`} />}
        </h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

/** "US", "Other", "Unallocated". */
export function marketLabel(key: string): string {
  if (key === MARKET_OTHER) return "Other";
  if (key === MARKET_UNALLOCATED) return "Unallocated";
  return key;
}

export function MarketKey({ markets, colors, extra }: { markets: string[]; colors: Record<string, string>; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-content-muted">
      {markets.map((m) => (
        <span key={m} className="inline-flex items-center gap-1.5 font-mono text-content-body">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colors[m] }} />
          {marketLabel(m)}
        </span>
      ))}
      {extra}
    </div>
  );
}

export function formatKind(v: number | null | undefined, kind: TrendKind | "rate", currency: string, compact = false): string {
  switch (kind) {
    case "money":
      return formatMoney(v, currency, compact ? { compact: true } : {});
    case "unit":
      return compact ? formatMoney(v, currency, { compact: true }) : formatMoney(v, currency, { unit: true });
    case "count":
      return formatNumber(v, compact ? { compact: true } : {});
    case "ratio":
      return formatRatio(v, compact ? { decimals: 1 } : {});
    case "rate":
      return formatPercent(v);
  }
}

export const AXIS_TICK = { fontSize: 10.5, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" } as const;

export function TooltipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-[180px] max-w-[280px] rounded-md border border-hairline bg-surface-card p-[10px_12px] font-mono text-[11.5px] shadow-lg">
      <div className="mb-1.5 text-content-strong">{title}</div>
      {children}
    </div>
  );
}

export function TooltipRow({ name, value, color, muted = false }: { name: string; value: string; color?: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <span className="inline-flex items-center gap-1.5 text-content-muted">
        {color && <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ background: color }} />}
        {name}
      </span>
      <span className={`tabular ${muted ? "text-content-muted" : "text-content-strong"}`}>{value}</span>
    </div>
  );
}
