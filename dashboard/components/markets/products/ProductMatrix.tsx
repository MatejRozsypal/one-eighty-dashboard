"use client";

/**
 * Product x market matrix: top products by net sales as rows (the tail pooled
 * into "Other products", pinned last), the client's markets as columns, home
 * first and Other last, with an "All markets" column before them.
 *
 * Two readings, one table:
 *   share  each cell is the product's share of that market's net sales, shaded
 *          on the accent ramp (fixed share steps, so a shade means the same in
 *          every column), with units under it;
 *   price  each cell is the average selling price in base currency, and in the
 *          market's local currency under it where the market pays in one.
 *
 * Hover or focus a cell for net sales, units, average price and the change
 * against the comparison period. Every header sorts (the pooled row stays
 * last). The product column sticks on narrow screens.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { InfoTip, placeTip } from "@/components/ui/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { useDeltaMode } from "@/components/ui/DeltaMode";
import { NaValue } from "@/components/markets/bits";
import { formatDelta, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { MARKET_OTHER } from "@/lib/markets/types";
import { formatTotal, MIN_PRICE_UNITS, type MarketColumn, type ProductCell, type ProductRow, type ProductsModel } from "@/lib/markets/products";

export type MatrixMetric = "share" | "price";

/** Share steps for the shading: below 2 %, 2 to 5, 5 to 10, 10 to 20, 20 and up. */
export const SHARE_STEPS = [0.02, 0.05, 0.1, 0.2] as const;
/** Accent mix per step, the cohort heatmap's ramp. */
export const SHARE_MIX = [10, 22, 38, 58, 82];

export function shareStep(share: number | null): number {
  if (share === null || share <= 0) return -1;
  let s = 0;
  for (const t of SHARE_STEPS) if (share >= t) s++;
  return s;
}

const marketLabel = (key: string) => (key === MARKET_OTHER ? "Other" : key);
const ALL = "__all";
type SortKey = "name" | typeof ALL | string;

interface Hover {
  row: ProductRow;
  col: string;
  rect: DOMRect;
}

function sortValue(row: ProductRow, key: SortKey, metric: MatrixMetric): number | string | null {
  if (key === "name") return row.product;
  const c = key === ALL ? row.total : row.cells[key];
  if (!c) return null;
  return metric === "share" ? c.share ?? c.netSales : c.asp;
}

function Tip({ hover, model, compareLabel }: { hover: Hover; model: ProductsModel; compareLabel?: string }) {
  const mode = useDeltaMode();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      placeTip(hover.rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight })
    );
  }, [hover]);

  const base = model.baseCurrency;
  const col = hover.col === ALL ? null : model.markets.find((m) => m.key === hover.col) ?? null;
  const c: ProductCell | undefined = hover.col === ALL ? hover.row.total : hover.row.cells[hover.col];
  if (!c) return null;
  const shareDelta = c.prevShare !== null ? formatDelta(c.share, c.prevShare, { kind: "rate", mode }) : null;
  const salesDelta = c.prevNetSales !== null ? formatDelta(c.netSales, c.prevNetSales, { kind: "money", mode, currency: base, compact: true }) : null;
  const where = col ? marketLabel(col.key) : "all markets";

  const line = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="font-mono tabular text-white">{value}</span>
    </div>
  );
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="pointer-events-none fixed z-[90] w-[250px] max-w-[calc(100vw-16px)] rounded-md border border-hairline-inverse bg-bg-inverse p-[11px_13px] text-[12px] leading-[1.6] text-gray-250 shadow-lg"
    >
      <div className="mb-1 font-semibold text-white">
        {hover.row.product} <span className="font-normal text-gray-250">in {where}</span>
      </div>
      {line("Net sales", formatMoney(c.netSales, base))}
      {line("Units", c.units === null ? "n/a" : formatNumber(c.units))}
      {line("Share of net sales", formatPercent(c.share))}
      {line("Avg selling price", formatMoney(c.asp, base, { unit: true }))}
      {col?.localCurrency && c.aspLocal !== null && line(`Avg price, ${col.localCurrency}`, formatMoney(c.aspLocal, col.localCurrency, { unit: true }))}
      {(shareDelta || salesDelta) && (
        <div className="mt-1 border-t border-hairline-inverse pt-1">
          {shareDelta && line(`Share ${compareLabel ?? "vs compare"}`, shareDelta)}
          {salesDelta && line(`Net sales ${compareLabel ?? "vs compare"}`, salesDelta)}
        </div>
      )}
    </div>,
    document.body
  );
}

function ShareCell({ c }: { c: ProductCell }) {
  const step = shareStep(c.share);
  const dark = step >= 3;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className={`font-mono text-[13px] tabular ${dark ? "font-semibold text-accent-contrast" : "text-content-strong"}`}>
        {c.netSales > 0 ? formatPercent(c.share) : "0%"}
      </span>
      <span className={`font-mono text-[11px] tabular ${dark ? "text-accent-contrast" : "text-content-muted"}`}>
        {c.units === null ? "n/a units" : `${formatNumber(c.units)} ${c.units === 1 ? "unit" : "units"}`}
      </span>
    </span>
  );
}

