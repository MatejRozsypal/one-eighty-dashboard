/**
 * Assistant, the first product that is not Analytics.
 *
 * No BigQuery import anywhere in this subtree, deliberately. The separation is
 * the point of the section, and it is enforced by there being nothing to call
 * rather than by a rule someone has to remember.
 */

import type { Metadata } from "next";
import { Conversation } from "@/components/chat/Conversation";
import { CHAT_FRAME } from "@/components/chat/frame";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default function ChatPage() {
  // `h-screen` minus nothing: this page owns its own scrolling because the
  // composer is pinned to the bottom of the viewport, unlike every Analytics
  // page which scrolls as one document.
  return (
    // The corner account menu is position-fixed over the top `--header-h`, and
    // this page draws no Header of its own to reserve that space, so the first
    // message was sliding underneath it.
    //
    // On a phone a bare 100dvh overran the screen by the sticky bar above and
    // the shell's foot padding below, so the composer began below the fold.
    // CHAT_FRAME sizes it to the space between; see components/chat/frame.ts.
    <div className={CHAT_FRAME}>
      <Conversation />
    </div>
  );
}
