/**
 * Home, variant "Summary": the iPhone Health app's Summary tab, for the agency.
 *
 * Pinned activity rings per client against the Goals plan, rule-generated
 * Highlights, and the Clients list with status and money. Data and rules live
 * in lib/home/health; the layout in components/home/health.
 *
 * Internal only, like Home: it lists every client next to what they pay us.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { firstName } from "@/lib/home/greeting";
import { getSummaryData } from "@/lib/home/health/queries";
import { Header } from "@/components/shell/Header";
import { SummaryView } from "@/components/home/health/SummaryView";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomeSummaryPage() {
  await requireInternalRole();
  const [session, data] = await Promise.all([getSession(), getSummaryData()]);
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    <>
      <Header title="Home" />
      <main className="page-frame px-4 pb-14 pt-6 sm:px-5 lg:px-8">
        <SummaryView data={data} name={name} now={new Date().toISOString()} />
      </main>
    </>
  );
}
