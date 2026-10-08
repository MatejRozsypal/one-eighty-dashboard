/**
 * One month of a client's CM3, split between us and them.
 *
 * The bar is the client's CM3 in CZK. From the left: our retainer, our profit
 * share, and what the client keeps. When the profit share is not known, the
 * rest is hatched: left after the retainer, an upper bound on what they keep.
 * When our fees exceed the CM3, the bar is the fees and a mark shows where the
 * CM3 ended. No CM3, no bar: an empty track.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import type { SettledMonth } from "@/lib/home/ledger/types";
import { FigureText, HATCH, NotAvailable, PART, Swatch } from "./bits";

const FEE_TAG: Record<string, string> = {
  invoiced: "invoiced",
  agreed: "agreed",
  statement: "statement",
  none_by_terms: "none on this billing",
};

function pct(part: number, total: number): string {
  return `${Math.max(0, Math.min(100, (part / total) * 100))}%`;
}

function Bar({ s }: { s: SettledMonth }) {
  const cm3 = s.cm3Czk.value;
  if (cm3 === null) {
    return (
      <div
        className="flex h-[14px] items-center justify-center rounded-pill border border-dashed border-hairline-strong"
        aria-label="No CM3 for this month"
      />
    );
  }
  const r = s.retainer.value ?? 0;
  const p = s.profitShare.value;
  const fees = r + (p ?? 0);
  const total = Math.max(cm3, fees, 1);
  const rest = Math.max(0, cm3 - fees);
  const short = cm3 < fees;

  return (
    <div className="relative">
      <div className="flex h-[14px] overflow-hidden rounded-pill" style={{ background: PART.track }}>
        {r > 0 && <span style={{ width: pct(r, total), background: PART.retainer }} />}
        {p !== null && p > 0 && (
          <span style={{ width: pct(p, total), background: PART.profitShare }} className="border-l border-white/70" />
        )}
        {rest > 0 && (
          <span
            style={{ width: pct(rest, total), background: p === null ? HATCH : PART.keeps }}
            className="border-l border-white/70"
          />
        )}
      </div>
      {short && (
        <span
          aria-hidden="true"
          className="absolute -top-[3px] h-[20px] w-[2px] rounded-full"
          style={{ left: `calc(${pct(Math.max(cm3, 0), total)} - 1px)`, background: PART.negative }}
        />
      )}
    </div>
  );
}

function Line({
  swatch,
  label,
  tag,
  tip,
  children,
}: {
  swatch?: React.ReactNode;
  label: string;
  tag?: string | null;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="inline-flex min-w-0 items-center gap-2 text-content-muted">
        {swatch ?? <span className="inline-block w-[9px]" />}
        <span className="truncate">{label}</span>
        {tag && <span className="shrink-0 text-[11.5px] text-content-muted/80">· {tag}</span>}
        {tip && <InfoTip text={tip} label={`About ${label}`} />}
      </dt>
      <dd className="m-0 text-right tabular text-content-strong">{children}</dd>
    </>
  );
}

export function SplitBar({ s, currency }: { s: SettledMonth; currency: string | null }) {
  const psKnown = s.profitShare.value !== null;
  const converted = currency && currency !== "CZK";
  return (
    <div className="flex flex-col gap-3">
      <Bar s={s} />
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-[7px] text-[12.5px] leading-[1.35]">
        <Line
          label={`CM3 ${s.label ?? ""}`.trim()}
          tip={`The client's CM3 for the month from mart.plan_actuals_daily${
            converted ? `, converted from ${currency} at the month's rate in ref.fx_rates` : ""
          }.`}
        >
          <FigureText figure={s.cm3Czk} label="CM3" className="font-semibold" />
        </Line>
        <Line
          swatch={<Swatch color={PART.retainer} />}
          label="Retainer"
          tag={s.retainer.source ? FEE_TAG[s.retainer.source] : null}
          tip={
            s.retainer.source === "invoiced"
              ? "Invoice Amount on the month's task in the ClickUp Invoice Tracker."
              : "Agreed monthly retainer: ref.contracts, else ClickUp Retainer CZK. No invoice for the month."
          }
        >
          <FigureText figure={s.retainer} label="Retainer" />
        </Line>
        <Line
          swatch={<Swatch color={PART.profitShare} />}
          label="Profit share"
          tag={s.profitShare.source ? FEE_TAG[s.profitShare.source] : null}
        >
          <FigureText figure={s.profitShare} label="Profit share" />
        </Line>
        {psKnown ? (
          <Line swatch={<Swatch color={PART.keeps} />} label="Client keeps" tip="CM3 minus retainer and profit share.">
            <FigureText figure={s.keeps} label="Client keeps" className="font-semibold" />
          </Line>
        ) : (
          <Line
            swatch={<Swatch color={PART.keeps} hatch />}
            label="After retainer"
            tip="CM3 minus the retainer, before the profit share. An upper bound on what the client keeps."
          >
            {s.afterRetainer.value === null ? (
              <NotAvailable note={s.afterRetainer.note} label="After retainer" />
            ) : (
              <FigureText figure={s.afterRetainer} label="After retainer" />
            )}
          </Line>
        )}
      </dl>
    </div>
  );
}
