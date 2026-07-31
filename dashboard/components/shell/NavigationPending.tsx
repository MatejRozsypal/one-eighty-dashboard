"use client";

/**
 * One shared "a navigation is in flight" signal.
 *
 * ── Why this needs to be shared rather than per-control ─────────────────────
 * Each control used to own its own `useTransition`, so the *control* showed it
 * was busy while the numbers it had just invalidated sat there looking settled.
 * Switching comparison from "prev period" to "prev year" changes every delta on
 * the page, and for the 2–5 seconds BigQuery takes, the old deltas stay on
 * screen looking like the answer — which is worse than a spinner, because a
 * stale number that looks fresh is indistinguishable from a number that didn't
 * change.
 *
 * With the transition hoisted here, every control feeds one flag and the
 * content can react to it. The controls keep their own crisp selected state —
 * you should see *what you picked* immediately — while the figures pulse to say
 * they are being recomputed.
 */

import {
  createContext,
  useContext,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { RouteProgress } from "@/components/ui/RouteProgress";

interface NavigationState {
  /** True from the click until the server's new output is committed. */
  isPending: boolean;
  /** Push a URL inside the shared transition. */
  navigate: (href: string) => void;
}

const NavigationContext = createContext<NavigationState>({
  isPending: false,
  // Falling back to a hard navigation keeps a control outside the provider
  // working rather than silently doing nothing.
  navigate: (href) => {
    if (typeof window !== "undefined") window.location.href = href;
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

  function navigate(href: string) {
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <NavigationContext.Provider value={{ isPending, navigate }}>
      <RouteProgress active={isPending} />
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Marks the region whose numbers are invalidated by a navigation.
 *
 * The pulse is scoped to `main` — the figures — and deliberately not applied to
 * the control bar, which sits outside it. Pulsing the controls too would blur
 * the selection the user just made at exactly the moment they are checking it
 * registered.
 *
 * `aria-busy` carries the same information to assistive tech, which cannot see
 * an opacity animation.
 */
export function PendingRegion({ children }: { children: ReactNode }) {
  const { isPending } = useNavigation();

  return (
    <div
      aria-busy={isPending}
      className={`flex min-w-0 flex-1 flex-col ${
        isPending ? "[&_main]:animate-pulse" : ""
      }`}
    >
      {children}
    </div>
  );
}
