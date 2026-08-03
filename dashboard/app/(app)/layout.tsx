/**
 * Application shell — dark sidebar on desktop, bottom tab bar on mobile.
 *
 * ── This layout is the authentication gate ──────────────────────────────────
 * There is deliberately no `middleware.ts`. The original one used next-auth's
 * `withAuth`, which does not survive bundling into Vercel's Edge runtime — it
 * threw `ReferenceError: __dirname is not defined` on every single request,
 * so the whole site returned 500 including the sign-in page itself.
 *
 * Enforcing the session here instead is both simpler and stricter: this layout
 * wraps every data-bearing route, and it runs in the same place as the queries
 * it protects, so there is no window where a request reaches BigQuery without
 * a verified session. An edge gate can be misconfigured to let a route through;
 * this cannot, because the data and the check are in the same function.
 *
 * The client registry is fetched once here and shared by every page. Which
 * client is *selected* is resolved inside the Sidebar from the URL, because
 * layouts in the App Router don't receive searchParams.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileTopBar } from "@/components/shell/MobileTopBar";
import {
  NavigationPendingProvider,
  PendingRegion,
} from "@/components/shell/NavigationPending";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Checked before anything touches BigQuery — an unauthenticated request must
  // never reach a warehouse query, not even one that would return nothing.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/auth/signin");
  }

  // An account can exist and still be allowed nothing — deactivated, or a
  // Google login with no row once the store is populated. `role: null` is that
  // state, and it must not fall through to "sees everything".
  if (!session.user.role) {
    redirect("/auth/error?error=AccessDenied");
  }

  // A temporary password gets you exactly one destination until it is replaced.
  if (session.user.mustChangePassword) {
    redirect("/auth/change-password");
  }

  const allClients = await getClients();

  // This filtered list drives the switcher UI only — it is what a client-role
  // user sees in the sidebar dropdown. It is NOT the confinement gate: pages
  // fetch their own client list and resolve `?client=` themselves, so the real
  // enforcement lives in `resolveClient`, which reads the role from the session
  // and pins a client-role account to its own client no matter what the URL
  // asks for. Keep both: this one stops the *names* of other clients showing in
  // the switcher; `resolveClient` stops their *data* being loaded.
  const clients =
    session.user.role === "client"
      ? allClients.filter((c) => c.clientId === session.user.clientId)
      : allClients;

  if (clients.length === 0 && allClients.length > 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-editorial flex-col justify-center gap-3 px-6">
        <h1 className="text-heading font-bold text-content-strong">
          No client assigned
        </h1>
        <p className="text-content-body">
          This account is set to client access but the client it points at
          (<code className="font-mono text-[13px]">{session.user.clientId ?? "—"}</code>)
          is not active. An admin can fix that under Admin → Users.
        </p>
      </main>
    );
  }

  if (clients.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-editorial flex-col justify-center gap-3 px-6">
        <h1 className="text-heading font-bold text-content-strong">
          No active clients
        </h1>
        <p className="text-content-body">
          <code className="font-mono text-[13px]">ref.clients</code> has no rows
          with <code className="font-mono text-[13px]">status = &apos;active&apos;</code>,
          so there is nothing to show. Add one and reload.
        </p>
      </main>
    );
  }

  const name = session.user.name ?? session.user.email ?? "Signed in";
  const role =
    session.user.role === "admin"
      ? "Admin"
      : session.user.role === "agency"
        ? "Agency"
        : `Client · ${clients[0]?.name ?? session.user.clientId}`;
  const isAdmin = session.user.role === "admin";
  const isInternal = isAdmin || session.user.role === "agency";

  return (
    // The page background is light everywhere. The black at the top is painted
    // by MobileTopBar itself, which is sticky and covers the status-bar inset —
    // making the whole shell black instead left a black band under the content
    // on any page shorter than the viewport, and under Safari's bottom bar.
    <NavigationPendingProvider>
    <div className="flex min-h-screen items-start bg-bg-subtle">
      <Sidebar
        clients={clients}
        userName={name}
        userRole={role}
        isAdmin={isAdmin}
        isInternal={isInternal}
      />

      {/*
        `min-h-screen` here, not just on the row: the row is `items-start` so
        the sidebar can hug the top, which also stops this column from
        stretching — leaving a short page's rounded surface floating with black
        underneath it.
      */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <MobileTopBar clients={clients} isAdmin={isAdmin} />

        {/*
          One continuous surface for everything under the bar — which is why the
          bar cannot live inside the per-page Header.

          Deliberately NOT rounded: the curve is drawn by the sticky shoulder
          inside MobileTopBar, so it survives scrolling. A corner here would
          only exist at scroll-top.

          Bottom padding clears the home indicator.
        */}
        <div className="flex min-w-0 flex-1 flex-col bg-bg-subtle pb-[calc(1.5rem+var(--safe-bottom))] lg:pb-0">
          {/*
            Pulses the figures — and only the figures — while a control's
            navigation is in flight, so a stale number never sits there looking
            like the answer.
          */}
          <PendingRegion>{children}</PendingRegion>
        </div>
      </div>

    </div>
    </NavigationPendingProvider>
  );
}
