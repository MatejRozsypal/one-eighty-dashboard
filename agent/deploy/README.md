# One Eighty agent: deploy on the Hostinger VPS

One agent, three ways in. All of them run the same Claude Code, as the same
`oeagent` user, in the same workspace, with the same two MCP servers and the
same instructions. What differs is what they may change:

| Way in | Scope |
|---|---|
| Dashboard chat | Read only, enforced in code (allowlist, `dontAsk`, write and built-in tools removed, a PreToolUse guard) and by identity (BigQuery reader key, always) |
| CloudCLI | Full Claude Code. Reads run at once; every Meta or BigQuery write, and every shell or file tool, asks for approval |
| Terminal (`oe-agent-cli`) | Same as CloudCLI |


```
dashboard.oneeighty.cz/chat ─► /api/chat (Vercel: internal roles only)
        └─► https://agent.oneeighty.cz  (shared secret) ─► oe-agent   (Agent SDK)  ─┐
https://cli.oneeighty.cz  (gate password + login)     ─► cloudcli   (Agent SDK)  ─┼─► claude, cwd /var/lib/oe-agent/work
ssh -t root@vps oe-agent-cli                           ─► claude (interactive)   ─┘
                                                              ├─ bigquery  (reader service account, token via bin/bq-headers.mjs)
                                                              └─ meta-ads  (Matěj's Meta login, stored by `claude mcp login`)
```

What is shared, and where it lives on the VPS:

| What | File | From repo |
|---|---|---|
| Instructions | `/var/lib/oe-agent/work/CLAUDE.md` | `agent/workspace/CLAUDE.md` |
| Reads run without asking, writes always ask (CloudCLI, terminal) | `/var/lib/oe-agent/work/.claude/settings.json` | `agent/workspace/.claude/settings.json` |
| Bypass mode off, so no toggle can skip those approvals | `/etc/claude-code/managed-settings.json` | `agent/policy/managed-settings.json` |
| Dashboard read-only deny list | `/opt/oe-agent/policy/dashboard-readonly.json` | `agent/policy/dashboard-readonly.json` |
| MCP servers | `/home/oeagent/.claude.json` | `setup.sh` |
| Conversations | `/home/oeagent/.claude/projects/` | |

The managed policy is enforced by Claude Code above every user, project and UI
setting, so CloudCLI's "skip permissions" toggle cannot skip write approvals.
The dashboard's read-only scope does not depend on any of these files: it is
in the agent's code and holds even if someone loosens the workspace settings.
Because conversations are ordinary Claude Code sessions in one workspace, a chat started in the dashboard shows up in
CloudCLI under the `work` project, and either can be continued in the terminal
with `oe-agent-cli --resume <session id>`.

Time: about 30 minutes.

## 1. Before the VPS

**DNS.** A records `agent.oneeighty.cz` and `cli.oneeighty.cz` pointing at the VPS IP.

**GCP.** The service account the agent uses needs, on the project:

```bash
PROJECT=<gcp project id>
SA=sa-frontend-reader@$PROJECT.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/mcp.toolUser
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/bigquery.jobUser
```

It already reads `mart`. For `ref` or `stg` too, grant Data Viewer on those
datasets; to keep the agent apart from the dashboard, create a dedicated
`sa-assistant-reader` with the same roles and use its key below.

**Anthropic.** An API key from console.anthropic.com. Set a spend limit on its
workspace: CloudCLI and the terminal have no per-question cap, only the
dashboard has (`AGENT_MAX_BUDGET_USD`).

**Meta writes** in CloudCLI use the same login as reads (step 4), so they can
do whatever your own Meta user can do in those ad accounts.

## 2. Upload and install

From the Mac, in the repo root:

```bash
rsync -av --exclude node_modules agent/ root@<vps-ip>:/root/oe-agent-src/
ssh root@<vps-ip> 'bash /root/oe-agent-src/deploy/setup.sh'
```

It installs Node 22 and Caddy, the `oeagent` user, the agent, CloudCLI
1.37.3, the managed policy, both MCP servers in oeagent's config, the systemd
units and the Caddy sites. It stops first if something other than Caddy holds
ports 80/443 (see "Existing proxy").

## 3. Secrets

```bash
ssh root@<vps-ip> nano /etc/oe-agent/agent.env      # ANTHROPIC_API_KEY, GCP_PROJECT_ID
scp sa-key.json root@<vps-ip>:/etc/oe-agent/bq-sa.json
ssh root@<vps-ip> 'chown root:oeagent /etc/oe-agent/bq-sa.json && chmod 640 /etc/oe-agent/bq-sa.json'
```

## 4. Sign in to Meta (once)

```bash
ssh -t root@<vps-ip> sudo -u oeagent -H claude mcp login meta-ads --no-browser
```

It prints a Meta URL. Open it on the Mac, sign in as yourself, approve. The
browser lands on a localhost page that does not load: copy the full URL from
the address bar and paste it into the SSH prompt. Claude Code stores and
refreshes the grant for oeagent, and all three interfaces use it.

