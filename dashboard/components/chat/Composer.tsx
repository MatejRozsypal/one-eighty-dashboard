"use client";

/**
 * The input box, shared by the centred empty state and the pinned bottom bar.
 *
 * One component rather than two so the two placements cannot drift: they are
 * the same control moving, which is also why the empty state grows into the
 * transcript rather than swapping for a different-looking box.
 *
 * ── Images ────────────────────────────────────────────────────────────────
 * Three ways in, because people reach for all three: paste, drag-and-drop, and
 * the button. Paste is the one that matters — it is how a screenshot gets from
 * a Meta dashboard into a question about it — and it is the one that needs no
 * discoverability, which is why the button exists anyway for the other two.
 *
 * ── The missing focus ring ────────────────────────────────────────────────
 * `globals.css` draws a green `:focus-visible` outline on everything, and that
 * rule is right nearly everywhere. It is suppressed here, and only here,
 * because a text field already shows focus twice over: the caret blinks in it
 * and the box is the only thing on the screen.
 */

import { useEffect, useRef, useState } from "react";
import {
  isImage,
  prepareImage,
  MAX_ATTACHMENTS,
  MAX_TOTAL_BYTES,
  type Attachment,
} from "@/lib/image";

const MAX_H = 180;

export function Composer({
  value,
  onChange,
  onSend,
  pending,
  attachments,
  onAttach,
  onRemove,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  attachments: Attachment[];
  onAttach: (added: Attachment[]) => void;
  onRemove: (id: string) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
  }, [value]);

  async function ingest(files: File[]) {
    const images = files.filter(isImage);
    if (images.length === 0) return;

    setNotice(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setNotice(`Up to ${MAX_ATTACHMENTS} images at a time.`);
      return;
    }

    const accepted: Attachment[] = [];
    let total = attachments.reduce((n, a) => n + a.bytes, 0);

    for (const file of images.slice(0, room)) {
      try {
        const att = await prepareImage(file);
        if (total + att.bytes > MAX_TOTAL_BYTES) {
          setNotice("That image is too large even after resizing.");
          break;
        }
        total += att.bytes;
        accepted.push(att);
      } catch {
        setNotice("That image could not be read.");
      }
    }

    if (images.length > room) {
      setNotice(`Only the first ${room} were added — ${MAX_ATTACHMENTS} is the limit.`);
    }
    if (accepted.length) onAttach(accepted);
  }

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !pending;

  return (
    <div className="flex flex-col gap-2">
      {notice && (
        <span className="px-1 text-[12px] leading-[1.5] text-content-muted">
          {notice}
        </span>
      )}

      <div
        onDragOver={(e) => {
          // Only claim the drop when it actually carries files, or dragging
          // selected text within the page starts flashing the drop state.
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(false);
          void ingest([...e.dataTransfer.files]);
        }}
        className={`flex flex-col gap-2 rounded-card border bg-surface-card py-[9px] pl-[15px] pr-[9px] shadow-sm transition-colors duration-fast ${
          dragging ? "border-accent" : "border-hairline"
        }`}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {attachments.map((a) => (
              <span key={a.id} className="relative block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="h-[54px] w-[54px] rounded-sm border border-hairline object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-hairline bg-paper text-content-body shadow-sm"
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => filePicker.current?.click()}
            aria-label="Add an image"
            title="Add an image"
            className="flex h-7 w-7 flex-none items-center justify-center self-center rounded-full text-content-muted transition-colors duration-fast hover:bg-gray-100 hover:text-content-body"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          <input
            ref={filePicker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void ingest([...(e.target.files ?? [])]);
              // Cleared so choosing the same file twice in a row still fires.
              e.target.value = "";
            }}
          />

          <textarea
            ref={ref}
            rows={1}
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.some(isImage)) {
                // Prevented only when there is an image, so pasting text into
                // the field still behaves like a text field.
                e.preventDefault();
                void ingest(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder="Ask anything"
            aria-label="Message"
            className="max-h-[180px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-[3px] text-[14.5px] leading-[1.55] text-content-strong outline-none focus-visible:outline-none placeholder:text-content-muted"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
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
      </div>
    </div>
  );
}
