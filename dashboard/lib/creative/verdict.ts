/**
 * The decision engine.
 *
 * Gate order comes from `agency/_processes/meta-creative-engine/07-analyzing.md`
 * and is not re-derived here, it is executed. In front of it sit the states in
 * which the tool declines to say scale or kill: no delivery, inside the
 * no-touch window, and below the spend gate, where "needs more data" carries a
 * price in spend.
 *
 * ── Pure numbers (owner decision, 2026-10-13) ───────────────────────────────
 * The verdict is a plain comparison of the real ROAS (revenue over spend) with
 * the client's lines. No purchase count, confidence interval or learning-phase
 * count gates it. What still gates it is time (the no-touch window) and money
 * (the hold, iterate and kill gates in multiples of target CPA). Zero
 * purchases on real spend is a ROAS of 0.00, judged like any other value.
 *
 * ── The rule that separates the two halves of the product ──────────────────
 * AD LEVEL NEVER PRODUCES A MONEY VERDICT. The fast loop, one ad, produces
 * iteration instructions from attention metrics, and the slow loop, ad set and
 * above, produces money.
 *
 * The reason is the one that costs money when ignored: last-click ROAS hides
 * Meta's multi-view sequencing, so a low-ROAS ad inside a working ad set is
 * likely the opener driving the converters above it. Turning it off destroys
 * the sequence. `07-analyzing.md` states it plainly and the learnings file has
 * three measured cases of it.
 */

import type { CreativeThresholds } from "@/lib/creative/stats";
import type { Components } from "@/lib/creative/model";
import { derive } from "@/lib/creative/model";
import { hasVideoMetrics } from "@/lib/creative/vocabulary";
import { formatNumber, NO_VALUE } from "@/lib/format";

// ---------------------------------------------------------------------------
// Money verdicts, ad set and concept level only
// ---------------------------------------------------------------------------

export type VerdictCode =
  | "unjudged"
  | "data-missing"
  | "too-early"
  | "needs-more-data"
  | "scale"
  | "aggressive-scale"
  | "hold"
  | "iterate"
  | "kill";

export interface Verdict {
  code: VerdictCode;
  label: string;
  /** One line of plain text. No prose beyond this, it is software, not a memo. */
  say: string;
  /** Present on `needs-more-data`: the spend still short of the hold gate. */
  costToDecide: number | null;
  /** True when the engine is explicitly declining to decide. */
  undecided: boolean;
}

export interface VerdictInput {
  components: Components;
  /** Days since launch. Null when unknown, treated as outside the window. */
  ageDays: number | null;
  /** Set when the no-touch window has a known end date, for the message. */
  noTouchUntil?: string | null;
}

const money = (v: number) => formatNumber(v);

/**
 * The verdict for a client with no kill line, target ROAS or CPA on file.
 *
 * ── Why this exists rather than an early return in each screen ─────────────
 * Concepts, Breakdown and Production used to render nothing at all in that
 * state, one warning strip on an otherwise blank page. But delivery is not a
 * judgement: spend, purchases, angle coverage and the concept roster are all
 * measured, not decided, and they are exactly what somebody looks at while
 * working out what the kill line should be. Withholding them made the screen
 * useless precisely when it was most needed.
 *
 * So the screens render on the display thresholds and every verdict resolves
 * here instead: stated plainly as absent, never as `hold`, which is what a
 * kill line of zero and a target of infinity would otherwise silently produce.
 */
export function unjudgedVerdict(): Verdict {
  return {
    code: "unjudged",
    label: "Not judged",
    say: "Set targets to see verdicts.",
    costToDecide: null,
    undecided: true,
  };
}

/**
 * Judge one ad set or concept on its real ROAS.
 *
 *   0  NO DATA          no delivery in the window
 *   1  TOO EARLY        inside the no-touch window
 *   2  NEEDS MORE DATA  below the hold gate (spend under 1x target CPA)
 *   3  the SOP gates    kill, scale hard, scale, hold, iterate
 */
