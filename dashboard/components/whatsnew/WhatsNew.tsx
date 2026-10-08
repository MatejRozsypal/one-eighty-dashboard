"use client";

/**
 * "What's new": a short, once per person tour of the redesign.
 *
 * Five beats and a closing card, 9.7 seconds end to end, auto-advancing. Each
 * beat shows one thing that changed, as the old state turning into the new
 * one. The visuals are DOM and CSS drawn with the app's own design tokens, so
 * the mock sidebar in beat one is the real sidebar's colours and the mock ring
 * in beat three is the real ring's geometry. There is no video, no image and
 * no network request anywhere in it.
 *
 * ── It must never be in the way ───────────────────────────────────────────
 * Three independent guards, because an overlay that appears at the wrong
 * moment is worse than no overlay:
 *
 *  1. It renders `null` on the server and on first client render, so it
 *     contributes nothing to the HTML the dashboard ships and nothing to
 *     hydration.
 *  2. It waits for `load`, then for an idle callback, before it appears. By
 *     then the shell has painted and the page's own figures are on screen or
 *     visibly loading. It never covers a blank app.
 *  3. It is dismissible by four separate gestures: the Skip control, the
 *     close control on the final card, Escape, and a click on the backdrop.
 *     Nobody is held for ten seconds.
 *
 * ── Where it shows ────────────────────────────────────────────────────────
 * On whichever dashboard page the person lands on, including a deep link into
 * a report, and exactly once. The reasoning is in the report that accompanies
 * this change; the short version is that the changes are shell-wide, a deep
 * link is a legitimate way to open the dashboard, and gating it to one route
 * would mean somebody who always arrives by link never sees it. It never
 * navigates, so the link they arrived on survives being shown.
 *
 * ── Reduced motion ───────────────────────────────────────────────────────
 * A sequence that cuts six times in ten seconds is exactly the kind of motion
 * that causes trouble for people with vestibular disorders, so when
 * `prefers-reduced-motion` is set this renders a different tree: the same five
 * changes as a static before and after list, with no timers, no progress bar,
 * no auto-advance and nothing that moves. Same content, same dismissal.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { BEATS, CLOSING, Stage, StaticSummary } from "./Stages";
import {
  markSeen,
  recallOffered,
  retireRecall,
  shouldAutoPlay,
} from "./release";
import "./whats-new.css";

/** Index of the closing card: one past the last beat. */
const CLOSING_INDEX = BEATS.length;

/** How the overlay was asked for, which is also whether it may be remembered. */
type Mode =
  /** First visit after the release. Dismissal is recorded. */
  | "auto"
  /** Asked for again with `?whatsnew=1`. Dismissal is recorded too. */
  | "replay"
  /** `?whatsnew=still`, or reduced motion: the static summary. */
  | "still";

function readQuery(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("whatsnew");
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A browser without matchMedia cannot tell us, and guessing "no" would
    // hand the fast cut to somebody who asked not to have it. Guess "yes".
    return true;
  }
}

/**
 * Runs `fn` once the page is loaded and the browser has a spare moment.
 *
 * `requestIdleCallback` is not in Safari, hence the timeout fallback; the
 * `timeout` option on the real thing is there so a busy page still gets to
 * the sequence rather than deferring it forever.
 */
function whenIdle(fn: () => void): () => void {
  let cancelled = false;
  const timers: number[] = [];

  const run = () => {
    if (cancelled) return;
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (idle) idle(() => !cancelled && fn(), { timeout: 1500 });
    else timers.push(window.setTimeout(() => !cancelled && fn(), 400));
  };

  if (document.readyState === "complete") {
    // Already loaded: still give the first frames away before appearing.
    timers.push(window.setTimeout(run, 350));
  } else {
    window.addEventListener("load", run, { once: true });
  }

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    window.removeEventListener("load", run);
  };
}

