"use client";

/**
 * One shared "a navigation is in flight" signal.
 *
 * ── Why this needs to be shared rather than per-control ─────────────────────
 * Each control used to own its own `useTransition`, so the *control* showed it
 * was busy while the numbers it had just invalidated sat there looking settled.
 * Switching comparison from "prev period" to "prev year" changes every delta on
 * the page, and for the 2-5 seconds BigQuery takes, the old deltas stay on
 * screen looking like the answer, which is worse than a spinner, because a
 * stale number that looks fresh is indistinguishable from a number that didn't
 * change.
 *
 * With the transition hoisted here, every control feeds one flag and the
 * content can react to it. The controls keep their own crisp selected state,
 * you should see *what you picked* immediately, while the figures pulse to say
 * they are being recomputed.
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RouteProgress } from "@/components/ui/RouteProgress";
import { SkeletonChart, SkeletonKpiRow, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * What a navigation changes, which decides how the page shows it is pending.
 *
 *   "view"    the same client's numbers under different settings (range,
 *             compare, currency, a filter, another page): the figures stay and
 *             pulse, because the old numbers are still the right client's.
 *   "client"  another client's numbers: the figures are hidden behind a
 *             skeleton until the new ones commit. The chip already shows the
 *             new name, and an old figure under a new name reads as the new
 *             client's (QA A-02), so nothing of the old body may stay visible.
 */
export type PendingKind = "view" | "client";

export interface NavigateOptions {
  replace?: boolean;
  /**
   * Scroll to the top after the navigation. Left undefined it defaults to
   * false when only the query string changes on the same path (a filter, a
   * toggle, a column set, the client), so the view stays where the user is
   * working (QA B-04), and to Next's own behaviour otherwise.
   */
  scroll?: boolean;
  /** Defaults to "view". */
  kind?: PendingKind;
}

/**
 * The scroll option to hand to the router for `href`, seen from `here`.
 *
 * An explicit choice always wins. A target on the same path with no hash is a
 * query-only change: do not scroll. Anything else (another path, a hash to
 * jump to) keeps Next's default. Pure, so the loading check can pin it.
 */
export function scrollFor(
  href: string,
  explicit: boolean | undefined,
  here: { href: string; origin: string; pathname: string },
): boolean | undefined {
  if (explicit !== undefined) return explicit;
  let target: URL;
  try {
    target = new URL(href, here.href);
  } catch {
    return undefined;
  }
  if (target.origin === here.origin && target.pathname === here.pathname && target.hash === "") {
    return false;
  }
  return undefined;
}

/**
 * The query string a control should patch, as a string without the "?".
 *
 * `useSearchParams()` is a snapshot of the last *committed* URL. A second
 * control change made while the first is still loading would start from that
 * snapshot and silently drop the first change (QA C-05, the same race QF2
 * fixed inside Reports). So while a navigation is in flight, controls build on
 * the URL that navigation is heading to, provided it is the same page; a
 * navigation to another path does not carry this page's state. Pure, so the
 * loading check can pin it.
 */
export function baseQueryFor(
  latestHref: string | null,
  pathname: string,
  committed: string,
): string {
  if (latestHref === null) return committed;
  let target: URL;
  try {
    target = new URL(latestHref, "http://n");
  } catch {
    return committed;
  }
  if (target.pathname !== pathname) return committed;
  return target.search.startsWith("?") ? target.search.slice(1) : target.search;
}

/** True when two hrefs, resolved against `here`, point at the same path. Pure. */
export function samePath(a: string, b: string, here: string): boolean {
  try {
    return new URL(a, here).pathname === new URL(b, here).pathname;
  } catch {
    return false;
  }
}

