/**
 * Small pieces the ledger cards share: a money figure with its currency code
 * set small, an n/a with the reason in its (i), and the colours of the split.
 *
 * The split has three parts and one stand-in. Our fees are ink (retainer) and
 * blue (profit share); what the client keeps is green; what is left before an
 * unknown profit share is the same green, hatched, because it is an upper
 * bound, not a figure the client keeps.
 */

import { InfoTip } from "@/components/ui/InfoTip";
import { MINUS, NO_VALUE, formatMoney } from "@/lib/format";
import type { Figure } from "@/lib/home/ledger/types";

export const PART = {
  retainer: "var(--h-mark)",
  profitShare: "var(--h-info)",
  keeps: "var(--h-positive)",
  negative: "var(--h-negative)",
  track: "var(--h-neutral-tint)",
} as const;

/** Hatched green: left after the retainer, before an unknown profit share. */
export const HATCH = `repeating-linear-gradient(135deg, var(--h-positive-tint) 0 4px, color-mix(in srgb, var(--h-positive) 38%, transparent) 4px 6px)`;

/** "CZK 245,000" as a figure with the code set small. */
export function Money({
  value,
  currency = "CZK",
  className = "",
  codeClassName = "text-[0.55em] font-semibold text-content-muted",
}: {
  value: number | null;
  currency?: string;
  className?: string;
  codeClassName?: string;
}) {
  const text = formatMoney(value, currency);
  if (text === NO_VALUE) return <span className={`${className} text-content-muted`}>{NO_VALUE}</span>;
  const m = text.match(new RegExp(`^(${MINUS}?)([A-Z]{3})[\\s\\u00a0]*(.+)$`));
  if (!m) return <span className={className}>{text}</span>;
  return (
    <span className={`tabular ${className}`}>
      <span className={`${codeClassName} mr-[0.25em] align-[0.12em]`}>{m[2]}</span>
      {m[1]}
      {m[3]}
    </span>
  );
}

/** n/a, muted, with the missing source in its (i). */
export function NotAvailable({ note, label, className = "" }: { note: string | null; label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-content-muted ${className}`}>
      {NO_VALUE}
      {note && (
        <span className="inline-flex text-[13px] font-normal leading-none tracking-normal">
          <InfoTip text={note} label={`Why ${label} is n/a`} />
        </span>
      )}
    </span>
  );
}

/** A figure, or n/a with its note. */
export function FigureText({
  figure,
  label,
  currency = "CZK",
  className = "",
}: {
  figure: Figure;
  label: string;
  currency?: string;
  className?: string;
}) {
  if (figure.value === null) return <NotAvailable note={figure.note} label={label} className={className} />;
  return (
    <span
      className={`tabular ${className}`}
      style={figure.value < 0 ? { color: "var(--h-negative-text)" } : undefined}
    >
      {formatMoney(figure.value, currency)}
    </span>
  );
}

export function Swatch({ color, hatch = false }: { color: string; hatch?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[9px] w-[9px] shrink-0 rounded-[3px]"
      style={{ background: hatch ? HATCH : color }}
    />
  );
}
