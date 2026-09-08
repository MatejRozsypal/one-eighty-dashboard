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

async function reply(_message: string, _images: Img[]): Promise<string> {
  return HOLDING_REPLY;
}

interface Img {
  mime: string;
  dataUrl: string;
}

/** Ceiling on the decoded payload, under Vercel's 4.5MB request body limit. */
const MAX_TOTAL_BYTES = 3_500_000;
const MAX_IMAGES = 5;

function decodedBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  return i < 0 ? 0 : Math.floor((dataUrl.length - i - 1) * 0.75);
}

export async function POST(request: Request) {
  // Same gate as every page: this route sits outside the (app) layout that
  // enforces the session, so it has to enforce it itself.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !session.user.role) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let message = "";
  let images: Img[] = [];
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.trim() : "";
    images = Array.isArray(body?.images) ? body.images : [];
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // The browser already caps and re-encodes these. Checked again here because
  // the browser is not where a limit is enforced — it is where it is a
  // convenience.
  if (images.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_IMAGES} images.` },
      { status: 413 }
    );
  }
  let total = 0;
  for (const img of images) {
    if (
      typeof img?.mime !== "string" ||
      !img.mime.startsWith("image/") ||
      typeof img?.dataUrl !== "string" ||
      !img.dataUrl.startsWith("data:image/")
    ) {
      return NextResponse.json({ error: "Unsupported attachment." }, { status: 415 });
    }
    total += decodedBytes(img.dataUrl);
  }
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "Attachments are too large." }, { status: 413 });
  }

  // An image with no words is still a question.
  if (!message && images.length === 0) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  return NextResponse.json({ reply: await reply(message, images) });
}
