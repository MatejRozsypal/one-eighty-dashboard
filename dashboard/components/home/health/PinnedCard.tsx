/**
 * One pinned client, as Health's Activity card: the figures on the left in
 * the colours of their rings, the rings on the right.
 *
 * With a Goals plan: outer revenue, middle CM3, inner aMER, each actual to
 * date over the plan to date. Without one: a single neutral ring of revenue
 * month to date over the same days last year, with CM3 and aMER month to date
 * listed beneath it in their own colours and no ring, since there is nothing
 * to close them against.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import { shortDay } from "@/lib/home/health/series";
import type { PinnedCard as Card, RingFigure } from "@/lib/home/health/types";
import { ActivityRings, RingsGlyph } from "./ActivityRings";
import { Chevron } from "./Icons";
import { family, type Family } from "./palette";

function Figure({ f, ringFamily, small = false }: { f: RingFigure; ringFamily: Family; small?: boolean }) {
  const colour = family(ringFamily);
  const missing = f.actualText === NO_VALUE;
  return (
    <div className="flex min-w-0 flex-col">
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold leading-[1.25] text-content-strong">
        {f.label}
        {f.note && <InfoTip text={f.note} label={`About ${f.label}`} />}
      </span>
      <span
        className={`${small ? "text-[17px]" : "text-[21px]"} font-bold leading-[1.15] tracking-heading tabular`}
        style={{ color: missing ? "var(--text-muted)" : colour.text }}
      >
        {f.actualText}
        {f.targetText && (
          <span className={`${small ? "text-[13px]" : "text-[15px]"} font-semibold`}>/{f.targetText}</span>
        )}
      </span>
      <span className="truncate text-[12px] leading-[1.35] text-content-muted">{f.caption}</span>
    </div>
  );
}

const PLAN_FAMILIES: Family[] = ["revenue", "cm3", "amer"];

export function PinnedCard({ card }: { card: Card }) {
  const plan = card.mode === "plan";
  const ringFamilies: Family[] = plan ? PLAN_FAMILIES : ["neutral"];
  const title = plan ? family("revenue").text : "var(--text-strong)";
  const description = plan
    ? card.rings.map((r) => `${r.label} ${r.actualText}${r.targetText ? ` of ${r.targetText} plan to date` : ""}`).join(", ")
    : `Revenue ${card.rings[0]?.actualText ?? NO_VALUE} against ${card.rings[0]?.targetText ?? NO_VALUE} on the same days last year`;

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface-card p-4 shadow-sm sm:p-[18px]">
      <AppLink
        href={card.href}
        className="group flex min-w-0 items-center gap-2 rounded-md outline-offset-4"
        aria-label={`${card.name}, open Goals`}
      >
        <RingsGlyph families={ringFamilies} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[1.3]" style={{ color: title }}>
          {card.name}
        </span>
        {card.asOf && <span className="flex-none text-[13px] text-content-muted">{shortDay(card.asOf)}</span>}
        <Chevron className="text-content-muted transition-transform duration-fast group-hover:translate-x-0.5" />
      </AppLink>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2.5">
          {card.rings.map((f, i) => (
            <Figure key={f.metric} f={f} ringFamily={ringFamilies[i]} />
          ))}
        </div>
        <ActivityRings
          rings={card.rings.map((f, i) => ({ family: ringFamilies[i], fraction: f.fraction }))}
          size={plan ? 132 : 112}
        />
      </div>

      {card.extras.length > 0 && (
        <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3">
          {card.extras.map((f) => (
            <Figure key={f.metric} f={f} ringFamily={f.metric} small />
          ))}
        </div>
      )}
      <span className="sr-only">{description}</span>
    </article>
  );
}
