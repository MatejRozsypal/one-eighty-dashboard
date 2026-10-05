/**
 * Creative hit rate on the Meta tab: one small tile after the KPI rows.
 *
 * The same figure the Creatives screen shows for the same range, said by the
 * same function (`tileText`), so the two cannot drift. The figure links to
 * Creatives with the client and range carried over, or to Settings when there
 * are no thresholds to judge a winner against.
 *
 * Not ready, no thresholds and no launches all read as n/a with one line. None
 * of them reads as 0%: a zero is a claim about the account.
 *
 * Built on its own markup rather than the shared KpiTile, which has no sub line.
 * The (i) sits outside the link: a control inside a link is not valid markup.
 */

import { AppLink } from "@/components/ui/AppLink";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import type { TileText } from "@/lib/creative/hitRate";

export function HitRateTile({
  text,
  href,
  needsThresholds,
}: {
  text: TileText;
  /** The Creatives screen for the same client and range. */
  href: string;
  /** True when the only missing piece is Settings: the tile then links there. */
  needsThresholds: boolean;
}) {
  const missing = text.value === null;
  return (
    <div className="flex min-w-0 max-w-[280px] flex-col gap-2 rounded-card border border-hairline bg-surface-card p-[13px_15px] shadow-sm">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
        Creative hit rate
        <InfoTip text={text.info} label="About Creative hit rate" />
      </span>
      <AppLink
        href={needsThresholds ? "/settings" : href}
        className="flex flex-col gap-2 hover:opacity-80"
      >
        <span
          className={`font-mono text-[18px] font-semibold leading-none tracking-heading tabular ${
            missing ? "text-content-muted" : "text-content-strong"
          }`}
        >
          {text.value ?? NO_VALUE}
        </span>
        <span className="text-[12px] text-content-muted">{text.sub}</span>
      </AppLink>
    </div>
  );
}
