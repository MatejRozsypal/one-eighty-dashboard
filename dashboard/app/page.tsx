import { redirect } from "next/navigation";
import { currentAccess, isInternal } from "@/lib/authz";

/**
 * The root has no content of its own. Home is the landing page for the
 * agency; client-role users, who cannot see Home, land on Snapshot.
 * Redirects rather than rendering so the URL always names the page you're on.
 */
export default async function Root() {
  const access = await currentAccess();
  if (!access) redirect("/auth/signin");
  redirect(isInternal(access.role) ? "/home" : "/snapshot");
}
