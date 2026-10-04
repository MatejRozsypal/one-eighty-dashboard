/**
 * A titled card on the Overview. The heading is one to three words; anything
 * longer belongs in the (i) tooltip beside it (`info`, at most 40 words).
 * `flush` removes the body padding for tables that carry their own.
 */

import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { InfoTip } from "@/components/ui/InfoTip";

export function Section({
  title,
  info,
  flush = false,
  children,
}: {
  title: string;
  info?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-card border border-hairline bg-surface-card shadow-sm">
      <div className="flex items-center gap-1.5 px-5 pb-1 pt-[18px] lg:px-[26px]">
        <Eyebrow>{title}</Eyebrow>
        {info && <InfoTip text={info} label={`About ${title}`} />}
      </div>
      <div className={flush ? "pt-3" : "px-5 pb-5 pt-3 lg:px-[26px]"}>{children}</div>
    </section>
  );
}
