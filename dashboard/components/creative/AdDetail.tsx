"use client";

/**
 * The ad detail panel.
 *
 * Creative fixed on the left, everything else scrolling on the right. That
 * split is the whole design: the thing being judged stays on screen while you
 * read the numbers about it, and the numbers are what scroll — the alternative
 * puts the creative above the fold and the retention curve below it, so you
 * never see them together.
 *
 * ── Everything here comes from Meta ────────────────────────────────────────
 * The copy, the retention curve, the demographics and the placement split are
 * all obtainable from the ad itself. Nothing on this panel needs ClickUp, which
 * matters because ClickUp is the half that is not filled in yet — this panel
 * works fully on an untagged ad.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { loadBreakdowns } from "@/app/(app)/creative/actions";
import type { AdBreakdowns } from "@/lib/queries/creative";
import type { AdView } from "@/lib/creative/view";
import { RetentionCurve } from "@/components/creative/RetentionCurve";
import {
  ConfidenceChip,
  Tag,
  count,
  money,
  pct,
  ratePct,
  roas,
} from "@/components/creative/primitives";

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function AdDetail({
  ad,
  currency,
  clientId,
  onClose,
}: {
  ad: AdView;
  currency: string;
  clientId: string;
  onClose: () => void;
}) {
  const [breakdowns, setBreakdowns] = useState<AdBreakdowns | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while a modal is open, or a trackpad
    // flick moves the wrong surface.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    let live = true;
    loadBreakdowns(clientId, ad.adId)
      .then((b) => {
        if (live) setBreakdowns(b);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [clientId, ad.adId]);

  // ── Portalled to <body>, and this is not a stylistic choice ──────────────
  // `position: fixed` is only relative to the viewport while no ancestor
  // establishes a containing block, and several ordinary things do: a
  // transform, a filter, a backdrop-filter, `will-change`, or an element in
  // the middle of an animation. This modal renders inside `ProductTransition`,
  // which carries `animation: product-enter ... both` and therefore animates a
  // transform — so the scrim was being positioned against that box instead of
  // the window, which is why it sat low on the page with the panel running off
  // the bottom.
  //
  // The bug never appeared in a bare test page because that page had none of
  // those ancestors. Rendering into <body> removes the whole dependency on
  // what happens to be above this component in the tree.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ad.adName}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      /*
        The SCRIM scrolls, not the modal.
        ────────────────────────────────
        This was a fixed, centred box with max-height and three nested
        overflow contexts inside it. On any screen shorter than the content it
        clipped: the creative ended up below the fold and the metrics beside it
        were cut off mid-panel. Letting the scrim scroll and giving the modal
        no height cap removes the whole class of problem — tall content simply
        scrolls, short content stays centred by `min-h-full items-center`.

        The blur is deliberately light. At 14px over a pale page it stopped
        reading as "something is in front" and started reading as "the page has
        gone milky"; a firmer dim and a gentler blur says the same thing more
        clearly.
      */
      /*
        A literal rgba rather than `bg-ink-950/55`. The design tokens render an
        opacity modifier as `color-mix(in srgb, var(--ink-950) calc(.55*100%),
        transparent)`, and a scrim is the one place where a colour that fails
        to parse degrades to *nothing* — no dim at all, just a blur, which is
        precisely the milky wash this looked like. Every other translucent
        surface in the app can afford to fall back; this one cannot.
      */
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[rgba(10,10,11,0.55)] backdrop-blur-[5px]"
    >
      {/* `items-start` with `my-auto`, not `items-center`: a flex item taller
          than its container and centred overflows in BOTH directions, and the
          top half becomes unreachable by scrolling. This centres when it fits
          and top-aligns when it does not. */}
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
      <div className="glass-solid my-auto flex w-full max-w-[1080px] flex-col rounded-2xl shadow-xl">
        <header className="flex flex-shrink-0 items-start gap-3.5 border-b border-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="break-all font-mono text-[13px] font-medium text-content-strong">
              {ad.adName}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ad.conceptId && (
                <Tag value={`${ad.conceptId} ${ad.conceptName ?? ""}`.trim()} missing="concept" />
              )}
              <Tag value={ad.persona} missing="persona" />
              <Tag value={ad.angle} missing="angle" />
              <Tag value={ad.offer} missing="offer" />
              {ad.method && <Tag value={ad.method} missing="made by" tone="made" />}
              {ad.creator && <Tag value={ad.creator} missing="creator" />}
              {ad.stage && <Tag value={ad.stage} missing="stage" />}
              {ad.market && <Tag value={ad.market} missing="market" />}
              {ad.bodyHook && <Tag value={ad.bodyHook} missing="body/hook" />}
              <ConfidenceChip level={ad.confidence} />
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control border border-hairline-strong text-[17px] leading-none text-content-muted transition-colors duration-fast hover:bg-gray-100"
          >
            ×
          </button>
        </header>

        {/* One flow, no inner scrollers. The creative sticks to the top of its
            column on wide screens so it stays in view while the numbers scroll
            past it, which was the point of the two-column split. */}
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr]">
          <Creative ad={ad} />

          <div className="flex min-w-0 flex-col gap-6 p-5">
            <PrimaryMetrics ad={ad} currency={currency} />
            <SecondaryMetrics ad={ad} currency={currency} />

            <Block title="Diagnosis" source="ad level, no money verdict">
              <p className="m-0 text-[13px] leading-[1.6] text-content-body">
                <span className="font-medium text-content-strong">
                  {ad.diagnosisLabel}.
                </span>{" "}
                {ad.diagnosisSay}
                {ad.iterationType && (
                  <span className="text-content-muted">
                    {" "}
                    Iteration type {ad.iterationType}.
                  </span>
                )}
              </p>
            </Block>

            {ad.retention && ad.videoLengthSec ? (
              <Retention ad={ad} />
            ) : ad.format === "DYN" ? (
              <Block title="Retention" source="not ingested">
                <p className="m-0 text-[13px] leading-[1.6] text-content-muted">
                  No quartile data for this ad. Meta serves roughly 37 months of
                  insights and the video fields were added later, so older ads
                  keep nulls. A partial curve is not drawn — a line with a hole
                  in it reads as a collapse in retention rather than as absent
                  data.
                </p>
              </Block>
            ) : (
              <Block title="Retention" source="static">
                <p className="m-0 text-[13px] leading-[1.6] text-content-muted">
                  Meta reports no video metrics for a static. Judge this one on
                  CTR ({ratePct(ad.ctr)}) and cost per purchase (
                  {money(ad.cpa, currency)}).
                </p>
              </Block>
            )}

            <Copy ad={ad} />

            <Breakdowns
              data={breakdowns}
              failed={loadFailed}
              purchases={ad.purchases}
            />
          </div>
        </div>
      </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------

