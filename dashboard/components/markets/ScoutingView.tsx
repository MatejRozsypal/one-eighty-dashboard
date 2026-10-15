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

import { useId, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { compareSortKeys } from "@/components/ui/DataTable";
import { InfoTip } from "@/components/ui/InfoTip";
import { EmptyNote } from "@/components/ui/PageNotes";
import { NaValue } from "@/components/markets/bits";
import { MarketMap, type MapItem } from "@/components/markets/MarketMap";
import type { MapGeometry } from "@/lib/markets/geo";
import { isNa, type MarketsModel } from "@/lib/markets/model";
import { SIGNALS, MIN_SIGNALS, ga4Coverage, type Opportunity, type SignalScore } from "@/lib/markets/opportunity";
import { SCOUT_REFERENCE, researchCandidates } from "@/lib/markets/scouting";
import { plural } from "@/lib/markets/analysis";
import { countryName, formatFigure } from "@/lib/markets/display";
import { formatMoney, formatNumber } from "@/lib/format";
import type { ScoutSignalRow } from "@/lib/markets/types";

const NOT_IN = {
  ga4NoRows: "No GA4 sessions by country in the last 90 days",
  signals: "Scouting signals are not built for this client",
  research: "Not covered by the 2026-10 research",
};

const INDEX_TIP =
  "A signal for what to test next, not a verdict. Each signal is scored 0 to 1 against the best candidate: " +
  "proven pull (new customers, last 365 days, weight 0.35), unpaid interest (unpaid engaged GA4 sessions, 90 d, 0.25), " +
  "search demand (core monthly searches, 0.25) on a log scale; cost to reach (home Meta CPM / country Meta CPM, 0.15) " +
  `against the best ratio. Index = 100 x weighted mean over the signals that exist; needs ${MIN_SIGNALS} of 4. No smoothing.`;

/** How many ranked candidates the index card lists; the table holds the rest. */
const CARD_TOP = 6;
/** Table rows before "Show all". */
const TABLE_TOP = 20;

const HATCH = "bg-[repeating-linear-gradient(45deg,var(--gray-300)_0_2px,var(--gray-100)_2px_5px)]";

/** One n/a look for every cell of the candidates table: same size, same colour. */
const CELL_TEXT = "text-[12.5px] leading-[1.45]";

function signalText(o: Opportunity, key: (typeof SIGNALS)[number]["key"]): string {
  const s = SIGNALS.find((x) => x.key === key)!;
  const x: SignalScore = o.signals[key];
  const name = `${s.label} (${s.basis})`;
  return x.score === null ? `${name}: n/a, ${"na" in x.raw ? x.raw.na : ""}` : `${name}: ${Math.round(x.score * 100)} of 100`;
}

function SignalBars({ o }: { o: Opportunity }) {
  return (
    <span className="grid grid-cols-4 gap-1.5">
      {SIGNALS.map((s) => {
        const x: SignalScore = o.signals[s.key];
        const text = signalText(o, s.key);
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

// ---------------------------------------------------------------------------
// Candidates table
// ---------------------------------------------------------------------------

interface Col {
  key: string;
  /** Wraps onto two lines; never truncated. */
  label: string;
  /** Column width in px (the table scrolls sideways below the sum). */
  width: number;
  align?: "right";
  sortable?: boolean;
  info?: string;
}

interface Row {
  key: string;
  cells: ReactNode[];
  sort: Array<number | string | null>;
}

function CandidatesTable({ cols, rows }: { cols: Col[]; rows: Row[] }) {
  const [sortIndex, setSortIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<"desc" | "asc" | null>(null);
  const sorted = useMemo(() => {
    if (sortIndex === null || direction === null) return rows;
    return [...rows].sort((a, b) => compareSortKeys(a.sort[sortIndex] ?? null, b.sort[sortIndex] ?? null, direction));
  }, [rows, sortIndex, direction]);
  const total = cols.reduce((t, c) => t + c.width, 0);

  function cycle(i: number) {
    if (sortIndex !== i) {
      setSortIndex(i);
      setDirection("desc");
    } else if (direction === "desc") setDirection("asc");
    else {
      setSortIndex(null);
      setDirection(null);
    }
  }

  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full table-fixed border-collapse" style={{ minWidth: total }}>
        <colgroup>
          {cols.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-hairline bg-gray-50">
            {cols.map((c, i) => {
              const active = sortIndex === i && direction !== null;
              const right = c.align === "right";
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (direction === "desc" ? "descending" : "ascending") : c.sortable === false ? undefined : "none"}
                  className={`px-2 py-2.5 align-bottom font-mono text-[10.5px] font-normal uppercase leading-[1.35] tracking-[0.06em] first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${
                    right ? "text-right" : "text-left"
                  } ${active ? "text-content-strong" : "text-content-muted"}`}
                >
                  <span className={`inline-flex items-end gap-1 ${right ? "flex-row-reverse" : ""}`}>
                    {c.info && <InfoTip text={c.info} label={`About ${c.label}`} />}
                    {c.sortable === false ? (
                      <span className="whitespace-normal break-words">{c.label}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => cycle(i)}
                        title={active ? (direction === "desc" ? "Sorted highest first. Click for lowest first." : "Sorted lowest first. Click to clear.") : `Sort by ${c.label}`}
                        className={`whitespace-normal break-words uppercase tracking-[0.06em] transition-colors duration-fast hover:text-content-strong ${right ? "text-right" : "text-left"}`}
                      >
                        {c.label}
                        <span aria-hidden="true" className={`ml-0.5 text-[8px] ${active ? "opacity-100" : "opacity-0"}`}>
                          {direction === "asc" ? "\u25B2" : "\u25BC"}
                        </span>
                      </button>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-hairline transition-colors duration-fast hover:bg-gray-50">
              {r.cells.map((cell, i) => (
                <td
                  key={cols[i]?.key ?? i}
                  className={`px-2 py-2.5 align-top first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 ${CELL_TEXT} ${cols[i]?.align === "right" ? "text-right" : "text-left"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  // One GA4 rule for the facts, the table and the index (lib/markets/opportunity):
  // under 28 of 90 days GA4 is not read at all.
  const ga4 = ga4Coverage(ga4Days);
  const ga4Reason = !model.signals
    ? NOT_IN.signals
    : ga4.ok || (ga4Days === null && ga4Connected)
      ? NOT_IN.ga4NoRows
      : ga4.na;
  const research = new Set(researchCandidates(sold));

  const items: Record<string, MapItem> = {};
  for (const iso of sold) items[iso] = { label: iso, value: "sold", fill: { fill: "var(--growth-300)", opacity: 1 }, aria: `${countryName(iso)}: sold market` };
  for (const iso of model.scoutMap) {
    const s = byIso.get(iso);
    const o = opp.get(iso);
    const index = o?.index ?? null;
    items[iso] = {
      label: iso,
      value: index !== null ? `${index}` : s ? plural(s.orders, "order") : undefined,
      hatch: true,
      aria:
        `${countryName(iso)}: candidate` +
        (index !== null ? `, opportunity index ${index} on ${o!.coverage} of 4 signals` : ", no opportunity index") +
        (s ? `, ${plural(s.orders, "order")} in this range` : ", no orders in this range"),
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

  const na = (reason: string) => <NaValue reason={reason} className={CELL_TEXT} />;
  const num = (v: string) => <span className="font-mono tabular text-content-strong">{v}</span>;
  const cpmText = (v: number, currency: string | null) => (currency ? formatMoney(v, currency, { decimals: 2 }) : formatNumber(v, { decimals: 2 }));

  const cols: Col[] = [
    { key: "country", label: "Country", width: 168 },
    { key: "why", label: "Why listed", width: 132, sortable: false },
    { key: "index", label: "Index", width: 76, align: "right", info: "Opportunity index, 0 to 100, and how many of the 4 signals it rests on. A signal for testing, not a verdict." },
    { key: "pull", label: "New customers, 365 d", width: 104, align: "right", info: "Proven pull: new customers with no campaign behind them, last 365 days. Not this range, so it can be above 0 when this range has no orders." },
    { key: "orders", label: "Orders, this range", width: 88, align: "right", info: "Orders with no campaign behind them, in the selected range." },
    { key: "net", label: "Net revenue, this range", width: 112, align: "right" },
    { key: "aov", label: "AOV new", width: 92, align: "right", info: "Average first order of new customers, this range." },
    { key: "ga4", label: "GA4 engaged, 90 d", width: 96, align: "right", info: `Engaged GA4 sessions from the country, last 90 days. n/a when GA4 covers fewer than 28 of the 90 days.` },
    { key: "unpaid", label: "Unpaid share", width: 84, align: "right", info: "Share of engaged sessions from unpaid channels (organic and direct), last 90 days." },
    { key: "search", label: "Searches / month", width: 92, align: "right", info: "Confirmed core terms, monthly searches, latest snapshot." },
    { key: "cpm", label: "Meta CPM", width: 104, align: "right", info: "The benchmark pair cost to reach uses: the country's CPM, and the home market's from the same source. n/a when either is missing; then cost to reach is n/a too." },
    { key: "aud", label: "Meta 18+", width: 80, align: "right", sortable: false, info: "Meta users 18+, vendor table, 2026-10 research." },
    { key: "vat", label: "VAT", width: 60, align: "right", sortable: false },
    { key: "note", label: "Market note", width: 240, sortable: false },
  ];

  const tableRows: Row[] = shown.map((iso) => {
    const s = byIso.get(iso);
    const r = sig.get(iso);
    const o = opp.get(iso);
    const ref = SCOUT_REFERENCE[iso];
    const eng = ga4.ok ? r?.engagedSessions90 ?? 0 : null;
    const unp = ga4.ok ? r?.unpaidEngagedSessions90 ?? 0 : null;
    const share = eng !== null && unp !== null && eng > 0 ? unp / eng : null;
    const search = o?.signals.search.raw;
    const pull = o?.signals.pull.raw;
    const cost = o?.signals.cost.raw;
    const pair = o?.cpm ?? null;
    const why = s
      ? "Orders this range, no campaign"
      : research.has(iso)
        ? "Research candidate"
        : r && r.orders365 > 0
          ? "Orders, last 365 days"
          : r && (r.engagedSessions90 ?? 0) > 0
            ? "GA4 visits"
            : r && r.searchVolumeCore !== null
              ? "Search demand"
              : "Research candidate";
    return {
      key: iso,
      sort: [
        countryName(iso), null, o?.index ?? null, pull && "v" in pull ? pull.v : null, s?.orders ?? 0, s?.netRevenue ?? null,
        s && !isNa(s.aovNew) ? s.aovNew.v : null, eng, share,
        search && "v" in search ? search.v : null, pair ? pair.country.value : null, null, null, null,
      ],
      cells: [
        <span key="c" className="text-[13px] text-content-strong">
          <span className="font-mono font-semibold">{iso}</span> {countryName(iso)}
        </span>,
        <span key="w" className="text-content-muted">{why}</span>,
        o && o.index !== null ? (
          <span key="i" className="inline-flex items-baseline gap-1 font-mono tabular">
            <span className="text-[13px] font-semibold text-content-strong">{o.index}</span>
            <span className="text-[11px] text-content-muted">{o.coverage}/4</span>
          </span>
        ) : (
          <span key="i">{na(o?.na ?? NOT_IN.signals)}</span>
        ),
        pull && "v" in pull ? num(formatFigure(pull.v, "count", ccy)) : na(pull && "na" in pull ? pull.na : NOT_IN.signals),
        num(formatFigure(s?.orders ?? 0, "count", ccy)),
        num(formatFigure(s?.netRevenue ?? 0, "money", ccy)),
        s && !isNa(s.aovNew) ? num(formatFigure(s.aovNew.v, "unit", ccy)) : na(s ? (s.aovNew as { na: string }).na : "No orders in this range"),
        eng !== null ? num(formatFigure(eng, "count", ccy)) : na(ga4Reason),
        share !== null ? num(formatFigure(share, "rate", ccy)) : na(eng === null ? ga4Reason : "No engaged sessions in 90 days"),
        search && "v" in search ? num(formatFigure(search.v, "count", ccy)) : na(search && "na" in search ? search.na : NOT_IN.signals),
        pair ? (
          <span key="p" className="flex flex-col items-end gap-0.5" title={`${pair.country.source}, ${pair.country.vertical}, as of ${pair.country.asOf}`}>
            {num(cpmText(pair.country.value, pair.country.currency))}
            <span className="font-mono text-[11px] tabular text-content-muted">{`${pair.home.iso} ${cpmText(pair.home.value, pair.home.currency)}`}</span>
          </span>
        ) : (
          na(cost && "na" in cost ? cost.na : NOT_IN.signals)
        ),
        ref?.metaAudience ? num(ref.metaAudience) : na(NOT_IN.research),
        ref?.vat ? num(ref.vat) : na(NOT_IN.research),
        ref?.note ? <span className="text-content-body">{ref.note}</span> : na(NOT_IN.research),
      ],
    };
  });

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
              <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] gap-x-3 px-2 text-[10.5px] leading-tight text-content-muted">
                <span />
                <span className="grid grid-cols-4 gap-1.5">
                  {SIGNALS.map((s) => (
                    <span key={s.key} title={`${s.label}: ${s.basis}`}>{s.short}</span>
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
            {ga4.ok ? (
              <>
                <Fact label={ga4.days < 90 ? `Engaged GA4 sessions, last 90 d (GA4 covers ${ga4.days} of 90 days)` : "Engaged GA4 sessions, last 90 d"}>
                  {formatFigure(engaged, "count", ccy)}
                </Fact>
                <Fact label="Unpaid share of engaged sessions">
                  {engaged > 0 ? formatFigure(unpaid / engaged, "rate", ccy) : <NaValue reason="No engaged sessions outside the sold markets in 90 days" />}
                </Fact>
              </>
            ) : (
              <Fact label={ga4Days !== null ? `GA4 sessions by country (GA4 covers ${plural(ga4Days, "day")} of 90)` : "GA4 sessions by country"}>
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
            <CandidatesTable cols={cols} rows={tableRows} />
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
