"use client";

/**
 * Debounced autosave through an injected `onSave` (design 1.1, 4.1: 800 ms).
 *
 * `createAutosaver` is a framework-free state machine (testable with a fake
 * scheduler); `useAutosave` binds it to a React value.
 *
 * Guarantees:
 *  - Mounting does not save: the initial value is the saved baseline.
 *  - Saves never overlap. A change during a save is saved after it finishes.
 *  - `onSave` may return `{ ok: false }` (the shape of `StoreResult`, which also
 *    covers a version conflict) or throw: both end in status "error" and the
 *    value stays dirty. Nothing retries on its own; the next change or a
 *    `flush()` tries again.
 *  - `flush()` saves now and resolves when the queue is empty. The hook calls
 *    it when the tab is hidden or the component unmounts.
 *
 * Owner: RS6 (canvas).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/reports/limits";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/** What `onSave` may return. `{ ok: false }` or `false` is a failed save. */
export type SaveOutcome = void | boolean | { ok: boolean };

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface AutosaverOptions<T> {
  baseline: T;
  save: (value: T) => Promise<SaveOutcome> | SaveOutcome;
  delayMs?: number;
  equals?: (a: T, b: T) => boolean;
  scheduler?: Scheduler;
  onStatus?: (status: AutosaveStatus) => void;
}

export interface Autosaver<T> {
  /** Report the latest value. Starts or restarts the debounce when it differs from what is saved. */
  update(value: T): void;
  /** Save now. Resolves when nothing is pending or in flight. */
  flush(): Promise<void>;
  /** Declare `value` as saved without calling `save` (the page reloaded the report). */
  markSaved(value: T): void;
  /** Cancel the timer. */
  dispose(): void;
  readonly status: AutosaveStatus;
}

const jsonEquals = <T>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

function failed(outcome: SaveOutcome): boolean {
  if (outcome === false) return true;
  if (typeof outcome === "object" && outcome !== null && outcome.ok === false) return true;
  return false;
}

export function createAutosaver<T>(opts: AutosaverOptions<T>): Autosaver<T> {
  const delay = opts.delayMs ?? AUTOSAVE_DEBOUNCE_MS;
  const equals = opts.equals ?? jsonEquals;
  const sched = opts.scheduler ?? realScheduler;

  let saved = opts.baseline;
  let latest = opts.baseline;
  let timer: unknown = null;
  let inflight: Promise<void> | null = null;
  let status: AutosaveStatus = "idle";

  const setStatus = (s: AutosaveStatus) => {
    if (s === status) return;
    status = s;
    opts.onStatus?.(s);
  };
  const clearTimer = () => {
    if (timer !== null) {
      sched.clear(timer);
      timer = null;
    }
  };
  const arm = () => {
    clearTimer();
    timer = sched.set(() => {
      timer = null;
      void run();
    }, delay);
  };

  /** One save of the latest value, then a follow-up when it changed meanwhile. */
  const run = (): Promise<void> => {
    if (inflight) return inflight;
    if (equals(latest, saved)) {
      if (status === "dirty") setStatus("idle");
      return Promise.resolve();
    }
    const value = latest;
    setStatus("saving");
    inflight = (async () => {
      let ok = false;
      try {
        ok = !failed(await opts.save(value));
      } catch {
        ok = false;
      }
      inflight = null;
      if (ok) {
        saved = value;
        if (equals(latest, saved)) setStatus("saved");
        else {
          setStatus("dirty");
          arm();
        }
      } else {
        setStatus("error");
      }
    })();
    return inflight;
  };

  return {
    update(value) {
      latest = value;
      if (equals(latest, saved) && !inflight) {
        clearTimer();
        if (status === "dirty" || status === "error") setStatus("idle");
        return;
      }
      if (!inflight) setStatus("dirty");
      arm();
    },
    async flush() {
      clearTimer();
      // A flush after an in-flight save needs one more round when the value moved on.
      for (let i = 0; i < 4; i++) {
        await run();
        if (equals(latest, saved) || status === "error") break;
      }
    },
    markSaved(value) {
      saved = value;
      latest = value;
      clearTimer();
      setStatus("idle");
    },
    dispose: clearTimer,
    get status() {
      return status;
    },
  };
}

export interface UseAutosaveOptions<T> {
  onSave: (value: T) => Promise<SaveOutcome> | SaveOutcome;
  delayMs?: number;
  /** False pauses autosave (no timer, no flush). Default true. */
  enabled?: boolean;
  equals?: (a: T, b: T) => boolean;
}

export interface UseAutosaveApi<T> {
  status: AutosaveStatus;
  flush(): Promise<void>;
  markSaved(value: T): void;
}

export function useAutosave<T>(value: T, options: UseAutosaveOptions<T>): UseAutosaveApi<T> {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const optsRef = useRef(options);
  optsRef.current = options;

  const saverRef = useRef<Autosaver<T> | null>(null);
  if (saverRef.current === null) {
    saverRef.current = createAutosaver<T>({
      baseline: value,
      delayMs: options.delayMs,
      equals: options.equals,
      // Always call the latest onSave, so a parent closing over a new version number is honoured.
      save: (v) => optsRef.current.onSave(v),
      onStatus: setStatus,
    });
  }
  const saver = saverRef.current;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (enabled) saver.update(value);
  }, [value, enabled, saver]);

  // Save before the tab goes away. Best effort: the browser may cut the request.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    const onPageHide = () => void saver.flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      void saver.flush();
    };
  }, [enabled, saver]);

  const flush = useCallback(() => saver.flush(), [saver]);
  const markSaved = useCallback((v: T) => saver.markSaved(v), [saver]);
  return { status, flush, markSaved };
}
