"use client";

/**
 * "What's new": a short, once per person tour of the redesign.
 *
 * Five beats and a closing card, stepped by the person rather than by a timer.
 * Each beat shows one thing that changed, as the old state turning into the new
 * one, and then waits. The motion is still brisk inside a beat, because the
 * before-to-after transition is the whole point; what is gone is the clock that
 * used to drag somebody off a sentence they were still reading. The visuals are DOM and CSS drawn with the app's own design tokens, so
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
 *  3. It is dismissible by three separate gestures at any point: the Skip
 *     control, Escape, and a click on the backdrop. Nothing has to be stepped
 *     through to get out of it.
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
import { markSeen, shouldAutoPlay } from "./release";
import { WHATS_NEW_OPEN, type OpenWhatsNewDetail } from "./open";
import "./whats-new.css";

/** Index of the closing card: one past the last beat. */
const CLOSING_INDEX = BEATS.length;

/** How the overlay was asked for, which is also whether it may be remembered. */
type Mode =
  /** First visit after the release. Dismissal is recorded. */
  | "auto"
  /** Asked for on purpose: the menu item, or `?whatsnew=1`. */
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
  /**
   * The furthest beat anybody has actually arrived at in this run.
   *
   * It is what tells Back-then-Next from a first viewing: a beat at or below
   * this mark has already been watched, so it is rendered in its settled state
   * instead of replaying its transition. See `settled`.
   */
  const [furthest, setFurthest] = useState(0);
  /** True when the beat on screen is one the person has already watched. */
  const [settled, setSettled] = useState(false);
  /**
   * Set as soon as the tour is open by any route.
   *
   * The automatic first showing waits for an idle moment, so there is a window
   * in which somebody can open it from the menu first. Without this the idle
   * callback would arrive afterwards and take over a tour already in progress.
   */
  const openedRef = useRef(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  /** The primary control. Focus lands here on open so Enter works at once. */
  const nextRef = useRef<HTMLButtonElement>(null);
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
      openedRef.current = true;
      setMode("still");
      return;
    }
    if (asked === "1") {
      openedRef.current = true;
      setMode(still ? "still" : "replay");
      return;
    }

    // Otherwise it is the automatic first showing, which is the only path that
    // consults storage, and the only one that fails closed when storage is
    // unavailable.
    if (!shouldAutoPlay()) return;

    return whenIdle(() => {
      // Somebody opened it from the menu while this was waiting for an idle
      // moment. Their tour is already running; do not restart it underneath
      // them, and do not mark seen a second time.
      if (openedRef.current) return;
      // Recorded the moment it is shown, not when it is dismissed.
      //
      // Marking it on dismissal looks tidier and is wrong: somebody who clicks
      // a nav link while the sequence is running never dismisses it, so the
      // flag is never written, and it would start again on the next page, and
      // the page after that. Showing it once and meaning it is the promise;
      // the way back for somebody who missed it is the permanent "What's new"
      // item in the account menu and the mobile page sheet.
      markSeen();
      setMode(still ? "still" : "auto");
    });
  }, []);

  /* ------------------------------------------------------------------ */
  /* Dismissal                                                          */
  /* ------------------------------------------------------------------ */

  const close = useCallback(
    () => {
      /*
       * Marked seen on the way out, whichever route opened it.
       *
       * This is the whole of how the menu item interacts with the flag, and
       * the reasoning is worth keeping: somebody who has never seen the tour
       * and opens it from the menu has, by the time they close it, seen it.
       * Writing the flag then is simply true, and it is what stops the
       * automatic showing arriving unprompted on their next page load, which
       * would look like the app had forgotten. Nothing clears the flag, ever,
       * so a deliberate viewing can never resurrect the automatic one.
       *
       * The flag is never written merely because the control exists or the
       * menu was opened. Only an actual viewing writes it, so the item being
       * present cannot cost anybody their first showing.
       */
      markSeen();
      openedRef.current = false;
      setMode(null);
      setBeat(0);
      setFurthest(0);
      setSettled(false);
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
  /* Opened on purpose                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * The permanent control, in the account menu and the mobile page sheet.
   *
   * Deliberately asks storage nothing. The automatic showing fails closed when
   * `localStorage` throws, because a tour that cannot be remembered would
   * otherwise appear on every page view; a click is not a guess, so it opens
   * regardless and simply will not be remembered. The seen flag is still
   * written on close, and still fails silently if it cannot be.
   */
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<OpenWhatsNewDetail>).detail;
      openedRef.current = true;
      returnTo.current = detail?.restoreFocusTo ?? document.activeElement;
      setBeat(0);
      setFurthest(0);
      setSettled(false);
      setMode(prefersReducedMotion() ? "still" : "replay");
    }
    window.addEventListener(WHATS_NEW_OPEN, onOpen);
    return () => window.removeEventListener(WHATS_NEW_OPEN, onOpen);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Stepping                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Moves to `target`, and decides whether that beat should play or simply be
   * there.
   *
   * A beat at or below `furthest` is one the person has already watched, so
   * going Back and then forward again does not make them sit through the same
   * transition a second time; the beat appears already resolved. Only a beat
   * being reached for the first time animates. That is the difference between
   * stepping back to check something and being re-shown a performance.
   */
  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target > CLOSING_INDEX) return;
      setSettled(target <= furthest);
      setFurthest((f) => Math.max(f, target));
      setBeat(target);
    },
    [furthest]
  );

  const atClosing = beat >= CLOSING_INDEX;

  /** The primary action: forward, or out when there is nowhere further. */
  const advance = useCallback(() => {
    if (atClosing) close();
    else goTo(beat + 1);
  }, [atClosing, beat, goTo, close]);

  const goBack = useCallback(() => {
    if (beat > 0) goTo(beat - 1);
  }, [beat, goTo]);

  /* ------------------------------------------------------------------ */
  /* Focus: take it, trap it, give it back                              */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!mode) return;
    // `??`, not `=`: an open from the menu has already named the control to
    // hand focus back to, because the menu item that was clicked is about to
    // be unmounted along with its menu. Only the automatic showing falls back
    // to whatever happened to have focus.
    returnTo.current = returnTo.current ?? document.activeElement;
    // Focus goes to Next, so Enter and Space work the moment the dialog opens
    // without anybody having to find the control first. The dialog is named by
    // the beat's heading, so a screen reader still hears what it is before it
    // hears the button. The static summary has no Next, and falls back to the
    // panel.
    (nextRef.current ?? panelRef.current)?.focus({ preventScroll: true });

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
        close();
        return;
      }

      // Stepping. The arrows are unconditional; Enter and Space are not,
      // because a focused button activates itself on both, and handling them
      // here as well would fire the action twice. Whatever has focus is
      // already the right thing to activate, so this only picks up the keys
      // when focus is somewhere inert, such as the panel itself.
      if (mode !== "still") {
        const target = e.target as HTMLElement | null;
        const onControl =
          target?.tagName === "BUTTON" || target?.tagName === "A";
        if (e.key === "ArrowRight" || ((e.key === "Enter" || e.key === " ") && !onControl)) {
          e.preventDefault();
          advance();
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goBack();
          return;
        }
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
  }, [mode, close, advance, goBack]);

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  // Nothing to render until it is open. The way back in is the permanent
  // "What's new" item in the shell, not a chip this component plants.
  if (!mode) return null;

  const isStill = mode === "still";
  const current = atClosing ? CLOSING : BEATS[beat];
  const steps = BEATS.length + 1;

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
        onClick={() => close()}
        className="wn-backdrop absolute inset-0 w-full cursor-default bg-ink-950/55"
      />

      {/*
        No `oe-health` class here any more. It used to carry the redesign's
        token scope onto this panel while the rest of the app was still on the
        house look. The rollout has since moved that scope to <html>, where it
        is written `:root.oe-health`, so a copy of the class on this element
        matches nothing and the tokens arrive by inheritance instead. Leaving
        the class on would have been a comment that claimed to be code.
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="wn-panel relative z-10 flex max-h-[94dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[22px] bg-paper pb-[var(--safe-bottom)] shadow-lg outline-none sm:rounded-[22px] sm:pb-0"
      >
        {/* ---- Head: label and Skip ---- */}
        <div className="flex flex-none items-center justify-between gap-3 px-5 pt-4 sm:px-7 sm:pt-5">
          <span className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-content-muted">
            What&rsquo;s new
          </span>

          {/* 44px minimum touch target, per the brief, which is why the label
              is padded rather than merely sized. */}
          <button
            type="button"
            onClick={() => close()}
            className="-mr-2 -mt-2 flex h-11 min-w-[44px] flex-none items-center justify-center rounded-[999px] px-3 text-[13.5px] font-semibold text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {isStill ? "Close" : "Skip"}
          </button>
        </div>

        {isStill ? (
          <StaticSummary titleId={titleId} onDone={() => close()} />
        ) : (
          <>
            {/* ---- The stage ----
                Keyed by beat, so each beat's subtree mounts fresh and its
                animations start from their first frame. No animation is ever
                asked to restart, which is the class of bug that makes a
                sequence like this look broken on the second viewing.

                `wn-settled` is how a revisited beat is shown already resolved:
                it pushes every animation in the subtree past its own end, and
                they all fill both ways, so the end state is what paints. It is
                a stylesheet rule rather than a pass over `getAnimations()`,
                which means it is applied before the first paint and cannot
                flash the "before" state on the way through. */}
            <div
              key={beat}
              className={`flex min-h-0 flex-auto flex-col gap-4 overflow-hidden px-5 pt-4 sm:gap-5 sm:px-7 sm:pt-5 ${
                settled ? "wn-settled" : ""
              }`}
            >
              {/*
                The copy is a live region so a screen reader hears each beat as
                it arrives. Focus stays on Next between beats, deliberately, so
                without this the heading and the body would change in silence.
              */}
              <div
                aria-live="polite"
                aria-atomic="true"
                className="flex flex-none flex-col gap-1.5"
              >
                <span className="sr-only">
                  Step {Math.min(beat, CLOSING_INDEX) + 1} of {steps}
                </span>
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
            </div>

            {/* ---- Controls ----
                Outside the keyed stage, so the row is one set of elements for
                the whole sequence rather than a new one per beat. That is what
                keeps focus on Next as the beats change: remounting the button
                would drop focus back to the body and Enter would stop working
                halfway through. */}
            <div className="flex flex-none items-center justify-between gap-3 px-5 pb-5 pt-1 sm:px-7 sm:pb-7">
              {/*
                Back is rendered on the first beat too, disabled and invisible,
                so the row does not reflow and the dots do not jump sideways
                the moment somebody presses Next. Disabled keeps it out of the
                tab order and out of the focus trap's list.
              */}
              <button
                type="button"
                onClick={goBack}
                disabled={beat === 0}
                aria-hidden={beat === 0}
                className={`flex h-11 flex-none items-center justify-center rounded-[999px] px-4 text-[14px] font-medium text-content-body transition-colors duration-fast hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                  beat === 0 ? "invisible" : ""
                }`}
              >
                Back
              </button>

              {/*
                The dots stand down on the last card at phone width. "Start
                looking around" is a long label, and Back plus the dots plus
                that button is about 12px more than a 375px row has; something
                had to give, and a position indicator reading six of six is
                the least useful thing in the row once you are at the end.
              */}
              <StepDots
                count={steps}
                index={Math.min(beat, CLOSING_INDEX)}
                className={atClosing ? "hidden sm:flex" : "flex"}
              />

              <button
                ref={nextRef}
                type="button"
                onClick={advance}
                className="flex h-11 flex-none items-center justify-center rounded-[999px] bg-ink-900 px-4 text-[14.5px] font-semibold text-content-inverse sm:px-5 transition-colors duration-fast hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {atClosing ? "Start looking around" : "Next"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ====================================================================== */
/* The step dots                                                          */
/* ====================================================================== */

/**
 * Where you are in the sequence, as dots.
 *
 * It replaced a segmented bar that filled over each beat's duration. That bar
 * was honest while a timer was running and became a lie the moment the person
 * took the pace: a bar that fills on its own says "this is running out", which
 * is the one thing this no longer does. Dots say position and nothing else.
 *
 * The current dot is a wider pill rather than merely a darker circle, so the
 * position is readable without relying on the difference between two greys.
 * Visited dots stay dark, which makes the row read as progress rather than as
 * a set of equal options.
 *
 * `aria-hidden`: the same information is in the "Step 3 of 6" line that the
 * live region reads out with each beat, and a screen reader does not need it
 * twice.
 */
function StepDots({
  count,
  index,
  className = "flex",
}: {
  count: number;
  index: number;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`min-w-0 items-center gap-1.5 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`h-[6px] rounded-[999px] transition-all duration-base ${
            i === index
              ? "w-[18px] bg-content-strong"
              : i < index
                ? "w-[6px] bg-content-strong/45"
                : "w-[6px] bg-gray-200"
          }`}
        />
      ))}
    </span>
  );
}