export function moneyVerdict(input: VerdictInput, t: CreativeThresholds): Verdict {
  const c = input.components;

  // ── 0. NO DATA ───────────────────────────────────────────────────────────
  // The one case with no ROAS at all: revenue over zero spend does not exist.
  if (c.spend <= 0) {
    return v("data-missing", "No data", "No delivery in this window.", true);
  }
  // The real ratio. With spend and no purchases this is 0.00, a number like
  // any other: below the kill line it is killed at the kill gate.
  const roas = c.revenue / c.spend;

  // ── 1. TOO EARLY ─────────────────────────────────────────────────────────
  if (input.ageDays !== null && input.ageDays < t.noTouchDays) {
    const until = input.noTouchUntil ? ` until ${input.noTouchUntil}` : "";
    return v(
      "too-early",
      "Too early",
      `Inside the ${t.noTouchDays}-day no-touch window${until}. Wait.`,
      true
    );
  }

  // ── 2. NEEDS MORE DATA, below the spend gate ────────────────────────────
  // A row with 300 Kč of spend has not been given enough money to say
  // anything. Telling someone what it costs to find out is an instruction.
  if (c.spend < t.holdGateX * t.targetCpa) {
    const short = Math.max(0, t.holdGateX * t.targetCpa - c.spend);
    return {
      code: "needs-more-data",
      label: "Needs more data",
      say: `Needs ${money(short)} more spend.`,
      costToDecide: short,
      undecided: true,
    };
  }

  // ── 3. the SOP gates ─────────────────────────────────────────────────────
  // Kill first: a row below the line past the 3x CPA gate is losing money on
  // every sale, and every day it keeps its budget is a day the money is gone.
  if (roas <= t.killRoas && c.spend >= t.killGateX * t.targetCpa) {
    return v(
      "kill",
      "Kill",
      `${fmt(roas)}, below the ${fmt(t.killRoas)} kill line past the ${t.killGateX}x CPA gate. Pause it.`,
      false
    );
  }

  if (roas >= t.targetRoas * t.aggressiveMultiplier) {
    return v(
      "aggressive-scale",
      "Scale hard",
      "Raise budget 30-40%. Graduate by post ID.",
      false
    );
  }

  if (roas >= t.targetRoas * t.scaleMultiplier) {
    return v(
      "scale",
      "Scale",
      "Raise budget 20-25%.",
      false
    );
  }

  if (roas >= t.targetRoas * 0.9) {
    return v(
      "hold",
      "Hold",
      `Hold zone ${fmt(t.targetRoas * 0.9)} to ${fmt(t.targetRoas * t.scaleMultiplier)}. Let it run.`,
      false
    );
  }

  if (roas > t.killRoas && c.spend >= t.iterateGateX * t.targetCpa) {
    return v(
      "iterate",
      "Iterate",
      "Brief an iteration.",
      false
    );
  }

  // Under a spend gate, nothing else applies. Holding is the SOP's answer
  // below 2x CPA, and below the kill line it holds until the 3x CPA kill gate.
  return v(
    "hold",
    "Hold",
    roas <= t.killRoas
      ? `${fmt(roas)}, below the kill line, under the ${t.killGateX}x CPA kill gate. Let it run.`
      : `Under the ${t.iterateGateX}x CPA iterate gate. Let it run.`,
    false
  );
}

