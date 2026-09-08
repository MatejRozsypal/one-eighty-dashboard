"use client";

/**
 * Top-right account and client menu.
 *
 * ── Why it lives here and not in `Header` ───────────────────────────────────
 * `Header` takes only an eyebrow and a title, and is called by every page. To
 * put this inside it, all fifteen pages would have to start passing the client
 * list and the session down. The layout already has both, so this renders from
 * there as a fixed element occupying the header's right-hand side. No page
 * changes, and no prop threaded through screens that have no interest in it.
 *
 * It sits above the sticky header (`z-40` against its `z-30`) because the panel
 * has to overlap the content scrolling beneath.
 *
 * ── Why the two controls merged ─────────────────────────────────────────────
 * The client switcher was top-left and the account bottom-left, which are the
 * two things you reach for when the question is "who am I and whose numbers am
 * I looking at". Answering that in one place, in the corner every SaaS tool
 * puts it, costs a click less and one fewer thing on the sidebar.
 *
 * Desktop only. Mobile keeps `MobileTopBar`, where the title doubles as the
 * page switcher and a second corner menu would crowd a 375pt bar.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useNavigation } from "@/components/shell/NavigationPending";
import { SETTINGS_HREF } from "@/lib/nav";
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

/**
 * Avatar tints, assigned by position in the list.
 *
 * Identity only — these never encode a value, so they carry none of the
 * obligations a chart palette does. They are here so two clients are told apart
 * at a glance in a menu, which is exactly what the Shopify store switcher this
 * mirrors does.
 */
const TINTS = [
  "bg-growth-500 text-ink-900",
  "bg-[#0866ff] text-white",
  "bg-[#db2777] text-white",
  "bg-[#a16207] text-white",
  "bg-ink-600 text-white",
];

const tintFor = (index: number) => TINTS[index % TINTS.length];

export function AccountMenu({
  clients,
  userName,
  userEmail,
  roleLabel,
  showSettings,
}: {
  clients: Client[];
  userName: string;
  userEmail: string;
  roleLabel: string;
  showSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Resolved here rather than passed in: layouts do not receive searchParams in
  // the App Router, and the selected client lives in the URL. This is display
  // only — the gate that decides whose data is actually served is
  // `resolveClient` on the server.
  const active =
    clients.find((c) => c.clientId === searchParams.get("client")) ?? clients[0];

  const { isPending, navigate } = useNavigation();
  // Switching re-runs every query on the page; adopting the new client straight
  // away makes the click read as taken rather than ignored.
  const [optimistic, setOptimistic] = useState<Client | null>(null);
  useEffect(() => {
    if (!isPending) setOptimistic(null);
  }, [isPending]);
  const shown = optimistic ?? active;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function select(clientId: string) {
    setOpen(false);
    if (clientId === shown.clientId) return;
    setOptimistic(clients.find((c) => c.clientId === clientId) ?? null);
    // Every other search param survives: changing client must not silently
    // reset the date range somebody spent time choosing.
    const params = new URLSearchParams(searchParams.toString());
    params.set("client", clientId);
    navigate(`${pathname}?${params.toString()}`);
  }

  const activeIndex = Math.max(
    0,
    clients.findIndex((c) => c.clientId === shown.clientId)
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 hidden h-[var(--header-h)] pt-[var(--safe-top)] lg:block lg:pl-[calc(var(--rail-w)+var(--nav-w))]">
      <div className="page-frame flex h-full items-center justify-end px-5 lg:px-8">
        <div ref={rootRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-busy={isPending}
        className={`flex items-center gap-2.5 rounded-control border border-hairline-strong bg-paper py-1.5 pl-1.5 pr-3 text-left shadow-sm transition-colors duration-fast hover:bg-gray-50 ${
          isPending ? "animate-pulse" : ""
        }`}
      >
        <span
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg font-mono text-[11px] font-semibold ${tintFor(activeIndex)}`}
        >
          {initials(shown.name)}
        </span>
        <span className="max-w-[190px] truncate text-[13px] font-semibold tracking-[-0.01em] text-content-strong">
          {shown.name}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`flex-none text-content-muted transition-transform duration-fast ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+10px)] w-[320px] overflow-hidden rounded-card border border-hairline bg-paper shadow-lg"
        >
          <div className="flex flex-col p-1.5">
            {clients.map((c, i) => {
              const isActive = c.clientId === shown.clientId;
              return (
                <button
                  key={c.clientId}
                  type="button"
                  role="menuitem"
                  onClick={() => select(c.clientId)}
                  className={`flex items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors duration-fast ${
                    isActive ? "bg-gray-100" : "hover:bg-gray-50"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg font-mono text-[11px] font-semibold ${tintFor(i)}`}
                  >
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content-strong">
                    {c.name}
                  </span>
                  <span className="flex-none font-mono text-[10px] text-content-muted">
                    {c.currency}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 border-t border-hairline px-3 py-3">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent font-mono text-[11px] font-semibold text-accent-contrast">
              {initials(userName)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold text-content-strong">
                {userName}
              </span>
              <span className="truncate text-[11.5px] text-content-muted">
                {userEmail}
              </span>
            </span>
            <span className="flex-none font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
              {roleLabel}
            </span>
          </div>

          <div className="flex flex-col border-t border-hairline p-1.5">
            {showSettings && (
              <Link
                href={SETTINGS_HREF}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-control px-2 py-2 text-[13px] text-content-body transition-colors duration-fast hover:bg-gray-50"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-none text-content-muted"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </Link>
            )}
            <a
              href="/api/auth/signout"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-control px-2 py-2 text-[13px] text-content-body transition-colors duration-fast hover:bg-gray-50"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-none text-content-muted"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </a>
          </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
