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
import { MobileNav } from "@/components/shell/MobileNav";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

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

  const clients = await getClients();

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

  const name = session?.user?.name ?? session?.user?.email ?? "Signed in";
  const role = session?.user?.email?.endsWith("@oneeighty.cz")
    ? "Founder · internal"
    : "Guest";

  return (
    <div className="flex min-h-screen items-start bg-bg-subtle">
      <Sidebar clients={clients} userName={name} userRole={role} />
      {/* Clears the floating bottom pill and the home indicator underneath it. */}
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(6rem+var(--safe-bottom))] lg:pb-0">
        {children}
      </div>
      <MobileNav initials={initialsOf(name)} />
    </div>
  );
}
