"use client";

/**
 * Home turning into the Assistant: the stage the question crosses on.
 *
 * A question asked on Home used to navigate to the Assistant and land in
 * whatever conversation was open there, a hard cut into the wrong place. Now
 * it starts a new conversation (`ChatSession.send` with `fresh`) and this
 * stage carries the box across:
 *
 *      0 ms  Home dissolves around the box: fades, blurs 4 px, recedes 1.5 %
 *            toward it. A veil of the page colour rises over it by 440 ms.
 *     40 ms  The box glides to where the composer sits, morphing into it on
 *            the way (a copy of each, crossfaded, see the flight below). A green
 *            wave sweeps from the box down the screen and a bloom travels
 *            under the box and settles around the composer.
 *    300 ms  The conversation fades up: the question, already in the
 *            transcript, and "Thinking…", or the first words if they came.
 *    440 ms  The route changes to /chat, under the veil, so the swap of pages
 *            is never seen.
 *    760 ms  The box lands. The copy goes and the composer is the real one.
 *            Then, once the Assistant page has mounted underneath and played
 *            its own entrance, the stage fades out over 220 ms onto a page
 *            that is identical to it, and is removed.
 *
 * ── Why a stage and not the View Transitions API ──────────────────────────
 * A view transition is a pair of screenshots: the answer could not stream
 * into it, and in the App Router it has to be wired to the moment Next
 * commits a route, which Next 14 does not expose. Here the transcript on the
 * stage is the real `Conversation`, live from the first frame, so the wait for
 * the route costs nothing: the question is already answering while it loads,
 * and if the route is slow the stage simply stays, usable, until it arrives.
 *
 * ── Motion ─────────────────────────────────────────────────────────────────
 * Every animation is transform, opacity or filter, run by the Web Animations
 * API so it stays on the compositor and needs no keyframes in CSS. The
 * curves are the brand's (`--ease-in-out`, `--ease-out` in motion.css),
 * written out because WAAPI cannot read a custom property. With reduced
 * motion asked for, there is no flight, no glow and no blur: Home and the
 * conversation cross-fade in 160 ms. (`globals.css` stops CSS animations for
 * that preference; it cannot reach these, which is why this file checks it.)
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Conversation } from "@/components/chat/Conversation";
import { useChatSession, type Handoff } from "@/components/chat/ChatSession";
import { CHAT_FRAME } from "@/components/chat/frame";

const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

const T = {
  dissolve: 420,
  veilDelay: 80,
  veil: 360,
  flightDelay: 40,
  flight: 700,
  convDelay: 300,
  conv: 420,
  waveDelay: 60,
  wave: 820,
  bloom: 1040,
  push: 440,
  land: 760,
  /** The Assistant page's own entrance (`product-enter`, 200 ms) plays out first. */
  settle: 240,
  fade: 220,
  /** Everything, with reduced motion. */
  quick: 160,
};

