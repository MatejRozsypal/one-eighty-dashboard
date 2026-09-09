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
import { addNote, loadBreakdowns, loadNotes } from "@/app/(app)/creative/actions";
import type { CreativeNote, TaskActivity } from "@/lib/creative/clickup";
import type { AdBreakdowns } from "@/lib/queries/creative";
import type { AdView } from "@/lib/creative/view";
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
              {/* Delivery, beside the reading confidence rather than buried
                  under the creative. Whether an ad is still running is the
                  first thing that qualifies every number below it — a 1.2x
                  ROAS on something paused three weeks ago is a different
                  statement from the same figure on something live. */}
              {ad.effectiveStatus && <StatusChip status={ad.effectiveStatus} />}
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

        {/* ── Overview / Copy / Notes ──────────────────────────────────────
            Three tabs rather than one long scroll. The panel had grown to
            metrics, a diagnosis, a retention curve, the full ad copy and two
            breakdown charts stacked in a single column — so the copy, which is
            the thing a creative person actually came to read, sat below three
            screens of numbers.

            Overview keeps everything that answers "how did it do", retention
            included, because the curve is read against the CPA and the hook
            rate sitting above it and splitting them would make both weaker. */}
        <nav
          role="tablist"
          aria-label="Creative detail"
          className="flex gap-6 border-b border-hairline px-5"
        >
          {(["overview", "breakdowns", "notes"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 py-3 text-[13.5px] font-medium capitalize transition-colors duration-fast ${
                tab === t
                  ? "border-accent text-content-strong"
                  : "border-transparent text-content-muted hover:text-content-body"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {/* The creative stays put across all three tabs — it is the subject of
            every one of them, and re-rendering it per tab would restart a video
            somebody was halfway through. */}
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr]">
          <Creative ad={ad} />

          <div className="flex min-w-0 flex-col gap-6 p-5">
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

      {/* ── The spec line ────────────────────────────────────────────────
          The three facts that qualify the picture above them: what shape it
          actually is, how much of the account it is holding, and how much
          weight its numbers can carry. Delivery status used to sit here and
          has moved up beside the name, where it qualifies the metrics too. */}
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-hairline pt-3.5">
        <dt className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">Format</dt>
        <dd className="m-0 text-right font-mono text-[12px] tabular text-content-body">
          {ad.assetWidth && ad.assetHeight
            ? `${ad.assetWidth}\u00d7${ad.assetHeight}`
            : "—"}
        </dd>
        <dt className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">Spend share</dt>
        <dd className="m-0 text-right font-mono text-[12px] tabular text-content-body">
          {pct(ad.spendShare)}
        </dd>
        <dt className="font-mono text-[10.5px] uppercase tracking-eyebrow text-content-muted">Learning</dt>
        <dd className="m-0 text-right text-[12px] text-content-body">
          {CONFIDENCE_LABELS[ad.confidence]}
        </dd>
      </dl>

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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xs px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${
        live ? "bg-accent-soft text-growth-700" : "bg-gray-100 text-content-muted"
      }`}
    >
      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
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
  good: "bg-accent-soft/50",
  warn: "bg-warning/[0.07]",
  bad: "bg-negative/[0.06]",
};

interface Metric {
  k: string;
  v: string;
  /** Small unit printed after the value, e.g. a currency or a percent. */
  unit?: string;
  s?: string;
  verdict?: Verdict;
  big?: boolean;
}

function MetricCard({ m }: { m: Metric }) {
  return (
    <div
      className={`glass flex flex-col justify-between px-4 py-3 ${
        m.verdict ? TINT[m.verdict] : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-content-muted">
          {m.k}
        </span>
        {m.verdict && (
          <span
            aria-hidden="true"
            className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: DOT[m.verdict] }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span
          className={`font-mono font-medium tracking-heading tabular text-content-strong ${
            m.big ? "text-[28px] leading-none" : "text-[19px] leading-none"
          }`}
        >
          {m.v}
        </span>
        {m.unit && (
          <span className="font-mono text-[11px] text-content-muted">{m.unit}</span>
        )}
      </div>
      {m.s && (
        <div className="mt-1.5 font-mono text-[10.5px] text-content-muted">{m.s}</div>
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
      v: count(ad.purchases),
      big: true,
      s:
        ad.impressions > 0
          ? `${((ad.purchases / ad.impressions) * 1000).toFixed(2)} / 1k impressions`
          : undefined,
      // Purchases alone carry no target — the CPA card is where that is judged.
      verdict: null,
    },
    {
      k: "Cost / purchase",
      v: money(ad.cpa, currency),
      big: true,
      s: thresholds ? `target ≤ ${money(thresholds.targetCpa, currency)}` : "no target set",
      verdict: cpaVerdict,
    },
    {
      k: "ROAS",
      v: roas(ad.roas),
      unit: "×",
      big: true,
      // The interval is on the card, not in a tooltip. It is the number that
      // decides whether the headline figure means anything at all.
      s:
        ad.ciLow !== null && ad.ciHigh !== null
          ? `95% CI ${roas(ad.ciLow)}–${roas(ad.ciHigh)}`
          : undefined,
      verdict: roasVerdict,
    },

    { k: "Spend", v: money(ad.spend, currency), s: `${pct(ad.spendShare)} of account spend` },
    {
      k: "Revenue",
      v: money(ad.revenue, currency),
      s: `${count(ad.purchases)} purchases`,
      verdict: ad.revenue > 0 ? "good" : null,
    },
    { k: "Impressions", v: count(ad.impressions), s: "delivered" },

    { k: "Reach", v: count(ad.reach), s: "people reached" },
    {
      k: "CTR (all)",
      v: ratePct(ad.ctr),
      // 1.5% is the account-level reference the learnings file uses for a
      // static; it is a benchmark, not a threshold anybody set, and it is
      // labelled as one.
      s: "benchmark 1.5%",
      verdict: ad.ctr === null ? null : ad.ctr >= 0.015 ? "good" : ad.ctr >= 0.01 ? "warn" : "bad",
    },
    {
      k: "Outbound CTR",
      v: ratePct(ad.outboundCtr),
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

    { k: "CPM", v: money(ad.cpm, currency), s: "per 1k impressions" },
    { k: "Adds to cart", v: count(ad.addToCart), s: "from this ad" },
  ];

  if (ad.format === "DYN") {
    cards.push(
      {
        k: "Hook rate",
        v: ratePct(ad.hookRate),
        s: "plays over impressions",
      },
      {
        k: "Hold rate",
        v: ratePct(ad.holdRate),
        s: "thruplays over impressions",
        verdict:
          ad.holdRate === null ? null : ad.holdRate >= 0.05 ? "good" : ad.holdRate >= 0.03 ? "warn" : "bad",
      }
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
  purchases: number;
  currency: string;
}) {
  const total = (data?.ages ?? []).reduce((a, s) => a + s.impressions, 0);
  const placeTotal = (data?.placements ?? []).reduce((a, s) => a + s.impressions, 0);
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
      <Block
        title="Demographics"
        source={data.femaleShare === null ? "no gender split" : "ingested"}
      >
        {data.femaleShare !== null && (
          <div className="mb-3 flex justify-end gap-4 text-[12px] text-content-muted">
            <span>
              <i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-[-1px]" style={{ background: "var(--growth-500)" }} />
              Women <b className="font-mono font-medium text-content-strong">{pct(data.femaleShare)}</b>
            </span>
            <span>
              <i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-[-1px]" style={{ background: "var(--ink-950)" }} />
              Men <b className="font-mono font-medium text-content-strong">{pct(1 - data.femaleShare)}</b>
            </span>
          </div>
        )}

        {/* Two bars per bucket, women over men, both scaled to the largest
            bucket so the rows are comparable down the column rather than each
            normalised to itself. */}
        <div className="flex flex-col">
          {data.ages.map((a) => {
            const max = Math.max(1, ...data.ages.map((x) => x.impressions));
            const share = total > 0 ? a.impressions / total : 0;
            return (
              <div
                key={a.label}
                className="grid grid-cols-[54px_1fr_auto] items-center gap-4 border-b border-hairline py-2.5 last:border-b-0"
              >
                <span className="text-[13px] text-content-body">{a.label}</span>
                <span className="flex flex-col gap-1">
                  <Bar value={(a.female ?? a.impressions) / max} colour="var(--growth-500)" />
                  <Bar value={(a.male ?? 0) / max} colour="var(--ink-950)" />
                </span>
                <span className="min-w-[52px] text-right font-mono text-[13px] tabular text-content-strong">
                  {pct(share)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
            Share of impressions
          </span>
          <span className="font-mono text-[11.5px] text-content-muted">
            {count(total)} total
          </span>
        </div>

        {/* The warning that keeps this panel honest. A single ad split six ways
            has single-digit purchases per bucket, so "which age group converts
            better" is a question this data cannot answer however confidently
            it renders. */}
        <p className="mt-2.5 border-l-2 border-hairline-strong pl-3 text-[12px] leading-[1.6] text-content-muted">
          Impression share, not ROAS. {purchases} purchases split six ways is
          single digits per bucket — read this for where Meta is putting the ad,
          not for which age group performs.
        </p>
      </Block>

      <Block title="Placement" source="ingested">
        <div className="mb-1 flex justify-end font-mono text-[10px] uppercase tracking-eyebrow text-content-muted">
          Share · CPM · CTR
        </div>
        <div className="flex flex-col">
          {data.placements.map((p) => {
            const max = Math.max(1, ...data.placements.map((x) => x.impressions));
            const share = placeTotal > 0 ? p.impressions / placeTotal : 0;
            const cpm = p.impressions > 0 ? (p.spend / p.impressions) * 1000 : null;
            const ctr = p.impressions > 0 ? p.clicks / p.impressions : null;
            // Against the same 1.5% reference the CTR card uses, so a reader
            // does not have to hold two different benchmarks in their head.
            const verdict = ctr === null ? null : ctr >= 0.015 ? "good" : ctr >= 0.01 ? "warn" : "bad";
            return (
              <div
                key={p.label}
                className="grid grid-cols-[minmax(96px,1fr)_1.4fr_auto_auto_auto] items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
              >
                <span className="truncate text-[13px] text-content-body">{p.label}</span>
                <Bar value={p.impressions / max} colour="var(--ink-950)" />
                <span className="min-w-[52px] text-right font-mono text-[13px] tabular text-content-strong">
                  {pct(share)}
                </span>
                <span className="min-w-[56px] text-right font-mono text-[12px] tabular text-content-muted">
                  {money(cpm, currency)}
                </span>
                <span className="flex min-w-[58px] items-center justify-end gap-1.5 font-mono text-[12px] tabular text-content-body">
                  {ratePct(ctr)}
                  {verdict && (
                    <i
                      aria-hidden="true"
                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                      style={{ background: DOT[verdict] }}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Block>
    </>
  );
}

/** One bar on a shared scale. Rounded, so a near-zero row still reads. */
function Bar({ value, colour }: { value: number; colour: string }) {
  return (
    <span className="block h-[13px] overflow-hidden rounded-full bg-gray-100">
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(1.5, Math.min(100, value * 100)).toFixed(1)}%`, background: colour }}
      />
    </span>
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
