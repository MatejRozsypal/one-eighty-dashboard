/**
 * The decision engine.
 *
 * Gate order comes from `agency/_processes/meta-creative-engine/07-analyzing.md`
 * and is not re-derived here — it is executed. What this file adds in front of
 * it is the honesty ladder: five states the tool can be in *before* it is
 * entitled to say scale or kill.
 *
 * ── Why the ladder matters more than the gates ─────────────────────────────
 * The gates were written for accounts with enough purchases to read. At
 * Manami's volume most rows never reach that, so a tool that always emits one
 * of SCALE / HOLD / ITERATE / KILL is guessing four times out of five while
 * looking equally confident each time. The ladder makes "we cannot tell yet" a
 * first-class answer, and `NEEDS MORE DATA` carries a price — which turns it
 * from an excuse into a decision Lukáš can take.
 *
 * ── The rule that separates the two halves of the product ──────────────────
 * AD LEVEL NEVER PRODUCES A MONEY VERDICT. Impression-based metrics have 50 to
 * 100 times more samples than purchase-based ones for the same spend, so at
 * 3 000 Kč of Manami spend hook rate is readable to ±1.4% while ROAS is
 * readable to ±96%. The fast loop therefore produces iteration instructions,
 * and the slow loop — ad set and above — produces money.
 *
 * There is a second reason, and it is the one that costs money when ignored:
 * last-click ROAS hides Meta's multi-view sequencing, so a low-ROAS ad inside a
 * working ad set is likely the opener driving the converters above it. Turning
 * it off destroys the sequence. `07-analyzing.md` states it plainly and the
 * learnings file has three measured cases of it.
 */

import {
  interval,
  purchasesToClear,
  spendToDecide,
  type CreativeThresholds,
} from "@/lib/creative/stats";
import type { Components } from "@/lib/creative/model";
import { derive } from "@/lib/creative/model";
import { hasVideoMetrics } from "@/lib/creative/vocabulary";

// ---------------------------------------------------------------------------
// Money verdicts — ad set and concept level only
// ---------------------------------------------------------------------------

export type VerdictCode =
  | "unjudged"
  | "data-missing"
  | "too-early"
  | "needs-more-data"
  | "not-separable"
  | "scale"
  | "aggressive-scale"
  | "hold"
  | "iterate"
  | "kill";

export interface Verdict {
  code: VerdictCode;
  label: string;
  /** One line of plain text. No prose beyond this — it is software, not a memo. */
  say: string;
  /** Present on `needs-more-data`: what finding out costs. */
  costToDecide: number | null;
  /** Present on `needs-more-data`: how many more purchases. */
  purchasesShort: number | null;
  /** True when the engine is explicitly declining to decide. */
  undecided: boolean;
}

export interface VerdictInput {
  /**
   * Which grain this is. Only `adset` is subject to Meta's learning phase —
   * see the gate below.
   */
  level?: "adset" | "concept";
  components: Components;
  /** The shrunk ROAS. Verdicts are taken on the defensible number, not the raw one. */
  roas: number | null;
  /** Days since launch. Null when unknown — treated as outside the window. */
  ageDays: number | null;
  /** Set when the no-touch window has a known end date, for the message. */
  noTouchUntil?: string | null;
}

const money = (v: number) => Math.round(v).toLocaleString("en-US");

/**
 * The verdict for a client with no kill line, target ROAS or CPA on file.
 *
 * ── Why this exists rather than an early return in each screen ─────────────
 * Concepts, Breakdown and Production used to render nothing at all in that
 * state — one warning strip on an otherwise blank page. But delivery is not a
 * judgement: spend, purchases, angle coverage and the concept roster are all
 * measured, not decided, and they are exactly what somebody looks at while
 * working out what the kill line should be. Withholding them made the screen
 * useless precisely when it was most needed.
 *
 * So the screens render on the display thresholds and every verdict resolves
 * here instead: stated plainly as absent, never as `hold` — which is what a
 * kill line of zero and a target of infinity would otherwise silently produce.
 */
