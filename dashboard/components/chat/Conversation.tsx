"use client";

/**
 * The assistant conversation.
 *
 * Two states, one control. Empty, it is a centred column — mark, one line, and
 * the box — which is the shape of the reference and the right one for a screen
 * whose only job is to accept a first sentence. Once anything has been said the
 * transcript takes the space and the same box pins to the bottom.
 *
 * The wait is a real round trip to `/api/chat`. The reply is a fixed holding
 * line today, so it would have been easy to render it instantly and ship an
 * interface that had never been exercised against latency at all — the pending
 * state and the failure path are the parts of a chat that are actually hard.
 */

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { Composer } from "@/components/chat/Composer";
import type { Attachment } from "@/lib/image";
import { useChatHistory } from "@/components/chat/HistoryProvider";

export function Conversation() {
  const { conversations, activeId, append } = useChatHistory();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const active = conversations?.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  async function send() {
    const text = draft.trim();
    const images = attachments;
    // An image on its own is a question — "what is wrong with this ad?" — so
    // the send is allowed with no text at all.
    if ((!text && images.length === 0) || pending) return;

    setDraft("");
    setAttachments([]);
    setError(null);
    append({ id: Date.now(), role: "user", text, images });
    setPending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          images: images.map((a) => ({ mime: a.mime, dataUrl: a.dataUrl })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      const { reply } = await res.json();
      append({ id: Date.now() + 1, role: "assistant", text: reply });
    } catch (e) {
      // Surfaced, never swallowed into a fake answer: a chat that invents a
      // reply when the server is down is worse than one that says it is down.
      setError(e instanceof Error ? e.message : "Could not reach the assistant.");
    } finally {
      setPending(false);
    }
  }

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={() => void send()}
      pending={pending}
      attachments={attachments}
      onAttach={(added) => setAttachments((a) => [...a, ...added])}
      onRemove={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
      autoFocus
    />
  );

  if (messages.length === 0 && !pending && !error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-16 lg:px-8">
        <div className="flex w-full max-w-[680px] flex-col gap-7">
          <div className="flex items-center justify-center gap-3">
            <Logo markOnly size={34} />
            <h1 className="m-0 text-center text-[30px] font-bold leading-[1.15] tracking-heading text-content-strong lg:text-[34px]">
              What do you want to know?
            </h1>
          </div>
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                <div className="min-w-0 whitespace-pre-wrap text-[14.5px] leading-[1.7] text-content-strong">
                  {m.text}
                </div>
              </div>
            )
          )}

          {pending && (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-content-muted">
              Thinking…
            </span>
          )}

          {error && (
            <div className="flex flex-col gap-1 rounded-card border border-negative/[0.35] bg-surface-card p-[14px_16px]">
              <span className="text-[13.5px] font-semibold text-content-strong">
                The assistant did not answer.
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
