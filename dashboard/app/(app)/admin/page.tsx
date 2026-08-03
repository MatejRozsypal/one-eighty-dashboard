/**
 * Retired. Everything this screen did now lives under Settings.
 *
 * It listed every person across every client in one table and every client's
 * cost assumptions in another. The question people actually arrive with is
 * "what is set up for *this* client", and a flat list makes you answer that in
 * your head — worse with every client added.
 *
 * The route stays as a redirect rather than being deleted: it is bookmarked,
 * and a 404 on the way to user management is an unhelpful thing to meet.
 *
 * `actions.ts` and `UserForms.tsx` in this directory are still live — Settings
 * imports both. They were left where they are deliberately: moving the server
 * actions would have meant rewriting the authorisation checks on the only path
 * to managing access, for no gain beyond tidier file paths.
 */

import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/settings");
}
