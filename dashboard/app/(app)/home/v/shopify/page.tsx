/**
 * Home variant "Sidekick home", after the Shopify admin home.
 *
 * Cross-client totals for the last 30 days across the top, a large greeting
 * with the assistant's box in the middle, chips of waiting work, then cards
 * from explicit rules ordered by money at stake, and the clients. Every
 * figure and sentence comes from `lib/home/shopify/data.ts`, which names its
 * sources; anything a source cannot give is n/a with the source in its (i).
 *
 * Internal only, like Home: it lists every client by name.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { firstName } from "@/lib/home/greeting";
import { getSidekickHome } from "@/lib/home/shopify/data";
import { Header } from "@/components/shell/Header";
import { SidekickHome } from "@/components/home/shopify/SidekickHome";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function SidekickHomePage() {
  await requireInternalRole();
  const [session, data] = await Promise.all([getSession(), getSidekickHome()]);
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    <>
      <Header title="Home" />
      <SidekickHome data={data} name={name} now={new Date().toISOString()} />
    </>
  );
}
