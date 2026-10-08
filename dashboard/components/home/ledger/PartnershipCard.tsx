/**
 * One client as a partnership: does it pay for both sides?
 *
 * Top: the ratio for the last complete month, what the client kept per 1 Kč
 * they paid us. Under it the same month as a split of their CM3, then six
 * months of CM3 against our fees, then the month in progress from Goals.
 * Every n/a carries the missing source in its (i).
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { MINUS, NO_VALUE } from "@/lib/format";
import { planStatusLabel, toneOfRow, toneVars } from "@/lib/plan/health";
import { fmtValue } from "@/lib/plan/format";
import type { Partnership } from "@/lib/home/ledger/types";
import { Money, NotAvailable } from "./bits";
import { SplitBar } from "./SplitBar";
import { TrendBars } from "./TrendBars";

const CARD =
  "flex min-w-0 flex-col gap-5 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm sm:p-[22px]";
const GROUP = "flex flex-col gap-3 border-t border-hairline pt-4";
const GROUP_TITLE = "text-[12px] font-semibold uppercase tracking-[0.06em] text-content-muted";

function capitalise(s: string | null): string | null {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

function ratioText(v: number): string {
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.abs(v) >= 10 ? 0 : 1,
    maximumFractionDigits: Math.abs(v) >= 10 ? 0 : 1,
  }).format(Math.abs(v));
  return v < 0 && /[1-9]/.test(text) ? `${MINUS}${text}` : text;
}

function Ratio({ p }: { p: Partnership }) {
  const r = p.settled.perKoruna;
  const ceiling = p.settled.perKorunaCeiling;
  const month = p.settled.label;
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-content-muted">
        {month ? `Client kept, ${month}` : "Client kept"}
        <InfoTip
          text="Client CM3 minus our retainer and profit share, per 1 Kč of those fees. Last complete month."
          label="About client kept per 1 Kč"
        />
      </span>
      {r.value === null && ceiling !== null ? (
        <span className="inline-flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-content-muted">at most</span>
          <span
            className="tabular text-[40px] font-bold leading-[1] tracking-display text-content-muted"
            style={ceiling < 0 ? { color: "var(--h-negative-text)" } : undefined}
          >
            {ratioText(ceiling)}
            <span className="ml-1.5 text-[17px] font-semibold tracking-normal">Kč</span>
          </span>
          <span className="self-center text-[13px]">
            <InfoTip
              text={`Before profit share. ${r.note ?? ""} Any profit share lowers this.`.trim()}
              label="Why this is an upper bound"
            />
          </span>
        </span>
      ) : r.value === null ? (
        <span className="text-[34px] font-bold leading-[1.05] tracking-display">
          <NotAvailable note={r.note} label="the ratio" />
        </span>
      ) : (
        <span
          className="tabular text-[40px] font-bold leading-[1] tracking-display text-content-strong"
          style={r.value < 0 ? { color: "var(--h-negative-text)" } : undefined}
        >
          {ratioText(r.value)}
          <span className="ml-1.5 text-[17px] font-semibold tracking-normal text-content-muted">Kč</span>
        </span>
      )}
      <span className="text-[13px] text-content-muted">per 1 Kč paid to us</span>
    </div>
  );
}

function ThisMonth({ p }: { p: Partnership }) {
  const { thisMonth: m, currency } = p;
  if (!p.clientId || !currency) return null;
  const tone = m.focus ? toneOfRow(m.focus) : null;
  return (
    <section className={GROUP} aria-label="This month">
      <div className="flex items-baseline justify-between gap-3">
        <span className={GROUP_TITLE}>{m.label ? `${m.label.split(" ")[0]} to date` : "Month to date"}</span>
        {m.focus && tone && (
          <span className="text-[12.5px] font-semibold" style={{ color: toneVars(tone).text }}>
            {planStatusLabel(m.focus)}
            <span className="font-normal text-content-muted"> on Goals</span>
          </span>
        )}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3">
        {(
          [
            ["Revenue", m.revenue, "revenue"],
            ["CM3", m.cm3, "cm3"],
          ] as const
        ).map(([label, f, metric]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[12px] text-content-muted">{label}</dt>
            <dd className="m-0 text-[17px] font-semibold tabular text-content-strong">
              {f.value === null ? <NotAvailable note={f.note} label={label} /> : fmtValue(f.value, metric, currency)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PartnershipCard({ p }: { p: Partnership }) {
  const href = p.clientId
    ? `${p.thisMonth.focus ? "/goals" : "/snapshot"}?client=${encodeURIComponent(p.clientId)}`
    : null;
  const meta = [capitalise(p.crmStatus), p.billingType, p.currency].filter(Boolean);

  return (
    <article className={p.clientId ? CARD : `${CARD} self-start`}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {href ? (
            <AppLink
              href={href}
              className="truncate text-[17px] font-semibold leading-[1.25] tracking-heading text-content-strong hover:underline"
            >
              {p.name}
            </AppLink>
          ) : (
            <span className="truncate text-[17px] font-semibold leading-[1.25] tracking-heading text-content-strong">
              {p.name}
            </span>
          )}
          <span className="text-[12.5px] leading-[1.35] text-content-muted">
            {meta.length ? meta.join(" · ") : NO_VALUE}
            {p.crmUrl && (
              <>
                {" · "}
                <a href={p.crmUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                  ClickUp
                </a>
              </>
            )}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-content-muted">Retainer</span>
          {p.agreedRetainer.value === null ? (
            <NotAvailable note={p.agreedRetainer.note} label="Retainer" className="text-[15px]" />
          ) : (
            <Money value={p.agreedRetainer.value} className="text-[15px] font-semibold text-content-strong" codeClassName="text-[11px] font-semibold text-content-muted" />
          )}
          <span className="text-[11.5px] text-content-muted">agreed / mo</span>
        </div>
      </header>

      {p.clientId ? (
        <>
          <Ratio p={p} />

          <SplitBar s={p.settled} currency={p.currency} />

          <section className={GROUP} aria-label="Six months">
            <span className={GROUP_TITLE}>CM3 and fees · 6 months · CZK</span>
            <TrendBars months={p.trend} retainer={p.agreedRetainer.value} note={p.trendNote} />
          </section>

          <ThisMonth p={p} />
        </>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-hairline-strong px-4 py-3 text-[13px] text-content-muted">
          <span>No shop data</span>
          <NotAvailable note={p.trendNote} label="shop data" />
        </div>
      )}
    </article>
  );
}
