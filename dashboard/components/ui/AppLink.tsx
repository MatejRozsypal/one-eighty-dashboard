"use client";

/**
 * Internal link that reports its navigation to the shared pending signal.
 *
 * A bare `next/link` navigates inside the router's own transition, which the
 * dashboard cannot observe, so a click on the sidebar, the rail or a tab left
 * the old page standing still until the server answered. This wraps it: the
 * click goes through `useNavigation().navigate`, so the progress bar and the
 * pulse on the main region start on the click, and the clicked link itself
 * pulses while its target is in flight.
 *
 * Plain clicks only. A modified click (new tab), a non-left button, an
 * external or `target` link, a download, a hash-only link and a click on the
 * page you are already on fall through to `next/link` untouched. Outside the
 * provider it is a plain `next/link`. Prefetching is `next/link`'s own.
 *
 * Use this instead of `next/link` everywhere under `app/(app)`; the loading
 * check (`npm run check:loading`) enforces it.
 */

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useNavigation } from "@/components/shell/NavigationPending";

type Props = ComponentProps<typeof Link>;

function isInternal(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function sameLocation(href: string): boolean {
  if (typeof window === "undefined") return false;
  const target = new URL(href, window.location.href);
  return (
    target.pathname === window.location.pathname &&
    target.search === window.location.search &&
    target.hash === window.location.hash
  );
}

export function AppLink({ href, onClick, replace, scroll, target, className, ...rest }: Props) {
  const { managed, navigate, pendingHref } = useNavigation();
  const url = typeof href === "string" ? href : null;
  const pending = url !== null && pendingHref === url;

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (
      e.defaultPrevented ||
      !managed ||
      url === null ||
      !isInternal(url) ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      (target && target !== "_self") ||
      "download" in rest ||
      sameLocation(url)
    ) {
      return;
    }
    e.preventDefault();
    navigate(url, { replace, scroll });
  }

  return (
    <Link
      {...rest}
      href={href}
      replace={replace}
      scroll={scroll}
      target={target}
      onClick={handleClick}
      aria-busy={pending || undefined}
      className={pending ? `${className ?? ""} oe-pulse` : className}
    />
  );
}
