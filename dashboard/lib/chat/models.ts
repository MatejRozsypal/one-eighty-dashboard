/**
 * The models the Assistant offers, shared by the picker and the route.
 *
 * Pure on purpose (no `server-only`): the browser renders the picker from this
 * list and the server validates the posted id against the same list, so a
 * hand-edited request cannot name a model nobody chose to pay for.
 */

export interface ChatModel {
  id: string;
  label: string;
  hint: string;
}

/**
 * Cheapest first after the default. Sonnet is the default: about a quarter of
 * Opus per answer and enough for most questions. Haiku is for quick lookups
 * (one number, one fact) at a fraction of Sonnet. Opus for the hard ones.
 */
export const CHAT_MODELS: readonly ChatModel[] = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Most questions" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Quick lookups, cheapest" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Deeper analysis, priciest" },
];

export const DEFAULT_CHAT_MODEL = "claude-sonnet-5-5";

export function isChatModel(id: unknown): id is string {
  return typeof id === "string" && CHAT_MODELS.some((m) => m.id === id);
}

/** `/api/chat/status`: whether the real assistant answers this person. */
export interface ChatStatus {
  live: boolean;
}

/** One line of the agent's NDJSON stream (`agent/src/agent.ts`). */
export type ChatEvent =
  | { type: "session"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; server: string; name: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };
