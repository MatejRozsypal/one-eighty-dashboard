"use client";

/**
 * The live side of the assistant: what is being typed, which model answers,
 * and every answer still streaming. `HistoryProvider` keeps what was said;
 * this keeps what is happening.
 *
 * ── Why this lives in the layout and not in the page ──────────────────────
 * It used to be state inside `Conversation`, which was fine while the only
 * place a question could start was the Assistant page. Home now starts one
 * too, and the answer has to keep streaming while Home dissolves and the
 * Assistant takes its place: a stream owned by a component dies with that
 * component, and the Home box is gone a few hundred milliseconds after send.
 * Owned here, above both routes, the request outlives the navigation and the
 * Assistant page simply picks up an answer that is already arriving.
 *
 * The same move fixes two quieter faults of the old shape. An answer is
 * written to the conversation it was asked in, not to whichever one is open
 * when it finishes (opening another conversation mid-answer used to land the
 * reply there). And each conversation carries its own stream, so a question
 * asked from Home never waits on, or interrupts, one still running elsewhere.
 *
 * The draft is here as well, so the two copies of the composer that exist for
 * a moment during the Home handoff (see `HandoffStage`) show the same text and
 * nothing typed in that moment is lost when one of them goes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useChatHistory } from "@/components/chat/HistoryProvider";
import type { Attachment } from "@/lib/image";
import {
  DEFAULT_CHAT_MODEL,
  isChatModel,
  type ChatEvent,
  type ChatStatus,
} from "@/lib/chat/models";

/** Shared by Home and the Assistant, so a choice made in one holds in the other. */
// v2: Sonnet became the default (2026-10-08); a new key resets earlier picks
// of Opus once, so nobody stays on the priciest model by accident.
const MODEL_KEY = "one-eighty:chat-model:v2";

function storedModel(): string {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    return isChatModel(m) ? m : DEFAULT_CHAT_MODEL;
  } catch {
    return DEFAULT_CHAT_MODEL;
  }
}

/** One conversation's answer in flight, or the end state of the last one. */
export interface StreamState {
  pending: boolean;
  text: string;
  activity: string | null;
  notices: string[];
  error: string | null;
}

const IDLE: StreamState = { pending: false, text: "", activity: null, notices: [], error: null };

/** A viewport rectangle, copied out of a `DOMRect` so it survives re-renders. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Everything the stage needs to carry the Home box into the Assistant: where
 * the box was, a copy of it to fly, and the Home content to dissolve.
 */
export interface Handoff {
  id: number;
  from: Rect;
  ghost: HTMLElement;
  root: HTMLElement | null;
  /** The path the handoff left from; any other path but `/chat` cancels it. */
  startPath: string;
}

interface SendInput {
  text: string;
  images?: Attachment[];
  /** Start a new conversation rather than continue the open one. */
  fresh?: boolean;
}

interface Ctx {
  live: boolean;
  /** Asks `/api/chat/status` once per page load; callers may call it freely. */
  checkLive: () => void;
  model: string;
  pickModel: (id: string) => void;
  draft: string;
  setDraft: (v: string) => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  streams: Record<string, StreamState>;
  /** Sends and starts streaming. Returns the conversation id, or null when nothing was sent. */
  send: (input: SendInput) => string | null;
  handoff: Handoff | null;
  beginHandoff: (h: Omit<Handoff, "id">) => void;
  endHandoff: () => void;
  /** True while the Assistant page's own `Conversation` is mounted. */
  pageMounted: boolean;
  notePage: (mounted: boolean) => void;
}

const ChatSession = createContext<Ctx | null>(null);

export function useChatSession(): Ctx {
  const ctx = useContext(ChatSession);
  if (!ctx) throw new Error("useChatSession used outside ChatSessionProvider");
  return ctx;
}

/** The stream for one conversation, idle when nothing has been asked there yet. */
export function streamOf(streams: Record<string, StreamState>, id: string | null): StreamState {
  return (id && streams[id]) || IDLE;
}

