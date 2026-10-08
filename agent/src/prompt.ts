/**
 * The agent's standing instructions: `workspace/CLAUDE.md`, the same file an
 * interactive `claude` or CloudCLI session in the workspace loads on its own,
 * so every interface gets one agent. The dashboard turn passes it explicitly
 * (with today's date) because it runs with no setting sources.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CLAUDE_MD = fileURLToPath(new URL("../workspace/CLAUDE.md", import.meta.url));
const BASE = readFileSync(CLAUDE_MD, "utf8");

const DASHBOARD = [
  "## This conversation",
  "You are answering in the dashboard chat, which is read only. You can query BigQuery, read Meta and read the Second Brain in ./brain, nothing else. If asked to change something, say exactly what to change (entity, current value, new value) and that it can be done in CloudCLI.",
].join("\n");

export function systemPrompt(surface: "dashboard"): string {
  const project = process.env.GCP_PROJECT_ID;
  return [
    BASE.trim(),
    "",
    surface === "dashboard" ? DASHBOARD : "",
    "",
    project ? `BigQuery project: \`${project}\`.` : "",
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ].join("\n");
}
