/**
 * Eyebrow — the small mono, wide-tracked label above a section heading.
 * Ported from `components/labels/Eyebrow.jsx`.
 */

import type { ReactNode } from "react";

const TONES = {
  muted: "text-content-muted",
  accent: "text-content-accent",
  inverse: "text-content-inverse-muted",
} as const;

export function Eyebrow({
  children,
  dot = false,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  dot?: boolean;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 font-mono text-eyebrow font-medium uppercase tracking-eyebrow",
        TONES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
      {children}
    </span>
  );
}
