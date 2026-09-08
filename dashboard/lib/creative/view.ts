/**
 * The serialisable shapes the client components render.
 *
 * ── Why there is a view model at all ───────────────────────────────────────
 * Filtering the grid and opening the detail panel are interactions, so those
 * components run on the client. Everything they display — the shrunk ROAS, the
 * interval, the diagnosis, the signed asset URL — is computed on the server,
 * because the thresholds come from Postgres, the asset URLs are signed with a
 * private key, and none of that belongs in a browser bundle.
 *
 * So the boundary carries plain data: numbers and strings, no functions, no
 * class instances, nothing that has to be re-derived twice and can therefore
 * disagree with itself.
 */

import {
  classify,
  derive,
  read,
  type AdRow,
  type AdsetRow,
  type Components,
  type Outcome,
} from "@/lib/creative/model";
import type { Confidence, CreativeThresholds } from "@/lib/creative/stats";
import { diagnose, moneyVerdict, type Verdict } from "@/lib/creative/verdict";
import type { CreativeAsset } from "@/lib/queries/creative";
import type { Proposal } from "@/lib/creative/matching";

export interface RetentionPoint {
  /** Seconds into the video. */
  t: number;
  /** Share of impressions still watching, 0..1. */
  y: number;
  label: string;
}

export interface AdView {
  adId: string;
  adName: string;
  adsetName: string | null;
  campaignName: string | null;

  spend: number;
  spendShare: number;
  revenue: number;
  purchases: number;
  impressions: number;
  reach: number;

  roas: number | null;
  roasRaw: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  confidence: Confidence;
  outcome: Outcome;

  cpa: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  hookRate: number | null;
  holdRate: number | null;
  outboundCtr: number | null;
  addToCart: number;

  format: string | null;
  stage: string | null;
  market: string | null;
  persona: string | null;
  angle: string | null;
  offer: string | null;
  conceptId: string | null;
  conceptName: string | null;
  method: string | null;
  creator: string | null;
  bodyHook: string | null;
  briefUrl: string | null;
  clickupUrl: string | null;

  /** Signed, short-lived. Null when nothing has been mirrored to the bucket. */
  thumbUrl: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  effectiveStatus: string | null;

  copyPrimary: string | null;
  copyHeadline: string | null;
  copyDescription: string | null;
  copyCta: string | null;
  /** Every text variant an Advantage+ ad rotates, when there is more than one. */
  copyVariants: string[];

  /** Null for a static: Meta reports no video metrics, which is not the same as zero. */
  retention: RetentionPoint[] | null;
  videoLengthSec: number | null;

  diagnosisCode: string;
  diagnosisLabel: string;
  diagnosisSay: string;
  iterationType: number | null;
}

/**
 * The retention curve, from the eight real points Meta reports.
 *
 * ── Why this is not reconstructed from hook and hold rate ──────────────────
 * With plays, 3-second views, the four quartiles, ThruPlays and completions
 * there are eight measured points across the duration. Interpolating between
 * measurements is honest; inventing a decay curve from two numbers and drawing
 * it at the same fidelity is not, and the reader cannot tell the difference by
 * looking.
 *
 * Returns null unless there is a real curve to draw. A partial curve — quartiles
 * missing because the ad predates Meta's ~37-month insights retention wall —
 * renders as nothing, because a curve with a hole in it reads as a collapse in
 * retention rather than as absent data.
 */
export function retentionCurve(
  c: Components,
  lengthSec: number | null
): RetentionPoint[] | null {
  if (!lengthSec || lengthSec <= 0) return null;
  if (c.impressions <= 0 || c.videoPlays <= 0) return null;
  // The quartiles are the part that has to be present. Without them this would
  // be three points and a lot of interpolation.
  if (c.videoP25 <= 0 && c.videoP50 <= 0 && c.videoP100 <= 0) return null;

  const share = (v: number) => v / c.impressions;
  const points: RetentionPoint[] = [
    { t: 0, y: share(c.videoPlays), label: "start" },
    { t: 3, y: share(c.videoViews || c.videoPlays), label: "3s" },
    { t: lengthSec * 0.25, y: share(c.videoP25), label: "25%" },
    { t: lengthSec * 0.5, y: share(c.videoP50), label: "50%" },
    { t: 15, y: share(c.videoThruplays), label: "15s" },
    { t: lengthSec * 0.75, y: share(c.videoP75), label: "75%" },
    { t: lengthSec * 0.95, y: share(c.videoP95), label: "95%" },
    { t: lengthSec, y: share(c.videoP100), label: "end" },
  ];

  if (lengthSec > 30 && c.video30s > 0) {
    points.push({ t: 30, y: share(c.video30s), label: "30s" });
  }

  // Sorted by time and plotted as measured. A curve that RISES is not a bug
  // here: ThruPlay counts 15 seconds *or* a completion, whichever comes first,
  // while the quartiles count a fraction of the duration, so on a long video
  // the two definitions can genuinely disagree. Smoothing that away would hide
  // a real property of Meta's metrics behind a prettier line.
  return points
    .filter((p) => p.t <= lengthSec && p.y >= 0)
    .sort((a, b) => a.t - b.t);
}

