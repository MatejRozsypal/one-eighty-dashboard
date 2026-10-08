/**
 * Line glyphs in the SF Symbols manner for the Forecast Home: the condition
 * a status reads as (sun on plan, cloud behind, rain off track), and the
 * small icons that head each tile. Decorative: every one is aria-hidden and
 * sits next to the word it stands for.
 */

import type { HealthTone } from "@/lib/plan/health";

export type Condition = "sun" | "partly" | "cloud" | "rain" | "none";

/** The condition a Goals status tone reads as. Neutral (no plan, no target) has none. */
export function conditionOf(tone: HealthTone): Condition {
  switch (tone) {
    case "positive":
    case "info":
      return "sun";
    case "warning":
      return "partly";
    case "negative":
      return "rain";
    default:
      return "none";
  }
}

const BASE = {
  viewBox: "0 0 32 32",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ConditionGlyph({
  condition,
  size = 22,
  sunFill,
  className = "",
}: {
  condition: Condition;
  size?: number;
  /** Fill for the sun's disc (the strip paints it yellow on the sky). */
  sunFill?: string;
  className?: string;
}) {
  const props = { ...BASE, width: size, height: size, className: `flex-none ${className}` };
  if (condition === "sun")
    return (
      <svg {...props}>
        <circle cx="16" cy="16" r="5.5" fill={sunFill ?? "none"} />
        <path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M7.2 24.8l2.1-2.1M22.7 9.3l2.1-2.1" />
      </svg>
    );
  if (condition === "partly")
    return (
      <svg {...props}>
        <path d="M12 4.5v2M5 11.5h2M7.1 6.6l1.4 1.4M16.9 6.6l-1.4 1.4M8.6 14a3.6 3.6 0 0 1 6.9-1.8" fill={sunFill ?? "none"} />
        <path d="M11 26h12.2a4.6 4.6 0 0 0 .5-9.1 6.4 6.4 0 0 0-12.4 1 4 4 0 0 0-.3 8.1z" />
      </svg>
    );
  if (condition === "cloud")
    return (
      <svg {...props}>
        <path d="M10 24h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 15.2 4.5 4.5 0 0 0 10 24z" />
      </svg>
    );
  if (condition === "rain")
    return (
      <svg {...props}>
        <path d="M10 19.5h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 10.7 4.5 4.5 0 0 0 10 19.5z" />
        <path d="M12 23l-1.5 4M17 23l-1.5 4M22 23l-1.5 4" />
      </svg>
    );
  return (
    <svg {...props}>
      <path d="M11 16h10" />
    </svg>
  );
}

export type TileIcon = "gauge" | "stack" | "link" | "refresh" | "banknote" | "tray" | "calendar" | "list";

export function TileGlyph({ icon, size = 14 }: { icon: TileIcon; size?: number }) {
  const props = { ...BASE, strokeWidth: 2.6, width: size, height: size, className: "flex-none" };
  switch (icon) {
    case "gauge":
      return (
        <svg {...props}>
          <path d="M5 22a11 11 0 1 1 22 0" />
          <path d="M16 22l5-7" />
        </svg>
      );
    case "stack":
      return (
        <svg {...props}>
          <path d="M16 5l11 6-11 6-11-6z" />
          <path d="M5 17l11 6 11-6" />
        </svg>
      );
    case "link":
      return (
        <svg {...props}>
          <path d="M13 19l-2.5 2.5a4.6 4.6 0 0 1-6.5-6.5L6.5 12.5" />
          <path d="M19 13l2.5-2.5a4.6 4.6 0 0 1 6.5 6.5l-2.5 2.5" transform="translate(-3 2)" />
          <path d="M20 4l-1.5 4M27 11l-4 1.5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...props}>
          <path d="M26 10a11 11 0 0 0-19-1.5M6 22a11 11 0 0 0 19 1.5" />
          <path d="M26 4v6h-6M6 28v-6h6" />
        </svg>
      );
    case "banknote":
      return (
        <svg {...props}>
          <rect x="4" y="9" width="24" height="14" rx="3" />
          <circle cx="16" cy="16" r="3" />
        </svg>
      );
    case "tray":
      return (
        <svg {...props}>
          <path d="M4 18l4-11h16l4 11v7H4z" />
          <path d="M4 18h7a5 5 0 0 0 10 0h7" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props}>
          <rect x="5" y="7" width="22" height="20" rx="3" />
          <path d="M5 13h22M11 4v5M21 4v5" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <path d="M6 9h20M6 16h20M6 23h20" />
        </svg>
      );
  }
}