const ACCENT = (pct: number) => `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
const MINT = (pct: number) => `color-mix(in srgb, var(--growth-300) ${pct}%, transparent)`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function HandoffStage() {
  const { handoff } = useChatSession();
  if (!handoff) return null;
  return <Stage key={handoff.id} handoff={handoff} />;
}

function Stage({ handoff }: { handoff: Handoff }) {
  const { pageMounted, endHandoff } = useChatSession();
  const pathname = usePathname();
  const router = useRouter();
  const stage = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const wave = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bloom = useRef<HTMLDivElement>(null);
  const [landed, setLanded] = useState(false);

  /*
   * Measured once, when the stage first renders, which is only ever in the
   * browser (a handoff starts from a click). The stage covers the content
   * column and leaves the sidebar alone, so the rail stays where the eye
   * left it.
   */
  const [env] = useState(() => {
    const col = document.querySelector("[data-app-column]")?.getBoundingClientRect();
    return {
      reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      left: col?.left ?? 0,
    };
  });

  useLayoutEffect(() => {
    const host = stage.current;
    const conv = layer.current;
    const target = conv?.querySelector<HTMLElement>("[data-chat-composer]");
    if (!host || !conv || !target || !veil.current) {
      // Nothing to fly onto: go plainly, and let the page take over.
      router.push("/chat");
      setLanded(true);
      return;
    }

    const anims: Animation[] = [];
    const timers: number[] = [];
    const run = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      anims.push(el.animate(frames, { fill: "both", ...opts }));
    };
    const later = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };
    host.setAttribute("inert", "");

    const { from, root } = handoff;
    let ghost: HTMLElement | null = null;

    if (env.reduce) {
      if (root) run(root, [{ opacity: 1 }, { opacity: 0 }], { duration: T.quick, easing: "linear" });
      run(veil.current, [{ opacity: 0 }, { opacity: 1 }], { duration: T.quick, easing: "linear" });
      run(conv, [{ opacity: 0 }, { opacity: 1 }], { duration: T.quick, easing: "linear" });
      later(T.quick, () => router.push("/chat"));
      later(T.quick, () => setLanded(true));
    } else {
      // Hidden until the flying copy lands on it. Measured before anything
      // moves, so the target is where the composer will finally rest.
      target.style.opacity = "0";
      const to = target.getBoundingClientRect();
      const hostLeft = host.getBoundingClientRect().left;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const flight = { delay: T.flightDelay, duration: T.flight, easing: EASE_IN_OUT };

      // Home recedes toward the box, so the eye stays on the one thing moving.
      if (root) {
        const r = root.getBoundingClientRect();
        root.style.transformOrigin = `${from.left + from.width / 2 - r.left}px ${from.top + from.height / 2 - r.top}px`;
        run(
          root,
          [
            { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
            { opacity: 0, filter: "blur(4px)", transform: "scale(0.985)" },
          ],
          { duration: T.dissolve, easing: EASE_OUT }
        );
      }
      run(veil.current, [{ opacity: 0 }, { opacity: 1 }], { delay: T.veilDelay, duration: T.veil, easing: EASE_IN_OUT });
      run(
        conv,
        [
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0px)" },
        ],
        { delay: T.convDelay, duration: T.conv, easing: EASE_OUT }
      );

      /*
       * The flight. The box and the composer are different shapes (a two-row
       * box with a footer, a one-row bar), so neither can simply be moved
       * onto the other. A copy of each rides in one wrapper that travels the
       * path; the Home copy shrinks to the composer's width and fades out, the
       * composer copy grows from the box's width and fades in, and the
       * crossover sits in the middle of the glide where the motion hides it.
       * Scale is uniform, so no text is ever squashed.
       */
      const s = to.width / from.width;
      ghost = document.createElement("div");
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${to.left}px`,
        top: `${to.top}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
        pointerEvents: "none",
      });
      const home = handoff.ghost;
      Object.assign(home.style, {
        position: "absolute",
        margin: "0",
        left: `${(to.width - from.width) / 2}px`,
        top: `${(to.height - from.height) / 2}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
      });
      const bar = target.cloneNode(true) as HTMLElement;
      bar.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      Object.assign(bar.style, { position: "absolute", inset: "0", margin: "0", opacity: "" });
      ghost.append(home, bar);
      host.appendChild(ghost);

      run(ghost, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }], flight);
      run(
        home,
        [
          { offset: 0, opacity: 1, transform: "scale(1)" },
          { offset: 0.15, opacity: 1, transform: `scale(${lerp(1, s, 0.15)})` },
          { offset: 0.55, opacity: 0, transform: `scale(${lerp(1, s, 0.55)})` },
          { offset: 1, opacity: 0, transform: `scale(${s})` },
        ],
        flight
      );
      run(
        bar,
        [
          { offset: 0, opacity: 0, transform: `scale(${1 / s})` },
          { offset: 0.45, opacity: 0, transform: `scale(${lerp(1 / s, 1, 0.45)})` },
          { offset: 0.9, opacity: 1, transform: `scale(${lerp(1 / s, 1, 0.9)})` },
          { offset: 1, opacity: 1, transform: "scale(1)" },
        ],
        flight
      );

      /*
       * The glow, in two parts and under the conversation, so it shows
       * through the transcript and the frosted composer bar rather than
       * tinting the text. The wave is a wide soft front that sweeps from the
       * box to the bottom of the screen, spreading as it goes. The bloom rides
       * the same path as the box (its track shares the flight exactly) and
       * outlasts it by a beat, so the composer lands inside a fading halo.
       */
      const vh = window.innerHeight;
      const waveH = Math.round(Math.max(280, vh * 0.5));
      const y0 = from.top + from.height / 2 - waveH / 2;
      const y1 = to.top + to.height / 2 - waveH / 2;
      if (wave.current) {
        wave.current.style.height = `${waveH}px`;
        run(
          wave.current,
          [
            { offset: 0, opacity: 0, transform: `translateY(${y0}px) scaleX(0.55)` },
            { offset: 0.25, opacity: 1, transform: `translateY(${lerp(y0, y1, 0.25)}px) scaleX(0.8)` },
            { offset: 0.75, opacity: 0.7, transform: `translateY(${lerp(y0, y1, 0.75)}px) scaleX(1.05)` },
            { offset: 1, opacity: 0, transform: `translateY(${y1}px) scaleX(1.15)` },
          ],
          { delay: T.waveDelay, duration: T.wave, easing: EASE_IN_OUT }
        );
      }
      if (track.current && bloom.current) {
        const bw = to.width * 1.15;
        const bh = Math.max(200, to.height * 2.6);
        Object.assign(track.current.style, {
          left: `${to.left - hostLeft + to.width / 2 - bw / 2}px`,
          top: `${to.top + to.height / 2 - bh / 2}px`,
          width: `${bw}px`,
          height: `${bh}px`,
        });
        run(track.current, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }], flight);
        run(
          bloom.current,
          [
            { offset: 0, opacity: 0, transform: "scale(0.6)" },
            { offset: 0.35, opacity: 0.9, transform: "scale(0.9)" },
            { offset: 0.75, opacity: 0.55, transform: "scale(1.1)" },
            { offset: 1, opacity: 0, transform: "scale(1.25)" },
          ],
          { delay: T.flightDelay, duration: T.bloom, easing: EASE_IN_OUT }
        );
      }

      later(T.push, () => router.push("/chat"));
      later(T.land, () => {
        target.style.opacity = "";
        ghost?.remove();
        setLanded(true);
      });
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      anims.forEach((a) => a.cancel());
      ghost?.remove();
      target.style.opacity = "";
    };
    // Runs once per stage: the stage is keyed on the handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Usable once landed, should the Assistant page be slow to arrive.
  useEffect(() => {
    if (landed) stage.current?.removeAttribute("inert");
  }, [landed]);

  useEffect(() => {
    const onChat = pathname === "/chat";
    // Gone somewhere else entirely (the rail is never covered): nothing to hand to.
    if (!onChat && pathname !== handoff.startPath) {
      endHandoff();
      return;
    }
    if (!landed || !onChat || !pageMounted) return;

    let fade: Animation | null = null;
    const t = window.setTimeout(
      () => {
        const host = stage.current;
        if (!host) return;
        fade = host.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: env.reduce ? 120 : T.fade,
          easing: EASE_OUT,
          fill: "forwards",
        });
        fade.onfinish = () => endHandoff();
      },
      env.reduce ? 0 : T.settle
    );
    return () => {
      window.clearTimeout(t);
      fade?.cancel();
    };
  }, [landed, pageMounted, pathname, handoff.startPath, endHandoff, env]);

  return (
    <div
      ref={stage}
      aria-hidden={!landed}
      className={`fixed bottom-0 right-0 top-0 z-[35] overflow-hidden ${landed ? "" : "pointer-events-none"}`}
      style={{ left: env.left }}
    >
      <div ref={veil} className="absolute inset-0 bg-bg-subtle" style={{ opacity: 0 }} />

      <div
        ref={wave}
        aria-hidden="true"
        className="pointer-events-none absolute left-[-15%] top-0 w-[130%]"
        style={{
          opacity: 0,
          background: `radial-gradient(closest-side, ${MINT(46)}, ${ACCENT(16)} 55%, transparent)`,
        }}
      />
      <div ref={track} aria-hidden="true" className="pointer-events-none absolute">
        <div
          ref={bloom}
          className="h-full w-full"
          style={{
            opacity: 0,
            background: `radial-gradient(closest-side, ${ACCENT(34)}, ${ACCENT(12)} 55%, transparent)`,
          }}
        />
      </div>

      {/*
        The Assistant page's own frame, so the conversation lays out here
        exactly as it will there: from the top on a desktop, and on a phone
        from under the sticky bar down to the bottom edge.
      */}
      <div
        ref={layer}
        className={`absolute inset-x-0 bottom-0 lg:bottom-auto lg:top-0 ${CHAT_FRAME}`}
        style={{ opacity: 0 }}
      >
        <Conversation staged />
      </div>
    </div>
  );
}
