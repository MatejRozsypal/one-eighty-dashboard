"use client";

/**
 * The Markets page body: Sold markets (map, leaderboard, P&L matrix, drawer)
 * or Scouting.
 *
 * ── Which state lives where ─────────────────────────────────────────────────
 * Period and Compare change the data, so they stay in the server's control
 * bar and navigate. View, map metric, currency (base or local) and the open
 * market only change how the same figures are drawn, so they are held here
 * and written to the URL in place (`replaceInPlace`, the delta toggle's
 * mechanism): a shared link opens on the same view without re-running a
 * single warehouse query when the reader clicks around.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { Card } from "@/components/ui/Card";
import { ChartSummary } from "@/components/ui/ChartSummary";
import { InfoTip } from "@/components/ui/InfoTip";
import { SegmentPills, type Segment } from "@/components/controls/SegmentedControl";
import { MarketMap, type MapItem } from "@/components/markets/MarketMap";
import { Leaderboard } from "@/components/markets/Leaderboard";
import { PnlMatrix } from "@/components/markets/PnlMatrix";
import { MarketDrawer } from "@/components/markets/MarketDrawer";
import { ScoutingView } from "@/components/markets/ScoutingView";
import type { MapGeometry } from "@/lib/markets/geo";
import {
  isNa,
  MAP_METRICS,
  mapStep,
  mapValue,
  VERDICT_LABEL,
  type MapMetric,
  type MarketsModel,
  type VerdictKey,
} from "@/lib/markets/model";
import {
  columnCurrency,
  countryName,
  formatFigure,
  longName,
  RAMP,
  VERDICT_FILL,
  type CurrencyMode,
} from "@/lib/markets/display";
import { MARKET_OTHER } from "@/lib/markets/types";
import type { MarketsViewKey, MarketsViewState } from "@/lib/markets/state";

function LegendSwatch({ fill, opacity, hatch, label }: { fill?: string; opacity?: number; hatch?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`h-3 w-3 rounded-xs ${hatch ? "border border-hairline-strong bg-[repeating-linear-gradient(45deg,var(--gray-300)_0_2px,var(--gray-100)_2px_5px)]" : ""}`}
        style={hatch ? undefined : { background: fill, opacity }}
      />
      {label}
    </span>
  );
}

export function MarketsView({
  model,
  geometry,
  initial,
  rangeText,
  compareLabel,
  candidates,
  ga4Connected,
}: {
  model: MarketsModel;
  geometry: { sold: MapGeometry | null; scout: MapGeometry | null };
  initial: MarketsViewState;
  rangeText: string;
  compareLabel?: string;
  candidates: string[];
  ga4Connected: boolean;
}) {
  const [state, setState] = useState<MarketsViewState>(initial);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { baseQuery, replaceInPlace } = useNavigation();
  const summaryId = useId();

  const stateRef = useRef(state);
  stateRef.current = state;
  const update = useCallback(
    (patch: Partial<MarketsViewState>) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next;
      setState(next);
      const q = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
      const put = (k: string, v: string | null, dflt: string | null) => (v === null || v === dflt ? q.delete(k) : q.set(k, v));
      put("view", next.view, "sold");
      put("map", next.map, "gpa");
      put("mccy", next.ccy, "base");
      put("market", next.market, null);
      replaceInPlace(`${pathname}?${q.toString()}`);
    },
    [baseQuery, pathname, replaceInPlace, searchParams]
  );

  // A market in a shared link that is not on this page (another client, a
  // range where it has no orders) simply does not open.
  const selected = state.market ? model.markets.find((m) => m.key === state.market) ?? null : null;
  useEffect(() => {
    if (state.market && !selected) update({ market: null });
  }, [state.market, selected, update]);

  const open = useCallback((m: string) => update({ market: m }), [update]);
  const close = useCallback(() => update({ market: null }), [update]);

  const base = model.baseCurrency;
  const hasLocal = model.markets.some((m) => m.localCurrency && m.localCurrency !== base && m.rate.cur !== null);
  const viewSegments: Segment[] = [
    { value: "sold", label: "Sold markets" },
    { value: "scout", label: "Scouting" },
  ];
  const ccySegments: Segment[] = [
    { value: "base", label: base, title: `All markets in ${base}` },
    {
      value: "local",
      label: "Local",
      title: "Each market in its own currency",
      disabled: !hasLocal,
      disabledReason: `Every market trades in ${base}`,
    },
  ];

  // Map metric, with the fallback when no market has the chosen figure.
  const sold = model.markets.filter((m) => m.kind === "sold");
  let metric = state.map;
  let metricNote = "";
  if (metric !== "status" && sold.length > 0 && sold.every((m) => isNa(mapValue(m, metric)))) {
    const first = mapValue(sold[0], metric);
    metricNote = `${MAP_METRICS.find((x) => x.key === metric)!.label} is n/a for every market: ${isNa(first) ? first.na : ""}. Showing net revenue.`;
    metric = "net";
  }
  const metricLabel = MAP_METRICS.find((x) => x.key === metric)!.label;
  const numericVals = sold.map((m) => mapValue(m, metric)).filter((x) => !isNa(x)).map((x) => (x as { v: number }).v);

  const items: Record<string, MapItem> = {};
  for (const c of sold) {
    const ccy = columnCurrency(c, state.ccy, base);
    if (metric === "status") {
      const key: VerdictKey = c.verdict?.key ?? "none";
      items[c.key] = {
        market: c.key,
        label: c.key,
        value: VERDICT_LABEL[key],
        fill: VERDICT_FILL[key],
        aria: `${longName(c)}: ${VERDICT_LABEL[key]}`,
      };
      continue;
    }
    const x = mapValue(c, metric);
    if (isNa(x)) {
      items[c.key] = { market: c.key, label: c.key, value: "n/a", hatch: true, aria: `${longName(c)}: n/a, ${x.na}` };
      continue;
    }
    const kind = metric === "ltgp" ? "ratio" : metric === "ncac" ? "unit" : "money";
    const shown = kind === "ratio" ? formatFigure(x.v, "ratio", base) : formatFigure(x.v * ccy.cur, kind, ccy.code, kind === "money");
    items[c.key] = {
      market: c.key,
      label: c.key,
      value: shown,
      fill: RAMP[mapStep(metric, x.v, numericVals)],
      aria: `${longName(c)}: ${shown}`,
    };
  }
  const other = model.markets.find((m) => m.key === MARKET_OTHER);
  for (const iso of other?.members ?? []) {
    items[iso] = { market: MARKET_OTHER, label: iso, hatch: true, aria: `${countryName(iso)}: part of Other` };
  }

  const summary =
    metric === "status" ? null : (
      <ChartSummary
        id={summaryId}
        categories
        labels={sold.map((m) => longName(m))}
        series={[{ name: metricLabel, values: sold.map((m) => {
          const x = mapValue(m, metric);
          return isNa(x) ? null : x.v;
        }) }]}
        format={(v) => (metric === "ltgp" ? formatFigure(v, "ratio", base) : formatFigure(v, metric === "ncac" ? "unit" : "money", base))}
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentPills segments={viewSegments} shown={state.view} onSelect={(v) => update({ view: v as MarketsViewKey, market: null })} ariaLabel="View" />
        {state.view === "sold" && (
          <SegmentPills segments={ccySegments} shown={state.ccy} onSelect={(v) => update({ ccy: v as CurrencyMode })} ariaLabel="Currency" />
        )}
      </div>

      {state.view === "scout" ? (
        <ScoutingView model={model} geometry={geometry.scout} candidates={candidates} ga4Connected={ga4Connected} rangeText={rangeText} />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card padding="none" className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
                  {metricLabel}
                  {metricNote && <InfoTip text={metricNote} />}
                </h2>
                <div className="relative max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <SegmentPills
                    segments={MAP_METRICS.map((m) => ({ value: m.key, label: m.label }))}
                    shown={state.map}
                    onSelect={(v) => update({ map: v as MapMetric })}
                    ariaLabel="Map metric"
                  />
                </div>
              </div>
              <MarketMap
                geometry={geometry.sold}
                items={items}
                onSelect={open}
                selected={state.market}
                title={`Map of markets by ${metricLabel}`}
                describedBy={summary ? summaryId : undefined}
              />
              {summary}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-content-muted">
                {metric === "status" ? (
                  (Object.keys(VERDICT_FILL) as VerdictKey[]).map((k) => (
                    <LegendSwatch key={k} fill={VERDICT_FILL[k].fill} opacity={VERDICT_FILL[k].opacity} label={VERDICT_LABEL[k]} />
                  ))
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span>{metric === "ncac" ? "Dearest" : metric === "ltgp" ? "0×" : "Lowest"}</span>
                      {RAMP.slice(1).map((r, i) => (
                        <span key={i} aria-hidden="true" className="h-3 w-4" style={{ background: r.fill, opacity: r.opacity }} />
                      ))}
                      <span>{metric === "ncac" ? "cheapest" : metric === "ltgp" ? "3× or more" : "highest"}</span>
                    </span>
                    {metric !== "ncac" && <LegendSwatch fill={RAMP[0].fill} opacity={RAMP[0].opacity} label="At or below 0" />}
                    <LegendSwatch hatch label="n/a, or part of Other" />
                  </>
                )}
              </div>
            </Card>
            <Card padding="none" className="min-w-0 p-4 sm:p-5">
              <Leaderboard model={model} mode={state.ccy} onOpen={open} />
            </Card>
          </div>

          <Card padding="none" className="min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
              <h2 className="m-0 text-[15px] font-semibold text-content-strong">P&amp;L by market</h2>
              <span className="text-[12px] text-content-muted">{compareLabel ? `${rangeText}, ${compareLabel}` : rangeText}</span>
            </div>
            <PnlMatrix model={model} mode={state.ccy} compareLabel={compareLabel} periodLabel={rangeText} onOpen={open} />
          </Card>

          {selected && (
            <MarketDrawer model={model} market={selected} mode={state.ccy} rangeText={rangeText} compareLabel={compareLabel} onClose={close} />
          )}
        </>
      )}
    </div>
  );
}
