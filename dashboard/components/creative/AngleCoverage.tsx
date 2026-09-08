/**
 * Angle coverage — all eighteen, whether or not they have ever run.
 *
 * ── Why the unused ones are the point ──────────────────────────────────────
 * A grid of only the angles already tested can tell you which of your habits
 * worked. It cannot tell you what you have never tried, and at a 1.5% net-new
 * hit rate the unexplored half of the vocabulary is where the next winner is.
 * That is why the list comes from `lib/creative/vocabulary.ts` rather than from
 * a DISTINCT over spend: a vocabulary derived from usage can only ever describe
 * what you already did.
 */

import { ANGLES } from "@/lib/creative/vocabulary";
import { pct } from "@/components/creative/primitives";
import { formatMoney } from "@/lib/format";

export function AngleCoverage({
  spendByAngle,
  totalSpend,
  currency,
}: {
  spendByAngle: Map<string, number>;
  totalSpend: number;
  currency: string;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
      {ANGLES.map((angle) => {
        const spend = spendByAngle.get(angle) ?? 0;
        const used = spend > 0;
        return (
          <div
            key={angle}
            className={
              used
                ? "glass flex min-h-[78px] flex-col gap-1.5 rounded-xl px-3 py-2.5"
                : "flex min-h-[78px] flex-col gap-1.5 rounded-xl border border-dashed border-hairline-strong bg-paper/25 px-3 py-2.5"
            }
          >
            <span
              className={`text-[12.5px] leading-[1.3] ${
                used ? "font-medium text-content-strong" : "text-content-muted"
              }`}
            >
              {angle}
            </span>
            <span className="mt-auto flex items-baseline gap-2">
              {used ? (
                <>
                  <span className="font-mono text-[13px] tabular text-content-strong">
                    {formatMoney(spend, currency, { compact: true })}
                  </span>
                  <span className="font-mono text-[11px] text-content-muted">
                    {pct(totalSpend > 0 ? spend / totalSpend : 0)}
                  </span>
                </>
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-content-muted">
                  never run
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
