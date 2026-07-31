import { redirect } from "next/navigation";

/**
 * The root has no content of its own — Snapshot is the home screen.
 * Redirects rather than rendering so the URL always names the page you're on.
 */
export default function Home() {
  redirect("/snapshot");
}
