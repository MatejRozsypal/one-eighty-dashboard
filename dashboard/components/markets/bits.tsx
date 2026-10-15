"use client";

/**
 * Small pieces every Markets widget shares: the n/a glyph with its reason,
 * the verdict chip and the maturity badge.
 */

import { Badge } from "@/components/ui/Badge";
import { InfoTip } from "@/components/ui/InfoTip";
import { NO_VALUE } from "@/lib/format";
import type { Maturity, Verdict } from "@/lib/markets/model";
import { VERDICT_BADGE } from "@/lib/markets/display";

/** "n/a", muted, with the reason one tap away. */
export function NaValue({ reason, className = "" }: { reason: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-content-muted ${className}`}>
      <span>{NO_VALUE}</span>
      <InfoTip text={reason} label="Why n/a" />
    </span>
  );
}

export function VerdictChip({
  verdict,
  maturity,
  maturityWhy,
  size = "sm",
}: {
  verdict: Verdict;
  maturity: Maturity;
  maturityWhy?: string;
  size?: "sm" | "md";
}) {
  const style = VERDICT_BADGE[verdict.key];
  const dim = maturity === "Directional";
  const tip = [
    verdict.why,
    verdict.onCm1 ? "Rules run on CM1 while CM2 needs rate cards." : "",
    dim && maturityWhy ? `Directional: ${maturityWhy.toLowerCase()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className="inline-flex items-center gap-1">
      {/* Directional is said by the badge beside the chip, not by fading it: a faded chip fails contrast. */}
      <Badge variant={style.variant} size={size} className={style.className}>
        {verdict.label}
        {verdict.onCm1 && <span className="normal-case tracking-normal opacity-75">on CM1</span>}
      </Badge>
      <InfoTip text={tip} label={`Why ${verdict.label}`} />
    </span>
  );
}

export function MaturityBadge({ level, why }: { level: Maturity; why?: string }) {
  if (level === "Established") return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" size="sm">
        {level}
      </Badge>
      {why ? <InfoTip text={why} label={`Why ${level.toLowerCase()}`} /> : null}
    </span>
  );
}
