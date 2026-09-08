/**
 * Conversation history — in this browser only, for now.
 *
 * ── Why localStorage and not Postgres yet ──────────────────────────────────
 * The real thing is per account and belongs in the app database beside
 * `app_users`. It is not there yet because a database path that has never been
 * run is how this app previously shipped an auth bootstrap that locked the only
 * account out of user management. This version is deliberately the shape of the
 * final one — a list of conversations, each a list of messages — so replacing
 * the storage underneath it touches this file and nothing else.
 *
 * What that costs, stated plainly: history lives in one browser. It is not
 * per account, it does not follow anyone to another device, and clearing site
 * data ends it.
 *
 * ── The quota ──────────────────────────────────────────────────────────────
 * localStorage is a few megabytes and images are kept, so it *will* fill.
 * Rather than letting a save throw and silently lose the conversation someone
 * is in the middle of, `save` sheds load: images from the oldest conversations
 * first, then the oldest conversations themselves, newest always protected.
 */

import type { Attachment } from "@/lib/image";

const KEY = "one-eighty:chat-history:v1";

export interface StoredMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  images?: Attachment[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
  /** Shipped as an illustration, not something the user wrote. */
  example?: boolean;
}

export function newId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** First line of the first thing said, which is what a person recognises. */
export function titleFrom(text: string, hasImage: boolean): string {
  const line = text.trim().split("\n")[0]?.trim();
  if (line) return line.length > 60 ? `${line.slice(0, 57)}…` : line;
  return hasImage ? "Image" : "New conversation";
}

const HOLDING =
  "This function is in progress. Please wait for further information from Matt. Thank you! 🤫";

/**
 * Examples, so the list is legible before anyone has typed anything.
 *
 * Marked `example` and removable. They are questions this business would
 * actually ask — attribution, dead stock, the cancelled-order trap — because a
 * seed of "Hello" and "Test 1" teaches a reader nothing about what the thing
 * is for.
 */
function seed(): Conversation[] {
  const now = Date.now();
  const hour = 3_600_000;
  const asked: Array<[string, number]> = [
    ["Is our ROAS good, or is Meta just marking its own homework?", 2],
    ["Which product is quietly losing us money on every order?", 9],
    ["Are Dobias's dog owners better customers than the humans?", 27],
    ["How much cash is sitting on a shelf pretending to be an asset?", 51],
    ["If I switched off every ad tomorrow, what actually happens?", 76],
    ["Please tell me we're not counting Stornována as revenue again.", 120],
  ];

  return asked.map(([text, agoHours], i) => {
    const at = now - agoHours * hour;
    return {
      id: `example-${i}`,
      title: titleFrom(text, false),
      createdAt: at,
      updatedAt: at,
      example: true,
      messages: [
        { id: 0, role: "user", text },
        { id: 1, role: "assistant", text: HOLDING },
      ],
    };
  });
}

export function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      const s = seed();
      save(s);
      return s;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    // Private mode, blocked site data, or something else wrote nonsense here.
    // An unreadable store must not take the page down with it.
    return seed();
  }
}

function attempt(list: Conversation[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function save(list: Conversation[]): void {
  if (attempt(list)) return;

  // Oldest first, so shedding starts furthest from what is on screen.
  const byAge = [...list].sort((a, b) => a.updatedAt - b.updatedAt);

  for (const conv of byAge) {
    let stripped = false;
    for (const m of conv.messages) {
      if (m.images?.length) {
        delete m.images;
        stripped = true;
      }
    }
    if (stripped && attempt(list)) return;
  }

  let remaining = [...list];
  while (remaining.length > 1) {
    const oldest = remaining.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
    remaining = remaining.filter((c) => c.id !== oldest.id);
    if (attempt(remaining)) {
      // The caller's array is the source of truth in memory; mirror the drop.
      list.length = 0;
      list.push(...remaining);
      return;
    }
  }
}

export function clearAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do, and nothing worth failing over */
  }
}
