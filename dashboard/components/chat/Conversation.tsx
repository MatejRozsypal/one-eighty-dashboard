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
 */

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { Composer } from "@/components/chat/Composer";
import { Markdown } from "@/components/chat/Markdown";
import type { Attachment } from "@/lib/image";
import { useChatHistory } from "@/components/chat/HistoryProvider";
import {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  isChatModel,
  type ChatEvent,
  type ChatStatus,
} from "@/lib/chat/models";

const MODEL_KEY = "one-eighty:chat-model";

function storedModel(): string {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    return isChatModel(m) ? m : DEFAULT_CHAT_MODEL;
  } catch {
    return DEFAULT_CHAT_MODEL;
  }
}

export function Conversation() {
  const { conversations, activeId, append, setAgentSession } = useChatHistory();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [streamText, setStreamText] = useState("");
  const [activity, setActivity] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const tail = useRef<HTMLDivElement>(null);
  const active = conversations?.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    setModel(storedModel());
    fetch("/api/chat/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ChatStatus>) : null))
      .then((s) => setLive(Boolean(s?.live)))
      .catch(() => setLive(false));
  }, []);

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, streamText, activity]);

  function pickModel(id: string) {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      // A private window without storage just forgets the choice.
    }
  }

  async function send() {
    const text = draft.trim();
    const images = attachments;
    // An image on its own is a question, "what is wrong with this ad?", so
    // the send is allowed with no text at all.
    if ((!text && images.length === 0) || pending) return;

    const sessionId = active?.agentSessionId ?? null;
    setDraft("");
    setAttachments([]);
    setError(null);
    setNotices([]);
    setStreamText("");
    setActivity(null);
    append({ id: Date.now(), role: "user", text, images });
    setPending(true);

    let answer = "";
    let failure: string | null = null;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          images: images.map((a) => ({ mime: a.mime, dataUrl: a.dataUrl })),
          model,
          sessionId,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "text") {
            answer += event.delta;
            setStreamText(answer);
            setActivity(null);
          } else if (event.type === "tool") {
            setActivity(`${event.server}: ${event.name.replace(/_/g, " ")}`);
          } else if (event.type === "session") {
            setAgentSession(event.id);
          } else if (event.type === "notice") {
            setNotices((n) => [...n, event.message]);
          } else if (event.type === "error") {
            failure = event.message;
          }
        }
      }
    } catch (e) {
      // Surfaced, never swallowed into a fake answer: a chat that invents a
      // reply when the server is down is worse than one that says it is down.
      failure = e instanceof Error ? e.message : "Could not reach the assistant.";
    } finally {
      // Whatever arrived is kept, even when the stream broke halfway: the
      // numbers already shown were real, and the error says it is incomplete.
      if (answer.trim()) append({ id: Date.now() + 1, role: "assistant", text: answer.trim() });
      if (failure) setError(failure);
      setStreamText("");
      setActivity(null);
      setPending(false);
    }
  }

  const composer = (
    <div className="flex flex-col gap-2">
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
      {live && (
        <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label="Model">
          {CHAT_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={model === m.id}
              title={m.hint}
              disabled={pending}
              onClick={() => pickModel(m.id)}
              className={`rounded-full px-[10px] py-[3px] text-[12px] transition-colors duration-fast ${
                model === m.id
                  ? "bg-surface-card font-semibold text-content-strong shadow-sm"
                  : "text-content-muted hover:text-content-body"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
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
