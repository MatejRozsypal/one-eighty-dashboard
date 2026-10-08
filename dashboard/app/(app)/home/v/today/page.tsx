/**
 * Home, variant "Today": an action inbox.
 *
 * The founders open the dashboard to learn what needs them today. Every item
 * on the list comes from one explicit rule over one named source
 * (`lib/home/today/rules.ts`), shows the number that fired it and links to
 * the page that resolves it. A source that cannot be read turns its own pill
 * n/a; it never reads as a quiet day. Under the list, the compact client table.
 *
 * Internal only, like Home: it names every client next to its figures.
 */

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { requireInternalRole } from "@/lib/authz";
import { firstName } from "@/lib/home/greeting";
import { getTodayData } from "@/lib/home/today/data";
import { Header } from "@/components/shell/Header";
import { TodayInbox } from "@/components/home/today/TodayInbox";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomeTodayPage() {
  await requireInternalRole();
  const [session, data] = await Promise.all([getSession(), getTodayData()]);
  const name = firstName(session?.user?.name, session?.user?.email);

  return (
    <>
      <Header title="Home" />
      <main className="page-frame px-5 pb-14 pt-6 lg:px-8">
        <TodayInbox
          items={data.items}
          sources={data.sources}
          clients={data.clients}
          clientsNote={data.clientsNote}
          day={data.day}
          name={name}
          now={new Date().toISOString()}
        />
      </main>
    </>
  );
}
