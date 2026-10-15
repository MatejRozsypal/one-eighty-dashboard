/**
 * Markets: names, currency per column and number formatting.
 *
 * Pure, client-safe. Formatting goes through lib/format so the page prints
 * money, rates and ratios exactly as every other page does.
 */

import { formatMoney, formatNumber, formatPercent, formatRatio, type DeltaKind } from "@/lib/format";
import { MARKET_OTHER, MARKET_UNALLOCATED } from "@/lib/markets/types";
import { isNa, type MarketColumn, type Payback, type Val, type VerdictKey } from "@/lib/markets/model";

const REGION = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(iso: string): string {
  try {
    return REGION.of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/** Column heading: the ISO code, "Other", "Unallocated" or "Total". */
export function shortName(c: Pick<MarketColumn, "key">): string {
  if (c.key === MARKET_OTHER) return "Other";
  if (c.key === MARKET_UNALLOCATED) return "Unallocated";
  if (c.key === "TOTAL") return "Total";
  return c.key;
}

export function longName(c: Pick<MarketColumn, "key" | "members">): string {
  if (c.key === MARKET_OTHER) {
    const list = c.members.slice(0, 4).join(", ");
    return c.members.length ? `Other (${list}${c.members.length > 4 ? ", more" : ""})` : "Other";
  }
  if (c.key === MARKET_UNALLOCATED) return "Unallocated spend";
  if (c.key === "TOTAL") return "Total";
  return countryName(c.key);
}

export type CurrencyMode = "base" | "local";

/** The currency a column is shown in, and the factor per period to get there. */
export interface ColumnCurrency {
  code: string;
  cur: number;
  prev: number;
  /** Set when local was asked for but the column stays in base. */
  why?: string;
}

export function columnCurrency(c: MarketColumn, mode: CurrencyMode, base: string): ColumnCurrency {
  if (mode === "base") return { code: base, cur: 1, prev: 1 };
  if (c.kind === "unallocated") return { code: base, cur: 1, prev: 1, why: "Unallocated spend has no market currency" };
  if (!c.localCurrency || c.rate.cur === null) {
    const why =
      c.kind === "total" || c.kind === "other"
        ? "Markets trade in several currencies"
        : "No single local currency for this market";
    return { code: base, cur: 1, prev: 1, why };
  }
  return { code: c.localCurrency, cur: c.rate.cur, prev: c.rate.prev ?? c.rate.cur };
}

/** How a row's figure is printed. */
export type FigureKind = "money" | "unit" | "count" | "rate" | "ratio";

export function deltaKind(k: FigureKind): DeltaKind {
  return k === "unit" ? "money" : k;
}

/**
 * Currencies whose unit is small enough that the page prints them whole, unit
 * values included: CZK 41, not CZK 40.55. Per-unit figures of these markets
 * (AOV, nCAC, GP per customer, first-order GP minus nCAC) then read alike
 * whether a value lands above or below 100.
 */
const WHOLE_UNIT_CURRENCIES = new Set(["CZK", "HUF", "JPY", "KRW", "ISK", "RSD", "CLP", "COP", "IDR", "VND"]);

export function formatFigure(v: number, kind: FigureKind, currency: string, compact = false): string {
  switch (kind) {
    case "money":
      return formatMoney(v, currency, compact ? { compact: true } : {});
    case "unit":
      return WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase())
        ? formatMoney(v, currency, { decimals: 0 })
        : formatMoney(v, currency, { unit: true });
    case "count":
      return formatNumber(v);
    case "rate":
      return formatPercent(v);
    case "ratio":
      return formatRatio(v);
  }
}

/** Decimals of an absolute money delta: whole for whole-unit currencies, else the delta's own rule. */
export function deltaDecimals(kind: FigureKind, currency: string): number | undefined {
  return (kind === "money" || kind === "unit") && WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase()) ? 0 : undefined;
}

/** A value with a currency factor applied (money kinds only). */
export function scaled(x: Val, kind: FigureKind, factor: number): Val {
  if (isNa(x)) return x;
  return kind === "money" || kind === "unit" ? { ...x, v: x.v * factor } : x;
}

export function paybackText(p: Payback): string | null {
  if ("na" in p) return null;
  if ("notYet" in p) return `Not by ${p.reachedAge} d`;
  if (p.firstOrder) return "First order";
  return `${p.days} d`;
}

/**
 * Badge styling per verdict, from tokens only. Warnings use the amber notice
 * tint with `text-warning-700` (design audit rule); a verdict colour is status,
 * never decoration.
 */
export const VERDICT_BADGE: Record<VerdictKey, { variant: "positive" | "negative" | "neutral" | "outline"; className: string }> = {
  scale: { variant: "positive", className: "" },
  hold: { variant: "neutral", className: "bg-info/10 text-content-strong" },
  "fix-acquisition": { variant: "neutral", className: "bg-notice-warning text-warning-700 shadow-[inset_0_0_0_1px_var(--warning-300)]" },
  "fix-structure": { variant: "neutral", className: "bg-warning/15 text-warning-700" },
  exit: { variant: "negative", className: "" },
  none: { variant: "outline", className: "text-content-muted" },
};

/** Map and legend fills per verdict. */
export const VERDICT_FILL: Record<VerdictKey, { fill: string; opacity: number }> = {
  scale: { fill: "var(--growth-500)", opacity: 1 },
  hold: { fill: "var(--info)", opacity: 0.35 },
  "fix-acquisition": { fill: "var(--warning-300)", opacity: 1 },
  "fix-structure": { fill: "var(--warning)", opacity: 1 },
  exit: { fill: "var(--negative)", opacity: 0.75 },
  none: { fill: "var(--gray-200)", opacity: 1 },
};

/** Choropleth steps: 0 is at or below zero, 1..5 the sequential ramp. */
export const RAMP: Array<{ fill: string; opacity: number }> = [
  { fill: "var(--negative)", opacity: 0.55 },
  { fill: "var(--growth-100)", opacity: 1 },
  { fill: "var(--growth-300)", opacity: 1 },
  { fill: "var(--growth-400)", opacity: 1 },
  { fill: "var(--growth-500)", opacity: 1 },
  { fill: "var(--growth-700)", opacity: 1 },
];
