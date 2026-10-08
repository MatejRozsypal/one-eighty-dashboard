/**
 * How the Velocity screens print their figures. Pure, so the Plan calculator
 * (a client component) and the server pages print the same thing.
 */

import { formatNumber, formatPercent, formatRatio, NO_VALUE } from "@/lib/format";

/** New ads, verdicts, packs a month: one decimal ("7.5"). */
export const perMonth = (v: number | null): string => formatNumber(v, { decimals: 1 });

/** Whole days ("16 days"). */
export const days = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? NO_VALUE : `${Math.round(v)} days`;

/** Shares with one decimal ("28.9%"). */
export const share = (v: number | null): string => formatPercent(v, { decimals: 1 });

/** Production against capacity ("0.40×"). */
export const times = (v: number | null): string => formatRatio(v);

/** Whole counts. */
export const whole = (v: number | null): string => formatNumber(v);
