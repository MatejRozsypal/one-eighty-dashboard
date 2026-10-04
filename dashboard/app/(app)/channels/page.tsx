/**
 * Channels. No GA4 mart exists yet, so the page is the title and one line.
 */

import type { Metadata } from "next";
import { Header } from "@/components/shell/Header";
import { NotConnected } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Channels" };

export default function ChannelsPage() {
  return (
    <>
      <Header title="Channels" />
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <NotConnected source="GA4" />
      </main>
    </>
  );
}