export function toAdView(
  ad: AdRow,
  asset: CreativeAsset | undefined,
  signed: { thumbUrl: string | null; assetUrl: string | null },
  accountMeanRoas: number,
  accountSpend: number,
  t: CreativeThresholds
): AdView {
  const r = read(ad.components, accountMeanRoas, accountSpend, t);
  const d = derive(ad.components);
  const format = ad.tags.format ?? inferFormat(asset);
  const diag = diagnose(ad.components, format, t);

  return {
    adId: ad.adId,
    adName: ad.adName,
    adsetName: ad.adsetName,
    campaignName: ad.campaignName,

    spend: r.spend,
    spendShare: r.spendShare,
    revenue: ad.components.revenue,
    purchases: r.purchases,
    impressions: ad.components.impressions,
    reach: ad.components.reach,

    roas: r.roas,
    roasRaw: r.roasRaw,
    ciLow: r.ciLow,
    ciHigh: r.ciHigh,
    confidence: r.confidence,
    outcome: classify(ad.components, accountMeanRoas, t),

    cpa: d.cpa,
    ctr: d.ctr,
    cpc: d.cpc,
    cpm: d.cpm,
    hookRate: format === "DYN" ? d.hookRate : null,
    holdRate: format === "DYN" ? d.holdRate : null,
    outboundCtr: d.outboundCtr,
    addToCart: ad.components.addToCart,

    format,
    stage: ad.tags.stage,
    market: ad.tags.market,
    persona: ad.tags.personaName ?? ad.tags.personaId,
    angle: ad.tags.angle,
    offer: ad.tags.offer,
    conceptId: ad.tags.conceptId,
    conceptName: ad.tags.conceptName,
    method: ad.tags.productionMethod,
    creator: ad.tags.creatorName,
    bodyHook:
      ad.tags.bodyCode || ad.tags.hookCode
        ? `${ad.tags.bodyCode ?? "b?"}${ad.tags.hookCode ?? "h?"}`
        : null,
    briefUrl: ad.tags.briefUrl,
    clickupUrl: ad.tags.clickupUrl,

    thumbUrl: signed.thumbUrl,
    assetUrl: signed.assetUrl,
    assetKind: asset?.assetKind ?? null,
    effectiveStatus: asset?.effectiveStatus ?? null,

    copyPrimary: asset?.body ?? null,
    copyHeadline: asset?.title ?? null,
    copyDescription: asset?.linkDescription ?? null,
    copyCta: asset?.callToActionType ?? null,
    copyVariants: (asset?.bodies ?? []).slice(1),

    retention: retentionCurve(ad.components, asset?.videoLengthSec ?? null),
    videoLengthSec: asset?.videoLengthSec ?? null,

    diagnosisCode: diag.code,
    diagnosisLabel: diag.label,
    diagnosisSay: diag.say,
    iterationType: diag.iterationType,
  };
}

/**
 * Fall back to what Meta says the creative is when ClickUp has not been filled.
 *
 * An untagged ad still has a format — the object type is on the creative
 * itself. Leaving it null would grey out the format filter for a third of the
 * account for no reason.
 */
function inferFormat(asset: CreativeAsset | undefined): string | null {
  if (!asset) return null;
  if (asset.assetKind === "video" || asset.objectType === "VIDEO") return "DYN";
  if (asset.objectType === "DPA") return "DPA";
  if (asset.objectType) return "STAT";
  return null;
}

// ---------------------------------------------------------------------------
// Ad sets and concepts — the levels that produce money verdicts
// ---------------------------------------------------------------------------

export interface VerdictView {
  code: string;
  label: string;
  say: string;
  costToDecide: number | null;
  undecided: boolean;
}

export function toVerdictView(v: Verdict): VerdictView {
  return {
    code: v.code,
    label: v.label,
    say: v.say,
    costToDecide: v.costToDecide,
    undecided: v.undecided,
  };
}

export interface AdsetView {
  adsetId: string;
  adsetName: string;
  campaignName: string | null;
  spend: number;
  spendShare: number;
  purchases: number;
  roas: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  cpa: number | null;
  confidence: Confidence;
  ageDays: number | null;
  frequency: number | null;
  verdict: VerdictView;
  adCount: number;
}

export function toAdsetView(
  set: AdsetRow,
  adCount: number,
  accountMeanRoas: number,
  accountSpend: number,
  t: CreativeThresholds
): AdsetView {
  const r = read(set.components, accountMeanRoas, accountSpend, t);
  const d = derive(set.components);
  const verdict = moneyVerdict(
    { components: set.components, roas: r.roas, ageDays: set.ageDays },
    t
  );
  return {
    adsetId: set.adsetId,
    adsetName: set.adsetName,
    campaignName: set.campaignName,
    spend: r.spend,
    spendShare: r.spendShare,
    purchases: r.purchases,
    roas: r.roas,
    ciLow: r.ciLow,
    ciHigh: r.ciHigh,
    cpa: d.cpa,
    confidence: r.confidence,
    ageDays: set.ageDays,
    frequency: set.frequencyLatest,
    verdict: toVerdictView(verdict),
    adCount,
  };
}

// ---------------------------------------------------------------------------
// The unmapped queue
// ---------------------------------------------------------------------------

/**
 * One row of the queue, as it crosses to the browser.
 *
 * Declared here rather than in the component because a plain function exported
 * from a `"use client"` module is a reference on the server, not something the
 * server can call — so the narrowing below has to live outside it. The proposal
 * is scored on the server anyway: the candidate list is every task in the ad
 * pipeline, and shipping it to the browser to run string similarity would be
 * both slower and a needless disclosure of every task name.
 */
export interface QueueRow {
  adId: string;
  adName: string;
  spend: number;
  purchases: number;
  proposal: {
    taskId: string;
    taskName: string;
    confidence: number;
    method: string;
    reasons: string[];
  } | null;
}

export function toQueueProposal(p: Proposal | null): QueueRow["proposal"] {
  if (!p) return null;
  return {
    taskId: p.candidate.taskId,
    taskName: p.candidate.taskName,
    confidence: p.confidence,
    method: p.method,
    reasons: p.reasons,
  };
}