export function unjudgedVerdict(): Verdict {
  return {
    code: "unjudged",
    label: "Not judged",
    say: "No kill line, target ROAS or CPA on file for this client. Set the three under Settings → Creative Engine and this row gets a verdict.",
    costToDecide: null,
    purchasesShort: null,
    undecided: true,
  };
}

/**
 * How many times its own spend a row may need before "spend more to find out"
 * stops being advice. Ten is a judgement: it keeps "this cost 6x what it has
 * already spent to settle" — a real decision somebody might take — and drops
 * the ones that would cost hundreds of times the entity's whole history.
 */
const UNRESOLVABLE_MULTIPLE = 10;

/**
 * Judge one ad set or concept.
 *
 * Order is the SOP's, with the ladder interleaved where each rung actually
 * applies rather than bolted on at the front:
 *
 *   0  DATA MISSING     no rows, or zero conversions past the investigate gate
 *   1  TOO EARLY        inside the no-touch window, or still in learning
 *   2  NEEDS MORE DATA  below the hold gate, or interval too wide to act on
 *   3  NOT SEPARABLE    past the gates, interval still spans a decision line
 *   4  the verdict
 */
export function moneyVerdict(input: VerdictInput, t: CreativeThresholds): Verdict {
  const c = input.components;
  const roas = input.roas;

  // ── 0. DATA MISSING ──────────────────────────────────────────────────────
  if (c.spend <= 0) {
    return v("data-missing", "No data", "No delivery in this window.", true);
  }
  // Zero conversions at 1.5x CPA is the classic broken-pixel signature. It is
  // deliberately NOT a kill: killing here throws away a concept because a UTM
  // was wrong, and that mistake is invisible afterwards.
  if (c.purchases === 0 && c.spend >= 1.5 * t.targetCpa) {
    return v(
      "data-missing",
      "Check tracking",
      `${money(c.spend)} spent, no purchases recorded. Check the pixel and the landing page before reading this.`,
      true
    );
  }

  // ── 1. TOO EARLY ─────────────────────────────────────────────────────────
  if (input.ageDays !== null && input.ageDays < t.noTouchDays) {
    const until = input.noTouchUntil ? ` until ${input.noTouchUntil}` : "";
    return v(
      "too-early",
      "Too early",
      `Inside the ${t.noTouchDays}-day no-touch window${until}. Record the data, decide nothing.`,
      true
    );
  }

  // ── 2. NEEDS MORE DATA — below the spend gate ────────────────────────────
  // Checked BEFORE the learning gate on purpose, even though the SOP lists
  // learning first. A row with one purchase and 300 Kč of spend is not "in
  // Meta's learning phase" in any useful sense; it simply has not been given
  // enough money to say anything. Telling someone what it costs to find out is
  // an instruction. Telling them it is in learning is a fact they can do
  // nothing with.
  if (c.spend < t.holdGateX * t.targetCpa) {
    const short = Math.max(0, t.holdGateX * t.targetCpa - c.spend);
    return {
      code: "needs-more-data",
      label: "Needs more data",
      say: `Below the ${t.holdGateX}x CPA gate. Needs ${money(short)} more spend before it says anything.`,
      costToDecide: short,
      purchasesShort: null,
      undecided: true,
    };
  }

  // Meta's learning phase — AD SET LEVEL ONLY.
  //
  // The 50-conversion threshold is a property of an ad set's delivery
  // optimisation, not of a creative idea. A concept running across a mature ad
  // set and a fresh one is not "in learning": part of it is, and the mature
  // part is perfectly readable. Applying this gate at concept level produced
  // the contradiction it was meant to prevent — a row labelled Read confidence
  // on 40 purchases, sitting next to a verdict saying nothing about it was
  // stable yet.
  if (input.level !== "concept" && c.purchases < 50) {
    return v(
      "too-early",
      "Learning",
      `${c.purchases} purchase events. Meta leaves an ad set's learning phase at 50; delivery is still being explored.`,
      true
    );
  }

  if (roas === null) {
    return v("data-missing", "No data", "No revenue attributed in this window.", true);
  }

  const [lo, hi] = interval(roas, c.purchases);

  // ── 3. NOT SEPARABLE — past the gate, interval still spans the kill line ──
  //
  // This is the state the whole product exists to be able to report, and it
  // deliberately blocks only the DANGEROUS direction.
  //
  // A row above the kill line whose interval still reaches down through it
  // cannot be told apart from break-even, so it gets no verdict — but it does
  // get a price, because "this costs 4 200 Kč to find out" is a decision
  // somebody can take and "insufficient data" is not.
  //
  // The asymmetry below is the point: a wrong SCALE costs a 20% budget
  // increase and is reversible next Monday. A wrong KILL throws away a winner
  // and is not reversible at all — the creative loses its social proof, its
  // post engagement and its delivery history, and the learnings file has three
  // measured cases of a re-uploaded winner returning a third to a half of what
  // it made in place. Asymmetric costs justify asymmetric evidence bars, so a
  // wide interval blocks a kill and does not block a scale.
  if (roas > t.killRoas && lo <= t.killRoas) {
    const needed = purchasesToClear(roas, t.killRoas);
    const cost = spendToDecide(roas, c.purchases, t.killRoas, t.targetCpa);
    const short = needed === null ? null : Math.max(0, needed - c.purchases);

    // Above the aggressive-scale line the point estimate is far enough clear
    // that waiting costs more than acting. Fall through to the verdict.
    if (roas < t.targetRoas * t.scaleMultiplier) {
      // ── When the price is not a price ──────────────────────────────────
      // The closer an estimate sits to the line, the more data separating them
      // takes, and the cost runs to infinity as the two converge. A row at 1.83
      // against a 1.80 kill line needs about twenty thousand more purchases —
      // arithmetically correct, and useless as an instruction. Printing
      // "$524,498 settles it" next to a concept that has spent $884 turns the
      // most useful number on the screen into an obviously silly one, and a
      // reader who sees one silly number stops trusting the others.
      //
      // So past a point the honest answer changes shape: it is not that we need
      // more data, it is that this thing is sitting ON the line and no amount
      // of spend anybody would authorise will move it off.
      const unresolvable = cost === null || cost > c.spend * UNRESOLVABLE_MULTIPLE;

      return {
        code: "not-separable",
        label: "Not separable",
        say: unresolvable
          ? `${fmt(roas)} (${fmt(lo)}–${fmt(hi)}) sits on the ${fmt(t.killRoas)} kill line. ` +
            `No realistic amount of further spend separates the two. Treat it as break-even ` +
            `and decide on the ad set it runs in, not on this number.`
          : `${fmt(roas)}, but the true value is between ${fmt(lo)} and ${fmt(hi)}. ` +
            `Cannot separate it from the ${fmt(t.killRoas)} kill line. ` +
            `${short} more purchases, about ${money(cost!)}, settles it.`,
        costToDecide: unresolvable ? null : cost,
        purchasesShort: unresolvable ? null : short,
        undecided: true,
      };
    }
  }

  // ── 3. the SOP gates ─────────────────────────────────────────────────────
  // Kill first: a row below the line past the 3x CPA gate is losing money on
  // every sale, and every day it keeps its budget is a day the money is gone.
  if (roas <= t.killRoas && c.spend >= t.killGateX * t.targetCpa) {
    // Say which of the two situations this is. "Interval 0.94-1.62, entirely
    // below the line" and "1.55, but the interval still reaches 2.10" justify
    // the same action and deserve very different learning notes.
    const clear = hi < t.killRoas;
    return v(
      "kill",
      "Kill",
      clear
        ? `Interval ${fmt(lo)}–${fmt(hi)} sits entirely below the ${fmt(t.killRoas)} kill line. Pause it, and write the learning note.`
        : `${fmt(roas)} past the ${t.killGateX}x CPA gate, though the interval still reaches ${fmt(hi)}. Pause it, and say so in the learning note.`,
      false
    );
  }

  if (roas >= t.targetRoas * t.aggressiveMultiplier) {
    return v(
      "aggressive-scale",
      "Scale hard",
      `Budget +30–40% and graduate the winner by post ID. Never move the original.`,
      false
    );
  }

  if (roas >= t.targetRoas * t.scaleMultiplier) {
    return v(
      "scale",
      "Scale",
      `Budget +20–25%. Do not add creatives to this ad set — that resets learning.`,
      false
    );
  }

  if (roas >= t.targetRoas * 0.9) {
    return v(
      "hold",
      "Hold",
      `Inside the hold zone ${fmt(t.targetRoas * 0.9)}–${fmt(t.targetRoas * t.scaleMultiplier)}. Let Meta optimise.`,
      false
    );
  }

  if (roas > t.killRoas && c.spend >= t.iterateGateX * t.targetCpa) {
    return v(
      "iterate",
      "Iterate",
      `Above the floor, under target. Brief an iteration rather than adding budget.`,
      false
    );
  }

  // Above the kill line, under the iterate spend gate, nothing else applies.
  // Holding is the SOP's answer below 2x CPA and it is also the honest one.
  return v(
    "hold",
    "Hold",
    `${fmt(roas)} (${fmt(lo)}–${fmt(hi)}). Above the floor but under the ${t.iterateGateX}x CPA gate an iteration would be briefed on noise.`,
    false
  );
}

