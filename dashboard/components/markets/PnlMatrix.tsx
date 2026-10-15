"use client";

/**
 * P&L by market: markets as columns, the metric tree as rows, top line to
 * bottom line, a delta against the comparison under every period figure.
 *
 * Sections collapse (the button is the section row). Period sections follow
 * the date picker; Lifetime is read from complete cohorts at a fixed age and
 * ignores it, which its section row says. The forecast rows sit in Lifetime
 * on their own, dashed and labelled, and are never part of the Total column.
 *
 * A market heading opens that market's drawer. The first column sticks on
 * narrow screens so a row keeps its label while the markets scroll.
 */

import { useState, type ReactNode } from "react";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { InfoTip } from "@/components/ui/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { NaValue, VerdictChip, MaturityBadge } from "@/components/markets/bits";
import {
  isNa,
  NOT_YET,
  type MarketColumn,
  type MarketsModel,
  type PeriodMetrics,
  type Val,
} from "@/lib/markets/model";
import type { CohortAge } from "@/lib/markets/types";
import {
  columnCurrency,
  deltaDecimals,
  deltaKind,
  formatFigure,
  longName,
  paybackText,
  scaled,
  shortName,
  type CurrencyMode,
  type FigureKind,
} from "@/lib/markets/display";

interface RowDef {
  id: string;
  label: string;
  info?: string;
  kind: FigureKind;
  good: GoodWhen;
  /** Period figure. */
  get?: (m: PeriodMetrics) => Val;
  /** Cohort figure (no delta, no total). */
  cohort?: (c: MarketColumn) => Val | ReactNode;
  /** Not measurable for anyone yet. */
  allNa?: string;
  strong?: boolean;
  sub?: boolean;
  forecast?: boolean;
  /** Shown in the Unallocated column (spend only). */
  unallocated?: boolean;
  /** Total column: false hides it (shares, cohort rows). */
  total?: boolean;
}

interface Section {
  id: string;
  label: string;
  cohort?: boolean;
  rows: RowDef[];
}

const cohortVal = (age: CohortAge, pick: "repeatRate" | "revenuePerCustomer" | "gpPerCustomer" | "cac" | "ltgpCac") =>
  (c: MarketColumn): Val => {
    const p = c.cohorts?.points[age];
    if (!c.cohorts) return { na: "No cohorts for this market" };
    if (!p) return { na: c.cohorts.missing[age] ?? `No complete cohort has reached ${age} days` };
    return p[pick];
  };

