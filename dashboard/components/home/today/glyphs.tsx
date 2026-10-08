/**
 * Small marks for the Today list: the urgency glyph, the check circle, the
 * day's progress ring and the arrows. Pure SVG, decorative unless labelled.
 */

import type { Urgency } from "@/lib/home/today/types";

export const URGENCY_LABEL: Record<Urgency, string> = {
  0: "Overdue or critical",
  1: "Today",
  2: "This week",
};

/** Linear-style priority: a red badge for overdue or critical, bars for the rest. */
export function UrgencyGlyph({ urgency }: { urgency: Urgency }) {
  if (urgency === 0) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={URGENCY_LABEL[0]} className="flex-none">
        <title>{URGENCY_LABEL[0]}</title>
        <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--h-negative)" />
        <path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.3" r="1.05" fill="#fff" />
      </svg>
    );
  }
  const filled = urgency === 1 ? 3 : 2;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={URGENCY_LABEL[urgency]} className="flex-none">
      <title>{URGENCY_LABEL[urgency]}</title>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 4.5}
          y={10 - i * 3}
          width="3"
          height={4 + i * 3}
          rx="1"
          fill={i < filled ? "var(--text-strong)" : "var(--gray-200)"}
        />
      ))}
    </svg>
  );
}

/** The round check of Things: empty ring, filled with a tick when done. */
export function CheckCircle({ done }: { done: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="block">
      <circle
        cx="11"
        cy="11"
        r="9.25"
        fill={done ? "var(--h-positive)" : "transparent"}
        stroke={done ? "var(--h-positive)" : "var(--gray-250)"}
        strokeWidth="1.5"
        className="transition-[fill,stroke] duration-fast"
      />
      {done && (
        <path
          d="M6.6 11.3l2.9 2.9 5.9-6.2"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="origin-center animate-tick"
        />
      )}
    </svg>
  );
}

/** Today's list as one rotation: the ring closes when every item is done. */
export function DayRing({ done, total, size = 26 }: { done: number; total: number; size?: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, done / total) : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className="flex-none">
      <circle cx="13" cy="13" r={r} fill="none" stroke="var(--h-positive-tint)" strokeWidth="4" />
      {share > 0 && (
        <circle
          cx="13"
          cy="13"
          r={r}
          fill="none"
          stroke="var(--h-positive)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${share * c} ${c}`}
          transform="rotate(-90 13 13)"
          className="transition-[stroke-dasharray] duration-slow ease-out"
        />
      )}
    </svg>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`flex-none transition-transform duration-fast ${open ? "rotate-90" : ""}`}
    >
      <path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Arrow({ external }: { external: boolean }) {
  return external ? (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
      <path d="M4 2.5h5.5V8M9.5 2.5L3 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
      <path d="M2.5 6h7M6.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
