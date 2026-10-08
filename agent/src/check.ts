/**
 * Setup check, run on the VPS after deploy:  npm run check
 *
 * Starts the agent exactly as a dashboard turn would (read only), reads the init message and
 * prints whether each MCP server connected and which of its tools the agent
 * can actually call. This is the proof that the SDK run picked up the
 * user-scope servers: the Meta login from `claude mcp login meta-ads` and the
 * BigQuery headersHelper, neither of which the SDK docs promise.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { ALLOWED, DASHBOARD_DENIED } from "./tools.js";

const q = query({
  prompt: "Reply with OK.",
  options: {
    model: "claude-sonnet-5-5",
    cwd: process.env.AGENT_WORKDIR ?? process.cwd(),
    tools: [],
    skills: [],
    settingSources: [],
    allowedTools: ALLOWED,
    disallowedTools: DASHBOARD_DENIED,
    permissionMode: "dontAsk",
    maxTurns: 1,
    env: { ...process.env, BQ_SERVICE_ACCOUNT_KEY_FILE: process.env.DASHBOARD_BQ_KEY_FILE ?? "/etc/oe-agent/bq-sa.json" },
  },
});

let ok = true;
for await (const m of q) {
  if (m.type === "system" && m.subtype === "init") {
    for (const s of m.mcp_servers) {
      const tools = m.tools.filter((t) => t.startsWith(`mcp__${s.name}__`));
      const callable = tools.filter((t) => ALLOWED.includes(t));
      const unlisted = tools.filter((t) => !ALLOWED.includes(t));
      console.log(`${s.name}: ${s.status}, ${callable.length} callable tools`);
      if (unlisted.length) console.log(`  not on the read list (refused in the dashboard): ${unlisted.join(", ")}`);
      if (s.status !== "connected") ok = false;
    }
    const builtins = m.tools.filter((t) => !t.startsWith("mcp__"));
    console.log(`built-in tools: ${builtins.length ? builtins.join(", ") : "none"}`);
    if (builtins.length) ok = false;
  }
  if (m.type === "result") console.log(`model reply: ${m.subtype === "success" ? m.result : m.subtype}`);
}
process.exit(ok ? 0 : 1);