const SECTIONS: Section[] = [
  {
    id: "volume",
    label: "Volume",
    rows: [
      { id: "orders", label: "Orders", kind: "count", good: "up", get: (m) => m.orders },
      { id: "new", label: "New customers", kind: "count", good: "up", get: (m) => m.newCustomers },
      { id: "ret", label: "Returning orders", kind: "count", good: "up", get: (m) => m.returningOrders },
      { id: "retshare", label: "Returning revenue share", kind: "rate", good: "neutral", get: (m) => m.returningRevenueShare },
      { id: "share", label: "Share of client net revenue", kind: "rate", good: "neutral", get: (m) => m.shareOfClient, total: false },
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    rows: [
      { id: "gross", label: "Gross sales", kind: "money", good: "up", get: (m) => m.grossSales },
      { id: "disc", label: "Discounts", kind: "money", good: "down", get: (m) => m.discounts },
      { id: "dr", label: "Effective discount rate", kind: "rate", good: "down", sub: true, get: (m) => m.discountRate, info: "All discounts / gross sales." },
      { id: "dp", label: "Orders with a discount", kind: "rate", good: "down", sub: true, get: (m) => m.discountPenetration },
      { id: "mkd", label: "Compare-at markdown", kind: "money", good: "down", allNa: NOT_YET.markdown },
      { id: "ref", label: "Refunds", kind: "money", good: "down", get: (m) => m.refunds },
      { id: "refr", label: "Refunded orders", kind: "rate", good: "down", sub: true, get: (m) => m.refundRate },
      { id: "ns", label: "Net sales", kind: "money", good: "up", get: (m) => m.netSales },
      { id: "ship", label: "Shipping charged", kind: "money", good: "neutral", get: (m) => m.shippingCharged },
      { id: "net", label: "Net revenue", kind: "money", good: "up", strong: true, get: (m) => m.netRevenue, info: "Net sales plus shipping charged, ex VAT." },
      { id: "aovn", label: "AOV new", kind: "unit", good: "up", get: (m) => m.aovNew },
      { id: "aovr", label: "AOV returning", kind: "unit", good: "up", get: (m) => m.aovReturning },
    ],
  },
  {
    id: "profit",
    label: "Profit",
    rows: [
      { id: "cogs", label: "COGS % of net sales", kind: "rate", good: "down", get: (m) => m.cogsPct },
      { id: "gp", label: "Gross profit (CM1)", kind: "money", good: "up", strong: true, get: (m) => m.grossProfit, info: "Net sales minus COGS. Shipping cost and payment fees come off in CM2." },
      { id: "cm1", label: "CM1 %", kind: "rate", good: "up", sub: true, get: (m) => m.cm1Pct },
      { id: "shipc", label: "Shipping and fulfilment", kind: "money", good: "down", get: (m) => m.shippingCost, info: "Cost card: shipping cost per order x orders plus return handling x refunded orders, minus shipping charged to customers." },
      { id: "fees", label: "Payment fees incl. COD", kind: "money", good: "down", get: (m) => m.paymentFees, info: "Cost card: payment fee % x net revenue plus COD fee x COD orders." },
      { id: "cm2", label: "CM2", kind: "money", good: "up", strong: true, get: (m) => m.cm2, info: "Gross profit minus shipping and fulfilment and payment fees." },
      { id: "spend", label: "Ad spend", kind: "money", good: "neutral", get: (m) => m.spend, unallocated: true },
      { id: "gpa", label: "GP after ads", kind: "money", good: "up", strong: true, get: (m) => m.gpAfterAds, info: "Gross profit minus ad spend: the ranking column until every market has CM3." },
      { id: "fogpa", label: "First-order GP after ads", kind: "money", good: "up", get: (m) => m.firstOrderGpAfterAds, info: "First-order gross profit of every new customer in the range minus the ad spend allocated to the market. Above 0: acquisition pays back on the first order." },
      { id: "cm3", label: "CM3", kind: "money", good: "up", strong: true, get: (m) => m.cm3, info: "CM2 minus ad spend and the fixed monthly market cost: the ranking column once every market has a cost card." },
    ],
  },
  {
    id: "acq",
    label: "Acquisition",
    rows: [
      { id: "ncac", label: "nCAC", kind: "unit", good: "down", get: (m) => m.nCac, info: "Ad spend allocated to the market / new customers in it." },
      { id: "mer", label: "MER", kind: "ratio", good: "up", get: (m) => m.mer, info: "Net revenue / ad spend." },
      { id: "amer", label: "aMER", kind: "ratio", good: "up", get: (m) => m.amer, info: "New-customer revenue / ad spend." },
      { id: "be", label: "Break-even aMER", kind: "ratio", good: "down", get: (m) => m.breakEvenAmer, info: "First-order AOV / first-order contribution: on CM2 where the market has a cost card, on CM1 otherwise." },
      { id: "fg", label: "First-order GP per new customer", kind: "unit", good: "up", get: (m) => m.firstOrderGp },
      { id: "fop", label: "First-order GP minus nCAC", kind: "unit", good: "up", get: (m) => m.firstOrderProfit, info: "Above 0: a new customer pays back on the first order (CM1 basis)." },
    ],
  },
  {
    id: "life",
    label: "Lifetime",
    cohort: true,
    rows: [
      { id: "c365", label: "Cohort customers, 365 d", kind: "count", good: "neutral", cohort: (c) => (c.cohorts?.points[365] ? { v: c.cohorts.points[365]!.customers } : { na: c.cohorts?.missing[365] ?? "No complete cohort has reached 365 days" }) },
      ...([90, 180, 365] as const).map<RowDef>((a) => ({ id: `rep${a}`, label: `Repeat rate ${a} d`, kind: "rate", good: "up", cohort: cohortVal(a, "repeatRate"), info: a === 90 ? "Every age reads the same cohorts: the latest 12 cohort months that reached 365 days (the oldest age with at least 30 customers when none did), so the rows form one curve. Under 30 cohort customers the figures are n/a." : undefined })),
      ...([90, 180, 365] as const).map<RowDef>((a) => ({ id: `rev${a}`, label: `Revenue per customer ${a} d`, kind: "unit", good: "up", cohort: cohortVal(a, "revenuePerCustomer") })),
      ...([90, 180, 365] as const).map<RowDef>((a) => ({ id: `gp${a}`, label: `GP per customer ${a} d`, kind: "unit", good: "up", strong: a === 365, cohort: cohortVal(a, "gpPerCustomer") })),
      ...([90, 180, 365] as const).map<RowDef>((a) => ({ id: `cac${a}`, label: `Cohort CAC ${a} d`, kind: "unit", good: "down", cohort: cohortVal(a, "cac"), info: a === 90 ? "Market spend inside the cohort months / cohort customers. n/a when part of that spend is not in the data: a platform's history starting later, days without spend data or over 10% Unallocated spend." : undefined })),
      ...([90, 180, 365] as const).map<RowDef>((a) => ({ id: `ltgp${a}`, label: `LTGP:CAC ${a} d`, kind: "ratio", good: "up", strong: a === 365, cohort: cohortVal(a, "ltgpCac"), info: a === 365 ? "Target 3:1 at 365 days." : undefined })),
      {
        id: "payback",
        label: "CAC payback",
        kind: "count",
        good: "down",
        info: "First day cumulative GP per customer crosses nCAC, read between the cohort ages 30, 60, 90, 180 and 365 d.",
        cohort: (c) => {
          if (!c.cohorts) return { na: "No cohorts for this market" };
          const p = c.cohorts.payback;
          if ("na" in p) return { na: p.na };
          return <span className="font-mono text-[13px] tabular text-content-strong">{paybackText(p)}</span>;
        },
      },
      {
        id: "fc-gp",
        label: "GP per customer 365 d",
        kind: "unit",
        good: "up",
        forecast: true,
        info: "Maturity multiplier on young cohorts: first-order GP stays actual, repeat GP is projected from mature cohorts of the same market. Shown only where the backtest supports it; never in totals or verdicts.",
        cohort: (c) => (c.forecast?.value ? { v: c.forecast.value.forecast } : { na: c.forecast?.reason ?? "No forecast for this market" }),
      },
      {
        id: "fc-ltgp",
        label: "LTGP:CAC 365 d",
        kind: "ratio",
        good: "up",
        forecast: true,
        cohort: (c) => c.forecast?.ltgpCac ?? { na: "No forecast for this market" },
      },
    ],
  },
];

function Cell({
  x,
  prev,
  kind,
  good,
  currency,
  compareLabel,
  forecastBand,
}: {
  x: Val;
  prev: Val | null;
  kind: FigureKind;
  good: GoodWhen;
  currency: { code: string; cur: number; prev: number };
  compareLabel?: string;
  forecastBand?: string;
}) {
  if (isNa(x)) return <NaValue reason={x.na} />;
  const v = scaled(x, kind, currency.cur) as { v: number; note?: string };
  const p = prev && !isNa(prev) ? (scaled(prev, kind, currency.prev) as { v: number }) : null;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[13px] tabular text-content-strong">
        {formatFigure(v.v, kind, currency.code)}
        {v.note ? <InfoTip text={v.note} label="Note" /> : null}
      </span>
      {forecastBand && <span className="whitespace-nowrap font-mono text-[11px] tabular text-content-muted">{forecastBand}</span>}
      {p && (
        <DeltaChip
          change={{ current: v.v, previous: p.v, kind: deltaKind(kind), currency: currency.code, compact: kind === "money", decimals: deltaDecimals(kind, currency.code) }}
          goodWhen={good}
          className="text-[11px]"
          after={compareLabel ? <span className="sr-only">{compareLabel}</span> : undefined}
        />
      )}
    </span>
  );
}

