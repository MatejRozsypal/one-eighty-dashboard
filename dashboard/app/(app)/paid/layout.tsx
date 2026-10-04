/**
 * The Paid section's shell: a role gate and the tab bar.
 *
 * The rail and sidebar already hide Paid from client-role users, but hiding a
 * link is presentation, not access control. The URL is guessable, so the
 * layout refuses on its own (same pattern as Creative): enforcing it here means
 * a fifth tab added later cannot forget.
 *
 * ── Where the tab bar lands ─────────────────────────────────────────────────
 * Each page renders its own header, control bar and `<main>` as sibling
 * elements. The wrapper is a flex column that orders those siblings, so the
 * layout can slot the tabs between the header and the control bar without the
 * pages knowing: header, tabs, controls, content. The control bar sticks below
 * the tabs instead of under them (`--paid-tabs-h` is the tab bar's height).
 */

import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { PaidTabs } from "@/components/paid/PaidTabs";

export default async function PaidLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "admin" && role !== "agency") {
    redirect("/snapshot");
  }

  const clients = (await getClients()).map((c) => ({
    clientId: c.clientId,
    capabilities: c.capabilities,
  }));

  return (
    <div
      style={{ "--paid-tabs-h": "44px" } as CSSProperties}
      className="flex min-w-0 flex-1 flex-col [&>header]:order-1 [&>nav]:order-2 [&>:not(header):not(nav)]:order-3 lg:[&>div]:top-[calc(var(--header-h)+var(--paid-tabs-h))]"
    >
      <PaidTabs clients={clients} />
      {children}
    </div>
  );
}
