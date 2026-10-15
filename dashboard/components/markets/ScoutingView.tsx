"use client";

/**
 * Scouting: countries the client does not sell to yet.
 *
 * Two sources, never blended: orders that arrived with no campaign behind them
 * (from the data, this range) and the 2026-10 research on nearby markets
 * (lib/markets/scouting). The opportunity index needs GA4 by country, search
 * demand and benchmarks; none of those is in the warehouse yet, so it says so
 * instead of ranking on what happens to be there. No verdicts here: these are
 * "worth a test" signals only.
 */

import { useId } from "react";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyNote } from "@/components/ui/PageNotes";
import { NaValue } from "@/components/markets/bits";
import { MarketMap, type MapItem } from "@/components/markets/MarketMap";
import type { MapGeometry } from "@/lib/markets/geo";
import { isNa, type MarketsModel } from "@/lib/markets/model";
import { SCOUT_REFERENCE } from "@/lib/markets/scouting";
import { countryName, formatFigure } from "@/lib/markets/display";

const NOT_IN = {
  ga4: "Needs GA4 sessions by country with ISO codes (F10)",
  ga4Off: "GA4 is not connected for this client (F10)",
  search: "Search demand per country is not ingested (Ahrefs or Keyword Planner, F11)",
  research: "Not covered by the 2026-10 research",
};