export function PnlMatrix({
  model,
  mode,
  compareLabel,
  periodLabel,
  onOpen,
}: {
  model: MarketsModel;
  mode: CurrencyMode;
  compareLabel?: string;
  periodLabel: string;
  onOpen: (market: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const cols: MarketColumn[] = [...model.markets, ...(model.unallocated ? [model.unallocated] : []), model.total];
  const base = model.baseCurrency;
  const currencies = cols.map((c) => columnCurrency(c, mode, base));
  const span = cols.length + 1;

  return (
    // `relative`: the sr-only text in each cell is absolutely positioned, and
    // without a positioned scroller it escapes the clip and widens the page.
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
        <caption className="sr-only">P&amp;L by market, {periodLabel}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-[1] min-w-[190px] border-b border-hairline bg-paper px-3 py-2.5 align-bottom font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-content-muted">
              {mode === "base" ? `${base}, ex VAT` : "Local currency, ex VAT"}
            </th>
            {cols.map((c, i) => {
              const ccy = currencies[i];
              const clickable = c.kind === "sold" || c.kind === "other";
              return (
                <th key={c.key} scope="col" className={`min-w-[120px] border-b border-hairline px-3 py-2.5 text-right align-bottom ${c.kind === "total" ? "bg-gray-50" : ""}`}>
                  <span className="flex flex-col items-end gap-1">
                    {clickable ? (
                      <button
                        type="button"
                        onClick={() => onOpen(c.key)}
                        title={`Open ${longName(c)}`}
                        className="rounded-xs font-mono text-[13px] font-semibold text-content-strong underline decoration-hairline-strong underline-offset-4 hover:decoration-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        {shortName(c)}
                      </button>
                    ) : (
                      <span className="font-mono text-[13px] font-semibold text-content-strong">{shortName(c)}</span>
                    )}
                    {c.verdict && <VerdictChip verdict={c.verdict} maturity={c.maturity.level} maturityWhy={c.maturity.why} />}
                    {c.kind !== "total" && c.kind !== "unallocated" && <MaturityBadge level={c.maturity.level} why={c.maturity.why} />}
                    {mode === "local" && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-content-muted">
                        {ccy.code}
                        {ccy.why ? <InfoTip text={`${ccy.why}; shown in ${base}.`} label="Currency" /> : null}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        {SECTIONS.map((sec) => {
          const isCollapsed = !!collapsed[sec.id];
          return (
            <tbody key={sec.id}>
              <tr>
                <th scope="colgroup" colSpan={span} className="border-b border-hairline bg-gray-50 p-0 text-left">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((s) => ({ ...s, [sec.id]: !s[sec.id] }))}
                    className="sticky left-0 flex w-full max-w-[100vw] items-center gap-2 px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-content-muted hover:text-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    <span aria-hidden="true" className="inline-block w-3 text-[11px]">{isCollapsed ? "+" : "−"}</span>
                    <span className="font-medium text-content-body">{sec.label}</span>
                    <span>{sec.cohort ? "complete cohorts, not the date range" : periodLabel}</span>
                  </button>
                </th>
              </tr>
              {!isCollapsed &&
                sec.rows.map((row) => (
                  <tr key={row.id} className={row.forecast ? "[&>*]:border-t [&>*]:border-dashed [&>*]:border-hairline-strong" : ""}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-[1] border-b border-hairline bg-paper px-3 py-2 text-left align-top text-[13px] font-normal ${
                        row.sub ? "pl-6 text-content-muted" : row.strong ? "font-semibold text-content-strong" : "text-content-body"
                      }`}
                    >
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {row.label}
                        {row.forecast && (
                          <Badge variant="outline" size="sm" className="border-dashed">
                            forecast
                          </Badge>
                        )}
                        {row.info && <InfoTip text={row.info} />}
                      </span>
                    </th>
                    {cols.map((c, i) => {
                      const ccy = currencies[i];
                      const empty = <span className="font-mono text-[13px] text-content-muted" aria-label="Not applicable">·</span>;
                      let content: ReactNode;
                      if (c.kind === "unallocated" && !row.unallocated) content = empty;
                      else if (c.kind === "total" && (row.cohort || row.total === false)) content = empty;
                      else if (row.allNa) content = <NaValue reason={row.allNa} />;
                      else if (row.cohort) {
                        const x = row.cohort(c);
                        if (x && typeof x === "object" && ("v" in x || "na" in x)) {
                          const band =
                            row.id === "fc-gp" && c.forecast?.value
                              ? `${formatFigure(c.forecast.value.low * ccy.cur, "unit", ccy.code)} to ${formatFigure(c.forecast.value.high * ccy.cur, "unit", ccy.code)}`
                              : undefined;
                          content = <Cell x={x as Val} prev={null} kind={row.kind} good={row.good} currency={ccy} forecastBand={band} />;
                        } else content = x as ReactNode;
                      } else if (row.get) {
                        content = (
                          <Cell
                            x={row.get(c.cur)}
                            prev={c.prev ? row.get(c.prev) : null}
                            kind={row.kind}
                            good={row.good}
                            currency={ccy}
                            compareLabel={compareLabel}
                          />
                        );
                      }
                      return (
                        <td
                          key={c.key}
                          className={`border-b border-hairline px-3 py-2 text-right align-top ${c.kind === "total" ? "bg-gray-50" : ""} ${row.forecast ? "italic" : ""}`}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
