/**
 * Badge / pill.
 *
 * Ported from `components/labels/Badge.jsx`. Used for status ("LIVE"), deltas,
 * and — the reason it earns its place here — platform tags. Every metric card
 * carries a badge naming the system the number came from, so you can tell at a
 * glance whether a figure is Shopify's truth or Meta's.
 *
 * The `live` variant's pulsing dot is a signature brand motion. It's driven by
 * the `live-pulse` keyframes in tailwind.config.ts and respects the global
 * reduced-motion override in globals.css.
 */

import type { ReactNode } from "react";

type Variant =
  | "neutral"
  | "accent"
  | "live"
  | "positive"
  | "negative"
  | "inverse"
  | "outline";

const VARIANTS: Record<Variant, { pill: string; dot: string }> = {
  neutral: { pill: "bg-gray-100 text-content-body border-transparent", dot: "bg-gray-400" },
  accent: { pill: "bg-accent-soft text-growth-700 border-transparent", dot: "bg-accent" },
  live: { pill: "bg-growth-500/[0.12] text-growth-700 border-transparent", dot: "bg-accent" },
  positive: { pill: "bg-growth-50 text-growth-700 border-transparent", dot: "bg-positive" },
  negative: { pill: "bg-negative/10 text-negative border-transparent", dot: "bg-negative" },
  inverse: {
    pill: "bg-white/10 text-content-inverse border-white/[0.14]",
    dot: "bg-accent",
  },
  outline: { pill: "bg-transparent text-content-body border-hairline-strong", dot: "bg-gray-400" },
};

export interface BadgeProps {
  variant?: Variant;
  size?: "sm" | "md";
  /** Leading status dot. Always on for `live`. */
  dot?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Badge({
  variant = "neutral",
  size = "md",
  dot = false,
  className = "",
  children,
}: BadgeProps) {
  const palette = VARIANTS[variant];
  const isLive = variant === "live";
  const showDot = dot || isLive;

  return (
    <span
      className={[
        "inline-flex items-center rounded-pill border font-mono font-medium uppercase leading-none tracking-[0.04em] whitespace-nowrap",
        size === "sm" ? "gap-1.5 px-[9px] py-[3px] text-[11px]" : "gap-[7px] px-3 py-[5px] text-[12px]",
        palette.pill,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={`relative inline-block h-[7px] w-[7px] rounded-full ${palette.dot}`}
        >
          {isLive && (
            <span className="absolute -inset-[3px] animate-live-pulse rounded-full border border-accent opacity-50" />
          )}
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * Platform tag — the source-of-truth badge on every metric card.
 *
 * Deliberately monochrome-with-a-dot rather than a fully colored pill: the brand
 * is monochrome plus one green, and a grid of eight differently-colored pills
 * would fight the numbers for attention. The dot carries the platform color, the
 * pill stays neutral.
 */
const PLATFORM_DOTS: Record<string, string> = {
  shopify: "bg-platform-shopify",
  shoptet: "bg-platform-shoptet",
  meta: "bg-platform-meta",
  google: "bg-platform-google",
  klaviyo: "bg-platform-klaviyo",
  ecomail: "bg-platform-ecomail",
};

export function PlatformBadge({
  platform,
  className = "",
}: {
  platform: string;
  className?: string;
}) {
  const dot = PLATFORM_DOTS[platform.toLowerCase()] ?? "bg-gray-400";

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface-card px-[9px] py-[3px] font-mono text-[11px] font-medium uppercase leading-none tracking-[0.04em] text-content-muted whitespace-nowrap",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className={`h-[6px] w-[6px] rounded-full ${dot}`} />
      {platform}
    </span>
  );
}