export function ChatSessionProvider({ children }: { children: React.ReactNode }) {
  const history = useChatHistory();
  const [live, setLive] = useState(false);
  const [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streams, setStreams] = useState<Record<string, StreamState>>({});
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [pages, setPages] = useState(0);

  /*
   * `send` is called from event handlers and finishes long after the render
   * that created it, so it reads the latest history, model and streams through
   * refs rather than through a closure that would be one answer out of date.
   */
  const historyRef = useRef(history);
  historyRef.current = history;
  const modelRef = useRef(model);
  modelRef.current = model;
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const statusAsked = useRef(false);

  // Read after mount: localStorage does not exist during the server render.
  useEffect(() => setModel(storedModel()), []);

  const checkLive = useCallback(() => {
    if (statusAsked.current) return;
    statusAsked.current = true;
    fetch("/api/chat/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ChatStatus>) : null))
      .then((s) => setLive(Boolean(s?.live)))
      .catch(() => {
        // Asked again by the next picker to mount, rather than never.
        statusAsked.current = false;
        setLive(false);
      });
  }, []);

  const pickModel = useCallback((id: string) => {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      // A private window without storage just forgets the choice.
    }
  }, []);

  const patch = useCallback(
    (id: string, next: Partial<StreamState> | ((s: StreamState) => Partial<StreamState>)) => {
      setStreams((prev) => {
        const cur = prev[id] ?? IDLE;
        return { ...prev, [id]: { ...cur, ...(typeof next === "function" ? next(cur) : next) } };
      });
    },
    []
  );

  const stream = useCallback(
    async (
      id: string,
      body: { message: string; images: Attachment[]; model: string; sessionId: string | null }
    ) => {
      const { append, setAgentSession } = historyRef.current;
      let answer = "";
      let failure: string | null = null;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: body.message,
            images: body.images.map((a) => ({ mime: a.mime, dataUrl: a.dataUrl })),
            model: body.model,
            sessionId: body.sessionId,
          }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error ?? `Request failed (${res.status}).`);
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
              patch(id, { text: answer, activity: null });
            } else if (event.type === "tool") {
              patch(id, { activity: `${event.server}: ${event.name.replace(/_/g, " ")}` });
            } else if (event.type === "session") {
              setAgentSession(event.id, id);
            } else if (event.type === "notice") {
              const message = event.message;
              patch(id, (s) => ({ notices: [...s.notices, message] }));
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
        if (answer.trim()) append({ id: Date.now() + 1, role: "assistant", text: answer.trim() }, id);
        patch(id, { pending: false, text: "", activity: null, error: failure });
      }
    },
    [patch]
  );

  const send = useCallback(
    (input: SendInput): string | null => {
      const text = input.text.trim();
      const images = input.images ?? [];
      // An image on its own is a question, "what is wrong with this ad?", so
      // the send is allowed with no text at all.
      if (!text && images.length === 0) return null;

      const h = historyRef.current;
      const current = input.fresh ? null : h.activeId;
      if (current && streamsRef.current[current]?.pending) return null;
      const sessionId = current
        ? h.conversations?.find((c) => c.id === current)?.agentSessionId ?? null
        : null;

      if (input.fresh) {
        h.open(null);
        // A half-written message belongs to the conversation it was written
        // in, which is no longer the one on screen.
        setDraft("");
        setAttachments([]);
      }
      const id = h.append({ id: Date.now(), role: "user", text, images });
      patch(id, { ...IDLE, pending: true });
      void stream(id, { message: text, images, model: modelRef.current, sessionId });
      return id;
    },
    [patch, stream]
  );

  const beginHandoff = useCallback((h: Omit<Handoff, "id">) => {
    setHandoff({ ...h, id: Date.now() });
  }, []);
  const endHandoff = useCallback(() => setHandoff(null), []);
  const notePage = useCallback((mounted: boolean) => setPages((n) => n + (mounted ? 1 : -1)), []);

  const value = useMemo(
    () => ({
      live,
      checkLive,
      model,
      pickModel,
      draft,
      setDraft,
      attachments,
      setAttachments,
      streams,
      send,
      handoff,
      beginHandoff,
      endHandoff,
      pageMounted: pages > 0,
      notePage,
    }),
    [live, checkLive, model, pickModel, draft, attachments, streams, send, handoff, beginHandoff, endHandoff, pages, notePage]
  );

  return <ChatSession.Provider value={value}>{children}</ChatSession.Provider>;
}
