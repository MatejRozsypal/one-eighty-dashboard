/**
 * The assistant's reply: a pass-through to the One Eighty agent.
 *
 * The agent runs on its own server (`agent/` in this repo, Hostinger VPS): the
 * Claude Code CLI via the Agent SDK, with the BigQuery and Meta Ads MCP servers
 * attached. This route owns only who may talk to it. It checks the session,
 * validates the payload, and pipes the agent's NDJSON stream straight back
 * (`ChatEvent` in `agent/src/agent.ts`: session, text, tool, notice, error,
 * done). No model, warehouse or Meta credentials live in the dashboard.
 *
 * ── Who gets the real assistant ────────────────────────────────────────────
 * Internal roles only. The agent reads every client's data and acts through
 * one Meta login, so a `client` account here would undo the tenant isolation
 * every page enforces. Client accounts get the holding reply through the same
 * stream shape, so the UI has one code path.
 */

import { NextResponse } from "next/server";
import { currentAccess, isInternal } from "@/lib/authz";
import { DEFAULT_CHAT_MODEL, isChatModel } from "@/lib/chat/models";

export const dynamic = "force-dynamic";
/** Several SQL queries and Meta reads in one answer take a while. */
export const maxDuration = 300;

const HOLDING_REPLY = "Coming soon.";

interface Img {
  mime: string;
  dataUrl: string;
}

/** Ceiling on the decoded payload, under Vercel's 4.5MB request body limit. */
const MAX_TOTAL_BYTES = 3_500_000;
const MAX_IMAGES = 5;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const SESSION_ID = /^[0-9a-f-]{36}$/i;

function decodedBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  return i < 0 ? 0 : Math.floor((dataUrl.length - i - 1) * 0.75);
}

function ndjson(lines: object[]): Response {
  return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""), {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  // This route sits outside the (app) layout that enforces the session, so it
  // has to enforce it itself.
  const access = await currentAccess();
  if (!access) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (access.mustChangePassword) {
    return NextResponse.json({ error: "Change your password first." }, { status: 403 });
  }

  let message = "";
  let images: Img[] = [];
  let model = DEFAULT_CHAT_MODEL;
  let sessionId: string | null = null;
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.trim() : "";
    images = Array.isArray(body?.images) ? body.images : [];
    if (isChatModel(body?.model)) model = body.model;
    if (typeof body?.sessionId === "string" && SESSION_ID.test(body.sessionId)) {
      sessionId = body.sessionId;
    }
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // The browser already caps and re-encodes these. Checked again here because
  // the browser is not where a limit is enforced, it is where it is a
  // convenience.
  if (images.length > MAX_IMAGES) {
    return NextResponse.json({ error: `At most ${MAX_IMAGES} images.` }, { status: 413 });
  }
  let total = 0;
  for (const img of images) {
    if (
      typeof img?.mime !== "string" ||
      !IMAGE_TYPES.includes(img.mime) ||
      typeof img?.dataUrl !== "string" ||
      !img.dataUrl.startsWith(`data:${img.mime};base64,`)
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

  const agentUrl = process.env.AGENT_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!isInternal(access.role) || !agentUrl || !secret) {
    return ndjson([{ type: "text", delta: HOLDING_REPLY }, { type: "done" }]);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        message,
        images: images.map((img) => ({
          mime: img.mime,
          data: img.dataUrl.slice(img.dataUrl.indexOf(",") + 1),
        })),
        model,
        sessionId,
        user: access.email,
      }),
      // Closing the tab cancels this fetch, which closes the agent's stream,
      // which stops the agent.
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    console.error("[chat] agent unreachable", error);
    return NextResponse.json({ error: "The assistant is offline." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.json().catch(() => null);
    return NextResponse.json(
      { error: body?.error ?? `The assistant answered ${upstream.status}.` },
      { status: upstream.status === 429 ? 429 : 502 }
    );
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
