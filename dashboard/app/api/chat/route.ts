/**
 * The assistant's reply.
 *
 * ── Why this is a real network round trip for a fixed string ────────────────
 * The answer is currently a placeholder Matěj wrote, but the *path* is the
 * finished one: the client posts a transcript, the server owns the reply, and
 * nothing about the model is decided in the browser. Faking it client-side
 * would have meant rewriting the page later rather than this file, and would
 * have left the interface unproven — latency, the pending state and error
 * handling are the parts of a chat that are actually hard, and they only exist
 * if there is a server to wait for.
 *
 * ── What replaces this ─────────────────────────────────────────────────────
 * Swap the body of `reply()` for an Anthropic call reading ANTHROPIC_API_KEY.
 * The route deliberately reads no warehouse data and holds no BigQuery client:
 * this product is separate from Analytics by design, and a query here would be
 * the first step in quietly merging them again.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Matěj's stated holding answer. Every question gets it, verbatim. */
const HOLDING_REPLY =
  "This function is in progress. Please wait for further information from Matt. Thank you! 🤫";

async function reply(_message: string): Promise<string> {
  return HOLDING_REPLY;
}

export async function POST(request: Request) {
  // Same gate as every page: this route sits outside the (app) layout that
  // enforces the session, so it has to enforce it itself.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !session.user.role) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let message = "";
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.trim() : "";
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  return NextResponse.json({ reply: await reply(message) });
}
