/**
 * One highlight: the category in its colour, the generated sentence, the
 * small chart it was built from. The (i) names the source and the rule.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { shortDay } from "@/lib/home/health/series";
import type { Highlight } from "@/lib/home/health/types";
import { CategoryIcon, Chevron } from "./Icons";
import { MiniChart } from "./MiniCharts";
import { family } from "./palette";

export function HighlightCard({ h }: { h: Highlight }) {
  const colour = family(h.metric);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-4 shadow-sm sm:p-[18px]">
      <div className="flex min-w-0 items-center gap-2">
        <CategoryIcon of={h.metric} />
        <span className="text-[15px] font-semibold leading-[1.3]" style={{ color: colour.text }}>
          {h.category}
        </span>
        <InfoTip text={h.source} label={`Source of this ${h.category} highlight`} />
        <AppLink
          href={h.href}
          className="group ml-auto inline-flex min-w-0 items-center gap-2 text-[13px] text-content-muted hover:text-content-strong"
          aria-label={`Open ${h.clientName}`}
        >
          <span className="truncate">{h.clientName}</span>
          {h.asOf && <span className="flex-none">{shortDay(h.asOf)}</span>}
          <Chevron className="transition-transform duration-fast group-hover:translate-x-0.5" />
        </AppLink>
      </div>
      <p className="m-0 text-[17px] font-semibold leading-[1.32] tracking-[-0.01em] text-content-strong">{h.sentence}</p>
      <div className="mt-auto pt-1">
        <MiniChart chart={h.chart} of={h.metric} />
      </div>
      {h.caption && <span className="text-[12px] text-content-muted">{h.caption}</span>}
    </article>
  );
}