/**
 * The style that lets a creative be its own shape inside a bounded panel.
 *
 * `aspect-ratio` with `width: auto` and both maxima set is the one combination
 * where a replaced element keeps its proportions under two constraints at once:
 * a 9:16 hits the height cap and narrows, a 1:1 or a 4:5 hits the width and
 * shortens. Nothing is cropped in either direction, and nothing is letterboxed,
 * because the element is exactly the media's box.
 */
function mediaBox(ratio: number | null): CSSProperties {
  const bounds: CSSProperties = { width: "auto", maxWidth: "100%", maxHeight: "52vh" };
  // No stored shape: say nothing about the ratio and let the media's own
  // natural size drive the box. Measured, an explicit 4:5 fallback produced a
  // 420x376 box — neither 4:5 nor the creative's shape — because a fixed width
  // and a height cap cannot both hold. The cost of leaving it out is a small
  // reflow once the poster loads, on the eighteen assets whose shape was never
  // recorded; the cost of guessing is every one of them drawn wrong.
  return ratio ? { ...bounds, aspectRatio: String(ratio) } : bounds;
}

function Creative({ ad }: { ad: AdView }) {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const video = useRef<HTMLVideoElement>(null);

  const onTime = useCallback(() => {
    if (video.current) setT(video.current.currentTime);
  }, []);

  const length = ad.videoLengthSec ?? 0;

  return (
    <div className="flex flex-col gap-3.5 self-start border-b border-hairline p-5 lg:sticky lg:top-0 lg:border-b-0 lg:border-r">
      {/*
        ── The box takes the creative's shape, not the other way round ──────
        This was a fixed 4:5 box with `object-fit: cover`. Meta's vertical
        formats are 9:16, so about 28% of every video — the top and bottom of
        it, where the hook and the call to action live — was cut off before it
        reached the screen. The files were never cropped; the mirrored mp4s are
        720x1280 and 1080x1920. Only this rule was.

        `aspectRatio` is stored per asset, read from the file at mirror time, so
        the box is the right shape before the media loads and the panel does not
        reflow under the reader — a `preload="none"` video does not report its
        size until somebody presses play.

        Height is still capped: a 9:16 at the panel's full width would be about
        750px tall, which on a laptop is the whole window for one frame. The cap
        narrows it instead of cropping it.

        Where the shape is unknown — an older row, or an asset we could not
        reach — no ratio is asserted at all and the media's own natural size
        drives the box. It reflows once, and it is never drawn in a shape it
        does not have.
      */}
      <div className="flex justify-center">
        {ad.assetUrl && ad.assetKind === "video" ? (
          <video
            ref={video}
            src={ad.assetUrl}
            poster={ad.thumbUrl ?? undefined}
            muted
            playsInline
            // `preload="none"` is not a micro-optimisation: without it a grid
            // of forty tiles would pull 600 MB of video the moment the page
            // rendered.
            preload="none"
            controls
            onTimeUpdate={onTime}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={mediaBox(ad.aspectRatio)}
            className="rounded-lg border border-hairline bg-gray-50 object-contain shadow-sm"
          />
        ) : ad.assetUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed GCS
          // URL; next/image would cache one that expires within the hour.
          <img
            src={ad.assetUrl}
            alt=""
            style={mediaBox(ad.aspectRatio)}
            className="rounded-lg border border-hairline bg-gray-50 object-contain shadow-sm"
          />
        ) : (
          <div className="flex aspect-[4/5] max-h-[52vh] w-full items-center justify-center rounded-lg border border-hairline bg-gray-50 px-5 text-center shadow-sm">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
              no asset mirrored
            </span>
          </div>
        )}
      </div>

      {/* Only when there is something to play. A scrub bar under a placeholder
          reads as a broken player rather than as an unmirrored asset. */}
      {ad.assetUrl && ad.assetKind === "video" && length > 0 && (
        <div className="flex items-center gap-2.5">
          <span className="h-[5px] flex-1 overflow-hidden rounded-xs bg-gray-100">
            <span
              className="block h-full rounded-xs bg-accent transition-[width] duration-100"
              style={{ width: `${Math.min(100, (t / length) * 100).toFixed(1)}%` }}
            />
          </span>
          <span className="min-w-[66px] text-right font-mono text-[11px] text-content-muted">
            {mmss(t)} / {mmss(length)}
          </span>
        </div>
      )}

      {!ad.assetUrl && (
        <p className="m-0 text-[12px] leading-[1.55] text-content-muted">
          Meta&apos;s own URLs expire within hours, so the dashboard serves a
          copy from our bucket. This one has not been downloaded yet.
        </p>
      )}

      {ad.effectiveStatus && (
        <p className="m-0 font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
          {ad.effectiveStatus.toLowerCase()}
          {playing ? " · playing" : ""}
        </p>
      )}

      {(ad.clickupUrl || ad.briefUrl) && (
        <div className="flex flex-wrap gap-3 text-[12.5px]">
          {ad.clickupUrl && (
            <a href={ad.clickupUrl} target="_blank" rel="noreferrer" className="text-content-accent underline">
              ClickUp task
            </a>
          )}
          {ad.briefUrl && (
            <a href={ad.briefUrl} target="_blank" rel="noreferrer" className="text-content-accent underline">
              Brief
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PrimaryMetrics({ ad, currency }: { ad: AdView; currency: string }) {
  const tiles = [
    {
      k: "Purchases",
      v: count(ad.purchases),
      s: ad.impressions > 0
        ? `${((ad.purchases / ad.impressions) * 1000).toFixed(2)} per 1k impressions`
        : "",
    },
    { k: "Cost per purchase", v: money(ad.cpa, currency), s: "" },
    {
      k: "ROAS",
      v: roas(ad.roas),
      // The interval is on the tile, not in a tooltip. It is the number that
      // decides whether the headline figure means anything.
      s:
        ad.ciLow !== null && ad.ciHigh !== null
          ? `95% ${roas(ad.ciLow)}–${roas(ad.ciHigh)}`
          : "",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.k} className="glass px-4 py-3">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
            {t.k}
          </div>
          <div className="mt-1 font-mono text-[23px] font-medium tracking-heading tabular text-content-strong">
            {t.v}
          </div>
          {t.s && (
            <div className="mt-1 font-mono text-[10.5px] text-content-muted">{t.s}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SecondaryMetrics({ ad, currency }: { ad: AdView; currency: string }) {
  const rows: Array<[string, string]> = [
    ["Spend", money(ad.spend, currency)],
    ["Revenue", money(ad.revenue, currency)],
    ["Impressions", count(ad.impressions)],
    ["Reach", count(ad.reach)],
    ["CTR", ratePct(ad.ctr)],
    ["Outbound CTR", ratePct(ad.outboundCtr)],
    ["CPM", money(ad.cpm, currency)],
    ["Adds to cart", count(ad.addToCart)],
    ["Spend share", pct(ad.spendShare)],
  ];
  if (ad.format === "DYN") {
    rows.push(["Hook rate", ratePct(ad.hookRate)], ["Hold rate", ratePct(ad.holdRate)]);
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(92px,1fr))] gap-x-5">
      {rows.map(([k, v]) => (
        <div key={k} className="border-b border-hairline py-1.5">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
            {k}
          </div>
          <div className="mt-px font-mono text-[14px] tabular text-content-body">{v}</div>
        </div>
      ))}
    </div>
  );
}

function Retention({ ad }: { ad: AdView }) {
  return (
    <Block title="Retention" source="8 measured points">
      <RetentionCurve
        points={ad.retention!}
        lengthSec={ad.videoLengthSec!}
        marker={null}
      />
    </Block>
  );
}

function Copy({ ad }: { ad: AdView }) {
  if (!ad.copyPrimary && !ad.copyHeadline) {
    return (
      <Block title="Ad copy" source="not ingested">
        <p className="m-0 text-[13px] text-content-muted">
          No creative row for this ad yet. The nightly job reads it from
          <span className="font-mono"> /adcreative</span>, not from ClickUp.
        </p>
      </Block>
    );
  }
  return (
    <Block title="Ad copy" source="as Meta serves it">
      <div className="flex flex-col gap-3">
        {ad.copyPrimary && (
          <div>
            <div className="mb-1 font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
              Primary text
            </div>
            <p className="m-0 whitespace-pre-line text-[13px] leading-[1.55] text-content-body">
              {ad.copyPrimary}
            </p>
          </div>
        )}
        {ad.copyHeadline && (
          <div>
            <div className="mb-1 font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
              Headline
            </div>
            <p className="m-0 text-[14px] font-semibold leading-[1.3] text-content-strong">
              {ad.copyHeadline}
            </p>
          </div>
        )}
        {ad.copyDescription && (
          <div>
            <div className="mb-1 font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
              Description
            </div>
            <p className="m-0 text-[12.5px] text-content-muted">{ad.copyDescription}</p>
          </div>
        )}
        {ad.copyCta && (
          <span className="self-start rounded-control bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-content-strong">
            {ad.copyCta.replace(/_/g, " ").toLowerCase()}
          </span>
        )}
        {ad.copyVariants.length > 0 && (
          <details className="text-[12.5px] text-content-muted">
            {/* Advantage+ rotates several bodies at once. Ads Manager shows one
                at a time, so this is genuinely more than you can see there. */}
            <summary className="cursor-pointer">
              {ad.copyVariants.length} more text {ad.copyVariants.length === 1 ? "variant" : "variants"} in rotation
            </summary>
            <ul className="mt-2 flex list-none flex-col gap-2 p-0">
              {ad.copyVariants.map((v, i) => (
                <li key={i} className="whitespace-pre-line border-l-2 border-hairline pl-3">
                  {v}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Block>
  );
}

function Breakdowns({
  data,
  failed,
  purchases,
}: {
  data: AdBreakdowns | null;
  failed: boolean;
  purchases: number;
}) {
  if (failed) {
    return (
      <Block title="Delivery" source="unavailable">
        <p className="m-0 text-[13px] text-content-muted">
          Could not load the breakdowns.
        </p>
      </Block>
    );
  }
  if (!data) {
    return (
      <Block title="Delivery" source="loading">
        <p className="m-0 text-[13px] text-content-muted">Loading…</p>
      </Block>
    );
  }
  if (data.ages.length === 0 && data.placements.length === 0) {
    return (
      <Block title="Delivery" source="not ingested">
        <p className="m-0 text-[13px] text-content-muted">
          The age and placement breakdowns are separate Meta calls that have not
          run for this ad yet.
        </p>
      </Block>
    );
  }

  return (
    <>
      <Block title="Who saw it" source="impressions">
        {data.femaleShare !== null && (
          <div className="mb-2 flex flex-wrap gap-3.5 text-[12px] text-content-muted">
            <span>
              Women <b className="font-mono font-medium text-content-strong">{pct(data.femaleShare)}</b>
            </span>
            <span>
              Men{" "}
              <b className="font-mono font-medium text-content-strong">
                {pct(1 - data.femaleShare)}
              </b>
            </span>
          </div>
        )}
        <Bars slices={data.ages} colour="var(--growth-500)" />
        {/* The warning that keeps this panel honest. A single ad split six ways
            has single-digit purchases per bucket, so "which age group converts
            better" is a question this data cannot answer however confidently it
            renders. */}
        <p className="mt-2.5 border-l-2 border-hairline-strong pl-3 text-[12px] leading-[1.6] text-content-muted">
          Impression share, not ROAS. {purchases} purchases split six ways is
          single digits per bucket — read this for where Meta is putting the ad,
          not for which age group performs.
        </p>
      </Block>

      <Block title="Where it ran" source="impressions">
        <Bars slices={data.placements} colour="var(--info)" />
      </Block>
    </>
  );
}

function Bars({
  slices,
  colour,
}: {
  slices: Array<{ label: string; impressions: number }>;
  colour: string;
}) {
  const total = slices.reduce((a, s) => a + s.impressions, 0);
  const max = Math.max(1, ...slices.map((s) => s.impressions));
  return (
    <div className="flex flex-col gap-1.5">
      {slices.map((s) => (
        <div
          key={s.label}
          className="grid grid-cols-[104px_1fr_56px] items-center gap-2.5 text-[12px]"
        >
          <span className="truncate text-content-muted">{s.label}</span>
          <span className="h-[14px] overflow-hidden rounded-xs bg-gray-100">
            <span
              className="block h-full rounded-xs"
              style={{
                width: `${((s.impressions / max) * 100).toFixed(1)}%`,
                background: colour,
              }}
            />
          </span>
          <span className="text-right font-mono text-[11.5px] tabular text-content-body">
            {total > 0 ? `${((s.impressions / total) * 100).toFixed(1)}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Block({
  title,
  source,
  children,
}: {
  title: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h5 className="m-0 text-[12.5px] font-semibold tracking-heading text-content-strong">
          {title}
        </h5>
        <span className="rounded-xs border border-hairline-strong px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.09em] text-content-muted">
          {source}
        </span>
      </div>
      {children}
    </section>
  );
}
