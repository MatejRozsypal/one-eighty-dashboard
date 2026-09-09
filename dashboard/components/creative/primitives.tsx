/**
 * The small, repeated pieces of the Creative Engine's surface.
 *
 * Server components throughout — none of them hold state, and keeping them off
 * the client boundary means a page of forty tiles ships no JavaScript for its
 * chrome.
 *
 * ── The formatting rules these encode ──────────────────────────────────────
 * Percentages are WHOLE NUMBERS everywhere except CTR, hook rate and hold rate,
 * where a decimal carries real signal at those magnitudes — the difference
 * between a 22.4% and a 19.8% hook rate is a decision, and "22%" against "20%"
 * hides it. ROAS always carries two decimals, because the whole product turns
 * on the gap between 1.80 and 2.50.
 */

import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import { CONFIDENCE_LABELS, type Confidence } from "@/lib/creative/stats";
import type { VerdictCode } from "@/lib/creative/verdict";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export const roas = (v: number | null): string => (v === null ? "—" : v.toFixed(2));

/** Whole-number percent. The default everywhere. */
export const pct = (v: number | null): string =>
  v === null ? "—" : `${Math.round(v * 100)}%`;

/** One decimal. Only CTR, hook rate and hold rate. */
export const ratePct = (v: number | null): string =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;

export const count = (v: number | null): string =>
  v === null ? "—" : Math.round(v).toLocaleString("en-US");

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
   * four delivery figures carry one — spend, ROAS, CPA and purchases have
   * enough events behind them to move for a reason. A "winners" count that went
   * from 1 to 2 is not up 100%.
   */
  delta?: number | null;
  /** Which direction is good. Spend is neutral; CPA is good when it falls. */
  goodWhen?: GoodWhen;
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
          <div className="mt-1 whitespace-nowrap font-mono text-[21px] font-medium tracking-heading tabular text-content-strong">
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
 * own name — Concepts, Breakdown — and the sections within it. The screen's
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
 * The honest empty state.
 *
 * Used wherever a warehouse object does not exist yet. It names the object, so
 * the reader can tell "this has not been built" from "this client has no data"
 * — which is the distinction the whole `isMissingObject` machinery exists to
 * preserve, and it would be wasted if the UI rendered both as "No data".
 */
export function NotIngested({
  what,
  object,
  hint,
}: {
  what: string;
  object?: string | null;
  hint?: string;
}) {
  return (
    <div className="glass flex flex-col gap-2 border-dashed p-6">
      <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
        Not ingested yet
      </span>
      <h3 className="m-0 text-[16px] font-bold tracking-heading text-content-strong">
        {what}
      </h3>
      {object && (
        <p className="m-0 font-mono text-[12px] text-content-muted">{object}</p>
      )}
      {hint && (
        <p className="m-0 max-w-[62ch] text-[13px] leading-[1.7] text-content-body">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Shown when a client has no kill line, target or CPA on file.
 *
 * ── Why this is one line and not a card ────────────────────────────────────
 * It was a card. On a real account it filled the top third of the screen and
 * pushed the wall of creative — the entire point of the page — below the fold,
 * so the first impression of the product was a warning about a setting. The
 * message has not changed; its share of the screen has. A notice that crowds
 * out the thing it is annotating is worse at its job, not better.
 */
export function ThresholdsMissing({ clientName }: { clientName: string }) {
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-warning/30 bg-warning/[0.07] px-4 py-2.5 text-[13px] leading-[1.6] text-content-body">
      <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-warning">
        No verdicts
      </span>
      <span>
        {clientName} has no kill line, target ROAS or CPA on file, so nothing
        below is judged — the delivery figures are real, the colour coding and
        the winner counts are switched off. Set the three under Settings →
        Creative Engine.
      </span>
    </p>
  );
}
