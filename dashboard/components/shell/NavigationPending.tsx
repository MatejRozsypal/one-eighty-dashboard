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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { RouteProgress } from "@/components/ui/RouteProgress";

export interface NavigateOptions {
  replace?: boolean;
  scroll?: boolean;
}

interface NavigationState {
  /** True from the click until the server's new output is committed. */
  isPending: boolean;
  /** The URL of the navigation in flight, so the link that started it can pulse. */
  pendingHref: string | null;
  /** False outside the provider: callers then fall back to plain behaviour. */
  managed: boolean;
  /** Push (or replace) a URL inside the shared transition. */
  navigate: (href: string, options?: NavigateOptions) => void;
  /** Re-render the current route from the server inside the shared transition. */
  refresh: () => void;
}

const NavigationContext = createContext<NavigationState>({
  isPending: false,
  pendingHref: null,
  managed: false,
  // Falling back to a hard navigation keeps a control outside the provider
  // working rather than silently doing nothing.
  navigate: (href) => {
    if (typeof window !== "undefined") window.location.href = href;
  },
  refresh: () => {
    if (typeof window !== "undefined") window.location.reload();
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

  useEffect(() => {
    if (!isPending) setPendingHref(null);
  }, [isPending]);

  // Back and forward are not routed through here: Next 14 restores a visited
  // entry from its own history state without a network round trip (checked in
  // the browser, also after the router cache expired), so there is nothing in
  // flight to show.

  const navigate = useCallback(
    (href: string, options?: NavigateOptions) => {
      setPendingHref(href);
      startTransition(() => {
        if (options?.replace) router.replace(href, { scroll: options.scroll });
        else router.push(href, { scroll: options?.scroll });
      });
    },
    [router],
  );

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const value = useMemo(
    () => ({ isPending, pendingHref, managed: true, navigate, refresh }),
    [isPending, pendingHref, navigate, refresh],
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
 * on `data-pending`; a skeleton `main` (`aria-busy`) is excluded there so a
 * loading fallback never pulses twice.
 *
 * `aria-busy` carries the same information to assistive tech, which cannot see
 * an opacity animation.
 */
export function PendingRegion({ children }: { children: ReactNode }) {
  const { isPending } = useNavigation();

  return (
    <div
      aria-busy={isPending}
      data-pending={isPending ? "true" : undefined}
      className="flex min-w-0 flex-1 flex-col"
    >
      {children}
    </div>
  );
}
