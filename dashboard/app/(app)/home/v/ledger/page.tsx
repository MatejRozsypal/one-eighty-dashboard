/**
 * Home, variant "ledger": the partnership.
 *
 * Money first. The agency's agreed retainers, the profit share last invoiced
 * and the value generated for clients; then per client whether the
 * partnership pays for both sides; then the inputs still missing to finish
 * the picture. Reads and sources: lib/home/ledger/queries.ts.
 *
 * Internal only, like Home: it lists every client next to what they pay us.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { firstName } from "@/lib/home/greeting";
import { getLedgerData } from "@/lib/home/ledger/queries";
import { Header } from "@/components/shell/Header";
import { LedgerBody } from "@/components/home/ledger/LedgerBody";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomeLedgerPage() {
  await requireInternalRole();
  const [session, data] = await Promise.all([getSession(), getLedgerData()]);
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    <>
      <Header title="Home" />
      <LedgerBody data={data} name={name} now={new Date().toISOString()} />
    </>
  );
}