export function ScoutingView({
  model,
  geometry,
  candidates,
  ga4Connected,
  rangeText,
}: {
  model: MarketsModel;
  geometry: MapGeometry | null;
  /** Research candidates plus countries with orders, in display order. */
  candidates: string[];
  ga4Connected: boolean;
  rangeText: string;
}) {
  const sumId = useId();
  const sold = model.markets.filter((m) => m.kind === "sold").map((m) => m.key);
  const byIso = new Map(model.scouting.map((s) => [s.iso, s]));

  const items: Record<string, MapItem> = {};
  for (const iso of sold) items[iso] = { label: iso, value: "sold", fill: { fill: "var(--growth-300)", opacity: 1 }, aria: `${countryName(iso)}: sold market` };
  for (const iso of candidates) {
    const s = byIso.get(iso);
    items[iso] = {
      label: iso,
      value: s ? `${s.orders} orders` : undefined,
      hatch: true,
      aria: `${countryName(iso)}: candidate${s ? `, ${s.orders} orders in this range` : ", no orders in this range"}`,
    };
  }

  const ccy = model.baseCurrency;
  const ga4 = ga4Connected ? NOT_IN.ga4 : NOT_IN.ga4Off;
  const withOrders = model.scouting.reduce((t, s) => t + s.orders, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card padding="none" className="p-4 sm:p-5">
          <h2 className="m-0 mb-3 text-[15px] font-semibold text-content-strong">Unsold countries</h2>
          <MarketMap geometry={geometry} items={items} onSelect={() => {}} selected={null} title="Map of sold markets and scouting candidates" describedBy={sumId} />
          <p id={sumId} className="sr-only">
            {Object.values(items).map((i) => i.aria).join(". ")}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-content-muted">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-3 rounded-xs bg-growth-300" />
              Sold market
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-3 rounded-xs border border-hairline-strong bg-[repeating-linear-gradient(45deg,var(--gray-300)_0_2px,var(--gray-100)_2px_5px)]" />
              Candidate
            </span>
          </div>
        </Card>

        <Card padding="none" className="flex flex-col gap-3 p-4 sm:p-5">
          <h2 className="m-0 text-[15px] font-semibold text-content-strong">Opportunity index</h2>
          <EmptyNote>Not computable yet: needs GA4 by country (F10), search demand and benchmarks (F11).</EmptyNote>
          <dl className="m-0 grid grid-cols-1 gap-2 text-[12.5px]">
            <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
              <dt className="text-content-body">Orders outside sold markets, {rangeText}</dt>
              <dd className="m-0 font-mono tabular text-content-strong">{formatFigure(withOrders, "count", ccy)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
              <dt className="text-content-body">Countries with orders</dt>
              <dd className="m-0 font-mono tabular text-content-strong">{formatFigure(model.scouting.length, "count", ccy)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
              <dt className="text-content-body">GA4 sessions by country</dt>
              <dd className="m-0"><NaValue reason={ga4} /></dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card padding="none" className="p-4 sm:p-5">
        <h2 className="m-0 mb-3 text-[15px] font-semibold text-content-strong">Candidates</h2>
        {candidates.length === 0 ? (
          <EmptyNote>No orders outside the sold markets in this range.</EmptyNote>
        ) : (
          <div className="relative overflow-x-auto">
            <div className="min-w-[1040px]">
              <DataTable
                gridClass="grid grid-cols-[1.3fr_1.1fr_0.7fr_0.9fr_0.8fr_0.8fr_0.8fr_0.8fr_0.9fr_0.5fr_1.5fr] items-center gap-2"
                columns={[
                  { key: "country", label: "Country" },
                  { key: "why", label: "Why listed", sortable: false },
                  { key: "orders", label: "Orders", align: "right", info: "Orders with no campaign behind them, in this range." },
                  { key: "net", label: "Net revenue", align: "right" },
                  { key: "aov", label: "AOV new", align: "right" },
                  { key: "ga4", label: "GA4 sessions", align: "right", sortable: false },
                  { key: "search", label: "Search demand", align: "right", sortable: false },
                  { key: "aud", label: "Meta 18+", align: "right", sortable: false, info: "Meta users 18+, vendor table, 2026-10 research." },
                  { key: "cpm", label: "Meta CPM", align: "right", sortable: false, info: "Vendor benchmark, 2026. No public benchmark exists for every country." },
                  { key: "vat", label: "VAT", align: "right", sortable: false },
                  { key: "note", label: "Market note", sortable: false },
                ]}
                rows={candidates.map((iso) => {
                  const s = byIso.get(iso);
                  const ref = SCOUT_REFERENCE[iso];
                  const na = (reason: string) => <NaValue reason={reason} />;
                  const txt = (v: string | null | undefined) => (v ? <span className="text-[12.5px] text-content-body">{v}</span> : na(NOT_IN.research));
                  return {
                    key: iso,
                    sort: [countryName(iso), null, s?.orders ?? 0, s?.netRevenue ?? null, s && !isNa(s.aovNew) ? s.aovNew.v : null, null, null, null, null, null, null],
                    cells: [
                      <span key="c" className="text-[13px] text-content-strong">
                        <span className="font-mono font-semibold">{iso}</span> {countryName(iso)}
                      </span>,
                      <span key="w" className="text-[12.5px] text-content-muted">{s ? "Orders, no campaign" : "Research candidate"}</span>,
                      <span key="o" className="font-mono text-[13px] tabular text-content-strong">{formatFigure(s?.orders ?? 0, "count", ccy)}</span>,
                      <span key="n" className="font-mono text-[13px] tabular text-content-strong">{s ? formatFigure(s.netRevenue, "money", ccy) : formatFigure(0, "money", ccy)}</span>,
                      s && !isNa(s.aovNew) ? (
                        <span key="a" className="font-mono text-[13px] tabular text-content-strong">{formatFigure(s.aovNew.v, "unit", ccy)}</span>
                      ) : (
                        <span key="a">{na(s ? (s.aovNew as { na: string }).na : "No orders in this range")}</span>
                      ),
                      <span key="g">{na(ga4)}</span>,
                      <span key="s">{na(NOT_IN.search)}</span>,
                      <span key="m" className="font-mono text-[12.5px] tabular">{ref?.metaAudience ?? na(NOT_IN.research)}</span>,
                      <span key="p" className="font-mono text-[12.5px] tabular">{ref?.cpm ?? na(NOT_IN.research)}</span>,
                      <span key="v" className="font-mono text-[12.5px] tabular">{ref?.vat ?? na(NOT_IN.research)}</span>,
                      <span key="t">{txt(ref?.note)}</span>,
                    ],
                  };
                })}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
