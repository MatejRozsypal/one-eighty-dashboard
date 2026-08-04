"use client";

/**
 * Submit button that shows what happened.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * These forms post to server actions and the page re-renders with the saved
 * values already in the inputs. Nothing visibly moves, so pressing Save looked
 * identical to not pressing it — and the natural response is to press it again,
 * or to assume it did not work.
 *
 * ── Why the tick lingers and then leaves ────────────────────────────────────
 * The pending state alone is not enough: a save against a warm connection is
 * over in well under a second, so a spinner can flash by unseen and the button
 * simply returns to "Save". The confirmation is therefore held for a moment
 * after the action resolves, then fades — long enough to be read, short enough
 * that it never becomes a stale claim about the current contents of the form.
 */

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export function SaveButton({
  label = "Save",
  disabled = false,
  className = "",
}: {
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  // Without this, the tick fires on first mount, announcing a save that never
  // happened — `pending` starts false, and "no longer pending" is not the same
  // as "was just pending".
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setSaved(false);
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(t);
  }, [pending]);

  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-control border px-3 py-2 font-mono text-[11px] transition-colors duration-fast disabled:opacity-40";

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-live="polite"
      className={`${base} ${
        saved
          ? "border-growth-500 bg-growth-50 text-growth-700"
          : "border-hairline-strong text-content-body hover:bg-gray-50"
      } ${className}`}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="h-3 w-3 flex-none animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      )}
      {saved && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-none animate-tick"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
      {pending ? "Saving…" : saved ? "Saved" : label}
    </button>
  );
}
