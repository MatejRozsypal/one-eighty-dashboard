"use client";

/**
 * The assistant conversation, a window onto the One Eighty agent.
 *
 * Two states, one control. Empty, it is a centred column, mark, one line, and
 * the box, which is the shape of the reference and the right one for a screen
 * whose only job is to accept a first sentence. Once anything has been said the
 * transcript takes the space and the same box pins to the bottom.
 *
 * The answer streams from `/api/chat`, which pipes the agent's NDJSON: text as
 * it is written, a line per tool call ("Querying BigQuery"), and the agent's
 * session id, stored on the conversation so the next message resumes it. The
 * agent holds the real transcript; the browser keeps only what it shows.
 *
 * The request itself is made by `ChatSession` in the layout, not here, so an
 * answer started on Home is still arriving when this page mounts, and one
 * started here keeps arriving if you leave and come back.
 */

import { useEffect, useRef } from "react";
import { Logo } from "@/components/ui/Logo";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { useChatHistory } from "@/components/chat/HistoryProvider";
import { streamOf, useChatSession } from "@/components/chat/ChatSession";

/**
 * `staged` is the copy `HandoffStage` draws while Home turns into this page.
 * It is the same component so the two cannot differ by a pixel when one
 * replaces the other; it only skips what must happen once per page: it takes
 * no focus, does not report itself as the page, and scrolls its own column
 * rather than calling `scrollIntoView`, which would also scroll the Home
 * document still underneath it.
 */
export function Conversation({ staged = false }: { staged?: boolean }) {
  const { conversations, activeId } = useChatHistory();
  const { streams, draft, setDraft, attachments, setAttachments, send, notePage } = useChatSession();
  const { pending, text: streamText, activity, notices, error } = streamOf(streams, activeId);
  const tail = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const active = conversations?.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    if (staged) return;
    notePage(true);
    return () => notePage(false);
  }, [staged, notePage]);

  useEffect(() => {
    if (staged) {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }
    tail.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, streamText, activity, staged]);

  function submit() {
    if (send({ text: draft, images: attachments })) {
      setDraft("");
      setAttachments([]);
    }
  }

  const composer = (
    <div data-chat-composer="" className="flex flex-col gap-2">
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={submit}
        pending={pending}
        attachments={attachments}
        onAttach={(added) => setAttachments((a) => [...a, ...added])}
        onRemove={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
        autoFocus={!staged}
      />
      <ModelPicker disabled={pending} />
    </div>
  );

  if (messages.length === 0 && !pending && !error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-16 lg:px-8">
        <div className="flex w-full max-w-[680px] flex-col gap-7">
          <div className="flex items-center justify-center gap-3">
            <Logo markOnly size={34} />
            <h1 className="m-0 text-center text-[30px] font-bold leading-[1.15] tracking-heading text-content-strong lg:text-[34px]">
              Assistant
            </h1>
          </div>
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-5 pb-8 pt-8 lg:px-8">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex flex-col items-end gap-2">
                {m.images && m.images.length > 0 && (
                  <div className="flex max-w-[84%] flex-wrap justify-end gap-2">
                    {m.images.map((img) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={img.id}
                        src={img.dataUrl}
                        alt={img.name}
                        className="max-h-[220px] rounded-card border border-hairline object-cover"
                      />
                    ))}
                  </div>
                )}
                {m.text && (
                  <div className="max-w-[84%] whitespace-pre-wrap rounded-card bg-surface-card px-[16px] py-[11px] text-[14.5px] leading-[1.6] text-content-strong shadow-sm">
                    {m.text}
                  </div>
                )}
              </div>
            ) : (
              <div key={m.id} className="flex items-start gap-3">
                <span className="mt-[3px] flex-none">
                  <Logo markOnly size={20} />
                </span>
                <Markdown text={m.text} />
              </div>
            )
          )}

          {pending && streamText && (
            <div className="flex items-start gap-3">
              <span className="mt-[3px] flex-none">
                <Logo markOnly size={20} />
              </span>
              <Markdown text={streamText} />
            </div>
          )}

          {notices.map((n) => (
            <span key={n} className="text-[12.5px] leading-[1.6] text-content-muted">
              {n}
            </span>
          ))}

          {pending && (
            <span
              role="status"
              className="oe-pulse font-mono text-[11px] uppercase tracking-[0.08em] text-content-muted"
            >
              {activity ?? (streamText ? "Writing…" : "Thinking…")}
            </span>
          )}

          {error && (
            <div className="flex flex-col gap-1 rounded-card border border-negative/[0.35] bg-surface-card p-[14px_16px]">
              <span className="text-[13.5px] font-semibold text-content-strong">
                The assistant did not finish.
              </span>
              <span className="text-[12.5px] leading-[1.6] text-content-body">
                {error}
              </span>
            </div>
          )}

          <div ref={tail} />
        </div>
      </div>

      <div className="border-t border-hairline bg-paper/[0.86] backdrop-blur-[12px]">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-[calc(1rem+var(--safe-bottom))] pt-3 lg:px-8 lg:pb-4">
          {composer}
        </div>
      </div>
    </div>
  );
}
