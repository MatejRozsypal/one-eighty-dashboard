/**
 * Recommendation cards: one rule, one client, one fact, one link. Ordered by
 * the money each puts at stake (lib/home/shopify/rules.ts), at most six.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { SectionTitle } from "@/components/plan/SectionTitle";
import { formatMoney } from "@/lib/format";
import { toneVars } from "@/lib/plan/health";
import type { Recommendation } from "@/lib/home/shopify/types";

const RULES_TIP =
  "Each card is one rule on warehouse or ClickUp data: behind plan, below last year, unmapped ads, over capacity, slow verdicts, briefs to write, missing cost data. Ordered by money at stake.";

function Card({ r }: { r: Recommendation }) {
  const tone = toneVars(r.tone);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-[18px] shadow-sm sm:p-5">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: tone.text }}>
        <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: tone.graphic }} />
        {r.rule}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 truncate text-[17px] font-semibold leading-[1.25] text-content-strong">{r.client}</h3>
        <p className="m-0 text-[14.5px] leading-[1.45] text-content-body">{r.fact}</p>
        {r.detail && <p className="m-0 text-[13px] leading-[1.4] text-content-muted tabular">{r.detail}</p>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3">
        {r.stake ? (
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] text-content-muted">{r.stake.label}</span>
            <span className="text-[19px] font-bold leading-[1.2] tracking-heading tabular text-content-strong">
              {formatMoney(r.stake.value, r.stake.currency)}
            </span>
          </div>
        ) : (
          <span />
        )}
        <AppLink
          href={r.href}
          className="inline-flex flex-none items-center gap-1 rounded-full bg-bg-subtle px-3 py-1.5 text-[13px] font-semibold text-content-strong hover:bg-gray-150"
        >
          {r.action}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </AppLink>
      </div>
    </article>
  );
}

export function Recommendations({ items }: { items: Recommendation[] }) {
  return (
    <section aria-label="For you" className="flex flex-col gap-3.5">
      <div className="flex items-center gap-1.5">
        <SectionTitle>For you</SectionTitle>
        <InfoTip text={RULES_TIP} label="About these cards" />
      </div>
      {items.length === 0 ? (
        <div className="rounded-card border border-hairline bg-surface-card px-5 py-6 text-center text-[14px] text-content-muted shadow-sm">
          Nothing flagged
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <Card key={r.id} r={r} />
          ))}
        </div>
      )}
    </section>
  );
}
