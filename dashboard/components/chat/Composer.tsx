"use client";

/**
 * The input box, shared by the centred empty state and the pinned bottom bar.
 *
 * One component rather than two so the two placements cannot drift: they are
 * the same control moving, which is also why the empty state animates into the
 * transcript rather than swapping for a different-looking box.
 *
 * The reference this follows puts a mode switch and a model name along the
 * bottom edge. Neither is reproduced here: there is one mode and the model is
 * not yet chosen, and a control that does nothing is worse than an absent one —
 * it invites a click and answers with nothing.
 */

import { useEffect, useRef } from "react";

const MAX_H = 200;

export function Composer({
  value,
  onChange,
  onSend,
  pending,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Reset to `auto` before measuring or scrollHeight only ratchets upward and
  // the box never shrinks again when text is deleted.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
  }, [value]);

  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-hairline bg-surface-card p-[16px_18px] shadow-sm">
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask anything"
        aria-label="Message"
        className="max-h-[200px] min-h-[26px] w-full resize-none bg-transparent text-[15px] leading-[1.6] text-content-strong outline-none placeholder:text-content-muted"
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] leading-[1.5] text-content-muted">
          Enter sends · Shift+Enter for a new line
        </span>
        <button
          type="button"
          onClick={onSend}
          disabled={!value.trim() || pending}
          aria-label="Send"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-content-strong text-paper transition-opacity duration-fast disabled:opacity-25"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="M6 11l6-6 6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
