/**
 * The small, repeated pieces of the Creative Engine's surface.
 *
 * Server components throughout, none of them hold state, and keeping them off
 * the client boundary means a page of forty tiles ships no JavaScript for its
 * chrome.
 *
 * ── The formatting rules these encode ──────────────────────────────────────
 * Percentages are WHOLE NUMBERS everywhere except CTR, hook rate and hold rate,
 * where a decimal carries real signal at those magnitudes, the difference
 * between a 22.4% and a 19.8% hook rate is a decision, and "22%" against "20%"
 * hides it. ROAS always carries two decimals, because the whole product turns
 * on the gap between 1.80 and 2.50.
 */

import type { ReactNode } from "react";
import { formatMoney, NO_VALUE, isNoValue } from "@/lib/format";
import { NoData, NotConnected } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { CONFIDENCE_LABELS, type Confidence } from "@/lib/creative/stats";
import type { VerdictCode } from "@/lib/creative/verdict";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const roas = (v: number | null): string => (v === null ? NO_VALUE : v.toFixed(2));

/** Whole-number percent. The default everywhere. */
export const pct = (v: number | null): string =>
  v === null ? NO_VALUE : `${Math.round(v * 100)}%`;

/** One decimal. Only CTR, hook rate and hold rate. */
export const ratePct = (v: number | null): string =>
  v === null ? NO_VALUE : `${(v * 100).toFixed(1)}%`;

export const count = (v: number | null): string =>
  v === null ? NO_VALUE : Math.round(v).toLocaleString("en-US");

export const money = (v: number | null, currency: string): string =>
  formatMoney(v, currency);

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  read: "bg-accent-soft text-growth-700",
  directional: "bg-info/10 text-info",
  noise: "bg-gray-100 text-content-muted",
};

/**
 * How much weight this row's number can carry.
 *
 * Separate from the verdict on purpose: "Read" and "Kill" are two different
 * statements, and collapsing them into one chip would let a confident-looking
 * verdict borrow authority from a number that has none.
 */
export function ConfidenceChip({ level }: { level: Confidence }) {
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-pill px-3 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.08em] ${CONFIDENCE_STYLES[level]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {CONFIDENCE_LABELS[level]}
    </span>
  );
}

const VERDICT_STYLES: Record<VerdictCode, string> = {
  unjudged: "border border-dashed border-hairline-strong text-content-muted",
  scale: "bg-accent-soft text-growth-700",
  "aggressive-scale": "bg-accent-soft text-growth-700",
  hold: "bg-gray-100 text-content-muted",
  iterate: "bg-warning/10 text-warning",
  kill: "bg-negative/10 text-negative",
  "too-early": "bg-info/10 text-info",
  "data-missing": "bg-negative/10 text-negative",
  "needs-more-data": "border border-dashed border-hairline-strong text-content-muted",
  "not-separable": "border border-dashed border-hairline-strong text-content-muted",
};