## 5. Check

```bash
ssh root@<vps-ip> "sudo -u oeagent -H bash -c 'set -a; . /etc/oe-agent/agent.env; cd /opt/oe-agent && npm run check'"
```

Expected:

```
bigquery: connected, 7 callable tools
meta-ads: connected, NN callable tools
built-in tools: none
model reply: OK
```

This runs the agent as the dashboard does (read only). `needs-auth` on
meta-ads: repeat step 4. `failed` on bigquery: check the key file and the two
IAM roles. A "not on the read list" line names tools Meta added since: refused
in the dashboard, asked for in CloudCLI. Add new reads to `allow` in
`agent/workspace/.claude/settings.json`, new writes to its `ask` list and to
`agent/policy/dashboard-readonly.json`.

## 6. Lock and claim CloudCLI (before sharing the URL)

CloudCLI is single user: whoever registers first owns it, it can change live
Meta campaigns, and it has a shell tab that runs as oeagent (which can read
`agent.env`). Hence two locks.

Gate password, checked by Caddy before anything reaches CloudCLI:

```bash
ssh -t root@<vps-ip>
HASH=$(caddy hash-password)        # type the password twice
printf 'basic_auth {\n\toneeighty %s\n}\n' "$HASH" > /etc/caddy/cloudcli-auth.caddy
systemctl reload caddy
```

Then start it and register the one account straight away:

```bash
systemctl restart cloudcli
```

Open https://cli.oneeighty.cz, pass the gate (user `oneeighty`), and create the
account. Open the `work` project; that is the agent.

## 7. Start the dashboard agent and connect Vercel

```bash
ssh root@<vps-ip> 'systemctl restart oe-agent && curl -s https://agent.oneeighty.cz/health'
```

In Vercel, project `one-eighty-dashboard`, Production env:

- `AGENT_URL` = `https://agent.oneeighty.cz`
- `AGENT_SHARED_SECRET` = the value in `/etc/oe-agent/agent.env`

Redeploy. Admin and agency accounts get the agent and the model picker; client
accounts keep "Coming soon."

## BigQuery writes (optional)

By default CloudCLI and the terminal also use the reader key, so BigQuery is
read only everywhere and only Meta can be changed. To allow DML/DDL in
CloudCLI, create a separate writer service account (Data Editor on the datasets
it may change, plus `roles/mcp.toolUser` and `roles/bigquery.jobUser`), upload
its key as `/etc/oe-agent/bq-sa-write.json` (root:oeagent, 640), set
`BQ_SERVICE_ACCOUNT_KEY_FILE=/etc/oe-agent/bq-sa-write.json` in
`/etc/oe-agent/cloudcli.env`, and `systemctl restart cloudcli`. The dashboard
keeps the reader key regardless.

## Terminal

```bash
ssh -t root@<vps-ip> oe-agent-cli                       # new conversation
ssh -t root@<vps-ip> oe-agent-cli --resume <session id> # continue one from the dashboard or CloudCLI
ssh -t root@<vps-ip> oe-agent-cli --model claude-sonnet-5-5
```

## Updates

```bash
rsync -av --exclude node_modules agent/ root@<vps-ip>:/root/oe-agent-src/
ssh root@<vps-ip> 'bash /root/oe-agent-src/deploy/setup.sh && systemctl restart oe-agent cloudcli'
```

Re-running never overwrites `agent.env`, `cloudcli.env`, the gate password,
the Meta login or the CloudCLI account. CloudCLI is pinned in `setup.sh`
(`CLOUDCLI_VERSION`); bump it there.

## Existing proxy

If nginx, Traefik or another Caddy already serves 80/443 on the VPS (n8n,
for example), run `SKIP_CADDY=1 bash deploy/setup.sh` and add both hosts there.
nginx:

```nginx
server {
  server_name agent.oneeighty.cz;
  location ~ ^/(chat|health)$ {
    proxy_pass http://127.0.0.1:8787;
    proxy_buffering off;              # stream the answer as it is written
    proxy_read_timeout 360s;
  }
  location / { return 404; }
}
server {
  server_name cli.oneeighty.cz;
  auth_basic "One Eighty"; auth_basic_user_file /etc/nginx/cloudcli.htpasswd;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;           # CloudCLI streams over websockets
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
# + the usual certbot ssl lines on both
```

## Operating

- Logs: `journalctl -u oe-agent` (one line per dashboard answer: user, model,
  session, turns, cost) and `journalctl -u cloudcli`.
- Meta login expired or revoked: repeat step 4.
- Rotate the shared secret: new value in `agent.env` and Vercel, restart, redeploy.
- Dashboard limits in `agent.env`: `AGENT_MAX_CONCURRENT` (3 parallel answers,
  then 429), `AGENT_MAX_TURNS` (40 tool steps), `AGENT_MAX_BUDGET_USD` (3 per answer).
- CloudCLI is AGPL-3.0. Running it unmodified, as here, needs nothing; if we
  ever patch it and serve it to others, the patched source must be offered to them.
