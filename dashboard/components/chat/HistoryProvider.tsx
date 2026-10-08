"use client";

/**
 * Shared conversation state.
 *
 * The sidebar list and the transcript are in different branches of the tree -
 * one is rendered by the app layout, the other by the page, so they need a
 * common owner. Context rather than the URL: the query string here carries the
 * client, range and currency and is appended to every navigation link, so a
 * conversation id put there would ride along to `/snapshot` and every other
 * page that has no idea what it means.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  load,
  save,
  newId,
  titleFrom,
  type Conversation,
  type StoredMessage,
} from "@/lib/chat/history";

interface Ctx {
  /** Null until localStorage has been read, the server cannot know it. */
  conversations: Conversation[] | null;
  activeId: string | null;
  open: (id: string | null) => void;
  remove: (id: string) => void;
  /**
   * Appends to the active conversation, starting one if there isn't one, and
   * returns the id written to. With `to` it writes to that conversation
   * instead, whichever is open, and to nothing if it has since been removed.
   */
  append: (message: StoredMessage, to?: string) => string;
  /** Records the agent session a conversation (the active one by default) continues. */
  setAgentSession: (sessionId: string, to?: string) => void;
}

const ChatHistory = createContext<Ctx | null>(null);

export function useChatHistory(): Ctx {
  const ctx = useContext(ChatHistory);
  if (!ctx) throw new Error("useChatHistory used outside HistoryProvider");
  return ctx;
}

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);

  /*
   * The selected conversation is mirrored into a ref because one send writes
   * twice, the question, then the answer, and both writes happen inside a
   * single `send()` whose closure captured `activeId` before the first write
   * set it. Reading state there meant the reply did not know a conversation had
   * just been created and started a second one, so every first message split
   * into two rows in the list. A ref is the current value, not the value as of
   * the last render, which is what a write path needs.
   */
  const activeIdRef = useRef<string | null>(null);

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);

  // Read after mount: localStorage does not exist during the server render, and
  // reading it in a `useState` initialiser would mismatch the hydration.
  useEffect(() => {
    setConversations(load());
  }, []);

  const open = useCallback((id: string | null) => setActiveId(id), [setActiveId]);

  const remove = useCallback(
    (id: string) => {
      setConversations((prev) => {
        if (!prev) return prev;
        const next = prev.filter((c) => c.id !== id);
        save(next);
        return next;
      });
      if (activeIdRef.current === id) setActiveId(null);
    },
    [setActiveId]
  );

  const append = useCallback(
    (message: StoredMessage, to?: string) => {
      const now = Date.now();

      // The id is minted and published here, outside the updater. React may
      // invoke an updater twice in development, and an updater that calls
      // `newId()` would mint a different id each time, leaving the selected
      // conversation pointing at one that was never stored.
      let id = to ?? activeIdRef.current;
      if (!id) {
        id = newId();
        setActiveId(id);
      }
      const target = id;

      setConversations((prev) => {
        const list = prev ?? [];
        const existing = list.find((c) => c.id === target);
        // An answer addressed to a conversation that was deleted while it
        // streamed is dropped, not used to bring the conversation back.
        if (!existing && to !== undefined) return prev;

        const next = existing
          ? list.map((c) =>
              c.id === target
                ? { ...c, updatedAt: now, messages: [...c.messages, message] }
                : c
            )
          : [
              {
                id: target,
                title: titleFrom(message.text, !!message.images?.length),
                createdAt: now,
                updatedAt: now,
                messages: [message],
              },
              ...list,
            ];

        save(next);
        return next;
      });
      return target;
    },
    [setActiveId]
  );

  const setAgentSession = useCallback((sessionId: string, to?: string) => {
    const target = to ?? activeIdRef.current;
    if (!target) return;
    setConversations((prev) => {
      if (!prev) return prev;
      const next = prev.map((c) =>
        c.id === target && c.agentSessionId !== sessionId ? { ...c, agentSessionId: sessionId } : c
      );
      save(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ conversations, activeId, open, remove, append, setAgentSession }),
    [conversations, activeId, open, remove, append, setAgentSession]
  );

  return <ChatHistory.Provider value={value}>{children}</ChatHistory.Provider>;
}
