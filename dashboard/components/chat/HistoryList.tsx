"use client";

/**
 * The Assistant's list in the sidebar: "New conversation" and the latest
 * conversations, as the second level under the Assistant row.
 *
 * Trimmed to the latest few so the product rows below it stay on screen;
 * "See all" lists the rest in place (there is no separate page of
 * conversations: they live in this browser, see `lib/chat/history`).
 *
 * The list can be peeked from any page, so picking a conversation also goes to
 * the Assistant when you are not already there. The query string rides along,
 * as on every other nav link.
 */

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useChatHistory } from "@/components/chat/HistoryProvider";
import { useNavigation } from "@/components/shell/NavigationPending";
import { SUB_HEAD, SUB_ROW, SUB_ROW_ACTIVE, SUB_ROW_IDLE, SUB_ROW_MUTED } from "@/components/shell/navStyles";

/** How many conversations show before "See all". */
const LATEST = 5;

function when(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function HistoryList() {
  const { conversations, activeId, open, remove } = useChatHistory();
  const [all, setAll] = useState(false);
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const { navigate } = useNavigation();
  const onChat = pathname === "/chat" || pathname.startsWith("/chat/");

  function pick(id: string | null) {
    open(id);
    if (!onChat) navigate(qs ? `/chat?${qs}` : "/chat");
  }

  const shown = conversations && !all ? conversations.slice(0, LATEST) : conversations;
  const hidden = conversations ? conversations.length - LATEST : 0;

  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={() => pick(null)}
        aria-current={onChat && activeId === null ? "page" : undefined}
        className={`${SUB_ROW} ${onChat && activeId === null ? SUB_ROW_ACTIVE : SUB_ROW_IDLE}`}
      >
        New conversation
      </button>

      <span className={`${SUB_HEAD} mt-1`}>History</span>

      {conversations === null ? (
        // Never rendered as "no conversations": the store has not been read
        // yet, and an empty state shown during a read is a lie that resolves
        // itself half a second later.
        <span className={`${SUB_ROW} text-gray-400`}>Loading…</span>
      ) : conversations.length === 0 ? (
        <span className={`${SUB_ROW} text-gray-400`}>No conversations yet.</span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-px p-0">
          {shown!.map((c) => {
            const isActive = onChat && c.id === activeId;
            return (
              <li key={c.id} className="group/row relative flex items-center">
                <button
                  type="button"
                  onClick={() => pick(c.id)}
                  title={c.title}
                  aria-current={isActive ? "page" : undefined}
                  className={`${SUB_ROW} gap-2 pr-8 ${isActive ? SUB_ROW_ACTIVE : SUB_ROW_IDLE}`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="flex-none font-mono text-[10px] font-normal text-gray-400 transition-opacity duration-fast group-hover/row:opacity-0">
                    {when(c.updatedAt)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label={`Delete ${c.title}`}
                  className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-sm text-gray-400 opacity-0 transition-opacity duration-fast hover:bg-white/[0.08] hover:text-gray-250 focus-visible:opacity-100 group-hover/row:opacity-100"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                aria-expanded={all}
                className={`${SUB_ROW} ${SUB_ROW_MUTED}`}
              >
                {all ? "Show fewer" : `See all (${conversations.length})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
