/**
 * Creative analysis — the third product, not yet built.
 *
 * Rendered as an explicit statement of what it will be rather than as an empty
 * dashboard. The convention this follows is the one `/channels` already sets:
 * a screen that says a thing does not exist is honest, and a screen that shows
 * zeroes is a lie that someone will eventually quote in a meeting.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";

export const metadata: Metadata = { title: "Creative" };
export const dynamic = "force-dynamic";

export default async function CreativePage() {
  // The rail already hides this section from client-role users. This is the
  // gate: hiding a link is presentation, and presentation is not access
  // control — the URL is guessable and has to refuse on its own.
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "admin" && role !== "agency") {
    redirect("/snapshot");
  }

  return (
    <>
      <Header eyebrow="Creative" title="Creative" />

      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        <section className="flex flex-col gap-3 rounded-card border border-dashed border-hairline-strong bg-paper p-[24px]">
          <Eyebrow>Not built yet</Eyebrow>
          <h2 className="m-0 text-[20px] font-bold tracking-heading text-content-strong">
            Creative analysis starts here.
          </h2>
          <p className="m-0 max-w-[62ch] text-[13.5px] leading-[1.7] text-content-body">
            This is a second product rather than another Analytics page: it reads
            ad creatives — the image or video, the copy, the landing page — and
            asks which of them earned the return, which is a different question
            from the one the rest of the dashboard answers.
          </p>
          <p className="m-0 max-w-[62ch] text-[13.5px] leading-[1.7] text-content-muted">
            The warehouse already carries the performance half in
            <span className="font-mono text-[12.5px]"> mart_meta_ad_perf</span>.
            What it does not carry is the creative itself — the asset, its
            format, and the copy on it. That is the gap to close before anything
            here can be real.
          </p>
        </section>
      </main>
    </>
  );
}