function v(code: VerdictCode, label: string, say: string, undecided: boolean): Verdict {
  return { code, label, say, costToDecide: null, purchasesShort: null, undecided };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/** Whether a verdict is one the decisions log will accept as a human action. */
export const ACTIONABLE: VerdictCode[] = [
  "scale", "aggressive-scale", "hold", "iterate", "kill",
];

// ---------------------------------------------------------------------------
// Ad-level diagnosis — the fast loop
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
 * Diagnose one ad. Never a money verdict — an iteration instruction.
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
      say: `${c.impressions.toLocaleString("en-US")} impressions. Below about ${MIN_IMPRESSIONS.toLocaleString("en-US")} even the attention metrics are noise.`,
      iterationType: null,
    };
  }

  const d = derive(c);

  // A static reports no video metrics at all. Drawing an empty hook-rate gauge
  // for it would imply the data is missing rather than nonexistent, which sends
  // someone looking for an ingestion bug that is not there.
  if (!hasVideoMetrics(format)) {
    if (c.purchases === 0 && c.spend >= 1.5 * t.targetCpa) {
      return {
        code: "body-problem",
        label: "Body problem",
        say: "Delivering and clicked, but not converting. The argument or the offer is the problem, not the hook.",
        iterationType: 4,
      };
    }
    return {
      code: "static-no-signal",
      label: "Judge on CTR",
      say: `Meta reports no video metrics for a static. CTR ${pct(d.ctr)} — branch on the angle or translate the format.`,
      iterationType: 2,
    };
  }

  if (d.hookRate !== null && d.hookRate < t.hookRateFloor) {
    return {
      code: "hook-problem",
      label: "Hook problem",
      say: `Hook rate ${pct(d.hookRate)}, under the ${pct(t.hookRateFloor)} floor. Brief 6 new hooks on the same body.`,
      iterationType: 1,
    };
  }

  if (d.holdRate !== null && d.holdRate < t.holdRateFloor) {
    return {
      code: "bridge-problem",
      label: "Bridge problem",
      say: `Hook lands at ${pct(d.hookRate)} but hold falls to ${pct(d.holdRate)}. The first ten seconds after the hook are losing them.`,
      iterationType: 2,
    };
  }

  if (c.purchases === 0 && c.spend >= 1.5 * t.targetCpa) {
    return {
      code: "body-problem",
      label: "Body problem",
      say: "Attention is fine and nobody buys. Keep the hook, change the argument.",
      iterationType: 4,
    };
  }

  return {
    code: "healthy",
    label: "Earning attention",
    say: `Hook ${pct(d.hookRate)}, hold ${pct(d.holdRate)}, both above floor. Nothing to fix at ad level.`,
    iterationType: null,
  };
}

function pct(v: number | null): string {
  // CTR, hook rate and hold rate keep a decimal — at these magnitudes it
  // carries real signal. Every other percentage in the product is whole.
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
