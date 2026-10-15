"use client";

/**
 * Scouting: countries the client does not sell to yet.
 *
 * Three sources, never blended into a figure: orders that arrived with no
 * campaign behind them (from the data, this range), the scouting signals
 * (`mart.market_scouting_signals`: new customers 365 d, GA4 90 d, search
 * demand) with Meta CPM benchmarks, and the 2026-10 research on nearby
 * markets (lib/markets/scouting). The opportunity index
 * (lib/markets/opportunity) ranks candidates on the signals that exist and
 * names the ones that do not. It is a signal for what to test, never a
 * verdict.
 */

import { useId, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { InfoTip } from "@/components/ui/InfoTip";
import { EmptyNote } from "@/components/ui/PageNotes";
import { NaValue } from "@/components/markets/bits";
import { MarketMap, type MapItem } from "@/components/markets/MarketMap";
import type { MapGeometry } from "@/lib/markets/geo";
import { isNa, type MarketsModel } from "@/lib/markets/model";
import { SIGNALS, MIN_SIGNALS, type Opportunity, type SignalScore } from "@/lib/markets/opportunity";
import { SCOUT_REFERENCE, researchCandidates } from "@/lib/markets/scouting";
import { countryName, formatFigure } from "@/lib/markets/display";
import type { ScoutSignalRow } from "@/lib/markets/types";

const NOT_IN = {
  ga4Off: "GA4 is not connected for this client",
  ga4NoRows: "No GA4 sessions by country in the last 90 days",
  signals: "Scouting signals are not built for this client",
  research: "Not covered by the 2026-10 research",
};

const INDEX_TIP =
  "A signal for what to test next, not a verdict. Each signal is scored 0 to 1 against the best candidate: " +
  "proven pull (new customers, 365 d, weight 0.35), unpaid interest (unpaid engaged GA4 sessions, 90 d, 0.25), " +
  "search demand (core monthly searches, 0.25) on a log scale; cost to reach (home Meta CPM / country Meta CPM, 0.15) " +
  `against the best ratio. Index = 100 x weighted mean over the signals that exist; needs ${MIN_SIGNALS} of 4. No smoothing.`;

/** How many ranked candidates the index card lists; the table holds the rest. */
const CARD_TOP = 6;
/** Table rows before "Show all". */
const TABLE_TOP = 20;

const HATCH = "bg-[repeating-linear-gradient(45deg,var(--gray-300)_0_2px,var(--gray-100)_2px_5px)]";

function SignalBars({ o }: { o: Opportunity }) {
  return (
    <span className="grid grid-cols-4 gap-1.5">
      {SIGNALS.map((s) => {
        const x: SignalScore = o.signals[s.key];
        const text = x.score === null ? `${s.label}: n/a, ${"na" in x.raw ? x.raw.na : ""}` : `${s.label}: ${Math.round(x.score * 100)} of 100`;
        return (
          <span key={s.key} title={text} className="flex flex-col gap-0.5">
            <span className="sr-only">{text}</span>
            <span aria-hidden="true" className={`block h-[5px] rounded-pill ${x.score === null ? HATCH : "bg-gray-100"}`}>
              {x.score !== null && <span className="block h-full rounded-pill bg-growth-500" style={{ width: `${Math.max(x.score * 100, x.score > 0 ? 4 : 0)}%` }} />}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
      <dt className="text-content-body">{label}</dt>
      <dd className="m-0 font-mono tabular text-content-strong">{children}</dd>
    </div>
  );
}

export function ScoutingView({
  model,
  geometry,
  candidates,
  ga4Connected,
  rangeText,
}: {
  model: MarketsModel;
  geometry: MapGeometry | null;
  /** Every scouting candidate (model.candidates). */
  candidates: string[];
  ga4Connected: boolean;
  rangeText: string;
}) {
  const sumId = useId();
  const [showAll, setShowAll] = useState(false);
  const sold = model.markets.filter((m) => m.kind === "sold").map((m) => m.key);
  const byIso = new Map(model.scouting.map((s) => [s.iso, s]));
  const opp = new Map(model.opportunity.map((o) => [o.iso, o]));
  const sig = new Map<string, ScoutSignalRow>((model.signals?.rows ?? []).map((r) => [r.iso, r]));
  const ga4Days = model.signals?.ga4Days90 ?? null;
  const ga4Reason = !model.signals ? NOT_IN.signals : ga4Connected ? NOT_IN.ga4NoRows : NOT_IN.ga4Off;
  const research = new Set(researchCandidates(sold));

  const items: Record<string, MapItem> = {};
  for (const iso of sold) items[iso] = { label: iso, value: "sold", fill: { fill: "var(--growth-300)", opacity: 1 }, aria: `${countryName(iso)}: sold market` };
  for (const iso of model.scoutMap) {
    const s = byIso.get(iso);
    const o = opp.get(iso);
    const index = o?.index ?? null;
    items[iso] = {
      label: iso,
      value: index !== null ? `${index}` : s ? `${s.orders} orders` : undefined,
      hatch: true,
      aria:
        `${countryName(iso)}: candidate` +
        (index !== null ? `, opportunity index ${index} on ${o!.coverage} of 4 signals` : ", no opportunity index") +
        (s ? `, ${s.orders} orders in this range` : ", no orders in this range"),
    };
  }

  const ccy = model.baseCurrency;
  const withOrders = model.scouting.reduce((t, s) => t + s.orders, 0);
  const ranked = model.opportunity.filter((o) => o.index !== null);
  const rows = model.signals?.rows ?? [];
  const engaged = rows.reduce((t, r) => t + (r.engagedSessions90 ?? 0), 0);
  const unpaid = rows.reduce((t, r) => t + (r.unpaidEngagedSessions90 ?? 0), 0);

  // Table order: the index ranking (n/a last), then anything the ranking does not hold.
  const order = [...model.opportunity.map((o) => o.iso), ...candidates.filter((iso) => !opp.has(iso))];
  const shown = showAll ? order : order.slice(0, TABLE_TOP);

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
              <span aria-hidden="true" className={`h-3 w-3 rounded-xs border border-hairline-strong ${HATCH}`} />
              Candidate, labelled with its opportunity index
            </span>
          </div>
        </Card>

        <Card padding="none" className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold text-content-strong">
              Opportunity index
              <InfoTip text={INDEX_TIP} label="How the index works" />
            </h2>
            <p className="m-0 text-[12px] text-content-muted">A signal for what to test next, not a verdict.</p>
          </div>
          {ranked.length === 0 ? (
            <EmptyNote>{model.opportunity[0]?.na ?? "No candidates outside the sold markets."}</EmptyNote>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] gap-x-3 px-2 text-[10.5px] text-content-muted">
                <span />
                <span className="grid grid-cols-4 gap-1.5">
                  {SIGNALS.map((s) => (
                    <span key={s.key} className="truncate">{s.short}</span>
                  ))}
                </span>
                <span className="text-right">Signals</span>
              </div>
              <ol className="m-0 flex list-none flex-col gap-1 p-0">
                {ranked.slice(0, CARD_TOP).map((o) => (
                  <li key={o.iso} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-2 py-2">
                    <span className="font-mono text-[12px] tabular text-content-muted">{o.rank}</span>
                    <span className="min-w-0 truncate text-[13.5px] font-medium text-content-strong">
                      <span className="font-mono font-semibold">{o.iso}</span> {countryName(o.iso)}
                    </span>
                    <span className="text-right font-mono text-[15px] font-semibold tabular text-content-strong">{o.index}</span>
                    <span />
                    <span className="min-w-0">
                      <SignalBars o={o} />
                    </span>
                    <span className="whitespace-nowrap text-right text-[11px] text-content-muted">{`${o.coverage} of 4`}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <dl className="m-0 grid grid-cols-1 gap-2 text-[12.5px]">
            <Fact label={`Orders outside sold markets, ${rangeText}`}>{formatFigure(withOrders, "count", ccy)}</Fact>
            <Fact label="Countries with orders">{formatFigure(model.scouting.length, "count", ccy)}</Fact>
            {ga4Days !== null ? (
              <>
                <Fact label={ga4Days < 90 ? `Engaged GA4 sessions, last 90 d (GA4 covers ${ga4Days} of 90 days)` : "Engaged GA4 sessions, last 90 d"}>
                  {formatFigure(engaged, "count", ccy)}
                </Fact>
                <Fact label="Unpaid share of engaged sessions">
                  {engaged > 0 ? formatFigure(unpaid / engaged, "rate", ccy) : <NaValue reason="No engaged sessions outside the sold markets in 90 days" />}
                </Fact>
              </>
            ) : (
              <Fact label="GA4 sessions by country">
                <NaValue reason={ga4Reason} />
              </Fact>
            )}
          </dl>
        </Card>
      </div>

      <Card padding="none" className="p-4 sm:p-5">
        <h2 className="m-0 mb-3 text-[15px] font-semibold text-content-strong">Candidates</h2>
        {candidates.length === 0 ? (
          <EmptyNote>No candidates outside the sold markets.</EmptyNote>
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <div className="min-w-[1320px]">
                <DataTable
                  gridClass="grid grid-cols-[1.3fr_1fr_0.6fr_0.7fr_0.9fr_0.8fr_0.9fr_0.7fr_0.9fr_0.7fr_0.8fr_0.5fr_1.4fr] items-center gap-2"
                  columns={[
                    { key: "country", label: "Country" },
                    { key: "why", label: "Why listed", sortable: false },
                    { key: "index", label: "Index", align: "right", info: "Opportunity index, 0 to 100. A signal for testing, not a verdict." },
                    { key: "orders", label: "Orders", align: "right", info: "Orders with no campaign behind them, in this range." },
                    { key: "net", label: "Net revenue", align: "right" },
                    { key: "aov", label: "AOV new", align: "right" },
                    { key: "ga4", label: "GA4 engaged (90 d)", align: "right", info: "Engaged GA4 sessions from the country, last 90 days." },
                    { key: "unpaid", label: "Unpaid share", align: "right", info: "Share of engaged sessions from unpaid channels." },
                    { key: "search", label: "Search demand", align: "right", info: "Core terms, monthly searches, latest snapshot." },
                    { key: "aud", label: "Meta 18+", align: "right", sortable: false, info: "Meta users 18+, vendor table, 2026-10 research." },
                    { key: "cpm", label: "Meta CPM", align: "right", sortable: false, info: "Vendor benchmark, 2026. No public benchmark exists for every country." },
                    { key: "vat", label: "VAT", align: "right", sortable: false },
                    { key: "note", label: "Market note", sortable: false },
                  ]}
                  rows={shown.map((iso) => {
                    const s = byIso.get(iso);
                    const r = sig.get(iso);
                    const o = opp.get(iso);
                    const ref = SCOUT_REFERENCE[iso];
                    const na = (reason: string) => <NaValue reason={reason} />;
                    const txt = (v: string | null | undefined) => (v ? <span className="text-[12.5px] text-content-body">{v}</span> : na(NOT_IN.research));
                    const mono = (k: string, v: string) => <span key={k} className="font-mono text-[13px] tabular text-content-strong">{v}</span>;
                    const eng = ga4Days === null ? null : r?.engagedSessions90 ?? 0;
                    const unp = ga4Days === null ? null : r?.unpaidEngagedSessions90 ?? 0;
                    const share = eng !== null && unp !== null && eng > 0 ? unp / eng : null;
                    const search = o?.signals.search.raw;
                    const why = s
                      ? "Orders, no campaign"
                      : research.has(iso)
                        ? "Research candidate"
                        : r && r.orders365 > 0
                          ? "Orders, last 365 d"
                          : r && (r.engagedSessions90 ?? 0) > 0
                            ? "GA4 visits"
                            : r && r.searchVolumeCore !== null
                              ? "Search demand"
                              : "Research candidate";
                    return {
                      key: iso,
                      sort: [
                        countryName(iso), null, o?.index ?? null, s?.orders ?? 0, s?.netRevenue ?? null,
                        s && !isNa(s.aovNew) ? s.aovNew.v : null, eng, share,
                        search && "v" in search ? search.v : null, null, null, null, null,
                      ],
                      cells: [
                        <span key="c" className="text-[13px] text-content-strong">
                          <span className="font-mono font-semibold">{iso}</span> {countryName(iso)}
                        </span>,
                        <span key="w" className="text-[12.5px] text-content-muted">{why}</span>,
                        o && o.index !== null ? (
                          <span key="i" className="inline-flex items-baseline gap-1 font-mono text-[13px] tabular">
                            <span className="font-semibold text-content-strong">{o.index}</span>
                            <span className="text-[11px] text-content-muted">{o.coverage}/4</span>
                          </span>
                        ) : (
                          <span key="i">{na(o?.na ?? NOT_IN.signals)}</span>
                        ),
                        mono("o", formatFigure(s?.orders ?? 0, "count", ccy)),
                        mono("n", formatFigure(s?.netRevenue ?? 0, "money", ccy)),
                        s && !isNa(s.aovNew) ? (
                          mono("a", formatFigure(s.aovNew.v, "unit", ccy))
                        ) : (
                          <span key="a">{na(s ? (s.aovNew as { na: string }).na : "No orders in this range")}</span>
                        ),
                        eng !== null ? mono("g", formatFigure(eng, "count", ccy)) : <span key="g">{na(ga4Reason)}</span>,
                        share !== null ? (
                          mono("u", formatFigure(share, "rate", ccy))
                        ) : (
                          <span key="u">{na(eng === null ? ga4Reason : "No engaged sessions in 90 days")}</span>
                        ),
                        search && "v" in search ? (
                          mono("s", formatFigure(search.v, "count", ccy))
                        ) : (
                          <span key="s">{na(search && "na" in search ? search.na : NOT_IN.signals)}</span>
                        ),
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
            {order.length > TABLE_TOP && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 text-[12.5px] font-medium text-content-body underline decoration-hairline-strong underline-offset-4 hover:text-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {showAll ? `Show the top ${TABLE_TOP}` : `Show all ${order.length} candidates`}
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