function v(code: VerdictCode, label: string, say: string, undecided: boolean): Verdict {
  return { code, label, say, costToDecide: null, undecided };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/** Whether a verdict is one the decisions log will accept as a human action. */
export const ACTIONABLE: VerdictCode[] = [
  "scale", "aggressive-scale", "hold", "iterate", "kill",
];

// ---------------------------------------------------------------------------
// Ad-level diagnosis, the fast loop
// ---------------------------------------------------------------------------

export type DiagnosisCode =
  | "hook-problem"
  | "bridge-problem"
  | "body-problem"
  | "static-no-signal"
  | "healthy"
  | "insufficient-signal";

export interface Diagnosis {
  code: DiagnosisCode;
  label: string;
  say: string;
  /** The iteration type from 08-feedback-loop.md this maps onto, if any. */
  iterationType: 1 | 2 | 3 | 4 | null;
}

/**
 * Diagnose one ad. Never a money verdict, an iteration instruction.
 *
 * The four outcomes map straight onto iteration types 1 to 4 in
 * `08-feedback-loop.md`, which is what makes the tool able to draft the brief
 * rather than just complain.
 *
 * Impressions are the gate rather than purchases, because that is the whole
 * point of the fast loop: 20 000 impressions is a readable hook rate and about
 * six purchases. One of those numbers can carry an instruction.
 */
export function diagnose(
  c: Components,
  format: string | null,
  t: CreativeThresholds
): Diagnosis {
  const MIN_IMPRESSIONS = 5000;
  if (c.impressions < MIN_IMPRESSIONS) {
    return {
      code: "insufficient-signal",
      label: "Not enough delivery",
      say: "Fewer than 5,000 impressions so far.",
      iterationType: null,
    };
  }

  const d = derive(c);

  // A static reports no video metrics at all. Drawing an empty hook-rate gauge
  // for it would imply the data is missing rather than nonexistent, which sends
  // someone looking for an ingestion bug that is not there.
  // A missing Target CPA reaches here as 0 (the display thresholds). Spend is
  // always >= 1.5 x 0, so without this guard every zero-purchase ad would read
  // "Body problem" on the strength of a threshold that is not there (C4).
  const hasCpa = t.targetCpa > 0;

  if (!hasVideoMetrics(format)) {
    if (hasCpa && c.purchases === 0 && c.spend >= 1.5 * t.targetCpa) {
      return {
        code: "body-problem",
        label: "Body problem",
        say: "Clicked but not converting. Fix the argument or offer.",
        iterationType: 4,
      };
    }
    return {
      code: "static-no-signal",
      label: "Judge on CTR",
      say: `No video metrics. CTR (all) ${pct(d.ctr)}.`,
      iterationType: 2,
    };
  }

  if (d.hookRate !== null && d.hookRate < t.hookRateFloor) {
    return {
      code: "hook-problem",
      label: "Hook problem",
      say: `Hook rate ${pct(d.hookRate)}, under the ${pct(t.hookRateFloor)} ${floorWords(t)}. Brief new hooks.`,
      iterationType: 1,
    };
  }

  if (d.holdRate !== null && d.holdRate < t.holdRateFloor) {
    return {
      code: "bridge-problem",
      label: "Bridge problem",
      say: `Hook ${pct(d.hookRate)}, hold ${pct(d.holdRate)}. Hold drops after the hook.`,
      iterationType: 2,
    };
  }

  if (hasCpa && c.purchases === 0 && c.spend >= 1.5 * t.targetCpa) {
    return {
      code: "body-problem",
      label: "Body problem",
      say: "Keep the hook, change the argument.",
      iterationType: 4,
    };
  }

  return {
    code: "healthy",
    label: "Earning attention",
    say: "Attention fine. Nothing to fix.",
    iterationType: null,
  };
}

/**
 * "floor" for the stored Settings value, "floor (your p25 of video ads)" for the
 * relative one. Hook and hold floors are diagnostic: they say where to look,
 * never what to do with money.
 */
function floorWords(t: { floorBasis?: "relative" | "fallback" }): string {
  return t.floorBasis === "relative" ? "floor (your p25 of video ads)" : "floor";
}

function pct(v: number | null): string {
  // CTR, hook rate and hold rate keep a decimal, at these magnitudes it
  // carries real signal. Every other percentage in the product is whole.
  return v === null ? NO_VALUE : `${(v * 100).toFixed(1)}%`;
}
