"use client";

/**
 * Toasts for the Reports pages: a short line, an optional action ("Undo"), gone
 * after a few seconds. One live region; the newest toast is at the bottom.
 *
 *   const toasts = useToasts();
 *   toasts.push({ text: "Widget removed", action: { label: "Undo", run: () => handle.undo() } });
 *   <ToastRegion toasts={toasts} />
 *
 * Copy follows the UI policy: two or three words, no exclamation marks.
 * Owner: RS9.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastInput {
  text: string;
  action?: { label: string; run: () => void };
  /** Milliseconds. Default 6000; 0 keeps it until dismissed. */
  ttl?: number;
  tone?: "default" | "error";
}

interface Toast extends ToastInput {
  id: number;
}

export interface Toasts {
  list: readonly Toast[];
  push(toast: ToastInput): number;
  dismiss(id: number): void;
}

export function useToasts(): Toasts {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setList((all) => all.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = next.current++;
      setList((all) => [...all.slice(-3), { ...toast, id }]);
      const ttl = toast.ttl ?? 6000;
      if (ttl > 0) timers.current.set(id, setTimeout(() => dismiss(id), ttl));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  return { list, push, dismiss };
}

export function ToastRegion({ toasts }: { toasts: Toasts }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--safe-bottom))] z-[120] flex flex-col items-center gap-2 px-4">
      {toasts.list.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-control px-4 py-2.5 text-[13px] shadow-lg ${
            t.tone === "error" ? "bg-negative text-content-inverse" : "bg-ink-900 text-content-inverse"
          }`}
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                toasts.dismiss(t.id);
              }}
              className="rounded-sm px-1.5 py-0.5 font-medium text-growth-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
