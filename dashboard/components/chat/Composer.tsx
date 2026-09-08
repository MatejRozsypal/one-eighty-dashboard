"use client";

/**
 * The input box, shared by the centred empty state and the pinned bottom bar.
 *
 * One component rather than two so the two placements cannot drift: they are
 * the same control moving, which is also why the empty state grows into the
 * transcript rather than swapping for a different-looking box.
 *
 * ── The missing focus ring ─────────────────────────────────────────────────
 * `globals.css` draws a green `:focus-visible` outline on everything, and that
 * rule is right nearly everywhere — it is how a keyboard user knows where they
 * are. It is suppressed here, and only here, because a text field already shows
 * focus twice over: the caret blinks in it and the box is the only thing on the
 * screen. Every other control in the app keeps its ring, which is why this is a
 * `focus-visible:outline-none` on one element rather than an edit to the global
 * rule.
 *
 * The reference this follows puts a mode switch and a model name along the
 * bottom edge. Neither is reproduced: there is one mode and no model chosen
 * yet, and a control that does nothing invites a click and answers with
 * nothing.
 */

import { useEffect, useRef } from "react";

const MAX_H = 180;

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
    // `items-end` keeps the button on the last line as the field grows, rather
    // than floating it at the vertical centre of a tall paragraph.
    <div className="flex items-end gap-2 rounded-card border border-hairline bg-surface-card py-[9px] pl-[15px] pr-[9px] shadow-sm">
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. No longer labelled — the
          // convention is carried from every other chat people use.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask anything"
        aria-label="Message"
        className="max-h-[180px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-[3px] text-[14.5px] leading-[1.55] text-content-strong outline-none focus-visible:outline-none placeholder:text-content-muted"
      />

      <button
        type="button"
        onClick={onSend}
        disabled={!value.trim() || pending}
        aria-label="Send"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-content-strong text-paper transition-opacity duration-fast disabled:opacity-25"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
