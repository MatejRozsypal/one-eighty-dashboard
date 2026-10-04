"use client";

/**
 * Undo and redo for the report canvas (design 1.11: 50-step client history).
 *
 * Two layers:
 *  - `createHistory` / `commitHistory` / `undoHistory` / `redoHistory` are pure
 *    functions over `{ past, present, future }`. They are what
 *    `scripts/check-reports-canvas.ts` tests.
 *  - `useLayoutHistory` wraps them in React state. Every mutator is
 *    synchronous and returns the resulting history, so a caller that needs the
 *    new present (to announce it, to save it) does not wait for a render.
 *
 * The state type is generic: the canvas stores its widget list, the page may
 * reuse the hook for widget configs.
 *
 * Coalescing: a held arrow key commits dozens of one-cell moves. Commits that
 * carry the same `key` within `COALESCE_MS` of the previous one replace the
 * present instead of pushing a new step, so one undo reverses the whole burst.
 *
 * Owner: RS6 (canvas).
 */

import { useCallback, useRef, useState } from "react";
import { UNDO_HISTORY_STEPS } from "@/lib/reports/limits";

export const COALESCE_MS = 600;

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
  /** Key and time of the last commit, for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

export interface CommitOptions<T> {
  /** Max past steps kept. Default `UNDO_HISTORY_STEPS` (50). */
  limit?: number;
  /** Structural equality. Default: JSON. An equal commit is a no-op. */
  equals?: (a: T, b: T) => boolean;
  /** Commits with the same key inside `COALESCE_MS` merge into one step. */
  key?: string;
  /** Clock, injected for tests. */
  now?: number;
}

const jsonEquals = <T>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [], lastKey: null, lastAt: 0 };
}

/** Push `next` as the new present. Clears redo. Returns the same object when nothing changed. */
export function commitHistory<T>(h: History<T>, next: T, opts: CommitOptions<T> = {}): History<T> {
  const { limit = UNDO_HISTORY_STEPS, equals = jsonEquals, key, now = Date.now() } = opts;
  if (equals(h.present, next)) return h;

  const coalesce = key !== undefined && key === h.lastKey && now - h.lastAt <= COALESCE_MS && h.past.length > 0;
  if (coalesce) {
    return { past: h.past, present: next, future: [], lastKey: key ?? null, lastAt: now };
  }
  const past = [...h.past, h.present];
  const trimmed = past.length > limit ? past.slice(past.length - limit) : past;
  return { past: trimmed, present: next, future: [], lastKey: key ?? null, lastAt: now };
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}

/** Replace the present without recording a step (an external reload). */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next, lastKey: null, lastAt: 0 };
}

export interface LayoutHistoryApi<T> {
  present: T;
  canUndo: boolean;
  canRedo: boolean;
  commit(next: T, opts?: { key?: string }): T;
  undo(): T;
  redo(): T;
  /** Replace the present without a history step. */
  replace(next: T): T;
  /** Drop all history and start from `next`. */
  reset(next: T): T;
}

export function useLayoutHistory<T>(
  initial: T | (() => T),
  options: { limit?: number; equals?: (a: T, b: T) => boolean } = {},
): LayoutHistoryApi<T> {
  const ref = useRef<History<T> | null>(null);
  if (ref.current === null) {
    ref.current = createHistory(typeof initial === "function" ? (initial as () => T)() : initial);
  }
  const [h, setH] = useState<History<T>>(ref.current);
  const optsRef = useRef(options);
  optsRef.current = options;

  const apply = useCallback((fn: (cur: History<T>) => History<T>): T => {
    const cur = ref.current as History<T>;
    const next = fn(cur);
    if (next !== cur) {
      ref.current = next;
      setH(next);
    }
    return next.present;
  }, []);

  const commit = useCallback(
    (next: T, o?: { key?: string }) =>
      apply((cur) => commitHistory(cur, next, { limit: optsRef.current.limit, equals: optsRef.current.equals, key: o?.key })),
    [apply],
  );
  const undo = useCallback(() => apply(undoHistory), [apply]);
  const redo = useCallback(() => apply(redoHistory), [apply]);
  const replace = useCallback((next: T) => apply((cur) => replacePresent(cur, next)), [apply]);
  const reset = useCallback((next: T) => apply(() => createHistory(next)), [apply]);

  return {
    present: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    commit,
    undo,
    redo,
    replace,
    reset,
  };
}
