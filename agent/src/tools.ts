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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

export const ALLOWED: string[] = read("../workspace/.claude/settings.json").permissions.allow;
export const DASHBOARD_DENIED: string[] = read("../policy/dashboard-readonly.json").deny;
