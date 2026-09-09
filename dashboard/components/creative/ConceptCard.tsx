"use client";

/**
 * One concept, with its verdict.
 *
 * Motion-style: the concept's ads as a thumbnail strip, its three defining
 * chips, the figures, and a status chip with one line of plain text.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No decision band and no buttons. A card that offers "Scale" and "Kill" as
 * one-click actions turns the weekly review into a clicking exercise, and the
 * SOP is explicit that budget or status changes in Ads Manager happen only as
 * the execution of a logged decision. The card says what the engine thinks; the
 * person acts in Ads Manager and records it afterwards.
 */

import Link from "next/link";
import type { AdView, VerdictView } from "@/lib/creative/view";
import type { Confidence } from "@/lib/creative/stats";
import {
  ConfidenceChip,
  Tag,
  VerdictChip,
  money,
  pct,
  roas,
} from "@/components/creative/primitives";
import type { VerdictCode } from "@/lib/creative/verdict";

export interface ConceptCardData {
  key: string;
  conceptId: string | null;
  /** What a person wrote in ClickUp's `Concept ID`, or null. Never the task id. */
  conceptCode: string | null;
  /** The concept's own ClickUp task, where the angle and offer are edited. */
  clickupUrl: string | null;
  /** The Creatives grid, filtered to this concept. Null for the untagged group. */
  adsHref: string | null;
  name: string;
  persona: string | null;
  angle: string | null;
  offer: string | null;
  ads: AdView[];
  /** Null when no ad in the concept carries a Body code in ClickUp. */
  bodies: number | null;
  adsets: string[];
  spend: number;
  spendShare: number;
  purchases: number;
  cpa: number | null;
  roas: number | null;
  confidence: Confidence;
  verdict: VerdictView;
  ageDays: number | null;
  frequency: number | null;
}

export function ConceptCard({
  data,
  currency,
  onOpenAd,
}: {
  data: ConceptCardData;
  currency: string;
  /** Opens the ad detail panel. The strip is the way into the creative itself. */
  onOpenAd?: (ad: AdView) => void;
}) {
  const strip = data.ads.slice(0, 4);
  const extra = data.ads.length - strip.length;

  return (
    <article
      className={`glass mb-[11px] flex flex-wrap items-start gap-[18px] px-[18px] py-[15px] ${
        data.verdict.code === "kill" ? "border-negative/30" : ""
      }`}
    >
      <div className="flex flex-shrink-0 gap-1">
        {strip.map((ad) => (
          <button
            key={ad.adId}
            type="button"
            title={ad.adName}
            aria-label={`Open ${ad.adName}`}
            onClick={onOpenAd ? () => onOpenAd(ad) : undefined}
            disabled={!onOpenAd}
            className="relative block h-[50px] w-10 overflow-hidden rounded-[7px] border border-hairline bg-gray-100/70 p-0 transition-transform duration-fast enabled:cursor-pointer enabled:hover:scale-[1.06]"
          >
            {ad.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed,
              // short-lived GCS URL; next/image would cache one that expires.
              // `contain`, like the grid: at 40x50 either choice is a smudge,
              // but a cropped one misrepresents the composition of the creative
              // it is standing in for.
              <img src={ad.thumbUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span
                aria-hidden="true"
                className="block h-full w-full"
                style={{
                  background: `linear-gradient(150deg, hsl(${
                    [...ad.adId].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
                  } 42% 92%), hsl(${
                    ([...ad.adId].reduce((a, c) => a + c.charCodeAt(0), 0) + 40) % 360
                  } 38% 96%))`,
                }}
              />
            )}
          </button>
        ))}
        {extra > 0 &&
          (data.adsHref ? (
            <Link
              href={data.adsHref}
              title={`All ${data.ads.length} creatives in this concept`}
              className="flex h-[50px] w-10 items-center justify-center rounded-[7px] border border-dashed border-hairline-strong font-mono text-[11px] text-content-muted transition-colors duration-fast hover:border-accent/50 hover:text-content-accent"
            >
              +{extra}
            </Link>
          ) : (
            <span className="flex h-[50px] w-10 items-center justify-center rounded-[7px] border border-dashed border-hairline-strong font-mono text-[11px] text-content-muted">
              +{extra}
            </span>
          ))}
      </div>

      <div className="flex min-w-[210px] flex-1 flex-col gap-1.5">
        <span className="text-[14.5px] font-semibold tracking-heading text-content-strong">
          {/* The code only when a person wrote one. `conceptId` falls back to
              the ClickUp task id so the joins always resolve, and printing
              `86ca9t2h4` beside a concept name reads as a name somebody chose. */}
          {data.conceptCode && (
            <span className="mr-1.5 font-mono text-[11.5px] font-medium text-content-muted">
              {data.conceptCode}
            </span>
          )}
          {data.name}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Tag value={data.persona} missing="persona" />
          <Tag value={data.angle} missing="angle" />
          <Tag value={data.offer} missing="offer" />
        </span>
        <span className="text-[12px] text-content-muted">
          {data.ads.length} {data.ads.length === 1 ? "ad" : "ads"} ·{" "}
          {data.bodies === null
            ? "body not coded"
            : `${data.bodies} ${data.bodies === 1 ? "body" : "bodies"}`}{" "}
          · {data.adsets.join(", ")}
          {data.ageDays !== null && ` · ${data.ageDays} days old`}
          {data.frequency !== null && ` · freq ${data.frequency.toFixed(1)}`}
        </span>
        {(data.adsHref || data.clickupUrl) && (
          <span className="flex flex-wrap gap-3 text-[12.5px]">
            {data.adsHref && (
              <Link href={data.adsHref} className="text-content-accent underline underline-offset-2">
                See the {data.ads.length} {data.ads.length === 1 ? "creative" : "creatives"}
              </Link>
            )}
            {data.clickupUrl && (
              <a
                href={data.clickupUrl}
                target="_blank"
                rel="noreferrer"
                className="text-content-accent underline underline-offset-2"
              >
                Edit the concept
              </a>
            )}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-5">
        {[
          ["Spend", money(data.spend, currency)],
          ["Share", pct(data.spendShare)],
          ["Purchases", String(data.purchases)],
          ["CPA", money(data.cpa, currency)],
          ["ROAS", roas(data.roas)],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-[58px] flex-col gap-px">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-content-muted">
              {k}
            </span>
            <span className="font-mono text-[15px] tabular text-content-strong">{v}</span>
          </div>
        ))}
      </div>

      {/* Fixed width and pushed right, rather than a flex item that grows.
          A long "not separable" sentence used to make this wrap onto its own
          full-width row, so one card in a column of otherwise identical cards
          was laid out differently — which reads as a rendering bug rather than
          as a longer message. */}
      <div className="ml-auto flex w-full flex-none flex-col items-end gap-1.5 text-right lg:w-[280px]">
        <span className="flex gap-1.5">
          <ConfidenceChip level={data.confidence} />
          <VerdictChip code={data.verdict.code as VerdictCode} label={data.verdict.label} />
        </span>
        <span className="text-[12.5px] leading-[1.45] text-content-muted">
          {data.verdict.say}
        </span>
      </div>
    </article>
  );
}
