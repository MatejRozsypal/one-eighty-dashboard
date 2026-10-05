"use client";

/**
 * The delta display mode, shared by every chip, tile, table and report widget.
 *
 * One global choice: a change against the comparison period is shown as a
 * relative change ("pct") or as the difference in the metric's own unit
 * ("abs"). Rates are in percentage points either way (lib/format `deltaParts`).
 *
 * ── Where the mode comes from ───────────────────────────────────────────────
 *   1. `?delta=` in the URL, so a shared link shows what its sender saw;
 *   2. else the mode this provider already holds (it lives in the app layout,
 *      so it survives every navigation, including links built on the server,
 *      which never carry `delta`, see `viewQuery`);
 *   3. on a fresh load, the cookie default the layout passes in (`initial`).
 *
 * ── Why the toggle does not navigate ────────────────────────────────────────
 * The mode is display only: no query reads it. A navigation would re-render the
 * page on the server and re-run every BigQuery query (5 to 10 s on Snapshot) to
 * redraw the same numbers. So the toggle switches the chips at once, writes the
 * cookie, and writes the URL in place (`replaceInPlace`). While a navigation to
 * the same page is in flight it folds into that navigation instead, so the two
 * changes cannot undo each other.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import {
  DEFAULT_DELTA_MODE,
  DELTA_COOKIE,
  DELTA_PARAM,
  parseDeltaMode,
  type DeltaMode,
} from "@/lib/format";

interface DeltaModeState {
  mode: DeltaMode;
  setMode: (mode: DeltaMode) => void;
}

const DeltaModeContext = createContext<DeltaModeState>({
  mode: DEFAULT_DELTA_MODE,
  setMode: () => {},
});

/** The mode every delta renders in. "pct" outside the provider. */
export function useDeltaMode(): DeltaMode {
  return useContext(DeltaModeContext).mode;
}

/** Mode plus its setter, for the toggle. */
export function useDeltaModeControl(): DeltaModeState {
  return useContext(DeltaModeContext);
}

/**
 * A fixed mode with no URL or cookie: for rendering outside the app shell
 * (check scripts, an export). Inside the app, `DeltaModeProvider` sets it.
 */
export function DeltaModeStatic({ mode, children }: { mode: DeltaMode; children: ReactNode }) {
  const value = useMemo(() => ({ mode, setMode: () => {} }), [mode]);
  return <DeltaModeContext.Provider value={value}>{children}</DeltaModeContext.Provider>;
}

/** One year; the choice is a preference, not a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(mode: DeltaMode) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${DELTA_COOKIE}=${mode}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function DeltaModeProvider({
  initial,
  children,
}: {
  /** The cookie default, read by the layout on the server. */
  initial: DeltaMode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { baseQuery, replaceInPlace } = useNavigation();

  const fromUrl = parseDeltaMode(searchParams.get(DELTA_PARAM));
  const [mode, setLocal] = useState<DeltaMode>(fromUrl ?? initial);

  // An explicit URL value wins whenever it changes (a shared link, Back,
  // Forward). Adjusted during render, so no frame shows the old mode.
  const [seen, setSeen] = useState<DeltaMode | null>(fromUrl);
  if (fromUrl !== seen) {
    setSeen(fromUrl);
    if (fromUrl !== null && fromUrl !== mode) setLocal(fromUrl);
  }

  const setMode = useCallback(
    (next: DeltaMode) => {
      setLocal(next);
      writeCookie(next);
      const q = new URLSearchParams(baseQuery(pathname, searchParams.toString()));
      q.set(DELTA_PARAM, next);
      replaceInPlace(`${pathname}?${q.toString()}`);
    },
    [baseQuery, pathname, replaceInPlace, searchParams],
  );

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <DeltaModeContext.Provider value={value}>{children}</DeltaModeContext.Provider>;
}
