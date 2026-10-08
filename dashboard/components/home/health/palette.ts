/**
 * Apple Health's palette, one colour family per metric category, tuned for the
 * dashboard's white ground. Declared once as custom properties on the page
 * root (`SUMMARY_VARS`), so every component below reads a token, never a hex.
 *
 *   revenue   Activity "Move" red        ring #FA114F (4.0:1), text #E5003F (4.8:1)
 *   cm3       Activity "Exercise" green  ring #2E9C12 (3.6:1), text #24800B (5.0:1)
 *   amer      Activity "Stand" cyan      ring #0098B8 (3.4:1), text #007C99 (4.8:1)
 *   creative  Health "Sleep" indigo      #5E5CE6 (5.1:1)
 *   money     Health "Body" purple       ring #AF52DE (4.1:1), text #9A3CC8 (5.5:1)
 *   neutral   no plan to measure against #8E8E93 (3.3:1), text #6C6C70 (5.2:1)
 *
 * Contrast against white. Ring steps meet 3:1 (graphics), text steps 4.5:1.
 * Apple's own lime and cyan are 1.6:1 on white and cannot carry a figure, so
 * the greens and cyans are the darker steps of the same hue.
 */

import type { CSSProperties } from "react";
import type { MetricKey } from "@/lib/home/health/types";

export type Family = MetricKey | "money" | "neutral";

const HEX: Record<Family, { graphic: string; text: string; tint: string }> = {
  revenue: { graphic: "#FA114F", text: "#E5003F", tint: "#FDE1E9" },
  cm3: { graphic: "#2E9C12", text: "#24800B", tint: "#E1F2DA" },
  amer: { graphic: "#0098B8", text: "#007C99", tint: "#D5EFF5" },
  creative: { graphic: "#5E5CE6", text: "#5E5CE6", tint: "#E6E6FB" },
  money: { graphic: "#AF52DE", text: "#9A3CC8", tint: "#F3E6FA" },
  neutral: { graphic: "#8E8E93", text: "#6C6C70", tint: "#EBEBED" },
};

/** The custom properties, set on the page root. */
export const SUMMARY_VARS = Object.fromEntries(
  Object.entries(HEX).flatMap(([family, c]) => [
    [`--sm-${family}`, c.graphic],
    [`--sm-${family}-text`, c.text],
    [`--sm-${family}-tint`, c.tint],
  ])
) as CSSProperties;

export function family(f: Family): { graphic: string; text: string; tint: string } {
  return { graphic: `var(--sm-${f})`, text: `var(--sm-${f}-text)`, tint: `var(--sm-${f}-tint)` };
}