export function VerdictChip({ code, label }: { code: VerdictCode; label: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-xs px-2 py-[3px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] ${VERDICT_STYLES[code]}`}
    >
      {label}
    </span>
  );
}

/** A tag value, or a dashed placeholder when nothing has been filed. */
export function Tag({
  value,
  missing,
  tone = "default",
}: {
  value: string | null;
  /** What to call the gap, e.g. "persona". */
  missing: string;
  tone?: "default" | "made";
}) {
  if (!value) {
    return (
      <span className="whitespace-nowrap rounded-pill border border-dashed border-hairline-strong px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-content-muted">
        {missing} ?
      </span>
    );
  }
  return (
    <span
      className={`whitespace-nowrap rounded-pill px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] ${
        tone === "made" ? "bg-info/10 text-info" : "bg-gray-100 text-content-body"
      }`}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Tile {
  label: string;
  value: string;
  sub?: string;
  /**
   * Period-over-period change, when a comparison range is selected. Only the
   * four delivery figures carry one, spend, ROAS, CPA and purchases have
   * enough events behind them to move for a reason. A "winners" count that went
   * from 1 to 2 is not up 100%.
   */
  delta?: number | null;
  /** Which direction is good. Spend is neutral; CPA is good when it falls. */
  goodWhen?: GoodWhen;
}

/**
 * The same figures as a Scorecard, on one line.
 *
 * ── Why a screen would want this instead ───────────────────────────────────
 * Six tiles at 21px each is a screen's worth of chrome for six small integers,
 * and on Concepts it pushed the concept roster, the thing the page is for,
 * below the fold. None of these six is a headline: "3 of 18 angles in use" is
 * context you read once on the way past, not a number you come to the page to
 * check.
 *
 * So the label and the value sit on the same baseline, separated down the row,
 * and the row wraps. Nothing is lost but the boxes.
 */
export function StatLine({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="m-0 flex flex-wrap items-baseline gap-x-7 gap-y-2.5 border-y border-hairline py-3">
      {tiles.map((t) => (
        <div key={t.label} className="flex items-baseline gap-2">
          <dt className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
            {t.label}
          </dt>
          <dd
            className={`m-0 whitespace-nowrap font-mono text-[13.5px] font-medium tabular ${
              isNoValue(t.value) ? "text-content-muted" : "text-content-strong"
            }`}
          >
            {t.value}
          </dd>
          {t.sub && (
            <dd className="m-0 whitespace-nowrap text-[11.5px] text-content-muted">
              {t.sub}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/**
 * The scorecard strip.
 *
 * Symmetric by contract: eight tiles render 4 x 2, six render 3 x 2. A ragged
 * final row reads as a bug in a screen whose entire claim is that it is
 * careful with numbers.
 */
export function Scorecard({ tiles }: { tiles: Tile[] }) {
  const cols =
    tiles.length % 4 === 0
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : tiles.length % 3 === 0
        ? "sm:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className={`grid grid-cols-1 gap-3 ${cols}`}>
      {tiles.map((t) => (
        <div key={t.label} className="glass px-4 py-3.5">
          <div className="truncate font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
            {t.label}
          </div>
          {/* `whitespace-nowrap` is not decoration: a wrapped headline figure
              changes the tile's height and breaks the row's alignment, which
              makes the whole strip look accidental. */}
          <div
            className={`mt-1 whitespace-nowrap font-mono text-[21px] font-medium tracking-heading tabular ${
              isNoValue(t.value) ? "text-content-muted" : "text-content-strong"
            }`}
          >
            {t.value}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            {t.sub && (
              <span className="truncate text-[12px] text-content-muted">{t.sub}</span>
            )}
            {t.delta !== undefined && t.delta !== null && (
              <DeltaChip delta={t.delta} goodWhen={t.goodWhen ?? "up"} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A section head inside a screen.
 *
 * ── Why this is an h3 at 16px and not an h2 at 19 ──────────────────────────
 * The design has two heading levels and they carry different jobs: the screen's
 * own name, Concepts, Breakdown, and the sections within it. The screen's
 * name is set by the app shell's sticky header, so everything reaching this
 * component is the second level, and rendering it a couple of points under the
 * page title is what makes a screen read as one thing with parts rather than a
 * stack of equal blocks. It was an h2 at 19px, which flattened the two.
 */
export function SectionHead({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3.5 mt-1 flex flex-wrap items-baseline gap-3.5">
      <h3 className="m-0 text-[16px] font-semibold tracking-heading text-content-strong">
        {title}
      </h3>
      {eyebrow && (
        <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
          {eyebrow}
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * A spend bar, coloured by where the row sits against the two lines.
 *
 * Grey when the row cannot be read: colouring a two-purchase row green would be
 * the single most misleading pixel in the product.
 */
export function SpendBar({
  fraction,
  tone,
}: {
  fraction: number;
  tone: "accent" | "negative" | "neutral" | "muted";
}) {
  const fill =
    tone === "accent"
      ? "bg-accent"
      : tone === "negative"
        ? "bg-negative"
        : tone === "neutral"
          ? "bg-content-muted"
          : "bg-gray-200";
  return (
    <div className="h-[5px] min-w-[40px] overflow-hidden rounded-xs bg-gray-100">
      <div
        className={`h-full rounded-xs ${fill}`}
        style={{ width: `${Math.max(1, Math.min(100, fraction * 100)).toFixed(1)}%` }}
      />
    </div>
  );
}

/**
 * Deprecated wrapper around the shared empty states (components/ui/EmptyState).
 *
 * `object` set (a creative object is missing) renders "Creative data not connected.";
 * no `object` (connected, nothing in the window) renders "No data in this
 * range.". `what` and `hint` are ignored: empty states are one line. WP7
 * replaces the call sites with `NotConnected` / `NoData` directly.
 */
export function NotIngested({
  object,
}: {
  what?: string;
  object?: string | null;
  hint?: string;
}) {
  return object ? <NotConnected source="Creative data" /> : <NoData />;
}

/** Shown when a client has no kill line, target ROAS or CPA on file. `clientName` is ignored. */
export function ThresholdsMissing(_props: { clientName?: string }) {
  return <Notice tone="warning">No verdicts. Set thresholds in Settings.</Notice>;
}
