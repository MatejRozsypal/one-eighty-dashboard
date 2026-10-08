/**
 * Six complete months of a client's CM3 against what they pay us, in CZK.
 *
 * Bars are the client's CM3 per month (green above zero, red below). The
 * dashed line is the retainer agreed today, drawn across the window as a
 * reference: there is no history of retainers, so it is labelled as today's.
 * A dot marks what the Invoice Tracker holds for a month (amount plus profit
 * share). A month without CM3 shows n/a at the baseline with the reason on
 * hover.
 *
 * Plain HTML boxes rather than an SVG, so the labels keep their size at any
 * card width.
 */

import { NO_VALUE, formatMoney, formatNumber } from "@/lib/format";
import type { TrendMonth } from "@/lib/home/ledger/types";
import { NotAvailable, PART } from "./bits";

const PLOT_H = 96;

function compact(v: number): string {
  return formatNumber(v, { compact: true, decimals: Math.abs(v) < 10_000 ? 1 : 0 });
}

export function TrendBars({
  months,
  retainer,
  note,
}: {
  months: TrendMonth[];
  retainer: number | null;
  note: string | null;
}) {
  const values = months.flatMap((m) => [m.cm3Czk, m.invoicedCzk]).filter((v): v is number => v !== null);
  if (!months.length || !months.some((m) => m.cm3Czk !== null)) {
    const reason = note ?? months.find((m) => m.note)?.note ?? null;
    return (
      <div className="flex h-[64px] items-center justify-center rounded-md border border-dashed border-hairline-strong text-[12.5px]">
        <NotAvailable note={reason} label="CM3 history" />
      </div>
    );
  }
  if (retainer !== null) values.push(retainer);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const y = (v: number) => ((v - min) / range) * 100; // % from the bottom
  const zero = y(0);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative" style={{ height: PLOT_H + 18 }}>
        <div className="absolute inset-x-0 top-[16px]" style={{ height: PLOT_H }}>
          {/* zero line */}
          <span className="absolute inset-x-0 h-px bg-hairline-strong" style={{ bottom: `${zero}%` }} />
          {retainer !== null && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${y(retainer)}%`, borderColor: PART.retainer, opacity: 0.55 }}
            />
          )}
          <div className="absolute inset-0 grid grid-cols-6 gap-[10px] px-[2px]">
            {months.map((m) => {
              const v = m.cm3Czk;
              const title = [
                `${m.label}: CM3 ${v === null ? NO_VALUE : formatMoney(v, "CZK")}`,
                m.invoicedCzk !== null ? `invoiced ${m.invoicePeriod ?? ""} ${formatMoney(m.invoicedCzk, "CZK")}` : null,
                v === null ? m.note : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={m.month} className="relative" title={title}>
                  {v !== null && (
                    <>
                      <span
                        className="absolute inset-x-[18%] rounded-[5px]"
                        style={{
                          bottom: `${v >= 0 ? zero : y(v)}%`,
                          height: `max(2px, ${(Math.abs(v) / range) * 100}%)`,
                          background: v >= 0 ? PART.keeps : PART.negative,
                          opacity: v >= 0 ? 0.88 : 0.9,
                        }}
                      />
                      <span
                        className="absolute inset-x-0 text-center text-[10.5px] font-semibold leading-none text-content-muted"
                        style={{ bottom: `calc(${v >= 0 ? y(v) : zero}% + 4px)` }}
                      >
                        {compact(v)}
                      </span>
                    </>
                  )}
                  {v === null && (
                    <span
                      className="absolute inset-x-0 text-center text-[10.5px] leading-none text-content-muted"
                      style={{ bottom: `calc(${zero}% + 4px)` }}
                    >
                      {NO_VALUE}
                    </span>
                  )}
                  {m.invoicedCzk !== null && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 h-[9px] w-[9px] -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white"
                      style={{ bottom: `${y(m.invoicedCzk)}%`, background: PART.profitShare }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-[10px] px-[2px] text-center text-[11px] text-content-muted">
        {months.map((m) => (
          <span key={m.month}>{m.label}</span>
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-[11.5px] text-content-muted">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-[9px] w-[9px] rounded-[3px]" style={{ background: PART.keeps }} />
          Client CM3
        </li>
        {retainer !== null && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-[12px] border-t border-dashed" style={{ borderColor: PART.retainer }} />
            Retainer agreed today
          </li>
        )}
        {months.some((m) => m.invoicedCzk !== null) && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: PART.profitShare }} />
            Invoiced
          </li>
        )}
      </ul>
    </div>
  );
}
