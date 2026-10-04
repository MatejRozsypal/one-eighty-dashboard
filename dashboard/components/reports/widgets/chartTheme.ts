/**
 * Chart styling shared by the report widgets. Tokens only: every colour is a
 * CSS variable, resolved by the browser, so no hex literal lives in a widget.
 *
 * Imports nothing from recharts (KPI, ranked and table use it too and must not
 * pull the charting bundle in).
 *
 * Series colours are slots `--series-1` to `--series-6` (styles/tokens/colors.css).
 * A client keeps its slot in every widget. Past six series in one widget the
 * slot repeats and a dash pattern tells the repeats apart.
 *
 * Owner: RS7 (widgets). Design: 11_reporting_suite_design.md 1.13.
 */

import { SERIES_SLOTS } from "@/lib/reports/limits";

function wrapSlot(slot: number): number {
  return ((Math.trunc(slot) % SERIES_SLOTS) + SERIES_SLOTS) % SERIES_SLOTS;
}

/** `var(--series-N)` for a slot (any integer; wraps at six). */
export function seriesColor(slot: number): string {
  return `var(--series-${wrapSlot(slot) + 1})`;
}

/** Dash patterns for the 2nd, 3rd, ... use of the same slot. The first use is solid. */
const REPEAT_DASHES: ReadonlyArray<string | undefined> = [undefined, "7 3", "2 3", "8 3 2 3"];

export interface SeriesStyle {
  color: string;
  /** SVG strokeDasharray; undefined is solid. */
  dash: string | undefined;
}

/** Style per series, in order. The n-th series sharing a slot gets the n-th dash pattern. */
export function assignSeriesStyles(series: ReadonlyArray<{ slot: number }>): SeriesStyle[] {
  const uses = new Map<number, number>();
  return series.map((s) => {
    const slot = wrapSlot(s.slot);
    const n = uses.get(slot) ?? 0;
    uses.set(slot, n + 1);
    return { color: seriesColor(slot), dash: REPEAT_DASHES[n % REPEAT_DASHES.length] };
  });
}

/** Industry benchmark: grey, dashed, thinner than a data line. */
export const BENCHMARK = {
  stroke: "var(--benchmark)",
  dash: "4 4",
  width: 1.5,
  /** Opacity of a stale benchmark. */
  staleOpacity: 0.5,
} as const;

/** The comparison period: same colour, thin, dotted, fainter. */
export const COMPARE = { dash: "2 4", width: 1.5, opacity: 0.6 } as const;

export const LINE_WIDTH = 2;
/** Markers are at least 8px across; dots are shown up to this many points. */
export const DOT_RADIUS = 4;
export const MAX_DOTS = 14;
/** Series up to this count get a direct end label; the legend is always there. */
export const MAX_DIRECT_LABELS = 4;

/** Rounded data end of a bar (4px), anchored to the baseline. */
export const BAR_RADIUS = 4;
/** Gap between stacked segments and the ring around overlapping marks. */
export const SURFACE_GAP = 2;

export const SURFACE = "var(--surface-card)";
export const GRID_STROKE = "var(--border)";
export const MUTED_FILL = "var(--gray-100)";
export const TEXT_MUTED = "var(--text-muted)";
export const TEXT_STRONG = "var(--text-strong)";
export const HATCH_STROKE = "var(--gray-250)";

export const AXIS_TICK = {
  fontSize: 10.5,
  fill: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
} as const;

/**
 * Width of one character of an axis label (10.5px mono is 0.6em wide). Axis
 * and margin sizes come from the labels they hold, not from a guess, so a
 * longer currency prefix or a wider number never loses its first character.
 */
export const AXIS_CHAR_PX = 6.4;

/** Pixels the text needs. */
export function textWidth(text: string): number {
  return Math.ceil(text.length * AXIS_CHAR_PX);
}

/** Width of a value axis that has to show `labels`: the widest label plus the tick gap. */
export function axisWidth(labels: readonly string[], min = 36, max = 120): number {
  const widest = labels.reduce((m, l) => Math.max(m, textWidth(l)), 0);
  return Math.min(max, Math.max(min, widest + 12));
}

/** Right margin that keeps the last tick label, centred on the plot edge, inside the card. */
export function edgeMargin(labels: readonly string[], min = 20): number {
  const widest = labels.reduce((m, l) => Math.max(m, textWidth(l)), 0);
  return Math.max(min, Math.ceil(widest / 2) + 6);
}

/** `text` cut to `max` characters with "..." (the full text goes in a hover title). */
export function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

/** The labels an axis over [lo, hi] is likely to print: both ends, zero and one tick of headroom. */
export function axisProbe(lo: number, hi: number): number[] {
  const span = Math.max(Math.abs(lo), Math.abs(hi));
  return [lo, hi, 0, hi + span * 0.15, lo - span * 0.15];
}

/** Chart margins: the labelled one leaves room for a direct end label. */
export const MARGIN = { top: 8, right: 20, bottom: 0, left: 4 } as const;
export const MARGIN_LABELLED = { top: 8, right: 56, bottom: 0, left: 4 } as const;

/** Class of the card behind a chart tooltip. */
export const TOOLTIP_CLASS =
  "min-w-[170px] max-w-[280px] rounded-md border border-hairline bg-surface-card p-[10px_12px] font-mono text-[11.5px] shadow-lg";

/** Class of the status text beside an "n/a". */
export const STATUS_CLASS = "font-mono text-[11px] text-content-muted";
