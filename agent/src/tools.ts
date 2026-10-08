/**
 * Tool policy. Two interfaces, two scopes, one agent:
 *
 *   Dashboard chat (this service): READ ONLY, enforced here in three layers.
 *     1. `ALLOWED` allowlist + permissionMode "dontAsk": anything not on it is
 *        refused without asking anyone, including tools Meta adds later.
 *     2. `DASHBOARD_DENIED` (policy/dashboard-readonly.json): every built-in
 *        tool (shell, files, web, subagents) and every known write tool is
 *        removed from the model's view.
 *     3. A PreToolUse hook in agent.ts that denies any call not in `ALLOWED`,
 *        whatever the settings files on the VPS say.
 *     Plus identity: BigQuery as the reader service account, always.
 *
 *   CloudCLI and `oe-agent-cli` (full Claude Code, writes allowed):
 *     workspace/.claude/settings.json  allow: the same read tools run without
 *                                      a prompt; ask: every Meta and BigQuery
 *                                      write asks for approval each time.
 *     /etc/claude-code/managed-settings.json (policy/managed-settings.json):
 *                                      bypass mode disabled, so CloudCLI's
 *                                      "skip permissions" cannot remove that.
 */

import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

export const ALLOWED: string[] = read("../workspace/.claude/settings.json").permissions.allow;
export const DASHBOARD_DENIED: string[] = read("../policy/dashboard-readonly.json").deny;

/**
 * Built-in tools the dashboard keeps: reading and searching files, so the
 * agent can use the Second Brain (workspace/brain, a clone of
 * MatejRozsypal/oneeighty-second-brain pulled every 10 minutes). Confined to
 * the workspace by `fileArgsInsideWorkspace`, which keeps the server's own
 * secrets (/etc/oe-agent, ~/.claude) out of reach of the chat.
 */
export const FILE_TOOLS = ["Read", "Glob", "Grep"];

const WORKDIR = (() => {
  const dir = process.env.AGENT_WORKDIR ?? process.cwd();
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
})();

function inside(p: unknown): boolean {
  // Glob and Grep default to the working directory, which is the workspace.
  if (p === undefined || p === null || p === "") return true;
  if (typeof p !== "string" || p.startsWith("~")) return false;
  const abs = resolve(WORKDIR, p);
  let real = abs;
  try {
    real = realpathSync(abs); // a symlink inside the repo must not lead out of it
  } catch {
    // Not on disk: judge the path as written.
  }
  return real === WORKDIR || real.startsWith(WORKDIR + sep);
}

/** A glob pattern that could reach outside the search root. */
const escapes = (g: unknown) =>
  typeof g === "string" && (g.startsWith("/") || g.startsWith("~") || g.split(/[\\/]/).includes(".."));

export function fileArgsInsideWorkspace(tool: string, input: unknown): boolean {
  const args = (input ?? {}) as Record<string, unknown>;
  if (tool === "Read") return typeof args.file_path === "string" && inside(args.file_path);
  if (tool === "Glob") return inside(args.path) && !escapes(args.pattern);
  if (tool === "Grep") return inside(args.path) && !escapes(args.glob);
  return false;
}
