"use client";

/**
 * The middle of the page: a large greeting, one line about the clients, and
 * the assistant's box.
 *
 * The box starts a new conversation with the Assistant and carries itself
 * there (see `AssistantBox`). The greeting is rendered in Prague time on the
 * server and corrected to the browser's clock after mount, as the current
 * Home does, so the first paint is never blank.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { useChatSession } from "@/components/chat/ChatSession";
import { HOME_TIME_ZONE, hourIn, partOfDay } from "@/lib/home/greeting";

const MAX_H = 168;

export function Hero({ name, now, line }: { name: string | null; now: string; line: string }) {
  const [part, setPart] = useState(() => partOfDay(hourIn(new Date(now), HOME_TIME_ZONE)));

  useEffect(() => setPart(partOfDay(new Date().getHours())), []);

  return (
    <section aria-label="Assistant" className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[32px] font-bold leading-[1.1] tracking-heading text-content-strong sm:text-[40px]">
          {name ? `${part}, ${name}.` : `${part}.`}
        </h1>
        <p className="m-0 text-[16px] leading-[1.4] text-content-muted sm:text-[17px]">{line}</p>
      </div>
      <AssistantBox />
    </section>
  );
}

/**
 * The assistant's box on its own.
 *
 * Sending asks the question right here, in a new conversation, and hands the
 * box to `HandoffStage`, which dissolves Home around it and glides it down
 * into the Assistant's composer while the answer starts to stream. It never
 * opens whichever conversation happened to be last, which is what a question
 * asked from Home almost never means.
 *
 * The model picker is the Assistant's own, with the same stored choice.
 */
export function AssistantBox() {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { send, handoff, beginHandoff } = useChatSession();
  const leaving = handoff !== null;

  // The stage changes route mid-flight; prefetched, the Assistant is ready
  // under the veil well before the box lands.
  useEffect(() => router.prefetch("/chat"), [router]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Empty, the box keeps its two rows. Measuring then would run before the
    // font and the width settle and can return a far taller box.
    if (!text) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
  }, [text]);

  function ask() {
    const q = text.trim();
    const el = wrap.current;
    if (!q || !el || leaving) return;

    // Taken before anything changes: the copy that flies is the box exactly
    // as it was when Enter was pressed, text, focus shadow and all.
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    ghost.querySelector("form")?.classList.add("shadow-lg");
    const copy = ghost.querySelector("textarea");
    if (copy) copy.value = text;

    if (!send({ text: q, fresh: true })) return;

    // On a phone the keyboard goes down as the box leaves, rather than
    // staying up over a transcript that has nothing to type yet.
    if (window.matchMedia("(pointer: coarse)").matches) box.current?.blur();

    beginHandoff({
      from: { left: r.left, top: r.top, width: r.width, height: r.height },
      ghost,
      root: el.closest<HTMLElement>("[data-blend-root]") ?? el.closest("main"),
      startPath: window.location.pathname,
    });
  }

  return (
    <div ref={wrap} className={`flex w-full flex-col gap-2 text-left ${leaving ? "invisible" : ""}`}>
      <form
        className="w-full rounded-[22px] border border-hairline bg-surface-card p-2 text-left shadow-md transition-shadow focus-within:shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <label htmlFor="sidekick-q" className="sr-only">
          Ask the assistant
        </label>
        <textarea
          id="sidekick-q"
          ref={box}
          name="q"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder="Ask anything about your clients"
          className="block w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[16px] leading-[1.45] text-content-strong placeholder:text-content-muted focus:outline-none focus-visible:outline-none"
          style={{ maxHeight: MAX_H }}
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-content-muted">
            <Logo markOnly size={16} />
            Assistant
          </span>
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Ask"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink-950 text-white transition-opacity disabled:opacity-25"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
      <ModelPicker />
    </div>
  );
}