export function WhatsNew() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [beat, setBeat] = useState(0);
  const [recall, setRecall] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  /** Where focus was before we took it, so it can be handed back exactly. */
  const returnTo = useRef<Element | null>(null);

  /* ------------------------------------------------------------------ */
  /* Should it appear at all                                            */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const asked = readQuery();
    const still = prefersReducedMotion();

    // Asked for explicitly: show it now, no idle wait, no storage check. This
    // is the durable way back in, and it has to work even in a browser where
    // storage throws.
    if (asked === "still") {
      setMode("still");
      return;
    }
    if (asked === "1") {
      setMode(still ? "still" : "replay");
      return;
    }

    // Otherwise it is the automatic first showing, which is the only path that
    // consults storage, and the only one that fails closed when storage is
    // unavailable.
    // No chip here: there is nothing to recall until somebody has actually cut
    // a sequence short, which is decided in `close`.
    if (!shouldAutoPlay()) return;

    return whenIdle(() => {
      // Recorded the moment it is shown, not when it is dismissed.
      //
      // Marking it on dismissal looks tidier and is wrong: somebody who clicks
      // a nav link while the sequence is running never dismisses it, so the
      // flag is never written, and it would start again on the next page, and
      // the page after that. Showing it once and meaning it is the promise;
      // the way back for somebody who missed it is the recall chip, and
      // `?whatsnew=1` on any page after that.
      markSeen();
      setMode(still ? "still" : "auto");
    });
  }, []);

  /* ------------------------------------------------------------------ */
  /* Dismissal                                                          */
  /* ------------------------------------------------------------------ */

  const close = useCallback(
    (offerRecall: boolean) => {
      markSeen();
      setMode(null);
      setBeat(0);
      // The chip is only worth offering to somebody who cut the sequence
      // short, and only until they have taken it up or waved it away once.
      if (offerRecall && recallOffered()) setRecall(true);
      // Hand focus back to whatever had it. `preventScroll` because the page
      // behind has not moved and should not jump.
      const target = returnTo.current;
      if (target instanceof HTMLElement && document.contains(target)) {
        target.focus({ preventScroll: true });
      }
      returnTo.current = null;
    },
    []
  );

  /* ------------------------------------------------------------------ */
  /* The beat timer                                                     */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (mode !== "auto" && mode !== "replay") return;
    if (beat >= CLOSING_INDEX) return; // the closing card waits for a person
    const id = window.setTimeout(() => setBeat((b) => b + 1), BEATS[beat].ms);
    return () => clearTimeout(id);
  }, [mode, beat]);

  /* ------------------------------------------------------------------ */
  /* Focus: take it, trap it, give it back                              */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!mode) return;
    returnTo.current = document.activeElement;
    // The panel itself is the focus target rather than the Skip button: a
    // screen reader should hear the dialog's name and its first beat, not land
    // on "Skip" with no idea what it would be skipping.
    panelRef.current?.focus({ preventScroll: true });

    // A tall overlay over a scrollable dashboard invites scrolling the page
    // behind it, which is disorienting while the thing on top is moving.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      // Re-queried on every Tab rather than cached: the controls change as the
      // beats advance, and a cached list would send focus at a removed node.
      const stops = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === panel);
      if (stops.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && (active === last || active === panel)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mode, close]);

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  if (!mode) {
    return recall ? (
      <RecallChip
        onOpen={() => {
          retireRecall();
          setRecall(false);
          setBeat(0);
          setMode(prefersReducedMotion() ? "still" : "replay");
        }}
        onDismiss={() => {
          retireRecall();
          setRecall(false);
        }}
      />
    ) : null;
  }

  const isStill = mode === "still";
  const atClosing = beat >= CLOSING_INDEX;
  const current = atClosing ? CLOSING : BEATS[beat];

  return (
    <div className="wn-root fixed inset-0 z-[200] flex items-end justify-center sm:items-center">
      {/*
        The backdrop is a button so it is a real, labelled dismissal rather
        than a click handler on a div, which is invisible to anything that is
        not a mouse.
      */}
      <button
        type="button"
        aria-label="Close what's new"
        onClick={() => close(true)}
        className="wn-backdrop absolute inset-0 w-full cursor-default bg-ink-950/55"
      />

      {/*
        `oe-health` is the redesign's token scope. Carrying it here means the
        overlay is drawn in the new language (white cards, Inter, the status
        colours the rings use) whether or not the scope has reached the rest of
        the app yet, and it keeps looking right once it has.
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="oe-health wn-panel relative z-10 flex max-h-[94dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[22px] bg-paper pb-[var(--safe-bottom)] shadow-lg outline-none sm:rounded-[22px] sm:pb-0"
      >
        {/* ---- Head: label, progress, Skip ---- */}
        <div className="flex flex-none items-start justify-between gap-3 px-5 pt-4 sm:px-7 sm:pt-5">
          <div className="flex min-w-0 flex-col gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
              What&rsquo;s new
            </span>
            {!isStill && (
              <ProgressRail
                count={BEATS.length + 1}
                index={Math.min(beat, CLOSING_INDEX)}
                ms={atClosing ? CLOSING.ms : BEATS[beat].ms}
              />
            )}
          </div>

          {/* 44px minimum touch target, per the brief, which is why the label
              is padded rather than merely sized. */}
          <button
            type="button"
            onClick={() => close(true)}
            className="-mr-2 -mt-2 flex h-11 min-w-[44px] flex-none items-center justify-center rounded-[999px] px-3 text-[13.5px] font-semibold text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {isStill ? "Close" : "Skip"}
          </button>
        </div>

        {isStill ? (
          <StaticSummary titleId={titleId} onDone={() => close(false)} />
        ) : (
          <>
            {/* ---- The stage ----
                Keyed by beat, so each beat's subtree mounts fresh and its
                animations start from their first frame. No animation is ever
                asked to restart, which is the class of bug that makes a
                sequence like this look broken on the second viewing. */}
            <div
              key={beat}
              className="flex min-h-0 flex-auto flex-col gap-4 overflow-hidden px-5 pb-5 pt-4 sm:gap-5 sm:px-7 sm:pb-7 sm:pt-5"
            >
              <div className="flex flex-none flex-col gap-1.5">
                <h2
                  id={titleId}
                  className="wn-copy text-[19px] font-semibold leading-[1.25] tracking-heading text-content-strong sm:text-[22px]"
                >
                  {current.title}
                </h2>
                <p className="wn-copy-body max-w-[46ch] text-[13.5px] leading-[1.5] text-content-muted sm:text-[14.5px]">
                  {current.body}
                </p>
              </div>

              {/*
                `flex-auto`, not `flex-1`. `flex-1` is `flex: 1 1 0%`, so this
                row would contribute nothing to the panel's intrinsic height,
                the panel would size itself to the heading and the body alone,
                and the stage would spill over the copy on a short screen.
              */}
              <div className="flex min-h-0 flex-auto items-center justify-center">
                <Stage index={atClosing ? "closing" : beat} />
              </div>

              {atClosing && (
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="wn-copy-body flex h-11 flex-none items-center justify-center rounded-[999px] bg-ink-900 px-6 text-[14.5px] font-semibold text-content-inverse transition-colors duration-fast hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  Start looking around
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ====================================================================== */
/* The progress rail                                                      */
/* ====================================================================== */

/**
 * One segment per beat: filled behind, filling now, empty ahead.
 *
 * `aria-hidden` because it is a restatement of position in a sequence that is
 * already narrated by the heading changing, and a live progress bar announcing
 * itself six times in ten seconds would be noise.
 */
function ProgressRail({
  count,
  index,
  ms,
}: {
  count: number;
  index: number;
  ms: number;
}) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="h-[3px] w-6 overflow-hidden rounded-[999px] bg-gray-150 sm:w-7"
        >
          <span
            className={`block h-full rounded-[999px] bg-content-strong ${
              i === index ? "wn-progress-fill" : ""
            }`}
            style={
              i === index
                ? ({ "--wn-beat": `${ms}ms` } as React.CSSProperties)
                : { transform: i < index ? "scaleX(1)" : "scaleX(0)" }
            }
          />
        </span>
      ))}
    </span>
  );
}

/* ====================================================================== */
/* The recall chip                                                        */
/* ====================================================================== */

/**
 * "Watch again", offered only to somebody who cut the sequence short, and only
 * until they take it up or wave it away once. Then it is gone for good.
 *
 * This is the whole of the re-open affordance, deliberately. A permanent
 * "What's new" button in the chrome would be clutter for a release that
 * happens a few times a year; a link that survives one skip is not. The
 * durable way back in afterwards is the `?whatsnew=1` query, which works on
 * any dashboard page and does not need storage to have worked.
 */
function RecallChip({
  onOpen,
  onDismiss,
}: {
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="oe-health wn-recall fixed bottom-[calc(1rem+var(--safe-bottom))] left-4 z-[150] flex items-center gap-0.5 rounded-[999px] bg-paper p-1 shadow-lg">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-11 items-center rounded-[999px] px-3.5 text-[13px] font-semibold text-content-strong transition-colors duration-fast hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        See what&rsquo;s new
      </button>
      <button
        type="button"
        aria-label="Hide this"
        onClick={onDismiss}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-[999px] text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      </button>
    </div>
  );
}
