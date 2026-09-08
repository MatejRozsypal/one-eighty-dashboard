/**
 * The Creative section's shell.
 *
 * Two jobs, and both are gates.
 *
 * The first is access. The rail already hides this section from client-role
 * users, but hiding a link is presentation and presentation is not access
 * control — the URL is guessable and has to refuse on its own. Enforcing it in
 * the layout rather than in each of the five pages means a sixth page added
 * later cannot forget.
 *
 * The second is the ground. `.creative-ground` carries the fixed green-tinted
 * gradient and the glass custom properties every surface in this section reads.
 * Scoping it here rather than globally is deliberate: Analytics is a P&L view
 * whose job is legibility of dense figures, and translucency there would cost
 * reading speed for nothing.
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function CreativeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "admin" && role !== "agency") {
    redirect("/snapshot");
  }

  return <div className="creative-ground min-h-full">{children}</div>;
}