interface NavigationState {
  /** True from the click until the server's new output is committed. */
  isPending: boolean;
  /** The URL of the navigation in flight, so the link that started it can pulse. */
  pendingHref: string | null;
  /** What the navigation in flight changes; null when nothing is pending. */
  pendingKind: PendingKind | null;
  /** False outside the provider: callers then fall back to plain behaviour. */
  managed: boolean;
  /** Push (or replace) a URL inside the shared transition. */
  navigate: (href: string, options?: NavigateOptions) => void;
  /** Re-render the current route from the server inside the shared transition. */
  refresh: () => void;
  /**
   * The query string (no "?") a control on `pathname` should merge its change
   * onto: the newest requested URL while one is in flight, else `committed`
   * (pass `useSearchParams().toString()`). Read at click time, never cached in
   * render, so two clicks in the same tick still see each other.
   */
  baseQuery: (pathname: string, committed: string) => string;
  /**
   * Write a display-only change (the delta mode) into the URL without a
   * server render: no query reads it, so a round trip would re-run every
   * BigQuery query on the page to redraw the same numbers.
   *
   * Race rule: while a navigation to the same page is in flight, `href` is
   * handed to `navigate` instead, superseding it (the page pulses, and the
   * change cannot be lost when the older target commits). While one to
   * another page is in flight the URL is left alone; the caller's own state
   * carries the change there. Build `href` on `baseQuery`.
   */
  replaceInPlace: (href: string) => void;
}

const NavigationContext = createContext<NavigationState>({
  isPending: false,
  pendingHref: null,
  pendingKind: null,
  managed: false,
  // Falling back to a hard navigation keeps a control outside the provider
  // working rather than silently doing nothing.
  navigate: (href) => {
    if (typeof window !== "undefined") window.location.href = href;
  },
  refresh: () => {
    if (typeof window !== "undefined") window.location.reload();
  },
  baseQuery: (_pathname, committed) => committed,
  replaceInPlace: (href) => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", href);
  },
});

export function useNavigation(): NavigationState {
  return useContext(NavigationContext);
}

