"use client";

/**
 * One market in detail, in a panel over the page: KPIs, the profit waterfall,
 * cohort value against acquisition cost, discounts, ops friction and, for a
 * Young or Directional market, the leading indicators that stand in for a
 * verdict.
 *
 * Portalled to <body> for the reason AdDetail gives: an animated ancestor
 * would make `position: fixed` relative to it instead of the window. Escape
 * and the scrim close it; focus moves to the close button on open and back to
 * whatever opened it on close.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";
import { Notice } from "@/components/ui/Notice";
import { NaValue, VerdictChip, MaturityBadge } from "@/components/markets/bits";
import { Waterfall } from "@/components/markets/Waterfall";
import { CohortChart } from "@/components/markets/CohortChart";
import {
  discountFlag,
  indexVsHome,
  isNa,
  NOT_YET,
  type MarketColumn,
  type MarketsModel,
  type Val,
} from "@/lib/markets/model";
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
import { formatNumber } from "@/lib/format";

function Figure({
  x,
  prev,
  kind,
  currency,
  good,
}: {
  x: Val;
  prev?: Val | null;
  kind: FigureKind;
  currency: { code: string; cur: number; prev: number };
  good?: GoodWhen;
}) {
  if (isNa(x)) return <NaValue reason={x.na} />;
  const v = scaled(x, kind, currency.cur) as { v: number; note?: string };
  const p = prev && !isNa(prev) ? (scaled(prev, kind, currency.prev) as { v: number }) : null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="inline-flex items-center gap-1 font-mono tabular text-content-strong">
        {formatFigure(v.v, kind, currency.code)}
        {v.note ? <InfoTip text={v.note} label="Note" /> : null}
      </span>
      {p && good && (
        <DeltaChip change={{ current: v.v, previous: p.v, kind: deltaKind(kind), currency: currency.code, decimals: deltaDecimals(kind, currency.code) }} goodWhen={good} className="text-[11px]" />
      )}
    </span>
  );
}

function Block({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  return (
    <Card padding="none" className="p-4 sm:p-5">
      <h3 className="m-0 mb-3 flex items-center gap-1.5 text-[14px] font-semibold text-content-strong">
        {title}
        {info && <InfoTip text={info} />}
      </h3>
      {children}
    </Card>
  );
}

function Items({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 text-[12.5px]">
          <dt className="text-content-body">{label}</dt>
          <dd className="m-0 text-right text-[13px]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MarketDrawer({
  model,
  market,
  mode,
  rangeText,
  compareLabel,
  onClose,
}: {
  model: MarketsModel;
  market: MarketColumn;
  mode: CurrencyMode;
  rangeText: string;
  compareLabel?: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  // A shared link with ?market= opens the drawer on load: the portal waits for
  // the client, so the server HTML and the first client render match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement || opener instanceof SVGElement) opener.focus();
    };
  }, [onClose, mounted]);

  if (!mounted) return null;

  const c = market;
  const base = model.baseCurrency;
  const ccy = columnCurrency(c, mode, base);
  const home = model.markets.find((m) => m.key === model.homeMarket) ?? null;
  const flag = discountFlag(c.cur, c.prev);
  const ltgp365 = c.cohorts?.points[365]?.ltgpCac ?? ({ na: c.cohorts?.missing[365] ?? "No complete cohort has reached 365 days" } as Val);
  const pb = c.cohorts ? c.cohorts.payback : { na: "No cohorts for this market" };
  const fig = (x: Val, kind: FigureKind, prev?: Val | null, good?: GoodWhen) => (
    <Figure x={x} prev={prev} kind={kind} currency={ccy} good={good} />
  );
  const rep = (age: 30 | 60, col: MarketColumn | null): Val => {
    const p = col?.cohorts?.points[age];
    return p ? p.repeatRate : { na: col?.cohorts?.missing[age] ?? `No complete cohort has reached ${age} days` };
  };
  const idx = (x: Val) => (isNa(x) ? <NaValue reason={x.na} /> : <span className="font-mono tabular text-content-strong">{formatNumber(x.v)}</span>);
  const ppVsHome = (a: Val, h: Val) =>
    isNa(a) ? <NaValue reason={a.na} /> : isNa(h) ? <NaValue reason={`Home: ${h.na}`} /> : (
      <span className="font-mono tabular text-content-strong">
        {formatFigure(a.v, "rate", base)} <span className="text-content-muted">vs {formatFigure(h.v, "rate", base)}</span>
      </span>
    );

  const kpis: Array<{ label: string; x: Val; prev: Val | null; kind: FigureKind; good: GoodWhen }> = [
    { label: "Net revenue", x: c.cur.netRevenue, prev: c.prev?.netRevenue ?? null, kind: "money", good: "up" },
    { label: "GP after ads", x: c.cur.gpAfterAds, prev: c.prev?.gpAfterAds ?? null, kind: "money", good: "up" },
    { label: "nCAC", x: c.cur.nCac, prev: c.prev?.nCac ?? null, kind: "unit", good: "down" },
    { label: "MER", x: c.cur.mer, prev: c.prev?.mer ?? null, kind: "ratio", good: "up" },
    { label: "LTGP:CAC 365 d", x: ltgp365, prev: null, kind: "ratio", good: "up" },
  ];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(10,10,11,0.55)] backdrop-blur-[5px]"
    >
      <div className="flex h-full w-full max-w-[600px] flex-col overflow-y-auto overscroll-contain border-l border-hairline bg-gray-100 shadow-xl">
        <header className="sticky top-0 z-[2] flex items-start gap-3 border-b border-hairline bg-paper px-5 pb-4 pt-[calc(1rem+var(--safe-top))]">
          <div className="min-w-0 flex-1">
            <Eyebrow>{rangeText}</Eyebrow>
            <h2 id="market-drawer-title" className="m-0 mt-1 text-[20px] font-bold tracking-heading text-content-strong">
              {longName(c)}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {c.verdict && <VerdictChip verdict={c.verdict} maturity={c.maturity.level} maturityWhy={c.maturity.why} size="md" />}
              <MaturityBadge level={c.maturity.level} why={c.maturity.why} />
              {mode === "local" && (
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-content-muted">
                  {ccy.code}
                  {ccy.why ? ` (${ccy.why.toLowerCase()})` : ""}
                </span>
              )}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close market detail"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-hairline text-[18px] leading-none text-content-muted transition-colors duration-fast hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <Card padding="none" className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 sm:p-5">
            {kpis.map((k) => (
              <div key={k.label} className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">{k.label}</span>
                <span className="text-[17px]">{fig(k.x, k.kind, k.prev, k.good)}</span>
              </div>
            ))}
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">CAC payback</span>
              <span className="text-[17px]">
                {"na" in pb ? <NaValue reason={pb.na} /> : <span className="font-mono tabular text-content-strong">{paybackText(pb)}</span>}
              </span>
            </div>
          </Card>
          {compareLabel && c.prev && <p className="m-0 px-1 text-[11.5px] text-content-muted">Changes {compareLabel}.</p>}

          <Block
            title="Waterfall"
            info={
              isNa(c.cur.cm2)
                ? "Gross sales to GP after ads in this range. The dashed lines are the CM2 costs that need a cost card for this market (Settings > Market costs)."
                : "Gross sales to CM3 in this range, with shipping, payment fees and the fixed market cost from the market's cost card."
            }
          >
            <Waterfall m={c.cur} currency={ccy.code} factor={ccy.cur} />
          </Block>

          <Block title="Cohort value vs acquisition cost" info="Complete cohorts only; every point reads the same cohorts, the latest twelve cohort months that reached 365 days (or the oldest age with at least 30 customers). Does not follow the date range.">
            <CohortChart market={c} home={home} currency={ccy.code} factor={ccy.cur} />
          </Block>

          <Block title="Discounts">
            <Items
              rows={[
                ["Effective discount rate", fig(c.cur.discountRate, "rate", c.prev?.discountRate, "down")],
                ["Orders with a discount", fig(c.cur.discountPenetration, "rate", c.prev?.discountPenetration, "down")],
                ["Average depth, discounted orders", fig(c.cur.avgDepth, "rate", c.prev?.avgDepth, "down")],
                ["Full-price revenue share", fig(c.cur.fullPriceShare, "rate", c.prev?.fullPriceShare, "up")],
                ["Discount rate, new", fig(c.cur.newDiscountRate, "rate")],
                ["Discount rate, returning", fig(c.cur.returningDiscountRate, "rate")],
                ["Code vs automatic", <NaValue key="cva" reason={NOT_YET.codeVsAuto} />],
              ]}
            />
            <div className="mt-3">
              {flag.state === "na" ? (
                <NaValue reason={flag.text} />
              ) : (
                <Notice tone={flag.state === "on" ? "warning" : "info"}>
                  <span className={flag.state === "on" ? "text-warning-700" : undefined}>{flag.text}</span>
                </Notice>
              )}
            </div>
          </Block>

          <Block title="Ops friction">
            <Items
              rows={[
                ["COD share", fig(c.cur.codShare, "rate", c.prev?.codShare, "down")],
                ["Free-shipping orders", fig(c.cur.zeroShippingShare, "rate", c.prev?.zeroShippingShare, "neutral")],
                ["Shipping charged per order", fig(c.cur.shippingPerOrder, "unit", c.prev?.shippingPerOrder, "neutral")],
                ["Refunded orders", fig(c.cur.refundRate, "rate", c.prev?.refundRate, "down")],
                ["COD refusal rate", <NaValue key="ref" reason={NOT_YET.codRefusal} />],
                ["Delivery mix", <NaValue key="del" reason={NOT_YET.delivery} />],
                ["Time to fulfilment", <NaValue key="ful" reason={NOT_YET.fulfilment} />],
              ]}
            />
            <div className="mt-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">Payment mix</span>
              {c.paymentMix.length === 0 ? (
                <p className="m-0 mt-1"><NaValue reason="Payment method is not ingested for this market" /></p>
              ) : (
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
                  {(() => {
                    const total = c.paymentMix.reduce((t, p) => t + p.orders, 0) || 1;
                    return c.paymentMix.map((p) => (
                      <li key={p.method} className="grid grid-cols-[minmax(0,1fr)_minmax(0,40%)_56px] items-center gap-2 text-[12.5px]">
                        <span className="truncate text-content-body">{p.method}</span>
                        <span className="h-[6px] rounded-pill bg-gray-100">
                          <span className="block h-full rounded-pill bg-gray-400" style={{ width: `${(p.orders / total) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono tabular text-content-strong">{formatFigure(p.orders / total, "rate", base)}</span>
                      </li>
                    ));
                  })()}
                </ul>
              )}
            </div>
          </Block>

          {c.maturity.level !== "Established" && (
            <Block
              title={`Leading indicators, ${c.maturity.level.toLowerCase()} market`}
              info="Read these before a verdict: they move within weeks, while LTGP needs a year of cohorts."
            >
              <Items
                rows={[
                  [`First-order GP, index vs ${home ? shortName(home) : "home"}`, idx(indexVsHome(c.cur.firstOrderGp, home?.cur.firstOrderGp ?? null))],
                  [`AOV new, index vs ${home ? shortName(home) : "home"}`, idx(indexVsHome(c.cur.aovNew, home?.cur.aovNew ?? null))],
                  ["Repeat at 30 d vs home", ppVsHome(rep(30, c), rep(30, home))],
                  ["Repeat at 60 d vs home", ppVsHome(rep(60, c), rep(60, home))],
                  ["First-order GP minus nCAC", fig(c.cur.firstOrderProfit, "unit", c.prev?.firstOrderProfit, "up")],
                  ["CVR, add to cart, checkout", <NaValue key="f" reason={NOT_YET.funnel} />],
                  ["CPM and CTR", <NaValue key="c" reason={NOT_YET.cpm} />],
                ]}
              />
            </Block>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
