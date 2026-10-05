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
import {
  formatMoney,
  formatNumber,
  formatRatio,
  NO_VALUE,
  isNoValue,
  type DeltaInput,
} from "@/lib/format";
import { Header } from "@/components/shell/Header";
import { NotConnected } from "@/components/ui/EmptyState";
import { InfoTip } from "@/components/ui/InfoTip";
import { CONFIDENCE_LABELS, type Confidence } from "@/lib/creative/stats";
import type { VerdictCode } from "@/lib/creative/verdict";
import { DeltaChip, type GoodWhen } from "@/components/ui/Delta";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Same formatter as Paid and the rest of the dashboard: "2.60×". */
export const roas = (v: number | null): string => formatRatio(v);

/** Whole-number percent. The default everywhere. */
export const pct = (v: number | null): string =>
  v === null ? NO_VALUE : `${Math.round(v * 100)}%`;

/** One decimal. Only CTR, hook rate and hold rate. */
export const ratePct = (v: number | null): string =>
  v === null ? NO_VALUE : `${(v * 100).toFixed(1)}%`;

export const count = (v: number | null): string =>
  v === null ? NO_VALUE : formatNumber(v);

export const money = (v: number | null, currency: string): string =>
  formatMoney(v, currency);

/** Unit costs (CPA, CPC, CPM): two decimals below 100, whole above. */
export const unitMoney = (v: number | null, currency: string): string =>
  formatMoney(v, currency, { unit: true });

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

/**
 * The three "no verdict" states are outlined rather than filled: they say the
 * engine declined to judge, and a filled chip would borrow the authority of a
 * real verdict. The outline is solid. Dashed borders are reserved for the empty
 * states (components/ui/EmptyState), so a dashed box always means "nothing here".
 */
const OUTLINE = "border border-hairline-strong text-content-muted";

const VERDICT_STYLES: Record<VerdictCode, string> = {
  unjudged: OUTLINE,
  scale: "bg-accent-soft text-growth-700",
  "aggressive-scale": "bg-accent-soft text-growth-700",
  hold: "bg-gray-100 text-content-muted",
  iterate: "bg-warning/10 text-warning",
  kill: "bg-negative/10 text-negative",
  "too-early": "bg-info/10 text-info",
  "data-missing": "bg-negative/10 text-negative",
  "needs-more-data": OUTLINE,
  "not-separable": OUTLINE,
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

/** A tag value, or a muted "n/a" chip when nothing has been filed. */
export function Tag({
  value,
  missing,
  tone = "default",
}: {
  value: string | null;
  /** What to call the gap, e.g. "persona". Shown as "persona: n/a". */
  missing: string;
  tone?: "default" | "made";
}) {
  if (!value) {
    return (
      <span
        title={`No ${missing}`}
        className="whitespace-nowrap rounded-pill border border-hairline px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-content-muted"
      >
        {missing}: {NO_VALUE}
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
  /** Definition or caveat, shown in an (i) tooltip beside the label. 40 words at most. */
  info?: string;
  /**
   * Period-over-period change, when a comparison range is selected. Only the
   * four delivery figures and the hit rate (percentage points, and only when the
   * comparison period launched something) carry one. Spend, ROAS, CPA and
   * purchases have enough events behind them to move for a reason. A "winners"
   * count that went from 1 to 2 is not up 100%.
   */
  delta?: number | null;
  /**
   * The same four figures, as current and comparison values plus the metric
   * kind, so the chip follows the "% | 123" toggle. Takes precedence over
   * `delta`. Null or omitted: no chip.
   */
  change?: DeltaInput | null;
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
          <dt className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
            {t.label}
            {t.info && <InfoTip text={t.info} label={`About ${t.label}`} />}
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
 * The change for a rate tile such as the hit rate, or null when it would not be
 * honest to draw one: the comparison period launched nothing (a rate over zero
 * launches is undefined, not zero), or either rate is missing. Rates are shown
 * in percentage points in both delta modes.
 */
export function rateChange(
  current: number | null,
  previous: number | null,
  previousLaunched: number
): DeltaInput | null {
  if (previousLaunched <= 0 || current === null || previous === null) return null;
  return { current, previous, kind: "rate" };
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
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
            <span className="truncate">{t.label}</span>
            {t.info && <InfoTip text={t.info} label={`About ${t.label}`} />}
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
            {t.change ? (
              <DeltaChip change={t.change} goodWhen={t.goodWhen ?? "up"} />
            ) : (
              t.delta !== undefined &&
              t.delta !== null && <DeltaChip delta={t.delta} goodWhen={t.goodWhen ?? "up"} />
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
  info,
  children,
}: {
  title: string;
  /** Definition or caveat, shown in an (i) tooltip. Never a subtitle. */
  info?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3.5 mt-1 flex flex-wrap items-baseline gap-3.5">
      <h3 className="m-0 text-[16px] font-semibold tracking-heading text-content-strong">
        {title}
      </h3>
      {info && <InfoTip text={info} label={`About ${title}`} />}
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
 * The whole page for a client with no Meta account: the title and one line.
 * `source` comes from `missingSource` (lib/capabilities), never from a guess.
 */
export function CreativeNotConnected({ title, source }: { title: string; source: string }) {
  return (
    <>
      <Header title={title} />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-4 lg:px-8">
        <NotConnected source={source} />
      </main>
    </>
  );
}
