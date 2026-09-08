"use client";

/**
 * The conversation list in the dark panel, shown while the assistant is the
 * selected product.
 *
 * It replaces the Analytics page list rather than sitting beside it: the panel
 * belongs to whichever product the rail has chosen, and a chat section whose
 * sidebar is a list of dashboards is a chat section pretending to be one.
 */

import { useChatHistory } from "@/components/chat/HistoryProvider";

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

  return (
    <div className="flex flex-col gap-[3px]">
      <button
        type="button"
        onClick={() => open(null)}
        className={`mb-1 flex items-center gap-[9px] rounded-sm px-2.5 py-[9px] text-left text-[13.5px] tracking-[-0.01em] transition-colors duration-fast ${
          activeId === null
            ? "bg-growth-500/[0.14] font-semibold text-growth-300"
            : "text-gray-250 hover:bg-white/[0.06]"
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="flex-none"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New conversation
      </button>

      <span className="px-2.5 pb-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-gray-400">
        History
      </span>

      {conversations === null ? (
        // Never rendered as "no conversations": the store has not been read
        // yet, and an empty state shown during a read is a lie that resolves
        // itself half a second later.
        <span className="px-2.5 py-[9px] text-[12.5px] text-gray-400">Loading…</span>
      ) : conversations.length === 0 ? (
        <span className="px-2.5 py-[9px] text-[12.5px] leading-[1.6] text-gray-400">
          Nothing yet. Ask something and it will appear here.
        </span>
      ) : (
        conversations.map((c) => {
          const isActive = c.id === activeId;
          return (
            <span key={c.id} className="group/row relative flex items-center">
              <button
                type="button"
                onClick={() => open(c.id)}
                title={c.title}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm py-[9px] pl-2.5 pr-8 text-left text-[13px] tracking-[-0.01em] transition-colors duration-fast ${
                  isActive
                    ? "bg-growth-500/[0.14] font-semibold text-growth-300"
                    : "text-gray-250 hover:bg-white/[0.06]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="flex-none font-mono text-[10px] text-gray-400">
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
            </span>
          );
        })
      )}

      <p className="px-2.5 pt-3 text-[11.5px] leading-[1.6] text-gray-400">
        Kept in this browser only, not yet on your account.
      </p>
    </div>
  );
}
