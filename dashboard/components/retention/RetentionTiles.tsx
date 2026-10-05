/**
 * The headline tiles of the Repeat rate page: repeat and full-size rates at 90
 * and 180 days, each pooled over the last 6 months that are fully mature for
 * its horizon, and a count of customers still maturing.
 *
 * A tile reads: the rate, its change against the comparison window (neutral
 * unless the Newcombe range excludes zero), "k of n", the 95% range and the
 * window. Fewer than 30 customers shows n/a; 30 to 99 shows the value with a
 * low count marker.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE, formatNumber, formatPercent } from "@/lib/format";
import { RETENTION_TIPS } from "@/lib/metrics";
import type { Tile } from "@/lib/retention/model";
import { EntrantsDiff, RateDiff } from "@/components/retention/RateDiff";
import { ciText } from "@/components/retention/RateCell";

const CARD =
  "flex min-w-0 flex-col gap-[9px] rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm";
const LABEL = "flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted";

function tileLabel(t: Tile): string {
  return `${t.event === "repeat" ? "Repeat" : "Full size"}, ${t.horizon}d`;
}

function RateTile({ tile, accent, compareLabel }: { tile: Tile; accent: boolean; compareLabel: string }) {
  const { current, previous } = tile;
  const shown = current.state !== "few" && current.p !== null;
  return (
    <div className={CARD} data-tile={tile.key}>
      <span className={LABEL}>
        {tileLabel(tile)}
        <InfoTip text={tile.event === "repeat" ? RETENTION_TIPS.repeat(tile.horizon) : RETENTION_TIPS.fullSize(tile.horizon)} />
      </span>
      <span
        title={shown ? undefined : "Too few customers"}
        className={`font-mono text-[22px] font-semibold leading-none tracking-heading tabular ${
          shown ? (accent ? "text-growth-700" : "text-content-strong") : "text-content-muted"
        }`}
      >
        {shown ? formatPercent(current.p) : NO_VALUE}
        {shown && current.state === "low" && (
          <span title="Fewer than 100 customers" aria-label="Fewer than 100 customers" className="ml-1 align-top text-[13px] text-warning">
            •
          </span>
        )}
      </span>
      {shown && (
        <>
          <RateDiff current={current} previous={previous} diff={tile.diff} after={compareLabel} />
          <span className="font-mono text-[11.5px] tabular text-content-body">
            {formatNumber(current.k)} of {formatNumber(current.n)}
          </span>
          {current.ci && <span className="font-mono text-[11px] tabular text-content-muted">{ciText(current.ci)}</span>}
          <span className="font-mono text-[11px] text-content-muted">{tile.window.label}</span>
          {previous.n > 0 && <EntrantsDiff current={current.n} previous={previous.n} />}
        </>
      )}
    </div>
  );
}

export function RetentionTiles({
  tiles,
  maturing,
  vsLabel,
}: {
  tiles: Tile[];
  /** Customers of the selected entry not yet mature for 90 days. */
  maturing: number;
  /** "year earlier" or "prior 6 months", appended after the chip. */
  vsLabel: string;
}) {
  return (
    <section aria-label="Headline rates" className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
      {tiles.map((t, i) => (
        <RateTile key={t.key} tile={t} accent={i === 0} compareLabel={`vs ${vsLabel}`} />
      ))}
      <div className={CARD} data-tile="maturing">
        <span className={LABEL}>
          Maturing
          <InfoTip text={RETENTION_TIPS.maturing} />
        </span>
        <span className="font-mono text-[22px] font-semibold leading-none tracking-heading tabular text-content-strong">
          {formatNumber(maturing)}
        </span>
        <span className="font-mono text-[11.5px] text-content-body">customers</span>
      </div>
    </section>
  );
}