function PriceCell({ c, col, base }: { c: ProductCell; col: MarketColumn | null; base: string }) {
  if (c.netSales <= 0) return <span className="font-mono text-[13px] text-content-muted">·</span>;
  if (c.asp === null) return <NaValue reason="No units recorded for these lines" />;
  if (c.units !== null && c.units < MIN_PRICE_UNITS) return <NaValue reason={`Fewer than ${MIN_PRICE_UNITS} units: one order would set the price`} />;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-[13px] tabular text-content-strong">{formatMoney(c.asp, base, { unit: true })}</span>
      {col?.localCurrency && c.aspLocal !== null && (
        <span className="font-mono text-[11px] tabular text-content-muted">{formatMoney(c.aspLocal, col.localCurrency, { unit: true })}</span>
      )}
    </span>
  );
}

export function ProductMatrix({
  model,
  metric,
  compareLabel,
  periodLabel,
}: {
  model: ProductsModel;
  metric: MatrixMetric;
  compareLabel?: string;
  periodLabel: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: ALL, dir: "desc" });
  const [hover, setHover] = useState<Hover | null>(null);
  const base = model.baseCurrency;

  const clear = useCallback(() => setHover(null), []);
  useEffect(() => {
    if (!hover) return;
    window.addEventListener("scroll", clear, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", clear, { capture: true });
  }, [hover, clear]);

  const pooled = model.rows.filter((r) => r.pooled);
  const sorted = model.rows
    .filter((r) => !r.pooled)
    .slice()
    .sort((a, b) => {
      const va = sortValue(a, sort.key, metric);
      const vb = sortValue(b, sort.key, metric);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : (va as number) - (vb as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  const rows = [...sorted, ...pooled];

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "");

  const cols: Array<{ key: string; col: MarketColumn | null }> = [{ key: ALL, col: null }, ...model.markets.map((m) => ({ key: m.key, col: m }))];

  const cellProps = (row: ProductRow, key: string) => ({
    tabIndex: 0,
    onMouseEnter: (e: MouseEvent<HTMLTableCellElement>) => setHover({ row, col: key, rect: e.currentTarget.getBoundingClientRect() }),
    onMouseLeave: clear,
    onFocus: (e: FocusEvent<HTMLTableCellElement>) => setHover({ row, col: key, rect: e.currentTarget.getBoundingClientRect() }),
    onBlur: clear,
  });

  const headBtn =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-xs font-mono text-[12px] font-semibold text-content-strong hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]";

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          {metric === "share" ? "Share of each market's net sales by product" : "Average selling price by product and market"}, {periodLabel}
        </caption>
        <thead>
          <tr>
            <th scope="col" aria-sort={ariaSort("name")} className="sticky left-0 z-[1] min-w-[128px] sm:min-w-[170px] border-b border-hairline bg-paper px-3 py-2.5 align-bottom">
              <button type="button" onClick={() => toggle("name")} className={`${headBtn} font-medium uppercase tracking-[0.08em] text-content-muted`}>
                Product <span aria-hidden="true" className="text-[9px]">{arrow("name")}</span>
              </button>
            </th>
            {cols.map(({ key, col }) => (
              <th
                key={key}
                scope="col"
                aria-sort={ariaSort(key)}
                className={`min-w-[96px] border-b border-hairline px-3 py-2.5 text-right align-bottom ${key === ALL ? "bg-gray-50" : ""}`}
              >
                <span className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1.5">
                    {col?.isHome && (
                      <Badge variant="outline" size="sm">
                        Home
                      </Badge>
                    )}
                    <button type="button" onClick={() => toggle(key)} className={headBtn}>
                      <span aria-hidden="true" className="text-[9px]">{arrow(key)}</span>
                      {col ? marketLabel(col.key) : "All markets"}
                    </button>
                  </span>
                  <span className="font-mono text-[10.5px] tabular text-content-muted">
                    {formatTotal(col ? col.netSales : model.markets.reduce((t, m) => t + m.netSales, 0), base)}
                  </span>
                  {metric === "price" && col && col.localCurrency && (
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-content-muted">{`${base} / ${col.localCurrency}`}</span>
                  )}
                  {metric === "price" && col && !col.localCurrency && col.localWhy && (
                    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-content-muted">
                      {base}
                      <InfoTip text={`No local price: ${col.localWhy.charAt(0).toLowerCase()}${col.localWhy.slice(1)}.`} label="Why no local price" />
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.product}>
              <th
                scope="row"
                className={`sticky left-0 z-[1] max-w-[150px] sm:max-w-[220px] border-b border-hairline bg-paper px-3 py-2 text-left align-top text-[13px] font-normal ${row.pooled ? "text-content-muted" : "text-content-body"}`}
              >
                <span className="inline-flex max-w-full items-center gap-1">
                  <span className="truncate" title={row.product}>
                    {row.product}
                  </span>
                  {row.pooled && <InfoTip text={`${row.pooledCount} smaller products pooled; ranked by net sales across all markets.`} label="What is pooled" />}
                </span>
              </th>
              {cols.map(({ key, col }) => {
                const c = key === ALL ? row.total : row.cells[key];
                const step = metric === "share" ? shareStep(c?.share ?? null) : -1;
                return (
                  <td
                    key={key}
                    {...cellProps(row, key)}
                    style={step >= 0 ? { backgroundColor: `color-mix(in srgb, var(--accent) ${SHARE_MIX[step]}%, transparent)` } : undefined}
                    className={`cursor-default border-b border-hairline px-3 py-2 text-right align-top focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                      key === ALL && step < 0 ? "bg-gray-50" : ""
                    }`}
                  >
                    {!c ? null : metric === "share" ? <ShareCell c={c} /> : <PriceCell c={c} col={col} base={base} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hover && typeof document !== "undefined" && <Tip hover={hover} model={model} compareLabel={compareLabel} />}
    </div>
  );
}

