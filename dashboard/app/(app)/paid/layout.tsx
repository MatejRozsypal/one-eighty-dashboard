/**
 * The Paid section's shell: a role gate.
 *
 * The rail and sidebar already hide Paid from client-role users, but hiding a
 * link is presentation, not access control. The URL is guessable, so the
 * layout refuses on its own (same pattern as Creative): enforcing it here means
 * a fifth tab added later cannot forget.
 *
 * Overview, Meta, Google and GA4 are not tabs in the page: they are the children
 * of the Paid item in the sidebar (`lib/nav.ts`), so the pages render their own
 * header, control bar and `<main>` directly.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function PaidLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "admin" && role !== "agency") {
    redirect("/snapshot");
  }

  return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}