export function NavigationPendingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [kind, setKind] = useState<PendingKind>("view");
  // The newest href handed to `navigate`, written synchronously so a second
  // click in the same tick already sees the first. Dropped when the transition
  // commits, after which `useSearchParams()` is current again.
  const latestHref = useRef<string | null>(null);
  // The href an in-place write (`replaceInPlace`) just put in the address bar.
  // Next applies it to `useSearchParams()` in a transition, so a control
  // clicked in the same tick would otherwise build on the old query and undo
  // it. Dropped as soon as the committed URL changes (it then reflects the
  // write) and by any `navigate`.
  const inPlaceHref = useRef<string | null>(null);
  const pathnameNow = usePathname();
  const committedQuery = useSearchParams().toString();
  useEffect(() => {
    inPlaceHref.current = null;
  }, [pathnameNow, committedQuery]);

  useEffect(() => {
    if (!isPending) {
      setPendingHref(null);
      setKind("view");
      latestHref.current = null;
    }
  }, [isPending]);

  // Back and forward are not routed through here: Next 14 restores a visited
  // entry from its own history state without a network round trip (checked in
  // the browser, also after the router cache expired), so there is nothing in
  // flight to show.

  const navigate = useCallback(
    (href: string, options?: NavigateOptions) => {
      const scroll =
        typeof window === "undefined"
          ? options?.scroll
          : scrollFor(href, options?.scroll, window.location);
      // Set in the same batch as the transition starts, so the first frame
      // that shows the pending state already shows the right kind of it.
      latestHref.current = href;
      inPlaceHref.current = null;
      setPendingHref(href);
      setKind(options?.kind ?? "view");
      startTransition(() => {
        if (options?.replace) router.replace(href, { scroll });
        else router.push(href, { scroll });
      });
    },
    [router],
  );

  const refresh = useCallback(() => {
    latestHref.current = null;
    setKind("view");
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const baseQuery = useCallback(
    (pathname: string, committed: string) =>
      baseQueryFor(latestHref.current ?? inPlaceHref.current, pathname, committed),
    [],
  );

  const replaceInPlace = useCallback(
    (href: string) => {
      if (typeof window === "undefined") return;
      const here = window.location.href;
      const inFlight = latestHref.current;
      if (inFlight !== null) {
        if (samePath(inFlight, href, here)) navigate(href);
        return;
      }
      // Next 14.2 patches replaceState: `useSearchParams` and `usePathname`
      // follow, the router keeps its tree, nothing is fetched.
      inPlaceHref.current = href;
      window.history.replaceState(null, "", href);
    },
    [navigate],
  );

  // Derived from `isPending` rather than cleared in the effect above, so the
  // render that commits the new page is also the one that drops the kind: the
  // skeleton never outlives the transition by a frame, and never lingers over
  // the new client's figures.
  const pendingKind = isPending ? kind : null;

  const value = useMemo(
    () => ({ isPending, pendingHref, pendingKind, managed: true, navigate, refresh, baseQuery, replaceInPlace }),
    [isPending, pendingHref, pendingKind, navigate, refresh, baseQuery, replaceInPlace],
  );

  return (
    <NavigationContext.Provider value={value}>
      <RouteProgress active={isPending} />
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Marks the region whose numbers are invalidated by a navigation.
 *
 * The pulse is scoped to `main`, the figures, and deliberately not applied to
 * the control bar, which sits outside it. Pulsing the controls too would blur
 * the selection the user just made at exactly the moment they are checking it
 * registered. The animation itself lives in `globals.css` (`oe-pulse`), keyed
 * on `data-pending="true"`; a skeleton `main` (`aria-busy`) is excluded there
 * so a loading fallback never pulses twice.
 *
 * A client switch is different (`data-pending="client"`): the page's `main`
 * is hidden (visibility, so nothing moves and the scroll position holds) and a
 * skeleton is drawn over it until the new client's page commits. The classes
 * are static and live here, so `globals.css` keeps its one pulse rule.
 *
 * `aria-busy` carries the same information to assistive tech, which cannot see
 * an opacity animation.
 */
export function PendingRegion({ children }: { children: ReactNode }) {
  const { isPending, pendingKind } = useNavigation();
  const regionRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const client = pendingKind === "client";

  // Layout effect: the skeleton is mounted before the browser paints the frame
  // in which `main` went invisible, so there is no blank frame and no frame of
  // old figures.
  useLayoutEffect(() => {
    if (!client) {
      setHost(null);
      return;
    }
    setHost(regionRef.current?.querySelector<HTMLElement>(PAGE_MAIN) ?? null);
  }, [client]);

  return (
    <PendingRegionFrame ref={regionRef} pending={isPending} kind={pendingKind}>
      {children}
      {client && host ? createPortal(<ClientSwitchSkeleton />, host) : null}
    </PendingRegionFrame>
  );
}

/** The page's own `main`, never a loading fallback's (which is `aria-busy`). */
const PAGE_MAIN = 'main:not([aria-busy="true"])';

/**
 * The region's element, split out so the loading check can render each state
 * without a router. The hide rule targets the same `main` the pulse rule does.
 */
export const PendingRegionFrame = forwardRef<
  HTMLDivElement,
  { pending: boolean; kind: PendingKind | null; children: ReactNode }
>(function PendingRegionFrame({ pending, kind, children }, ref) {
  const client = pending && kind === "client";
  return (
    <div
      ref={ref}
      aria-busy={pending}
      data-pending={pending ? (client ? "client" : "true") : undefined}
      className={`flex min-w-0 flex-1 flex-col ${
        client
          ? "[&_main:not([aria-busy=true])]:invisible [&_main:not([aria-busy=true])]:relative"
          : ""
      }`}
    >
      {children}
    </div>
  );
});

/**
 * Drawn inside the hidden `main` during a client switch. `visible` overrides
 * the inherited visibility, `overflow-clip` keeps it inside `main` without
 * becoming a scroll container (which would stop the inner block sticking),
 * and the inner block sticks under the header so the skeleton is where the
 * user is looking even when they switched from far down the page.
 */
export function ClientSwitchSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-client-skeleton=""
      className="visible absolute inset-0 z-10 overflow-clip"
    >
      <div className="sticky top-[var(--header-h)] flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <SkeletonKpiRow />
        <SkeletonChart />
        <SkeletonTable rows={4} />
      </div>
    </div>
  );
}
