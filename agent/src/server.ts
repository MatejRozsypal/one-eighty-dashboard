/**
 * HTTP front of the agent. One endpoint the dashboard calls:
 *
 *   POST /chat   Authorization: Bearer $AGENT_SHARED_SECRET
 *     { message, images: [{ mime, data }], model, sessionId?, user }
 *   → NDJSON stream of ChatEvent, one per line, ending with {"type":"done"}
 *
 *   GET /health  liveness for the reverse proxy and uptime checks.
 *
 * Listens on 127.0.0.1 only; Caddy terminates HTTPS in front of it. The shared
 * secret is the only thing standing between the internet and a signed-in Meta
 * account, so it is compared in constant time and never logged.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isModel, runTurn, type ChatEvent, type Turn } from "./agent.js";

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.AGENT_SHARED_SECRET ?? "";
const MAX_CONCURRENT = Number(process.env.AGENT_MAX_CONCURRENT ?? 3);
const MAX_BODY = 6_000_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const SESSION_ID = /^[0-9a-f-]{36}$/i;

if (SECRET.length < 32) {
  console.error("AGENT_SHARED_SECRET must be set to at least 32 characters.");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

let running = 0;

function authorised(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(SECRET);
  return given.length === want.length && timingSafeEqual(given, want);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseTurn(body: any): Turn | string {
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const images = Array.isArray(body?.images) ? body.images : [];
  if (images.length > 5) return "At most 5 images.";
  for (const img of images) {
    if (!IMAGE_TYPES.has(img?.mime) || typeof img?.data !== "string") return "Unsupported attachment.";
  }
  if (!message && images.length === 0) return "Empty message.";
  if (!isModel(body?.model)) return "Unknown model.";
  const sessionId =
    typeof body?.sessionId === "string" && SESSION_ID.test(body.sessionId) ? body.sessionId : null;
  const user = typeof body?.user === "string" ? body.user.slice(0, 200) : "unknown";
  return { message, images, model: body.model, sessionId, user };
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, running });
  if (req.method !== "POST" || req.url !== "/chat") return json(res, 404, { error: "Not found." });
  if (!authorised(req)) return json(res, 401, { error: "Unauthorised." });

  let turn: Turn | string;
  try {
    turn = parseTurn(await readBody(req));
  } catch {
    return json(res, 400, { error: "Malformed request." });
  }
  if (typeof turn === "string") return json(res, 400, { error: turn });
  if (running >= MAX_CONCURRENT) {
    return json(res, 429, { error: "The assistant is busy. Try again in a moment." });
  }

  running++;
  const abort = new AbortController();
  // The dashboard closed the stream (tab closed, request cancelled): stop the
  // agent instead of paying for an answer nobody will read.
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  const emit = (e: ChatEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`);
  };

  try {
    await runTurn(turn, emit, abort);
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error("[agent] turn failed", error);
      emit({ type: "error", message: "The agent failed. Try again." });
    }
  } finally {
    running--;
    emit({ type: "done" });
    res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.info(`[agent] listening on 127.0.0.1:${PORT}`);
});
