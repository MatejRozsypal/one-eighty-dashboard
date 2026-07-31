"use client";

/**
 * Client switcher.
 *
 * The selection lives in the URL (`?client=dobias`), not in a cookie or session,
 * so any dashboard view is a shareable, bookmarkable link and server components
 * can read it directly without client-side state syncing.
 *
 * Switching preserves every other search param — changing client should not
 * silently reset the date range you spent time choosing.
 */

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import type { Client } from "@/lib/clients";

function initials(name: string): string {
  return name
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function meta(client: Client): string {
  const platforms = [
    client.shopPlatform,
    client.emailPlatform,
    client.capabilities.meta && "meta",
    client.capabilities.googleAds && "google",
  ].filter(Boolean) as string[];

  const pretty = platforms.map((p) => p[0].toUpperCase() + p.slice(1));
  return [client.currency, ...pretty].join(" · ");
}

export function ClientSwitcher({
  clients,
  active,
}: {
  clients: Client[];
  active: Client;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Switching client re-runs every query on the page. The button adopts the new
  // client immediately so the switch reads as taken, not ignored.
  const { isPending, navigate } = useNavigation();
  const [optimistic, setOptimistic] = useState<Client | null>(null);
  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);

  const shown = optimistic ?? active;

  function select(clientId: string) {
    if (clientId === shown.clientId) {
      setOpen(false);
      return;
    }
    setOptimistic(clients.find((c) => c.clientId === clientId) ?? null);
    setOpen(false);

    const params = new URLSearchParams(searchParams.toString());
    params.set("client", clientId);
    navigate(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-2 font-mono text-[10px] uppercase tracking-eyebrow text-gray-400">
        Client
      </span>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-busy={isPending}
        className={`flex w-full items-center gap-2.5 rounded-control border border-white/[0.12] bg-white/[0.06] px-3 py-2.5 text-left text-content-inverse transition-colors duration-fast hover:bg-white/[0.11] ${
          isPending ? "animate-pulse" : ""
        }`}
      >
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg bg-growth-500/20 font-mono text-[11px] font-semibold text-growth-300">
          {initials(shown.name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">
            {shown.name}
          </span>
          <span className="truncate font-mono text-[10px] tracking-[0.06em] text-gray-300">
            {meta(shown)}
          </span>
        </span>
        <span className="text-[10px] text-gray-300" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 rounded-control border border-hairline-inverse bg-ink-800 p-1.5">
          {clients.map((c) => {
            const isActive = c.clientId === shown.clientId;
            return (
              <button
                key={c.clientId}
                type="button"
                onClick={() => select(c.clientId)}
                className={`flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2.5 text-left text-[13px] transition-colors duration-fast hover:bg-white/[0.08] ${
                  isActive ? "bg-growth-500/[0.14] text-growth-300" : "text-gray-250"
                }`}
              >
                {c.name}
                <span className="font-mono text-[10px] text-gray-400">
                  {c.currency}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
