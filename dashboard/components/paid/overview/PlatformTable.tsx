/**
 * By platform: Meta and Google as the platforms report themselves, then the
 * Total row as the shop sees it.
 *
 * The platform rows and the Total row answer different questions (what each
 * platform claims vs what the shop booked), so the Total's value is shop
 * revenue, its ROAS is MER and its CPA is blended CAC. A platform the client
 * does not have is one muted cell spanning the row. GA4 columns exist only when
 * the client has GA4 and its data is readable.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { NoValue } from "@/components/ui/EmptyState";
import { NO_VALUE, formatMoney, formatNumber, formatPercent, formatRatio } from "@/lib/format";
import { ratio } from "@/lib/paid/math";
import type { Ga4Totals, Sums } from "@/components/paid/overview/model";

const COLS_BASE = "grid-cols-[minmax(110px,1.3fr)_repeat(6,minmax(84px,1fr))]";
const COLS_GA4 = "grid-cols-[minmax(110px,1.3fr)_repeat(8,minmax(84px,1fr))]";

interface Row {
  key: string;
  label: string;
  dot?: string;
  connected: boolean;
  spend: number | null;
  share: number | null;
  purchases: number | null;
  value: number | null;
  ga4: number | null;
  strong?: boolean;
}

export function PlatformTable({
  sums,
  currency,
  hasMeta,
  hasGoogle,
  ga4,
}: {
  sums: Sums;
  currency: string;
  hasMeta: boolean;
  hasGoogle: boolean;
  /** Null hides the GA4 columns. */
  ga4: Ga4Totals | null;
}) {
  const rows: Row[] = [
    {
      key: "meta",
      label: "Meta",
      dot: "bg-platform-meta",
      connected: hasMeta,
      spend: sums.metaSpend,
      share: ratio(sums.metaSpend, sums.paidSpend),
      purchases: sums.metaPurchases,
      value: sums.metaRevenue,
      ga4: ga4?.meta ?? null,
    },
    {
      key: "google",
      label: "Google",
      dot: "bg-platform-google",
      connected: hasGoogle,
      spend: sums.googleSpend,
      share: ratio(sums.googleSpend, sums.paidSpend),
      purchases: sums.googlePurchases,
      value: sums.googleRevenue,
      ga4: ga4?.google ?? null,
    },
    {
      key: "total",
      label: "Total",
      connected: true,
      spend: sums.paidSpend,
      share: sums.paidSpend === null ? null : 1,
      purchases: sums.orders,
      value: sums.revenue,
      ga4: ga4?.paid ?? null,
      strong: true,
    },
  ];

  const cols = ga4 ? COLS_GA4 : COLS_BASE;
  const heads = [
    { label: "Platform" },
    { label: "Spend" },
    { label: "Share" },
    { label: "Purchases" },
    {
      label: "Value",
      info: "Platform rows are what each platform claims, so they can overlap and exceed shop revenue. The total row is shop revenue.",
    },
    { label: "ROAS" },
    { label: "CPA" },
    ...(ga4
      ? [
          { label: "GA4 revenue", info: "Last-click revenue GA4 attributes to the platform." },
          { label: "GA4 ROAS" },
        ]
      : []),
  ];

  const cell = "min-w-0 truncate text-right font-mono text-[12.5px] tabular";
  const money = (v: number | null) => formatMoney(v, currency);
  const unit = (v: number | null) => formatMoney(v, currency, { unit: true });
  const show = (text: string) => (text === NO_VALUE ? <NoValue /> : text);

  return (
    <div className="overflow-x-auto">
      <div className={ga4 ? "min-w-[880px]" : "min-w-[680px]"} role="table">
        <div
          role="row"
          className={`grid ${cols} items-center gap-2 border-b border-hairline bg-gray-50 px-5 py-3`}
        >
          {heads.map((h, i) => (
            <span
              key={h.label}
              role="columnheader"
              className={`inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted ${
                i === 0 ? "justify-start" : "justify-end"
              }`}
            >
              {h.label}
              {"info" in h && h.info && <InfoTip text={h.info} label={`About ${h.label}`} />}
            </span>
          ))}
        </div>

        {rows.map((r) => {
          const roas = ratio(r.value, r.spend);
          const cpa = ratio(r.spend, r.purchases);
          const ga4Roas = ratio(r.ga4, r.spend);
          return (
            <div
              key={r.key}
              role="row"
              className={`grid ${cols} items-center gap-2 border-b border-hairline px-5 py-3 ${
                r.strong ? "bg-gray-50/60" : ""
              }`}
            >
              <span
                role="cell"
                className={`inline-flex min-w-0 items-center gap-2 text-[13px] ${
                  r.strong ? "font-semibold text-content-strong" : r.connected ? "text-content-strong" : "text-content-muted"
                }`}
              >
                {r.dot && <span aria-hidden="true" className={`h-[9px] w-[9px] flex-none rounded-[3px] ${r.dot}`} />}
                {r.label}
              </span>

              {!r.connected ? (
                <span
                  role="cell"
                  style={{ gridColumn: "2 / -1" }}
                  className="text-right font-mono text-[12.5px] text-content-muted"
                >
                  Not connected
                </span>
              ) : (
                <>
                  <span role="cell" className={`${cell} ${r.strong ? "font-semibold text-content-strong" : "text-content-strong"}`}>
                    {show(money(r.spend))}
                  </span>
                  <span role="cell" className={`${cell} text-content-body`}>{show(formatPercent(r.share))}</span>
                  <span role="cell" className={`${cell} text-content-strong`}>{show(formatNumber(r.purchases))}</span>
                  <span role="cell" className={`${cell} text-content-strong`}>{show(money(r.value))}</span>
                  <span role="cell" className={`${cell} text-content-strong`}>{show(formatRatio(roas))}</span>
                  <span role="cell" className={`${cell} text-content-strong`}>{show(unit(cpa))}</span>
                  {ga4 && (
                    <>
                      <span role="cell" className={`${cell} text-content-strong`}>{show(money(r.ga4))}</span>
                      <span role="cell" className={`${cell} text-content-strong`}>{show(formatRatio(ga4Roas))}</span>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
