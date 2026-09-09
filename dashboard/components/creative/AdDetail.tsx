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

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addNote, loadBreakdowns, loadNotes } from "@/app/(app)/creative/actions";
import type { CreativeNote, TaskActivity } from "@/lib/creative/clickup";
import type { AdBreakdowns } from "@/lib/queries/creative";
import type { AdView } from "@/lib/creative/view";
import type { RangeLabel } from "@/lib/params";
import { RetentionCurve } from "@/components/creative/RetentionCurve";
import { CONFIDENCE_LABELS } from "@/lib/creative/stats";
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
  thresholds,
  rangeLabel,
  onClose,
}: {
  ad: AdView;
  currency: string;
  clientId: string;
  /**
   * The client's own lines. Null when they have not been set, and then every
   * metric card renders without a verdict dot rather than inventing one — the
   * same rule the rest of the product follows.
   */
  thresholds?: { targetCpa: number; targetRoas: number; killRoas: number } | null;
  /**
   * The period every number on this panel is scoped to. The panel covers the
   * page, and with it the picker that set the range — so without this the
   * reader is looking at a CPA with no idea which weeks produced it.
   */
  rangeLabel?: RangeLabel | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "breakdowns" | "notes">("overview");
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
      <div className="my-auto flex w-full max-w-[1080px] flex-col rounded-2xl border border-hairline bg-bg-subtle shadow-xl">
        <header className="flex flex-shrink-0 items-start gap-4 border-b border-hairline px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="break-all font-mono text-[21px] font-medium leading-[1.2] tracking-heading text-content-strong">
              {ad.adName}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              {/* Delivery, beside the reading confidence rather than buried
                  under the creative. Whether an ad is still running is the
                  first thing that qualifies every number below it — a 1.2x
                  ROAS on something paused three weeks ago is a different
                  statement from the same figure on something live. */}
              {ad.effectiveStatus && <StatusChip status={ad.effectiveStatus} />}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            {rangeLabel && (
              <span className="hidden items-baseline gap-2 rounded-lg border border-hairline px-3.5 py-2 font-mono text-[12px] uppercase tracking-[0.06em] sm:inline-flex">
                <span className="text-content-body">{rangeLabel.label}</span>
                {rangeLabel.dates && (
                  <span className="text-content-muted">{rangeLabel.dates}</span>
                )}
              </span>
            )}
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-hairline text-[18px] leading-none text-content-muted transition-colors duration-fast hover:bg-gray-100"
            >
              ×
            </button>
          </div>
        </header>

        {/* The creative stays put across all three tabs — it is the subject of
            every one of them, and re-rendering it per tab would restart a video
            somebody was halfway through. */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
          <Creative ad={ad} />

          <div className="flex min-w-0 flex-col gap-7 p-6">
            {/* ── Overview / Breakdowns / Notes ────────────────────────
                Inside the right column, not spanning the panel. The creative
                is the subject of all three tabs and does not belong under a
                control that switches between them; putting the bar over both
                columns said the opposite, and left the creative starting a row
                lower than the numbers it is read against. */}
            <nav
              role="tablist"
              aria-label="Creative detail"
              className="-mx-6 -mt-6 mb-1 flex gap-8 border-b border-hairline px-6"
            >
              {(["overview", "breakdowns", "notes"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 py-4 text-[15.5px] font-medium capitalize transition-colors duration-fast ${
                    tab === t
                      ? "border-accent text-content-strong"
                      : "border-transparent text-content-muted hover:text-content-body"
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>

            {tab === "overview" && (
              <>
                <Metrics ad={ad} currency={currency} thresholds={thresholds ?? null} />

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
                      No quartile data for this ad. Meta serves roughly 37 months
                      of insights and the video fields were added later, so older
                      ads keep nulls. A partial curve is not drawn — a line with a
                      hole in it reads as a collapse in retention rather than as
                      absent data.
                    </p>
                  </Block>
                ) : (
                  <Block title="Retention" source="static">
                    <p className="m-0 text-[13px] leading-[1.6] text-content-muted">
                      Meta reports no video metrics for a static. Judge this one
                      on CTR ({ratePct(ad.ctr)}) and cost per purchase (
                      {money(ad.cpa, currency)}).
                    </p>
                  </Block>
                )}

                <Copy ad={ad} />
              </>
            )}

            {tab === "breakdowns" && (
              <Breakdowns
                data={breakdowns}
                failed={loadFailed}
                purchases={ad.purchases}
                currency={currency}
              />
            )}

            {tab === "notes" && (
              <Notes clientId={clientId} taskId={ad.clickupTaskId} url={ad.clickupUrl} />
            )}
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
 * The note thread, which is ClickUp's thread.
 *
 * ── Why it is not our own comment box ─────────────────────────────────────
 * The conversation about a creative already happens on its ClickUp task —
 * the brief, the reviewer's changes, "this one won, do six hooks off it" —
 * written by people who never open this dashboard. A second comment box in a
 * second system produces two half-threads and an argument about which is
 * current. So this reads and writes the same thread they do.
 *
 * Loaded when the tab is opened, not with the panel: most opens are to check a
 * number, and a ClickUp round trip on every one would cost a second on a tab
 * nobody clicked.
 */
function Notes({
  clientId,
  taskId,
  url,
}: {
  clientId: string;
  taskId: string | null;
  url: string | null;
}) {
  const [notes, setNotes] = useState<CreativeNote[] | null>(null);
  const [activity, setActivity] = useState<TaskActivity | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadNotes(taskId)
      .then((r) => {
        if (!live) return;
        setNotes(r.notes);
        setActivity(r.activity);
        setUnavailable(r.unavailable);
      })
      .catch(() => live && setUnavailable("Could not load the thread."));
    return () => {
      live = false;
    };
  }, [taskId]);

  async function send() {
    if (!taskId || !draft.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await addNote({ clientId, taskId, text: draft });
    setBusy(false);
    if (result.ok) {
      setNotes(result.notes);
      setDraft("");
    } else {
      setProblem(result.message);
    }
  }

  return (
    <Block
      title="Notes"
      source={taskId ? "the ClickUp task's own thread" : "no task mapped"}
    >
      {unavailable ? (
        <p className="m-0 max-w-[68ch] text-[13px] leading-[1.6] text-content-muted">
          {unavailable}
        </p>
      ) : notes === null ? (
        <p className="m-0 text-[13px] text-content-muted">Loading the thread…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ── What the task itself records ──────────────────────────────
              ClickUp's v2 API has no audit log, so a field-by-field history
              is not obtainable at any price. What it does expose is the
              creation, every status the task has held and how long it sat in
              each, the assignees, and the last touch — which is enough to
              answer "what happened to this creative and who did it". The gap
              is stated rather than papered over. */}
          {activity && (
            <div className="flex flex-col gap-2 rounded-card border border-hairline bg-paper/60 px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
                  Activity
                </span>
                {activity.assignees.length > 0 && (
                  <span className="text-[12px] text-content-muted">
                    {activity.assignees.join(", ")}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1 text-[12.5px] text-content-body">
                {activity.createdAt && (
                  <div className="flex justify-between gap-3">
                    <span>
                      Created{activity.createdBy ? ` by ${activity.createdBy}` : ""}
                    </span>
                    <span className="font-mono text-[11.5px] text-content-muted">
                      {when(activity.createdAt)}
                    </span>
                  </div>
                )}
                {activity.updatedAt && (
                  <div className="flex justify-between gap-3">
                    <span>Last touched</span>
                    <span className="font-mono text-[11.5px] text-content-muted">
                      {when(activity.updatedAt)}
                    </span>
                  </div>
                )}
              </div>

              {activity.statuses.length > 0 && (
                <div className="mt-1 flex flex-col gap-1 border-t border-hairline pt-2">
                  {activity.statuses.map((st) => (
                    <div key={st.status} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-[12.5px]">
                        <i
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${
                            st.current ? "bg-accent" : "bg-hairline-strong"
                          }`}
                        />
                        <span className={st.current ? "text-content-strong" : "text-content-body"}>
                          {st.status}
                        </span>
                        {st.current && (
                          <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
                            now
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[11.5px] text-content-muted">
                        {duration(st.minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="m-0 text-[11.5px] leading-[1.5] text-content-muted">
                Creation, status history and comments are everything ClickUp&apos;s
                API exposes — there is no per-field edit log to read.
              </p>
            </div>
          )}

          {notes.length === 0 ? (
            <p className="m-0 text-[13px] text-content-muted">
              No notes on this task yet. The first one posts to ClickUp, where
              the rest of the team will see it.
            </p>
          ) : (
            notes.map((n) => (
              <article
                key={n.id}
                className="rounded-card border border-hairline bg-paper/60 px-3.5 py-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-content-strong">
                    {n.author}
                  </span>
                  <span className="font-mono text-[10.5px] text-content-muted">
                    {n.at ? new Date(n.at).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    }) : ""}
                    {n.replies > 0 && ` · ${n.replies} ${n.replies === 1 ? "reply" : "replies"}`}
                  </span>
                </div>
                <p className="m-0 mt-1 whitespace-pre-line text-[13px] leading-[1.55] text-content-body">
                  {n.text}
                </p>
              </article>
            ))
          )}

          {taskId && (
            <div className="flex flex-col gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder="Add a note. It posts to the ClickUp task, under your name."
                className="w-full resize-y rounded-card border border-hairline-strong bg-paper px-3 py-2 text-[13px] leading-[1.55] text-content-body outline-none transition-colors duration-fast focus:border-accent/50"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={send}
                  disabled={busy || draft.trim().length === 0}
                  className="rounded-control bg-ink-950 px-3.5 py-1.5 text-[12.5px] font-medium text-paper transition-opacity duration-fast disabled:opacity-40"
                >
                  {busy ? "Posting…" : "Post to ClickUp"}
                </button>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12.5px] text-content-accent underline underline-offset-2"
                  >
                    Open the task
                  </a>
                )}
                {problem && (
                  <span className="text-[12.5px] text-negative">{problem}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

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
  // Full column width, height following the creative's own shape. There is no
  // height cap: the brief was that the preview fills the entire left side, and
  // a cap is what stops it — a capped box has to give up either the width or
  // the ratio, and giving up the ratio is the crop this whole change removed.
  // The panel scrolls, so a tall 9:16 costs a scroll rather than a crop.
  const bounds: CSSProperties = { width: "100%", maxWidth: "100%" };
  // No stored shape: say nothing about the ratio and let the media's own
  // natural size drive the box. Measured, an explicit 4:5 fallback produced a
  // 420x376 box — neither 4:5 nor the creative's shape — because a fixed width
  // and a height cap cannot both hold. The cost of leaving it out is a small
  // reflow once the poster loads, on the eighteen assets whose shape was never
  // recorded; the cost of guessing is every one of them drawn wrong.
  return ratio ? { ...bounds, aspectRatio: String(ratio) } : { ...bounds, height: "auto" };
}

function Creative({ ad }: { ad: AdView }) {
  const [t, setT] = useState(0);
  const [feed, setFeed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const onTime = useCallback(() => {
    if (video.current) setT(video.current.currentTime);
  }, []);

  const length = ad.videoLengthSec ?? 0;
  const isVideo = ad.assetKind === "video";

  /*
    ── The creative sits in a card, at its own shape ────────────────────────
    Sized to the column and to the creative's stored aspect ratio, so a 9:16
    is tall and narrow and a 1:1 is square, and neither is cropped. The shape
    is read from the file at mirror time precisely so the box is right before
    the media loads — a `preload="none"` video reports nothing until somebody
    presses play, and a box that resizes under the reader is worse than one
    that waits.
  */
  const media =
    ad.assetUrl && isVideo ? (
      <video
        ref={video}
        src={ad.assetUrl}
        poster={ad.thumbUrl ?? undefined}
        muted
        playsInline
        // Without this a grid of forty tiles pulls 600 MB the moment the page
        // renders.
        preload="none"
        controls
        onTimeUpdate={onTime}
        style={mediaBox(ad.aspectRatio)}
        className="block object-contain"
      />
    ) : ad.assetUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- signed GCS URL;
      // next/image would cache one that expires within the hour.
      <img
        src={ad.assetUrl}
        alt=""
        style={mediaBox(ad.aspectRatio)}
        className="block object-contain"
      />
    ) : (
      <div className="flex aspect-[4/5] w-full items-center justify-center px-5 text-center">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          no asset mirrored
        </span>
      </div>
    );

  return (
    <div className="flex flex-col gap-4 self-start border-b border-hairline p-6 lg:sticky lg:top-0 lg:border-b-0 lg:border-r">
      {feed ? (
        <FeedPreview ad={ad}>{media}</FeedPreview>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-accent-soft shadow-sm">
          {media}
          {/* What kind of creative this is, on the creative. The format line
              below gives the pixels; this gives the thing you judge first,
              and it has to be legible against whatever the image happens to
              be, hence the solid dark pill rather than a tint. */}
          <span className="absolute bottom-3 left-3 inline-flex items-center rounded-lg bg-bg-inverse px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-content-inverse">
            {isVideo ? (length > 0 ? `video ${mmss(length)}` : "video") : "still image"}
          </span>
        </div>
      )}

      {/* ── The two things you do to a creative that are not reading it ────
          Look at it as it was served, and take a copy away. */}
      <div className="flex items-stretch gap-2.5">
        <button
          type="button"
          onClick={() => setFeed((v) => !v)}
          aria-pressed={feed}
          disabled={!ad.copyPrimary && !ad.copyHeadline && !ad.copyCta}
          className={`flex-1 rounded-lg border py-3 text-[14px] font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${
            feed
              ? "border-accent bg-accent-soft text-content-strong"
              : "border-hairline text-content-strong hover:bg-gray-50"
          }`}
        >
          Feed preview
        </button>
        <a
          href={ad.downloadUrl ?? undefined}
          aria-disabled={!ad.downloadUrl}
          aria-label="Download the creative"
          title="Download the creative"
          className={`flex w-[52px] items-center justify-center rounded-lg border border-hairline text-[17px] leading-none text-content-strong transition-colors duration-fast ${
            ad.downloadUrl ? "hover:bg-gray-50" : "pointer-events-none opacity-40"
          }`}
        >
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 2.5v9m0 0 3.5-3.5M8 11.5 4.5 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>

      {/* Only when there is something to play. A scrub bar under a placeholder
          reads as a broken player rather than as an unmirrored asset. */}
      {ad.assetUrl && isVideo && length > 0 && (
        <div className="flex items-center gap-2.5">
          <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-gray-100">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-100"
              style={{ width: `${Math.min(100, (t / length) * 100).toFixed(1)}%` }}
            />
          </span>
          <span className="min-w-[66px] text-right font-mono text-[11px] tabular text-content-muted">
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

      {/* ── The spec line ────────────────────────────────────────────────
          The three facts that qualify the picture above them: what shape it
          actually is, how much of the account it is holding, and how much
          weight its numbers can carry. Delivery status sits up beside the
          name, where it qualifies the metrics too. */}
      <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3.5">
        <dt className="font-mono text-[11.5px] uppercase tracking-[0.07em] text-content-muted">
          Format
        </dt>
        <dd className="m-0 text-right font-mono text-[13px] tabular text-content-strong">
          {ad.assetWidth && ad.assetHeight
            ? `${ad.assetWidth}×${ad.assetHeight}`
            : DASH}
        </dd>
        <dt className="font-mono text-[11.5px] uppercase tracking-[0.07em] text-content-muted">
          Spend share
        </dt>
        <dd className="m-0 text-right font-mono text-[13px] tabular text-content-strong">
          {csPct(ad.spendShare)}
        </dd>
        <dt className="font-mono text-[11.5px] uppercase tracking-[0.07em] text-content-muted">
          Learning
        </dt>
        <dd className="m-0 text-right text-[13px] text-content-strong">
          {CONFIDENCE_LABELS[ad.confidence]}
        </dd>
      </dl>

      {(ad.clickupUrl || ad.briefUrl) && (
        <div className="flex flex-wrap gap-4 text-[13px]">
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

/** "SHOP_NOW" as something a person would read. */
function ctaLabel(raw: string): string {
  const words = raw.toLowerCase().split("_").filter(Boolean);
  if (!words.length) return raw;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ` ${words.slice(1).join(" ")}` : "");
}

/**
 * The creative with its copy around it, in the shape the feed puts them.
 *
 * ── Why this is assembled here and not fetched from Meta ──────────────────
 * Meta will render the real thing: `/{ad_id}/previews` returns an iframe that
 * is pixel-exact, including the profile picture and the current chrome. Two
 * things rule it out for this panel. It needs a Meta access token in the
 * dashboard's own environment — the dashboard has never held one, it reads the
 * warehouse and nothing else, and adding a token to a Vercel app to draw a
 * preview is a real widening of what a leak of that app would cost. And the
 * iframe URL expires, so it cannot be signed alongside the asset and rendered
 * from a server component; it would need a live call per open.
 *
 * What this shows instead is the assembly: the primary text above, the media,
 * then the headline, description and call to action in the bar beneath. That
 * is the question a creative person is actually asking here — does the hook
 * survive the truncation, does the headline still make sense under the frame —
 * and every field is the one Meta is serving, read from the same creative row.
 *
 * It is deliberately not dressed up as a real Facebook card. There is no fake
 * profile picture and no fake engagement row, because a mock that looks exact
 * invites people to trust the parts that are not.
 */
function FeedPreview({ ad, children }: { ad: AdView; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-hairline bg-ink-950/[0.02] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">
          As assembled
        </span>
        <span className="text-[11px] text-content-muted">not Meta&apos;s renderer</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-sm">
        {ad.copyPrimary && (
          <p className="m-0 whitespace-pre-line px-3.5 pb-3 pt-3.5 text-[13px] leading-[1.5] text-content-body">
            {ad.copyPrimary}
          </p>
        )}

        {children}

        {(ad.copyHeadline || ad.copyDescription || ad.copyCta) && (
          <div className="flex items-center gap-3 border-t border-hairline px-3.5 py-3">
            <div className="min-w-0 flex-1">
              {ad.copyHeadline && (
                <div className="truncate text-[13px] font-medium text-content-strong">
                  {ad.copyHeadline}
                </div>
              )}
              {ad.copyDescription && (
                <div className="truncate text-[12px] text-content-muted">
                  {ad.copyDescription}
                </div>
              )}
            </div>
            {ad.copyCta && (
              <span className="flex-shrink-0 rounded-control bg-gray-100 px-2.5 py-1.5 text-[12px] font-medium text-content-strong">
                {ctaLabel(ad.copyCta)}
              </span>
            )}
          </div>
        )}
      </div>

      {ad.copyVariants.length > 0 && (
        <p className="m-0 text-[11.5px] leading-[1.5] text-content-muted">
          Advantage+ rotates {ad.copyVariants.length + 1} text variants on this ad.
          The first is shown; the rest are under Overview.
        </p>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Numbers, in the reader's own convention
// ---------------------------------------------------------------------------

/**
 * ── Why this panel formats differently from the rest of the app ───────────
 * The design this panel is built to writes every figure the Czech way: a space
 * between thousands, a comma for the decimal point, a space before the percent
 * sign, and the currency as a symbol AFTER the number — `4 769 Kč`, not
 * `CZK 4,769`. Everywhere else in the dashboard still uses `formatMoney`,
 * which is en-US.
 *
 * That inconsistency is real and it is deliberate for now: the design was
 * approved as drawn, and it is confined to this one panel until somebody
 * decides whether the whole product moves. It is stated here rather than
 * discovered later, because a grid tile reading `CZK 48,210` above a panel
 * reading `48 210 Kč` for the same ad is otherwise just a bug.
 */
const CS = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const csDec = (v: number, d: number) =>
  new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

/** A number and the small grey thing printed after it, kept apart on purpose. */
interface Figure {
  v: string;
  unit?: string;
}

const DASH = "\u2014";

/**
 * Currency as a symbol, because the design sets it in the small grey slot
 * beside the number and a three-letter code reads as part of the figure there.
 * Anything unmapped keeps its ISO code, which is ugly and unambiguous.
 */
const SYMBOL: Record<string, string> = {
  CZK: "K\u010d",
  EUR: "\u20ac",
  USD: "$",
  GBP: "\u00a3",
  PLN: "z\u0142",
  HUF: "Ft",
  RON: "lei",
};
const symbolOf = (currency: string) => SYMBOL[currency.toUpperCase()] ?? currency.toUpperCase();

const csCount = (v: number | null): Figure =>
  v === null ? { v: DASH } : { v: CS.format(Math.round(v)) };

const csMoney = (v: number | null, currency: string): Figure =>
  v === null ? { v: DASH } : { v: CS.format(Math.round(v)), unit: symbolOf(currency) };

/** Whole percent, with the space cs-CZ puts before the sign. */
const csPct = (v: number | null): string =>
  v === null ? DASH : `${CS.format(Math.round(v * 100))} %`;

/**
 * Two decimals on a metric card, one in a breakdown row.
 *
 * Not an inconsistency: a card is the figure being judged against a benchmark
 * of 1,50 %, and at one decimal a 1,44 % and a 1,54 % both print as different
 * numbers from the benchmark but the same distance from it. A breakdown row is
 * a share, read for shape down the column, where the second decimal is noise.
 */
const csRate = (v: number | null): Figure =>
  v === null ? { v: DASH } : { v: csDec(v * 100, 2), unit: "%" };

const csRateFlat = (v: number | null): string =>
  v === null ? DASH : `${csDec(v * 100, 1)} %`;

const csRoas = (v: number | null): Figure =>
  v === null ? { v: DASH } : { v: csDec(v, 2), unit: "\u00d7" };

/**
 * The pill beside a section title — INGESTED, STATIC, NOT INGESTED.
 *
 * Green when the data is really there, neutral when it is not, because the
 * whole point of the badge is to say whether the chart under it is drawn from
 * something or from nothing.
 */
function SourcePill({ label, live = true }: { label: string; live?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.09em] ${
        live
          ? "bg-accent-soft text-growth-700"
          : "border border-hairline-strong text-content-muted"
      }`}
    >
      {label}
    </span>
  );
}

/** A section title with its provenance pill, and whatever legend sits opposite. */
function SectionHeading({
  title,
  pill,
  live = true,
  aside,
}: {
  title: string;
  pill: string;
  live?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-3">
      <h5 className="m-0 text-[17px] font-semibold tracking-heading text-content-strong">
        {title}
      </h5>
      <SourcePill label={pill} live={live} />
      {aside && <div className="ml-auto flex items-center gap-5">{aside}</div>}
    </div>
  );
}

/** The white surface every chart and card on this panel sits on. */
const CARD = "rounded-2xl border border-hairline bg-surface-card shadow-sm";

/** A ClickUp epoch, as a date somebody can read. */
function when(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Minutes, rounded to the largest unit that still says something useful. */
function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

/** Delivery, as Meta reports it. Green only when it is actually running. */
function StatusChip({ status }: { status: string }) {
  const live = status.toUpperCase() === "ACTIVE";
  const label = status.toLowerCase().replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-pill px-3 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.08em] ${
        live ? "bg-accent-soft text-growth-700" : "bg-gray-100 text-content-muted"
      }`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/**
 * ── One card per metric, and a dot that says how to read it ───────────────
 * The panel used to draw three headline tiles and then a run of bare
 * label/value pairs, which made a CPA over target look exactly like an
 * impression count. Every card now carries a verdict dot — green where the
 * figure is where you want it, amber where it is drifting, red where it is
 * not — and a sub-line naming the thing it is being judged against.
 *
 * A metric with nothing to judge it against gets NO dot rather than a grey
 * one. Impressions are not good or bad; a dot on them would be decoration
 * pretending to be information.
 */
type Verdict = "good" | "warn" | "bad" | null;

const DOT: Record<"good" | "warn" | "bad", string> = {
  good: "var(--positive)",
  warn: "var(--warning)",
  bad: "var(--negative)",
};

const TINT: Record<"good" | "warn" | "bad", string> = {
  good: "bg-accent-soft",
  warn: "bg-warning/[0.08]",
  bad: "bg-negative/[0.07]",
};

interface Metric {
  k: string;
  /** The figure and the small grey unit that follows it, kept apart. */
  f: Figure;
  s?: string;
  verdict?: Verdict;
  /** The three that lead: bigger type, no tint, verdict dot in the corner. */
  big?: boolean;
}

/**
 * ── One card per metric, and a dot that says how to read it ───────────────
 * The panel used to draw three headline tiles and then a run of bare
 * label/value pairs, which made a CPA over target look exactly like an
 * impression count.
 *
 * The three leading cards carry their verdict in the top-right corner and stay
 * white; the rest carry it as a dot in front of the label and tint the whole
 * card. That is not decoration — at a glance the reader sees which half of the
 * grid is coloured before reading a single number, and the leading three keep
 * their weight by staying plain.
 *
 * A card with nothing to judge still shows a grey dot in the secondary rows,
 * so the label column stays aligned down the grid. Grey is the absence of a
 * verdict, and it never appears in the leading row where it would read as one.
 */
function MetricCard({ m }: { m: Metric }) {
  const dot = m.verdict ? DOT[m.verdict] : "var(--gray-250)";

  if (m.big) {
    return (
      <div className={`${CARD} flex flex-col justify-between px-5 py-4`}>
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-content-muted">
            {m.k}
          </span>
          {m.verdict && (
            <span
              aria-hidden="true"
              className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ background: DOT[m.verdict] }}
            />
          )}
        </div>
        <Figures f={m.f} size="text-[34px]" unitSize="text-[15px]" />
        {m.s && <div className="mt-2.5 font-mono text-[12.5px] text-content-muted">{m.s}</div>}
      </div>
    );
  }

  return (
    <div
      className={`${CARD} flex flex-col justify-between px-5 py-4 ${
        m.verdict ? TINT[m.verdict] : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ background: dot }}
        />
        <span className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-content-muted">
          {m.k}
        </span>
      </div>
      <Figures f={m.f} size="text-[26px]" unitSize="text-[13px]" />
      {m.s && <div className="mt-2 font-mono text-[12.5px] text-content-muted">{m.s}</div>}
    </div>
  );
}

/** The number, and its unit set smaller and greyer beside it. */
function Figures({ f, size, unitSize }: { f: Figure; size: string; unitSize: string }) {
  return (
    <div className="mt-2 flex items-baseline gap-1.5">
      <span
        className={`font-mono font-medium leading-none tracking-heading tabular text-content-strong ${size}`}
      >
        {f.v}
      </span>
      {f.unit && (
        <span className={`font-mono leading-none text-content-muted ${unitSize}`}>{f.unit}</span>
      )}
    </div>
  );
}

function Metrics({
  ad,
  currency,
  thresholds,
}: {
  ad: AdView;
  currency: string;
  /** Null when the client has set no lines: every card then goes dotless. */
  thresholds: { targetCpa: number; targetRoas: number; killRoas: number } | null;
}) {
  // Judgements, each stated once. `null` wherever there is no line to judge
  // against — which is the whole account when nobody has set the thresholds.
  const cpaVerdict: Verdict =
    !thresholds || ad.cpa === null
      ? null
      : ad.cpa <= thresholds.targetCpa
        ? "good"
        : ad.cpa <= thresholds.targetCpa * 1.25
          ? "warn"
          : "bad";

  const roasVerdict: Verdict =
    !thresholds || ad.roas === null
      ? null
      : ad.roas >= thresholds.targetRoas
        ? "good"
        : ad.roas >= thresholds.killRoas
          ? "warn"
          : "bad";

  const cards: Metric[] = [
    {
      k: "Purchases",
      f: csCount(ad.purchases),
      big: true,
      s:
        ad.impressions > 0
          ? `${csDec((ad.purchases / ad.impressions) * 1000, 2)} / 1k impressions`
          : undefined,
      // Purchases alone carry no target — the CPA card beside it is where that
      // is judged, and a second dot on the same judgement is not information.
      verdict: null,
    },
    {
      k: "Cost / purch.",
      f: csMoney(ad.cpa, currency),
      big: true,
      s: thresholds
        ? `target ≤ ${csMoney(thresholds.targetCpa, currency).v} ${symbolOf(currency)}`
        : "no target set",
      verdict: cpaVerdict,
    },
    {
      k: "ROAS",
      f: csRoas(ad.roas),
      big: true,
      // The interval is on the card, not in a tooltip. It is the number that
      // decides whether the headline figure means anything at all.
      s:
        ad.ciLow !== null && ad.ciHigh !== null
          ? `95 % CI ${csDec(ad.ciLow, 2)}–${csDec(ad.ciHigh, 2)}`
          : undefined,
      verdict: roasVerdict,
    },

    {
      k: "Spend",
      f: csMoney(ad.spend, currency),
      s: `${csPct(ad.spendShare)} of account spend`,
    },
    {
      k: "Revenue",
      f: csMoney(ad.revenue, currency),
      s: `${csCount(ad.purchases).v} purchases`,
      verdict: ad.revenue > 0 ? "good" : null,
    },
    {
      k: "Impressions",
      f: csCount(ad.impressions),
      // Frequency rather than "delivered": impressions over reach is the fact
      // that qualifies the impression count, and it is free to compute here.
      s:
        ad.reach && ad.reach > 0
          ? `${csDec(ad.impressions / ad.reach, 2)} frequency`
          : "delivered",
    },

    { k: "Reach", f: csCount(ad.reach), s: "people reached" },
    {
      k: "CTR (all)",
      f: csRate(ad.ctr),
      // 1.5% is the account-level reference the learnings file uses for a
      // static; it is a benchmark, not a threshold anybody set, and it is
      // labelled as one.
      s: "benchmark 1,50 %",
      verdict: ad.ctr === null ? null : ad.ctr >= 0.015 ? "good" : ad.ctr >= 0.01 ? "warn" : "bad",
    },
    {
      k: "Outbound CTR",
      f: csRate(ad.outboundCtr),
      s: "clicks that left Meta",
      verdict:
        ad.outboundCtr === null
          ? null
          : ad.outboundCtr >= 0.01
            ? "good"
            : ad.outboundCtr > 0
              ? "warn"
              : "bad",
    },

    { k: "CPM", f: csMoney(ad.cpm, currency), s: "per 1k impressions" },
    { k: "Adds to cart", f: csCount(ad.addToCart), s: "from this ad" },
  ];

  if (ad.format === "DYN") {
    cards.push(
      {
        k: "Hook rate",
        f: csRate(ad.hookRate),
        s: "plays over impressions",
      },
      {
        k: "Hold rate",
        f: csRate(ad.holdRate),
        s: "thruplays over impressions",
        verdict:
          ad.holdRate === null ? null : ad.holdRate >= 0.05 ? "good" : ad.holdRate >= 0.03 ? "warn" : "bad",
      }
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((m) => (
        <MetricCard key={m.k} m={m} />
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
  currency,
}: {
  data: AdBreakdowns | null;
  failed: boolean;
  /** Kept for the empty-state copy, which names how thin the split would be. */
  purchases: number;
  currency: string;
}) {
  const total = (data?.ages ?? []).reduce((a, s) => a + s.impressions, 0);
  const placeTotal = (data?.placements ?? []).reduce((a, s) => a + s.impressions, 0);

  if (failed) {
    return (
      <section>
        <SectionHeading title="Delivery" pill="unavailable" live={false} />
        <div className={`${CARD} px-5 py-4`}>
          <p className="m-0 text-[13.5px] text-content-muted">Could not load the breakdowns.</p>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section>
        <SectionHeading title="Delivery" pill="loading" live={false} />
        <div className={`${CARD} px-5 py-4`}>
          <p className="m-0 text-[13.5px] text-content-muted">Loading…</p>
        </div>
      </section>
    );
  }
  if (data.ages.length === 0 && data.placements.length === 0) {
    return (
      <section>
        <SectionHeading title="Delivery" pill="not ingested" live={false} />
        <div className={`${CARD} px-5 py-4`}>
          <p className="m-0 max-w-[70ch] text-[13.5px] leading-[1.6] text-content-muted">
            The age and placement breakdowns are separate Meta calls that have not
            run for this ad yet. With {purchases} purchases on this ad they would
            be read for where Meta is putting the creative, not for which bucket
            converts.
          </p>
        </div>
      </section>
    );
  }

  const ageMax = Math.max(1, ...data.ages.map((x) => x.impressions));
  const placeMax = Math.max(1, ...data.placements.map((x) => x.impressions));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionHeading
          title="Demographics"
          pill={data.femaleShare === null ? "no gender split" : "ingested"}
          live={data.femaleShare !== null}
          aside={
            data.femaleShare !== null ? (
              <>
                <span className="flex items-center gap-2 text-[14px] text-content-body">
                  <i
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: "var(--growth-500)" }}
                  />
                  Women{" "}
                  <b className="font-mono font-medium text-content-strong">
                    {csPct(data.femaleShare)}
                  </b>
                </span>
                <span className="flex items-center gap-2 text-[14px] text-content-body">
                  <i
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: "var(--ink-950)" }}
                  />
                  Men{" "}
                  <b className="font-mono font-medium text-content-strong">
                    {csPct(1 - data.femaleShare)}
                  </b>
                </span>
              </>
            ) : undefined
          }
        />

        {/* Two bars per bucket, women over men, both scaled to the largest
            bucket so the rows are comparable down the column rather than each
            normalised to itself. */}
        <div className={`${CARD} px-6 py-2`}>
          {data.ages.map((a) => (
            <div
              key={a.label}
              className="grid grid-cols-[56px_1fr_auto] items-center gap-5 border-b border-hairline py-3.5"
            >
              <span className="font-mono text-[14px] text-content-strong">{a.label}</span>
              <span className="flex flex-col gap-1.5">
                <Bar value={(a.female ?? a.impressions) / ageMax} colour="var(--growth-500)" />
                <Bar value={(a.male ?? 0) / ageMax} colour="var(--ink-950)" />
              </span>
              <span className="min-w-[62px] text-right font-mono text-[14px] tabular text-content-strong">
                {csRateFlat(total > 0 ? a.impressions / total : null)}
              </span>
            </div>
          ))}

          <div className="flex items-baseline justify-between py-3.5">
            <span className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-content-muted">
              Share of impressions
            </span>
            <span className="font-mono text-[13px] tabular text-content-muted">
              {csCount(total).v} total
            </span>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading
          title="Placement"
          pill="ingested"
          aside={
            <span className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-content-muted">
              Share · CPM · CTR
            </span>
          }
        />

        <div className={`${CARD} px-6 py-2`}>
          {data.placements.map((p) => {
            const share = placeTotal > 0 ? p.impressions / placeTotal : null;
            const cpm = p.impressions > 0 ? (p.spend / p.impressions) * 1000 : null;
            const ctr = p.impressions > 0 ? p.clicks / p.impressions : null;
            // Against the same 1.5% reference the CTR card uses, so a reader
            // does not have to hold two different benchmarks in their head.
            const verdict = ctr === null ? null : ctr >= 0.015 ? "good" : ctr >= 0.01 ? "warn" : "bad";
            return (
              <div
                key={p.label}
                className="grid grid-cols-[minmax(110px,1fr)_1.5fr_auto_auto_auto] items-center gap-4 border-b border-hairline py-3.5"
              >
                <span className="truncate text-[14px] text-content-strong">{p.label}</span>
                {/* Grey rather than black where the CTR is failing: the row is
                    still on the same scale, but the bar stops claiming the
                    reader's eye for delivery that is not working. */}
                <Bar
                  value={p.impressions / placeMax}
                  colour={verdict === "bad" ? "var(--gray-250)" : "var(--ink-950)"}
                />
                <span className="min-w-[62px] text-right font-mono text-[14px] tabular text-content-strong">
                  {csRateFlat(share)}
                </span>
                <span className="min-w-[70px] text-right font-mono text-[14px] tabular text-content-muted">
                  {cpm === null ? DASH : `${csMoney(cpm, currency).v} ${symbolOf(currency)}`}
                </span>
                <span className="flex min-w-[72px] items-center justify-end gap-2 font-mono text-[14px] tabular text-content-strong">
                  {csRateFlat(ctr)}
                  {verdict && (
                    <i
                      aria-hidden="true"
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ background: DOT[verdict] }}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** One bar on a shared scale. Rounded, so a near-zero row still reads. */
function Bar({ value, colour }: { value: number; colour: string }) {
  return (
    <span className="block h-[10px] overflow-hidden rounded-full bg-gray-100">
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(1.5, Math.min(100, value * 100)).toFixed(1)}%`, background: colour }}
      />
    </span>
  );
}

/**
 * A titled section on the Overview tab, in the same chrome the Breakdowns use.
 *
 * `source` is the provenance pill, and it is never decorative: "ingested"
 * means the chart under it is drawn from data, "static" and "not ingested"
 * mean it is drawn from the absence of it, and the two must not look alike.
 */
function Block({
  title,
  source,
  children,
}: {
  title: string;
  source: string;
  children: ReactNode;
}) {
  const live = source === "ingested" || /measured/.test(source);
  return (
    <section className="min-w-0">
      <SectionHeading title={title} pill={source} live={live} />
      <div className={`${CARD} px-5 py-4`}>{children}</div>
    </section>
  );
}
