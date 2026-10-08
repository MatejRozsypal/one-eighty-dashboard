#!/usr/bin/env node
/**
 * Claude Code `headersHelper` for the bigquery MCP server.
 *
 * Google's BigQuery MCP takes OAuth bearer tokens only, and they expire hourly,
 * so a static header in the config would die an hour after setup. Claude Code
 * runs this at session start and on reconnect (and again after a 401), and
 * sends whatever JSON it prints as request headers. One helper serves every
 * interface: the dashboard agent, `claude` over SSH and CloudCLI.
 *
 * Identity: the reader service account key at BQ_SERVICE_ACCOUNT_KEY_FILE,
 * default /etc/oe-agent/bq-sa.json. Prints nothing else to stdout.
 */

import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const keyFile = process.env.BQ_SERVICE_ACCOUNT_KEY_FILE || "/etc/oe-agent/bq-sa.json";
const auth = new GoogleAuth({
  credentials: JSON.parse(readFileSync(keyFile, "utf8")),
  scopes: ["https://www.googleapis.com/auth/bigquery"],
});
const token = await auth.getAccessToken();
if (!token) {
  console.error("bq-headers: Google returned no access token");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }));
