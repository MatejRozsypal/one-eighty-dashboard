/**
 * One turn of the One Eighty agent.
 *
 * Each turn runs the Claude Code CLI (via the Agent SDK) as a subprocess,
 * resumes the conversation's session from disk when there is one, and turns
 * the SDK's message stream into the small NDJSON event protocol the dashboard
 * reads. The agent is the same for everyone: same prompt, same tools, same
 * Meta login; sessions are what keep conversations apart.
 *
 * MCP servers are not passed here. Both live in the oeagent user's Claude
 * Code config (~/.claude.json), so `claude` over SSH and CloudCLI see the same
 * two servers: bigquery with `bin/bq-headers.mjs` as its headersHelper (fresh
 * service-account token per session), meta-ads with the OAuth grant stored by
 * `claude mcp login meta-ads`. The CLI loads that file on every run. See
 * deploy/README.md; `npm run check` proves both connect.
 */

import { query, type HookCallback, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { systemPrompt } from "./prompt.js";
import { ALLOWED, DASHBOARD_DENIED, FILE_TOOLS, fileArgsInsideWorkspace } from "./tools.js";

export type ChatEvent =
  | { type: "session"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; server: string; name: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface Turn {
  message: string;
  images: { mime: string; data: string }[];
  model: string;
  sessionId: string | null;
  user: string;
}

const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
export const isModel = (m: unknown): m is string => typeof m === "string" && MODELS.has(m);

const SERVER_LABEL: Record<string, string> = {
  bigquery: "BigQuery",
  "meta-ads": "Meta Ads",
};

/**
 * Last line of the dashboard's read-only guarantee: runs before every tool
 * call and refuses anything not on the read allowlist, and any file read or
 * search outside the workspace, independent of any settings file on the VPS.
 */
export const readOnlyGuard: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || ALLOWED.includes(input.tool_name)) return {};
  if (FILE_TOOLS.includes(input.tool_name)) {
    if (fileArgsInsideWorkspace(input.tool_name, input.tool_input)) return {};
    console.warn(`[agent] refused ${input.tool_name} outside the workspace`);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Only the One Eighty workspace (the Second Brain in ./brain) can be read here.",
      },
    };
  }
  console.warn(`[agent] refused ${input.tool_name} in the read-only dashboard`);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "The dashboard chat is read only. Changes are made in CloudCLI.",
    },
  };
};

async function* single(turn: Turn): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...turn.images.map((img) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: img.data,
          },
        })),
        ...(turn.message ? [{ type: "text" as const, text: turn.message }] : []),
      ],
    },
  };
}

export async function runTurn(
  turn: Turn,
  emit: (e: ChatEvent) => void,
  abort: AbortController
): Promise<void> {
  const q = query({
    prompt: single(turn),
    options: {
      model: turn.model,
      effort: "high",
      systemPrompt: systemPrompt("dashboard"),
      cwd: process.env.AGENT_WORKDIR ?? process.cwd(),
      tools: FILE_TOOLS,
      skills: [],
      // "user" loads the MCP servers from ~/.claude.json (bigquery with its
      // headersHelper, meta-ads with its stored login). Nothing else lives
      // there, and the read-only guard below holds whatever it contains.
      settingSources: ["user"],
      allowedTools: [...ALLOWED, ...FILE_TOOLS],
      disallowedTools: DASHBOARD_DENIED,
      permissionMode: "dontAsk",
      hooks: { PreToolUse: [{ hooks: [readOnlyGuard] }] },
      includePartialMessages: true,
      maxTurns: Number(process.env.AGENT_MAX_TURNS ?? 40),
      maxBudgetUsd: Number(process.env.AGENT_MAX_BUDGET_USD ?? 3),
      ...(turn.sessionId ? { resume: turn.sessionId } : {}),
      abortController: abort,
      env: {
        ...process.env,
        // The dashboard always reads BigQuery as the reader service account,
        // whatever key CloudCLI or the terminal are configured with.
        BQ_SERVICE_ACCOUNT_KEY_FILE:
          process.env.DASHBOARD_BQ_KEY_FILE ?? "/etc/oe-agent/bq-sa.json",
      },
    },
  });

  let wroteText = false;

  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") {
      emit({ type: "session", id: m.session_id });
      for (const s of m.mcp_servers) {
        if (s.status !== "connected") {
          console.warn(`[agent] mcp ${s.name} is ${s.status}`);
          emit({
            type: "notice",
            message: `${SERVER_LABEL[s.name] ?? s.name} is not available right now (${s.status}).`,
          });
        }
      }
    } else if (m.type === "stream_event" && m.parent_tool_use_id === null) {
      const e = m.event;
      if (e.type === "content_block_start") {
        const block = e.content_block;
        if (block.type === "tool_use" && block.name.startsWith("mcp__")) {
          const [, server = "", name = ""] = block.name.split("__");
          emit({ type: "tool", server: SERVER_LABEL[server] ?? server, name });
        } else if (block.type === "tool_use" && FILE_TOOLS.includes(block.name)) {
          emit({ type: "tool", server: "Second Brain", name: block.name.toLowerCase() });
        } else if (block.type === "text" && wroteText) {
          // Text before and after a tool call arrives as separate blocks.
          emit({ type: "text", delta: "\n\n" });
        }
      } else if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
        wroteText = true;
        emit({ type: "text", delta: e.delta.text });
      }
    } else if (m.type === "system" && m.subtype === "model_refusal_no_fallback") {
      emit({ type: "error", message: "The model declined this request. Try rephrasing it." });
    } else if (m.type === "result") {
      console.info(
        `[agent] ${turn.user} model=${turn.model} session=${m.session_id} ` +
          `turns=${m.num_turns} cost=$${m.total_cost_usd.toFixed(3)} ${m.subtype}`
      );
      if (m.subtype === "error_max_turns") {
        emit({ type: "error", message: "The question needed more steps than allowed. Try narrowing it." });
      } else if (m.subtype === "error_max_budget_usd") {
        emit({ type: "error", message: "This answer hit the per-question cost limit." });
      } else if (m.subtype !== "success") {
        emit({ type: "error", message: "The agent stopped with an error." });
      }
    }
  }
}
