#!/usr/bin/env bash
# Setup of the One Eighty agent on the Hostinger VPS (Ubuntu/Debian).
# Run as root from the uploaded agent folder:  sudo bash deploy/setup.sh
# Safe to re-run (also how updates are applied): it never overwrites
# agent.env, cloudcli.env, the Meta login or the CloudCLI account.
#
# One agent, three ways in, all as the `oeagent` user in one workspace:
#   dashboard chat  -> oe-agent service (Agent SDK)  agent.oneeighty.cz  READ ONLY
#   CloudCLI web UI -> cloudcli service (Agent SDK)  cli.oneeighty.cz    writes, each approved
#   terminal        -> `ssh -t root@vps oe-agent-cli`                    writes, each approved
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_CADDY="${SKIP_CADDY:-0}"
AS_AGENT=(sudo -u oeagent -H)

echo "== ports 80/443"
if ss -ltnp | grep -E ':(80|443)\s' | grep -vq caddy; then
  echo "Something other than Caddy already listens on 80/443:"; ss -ltnp | grep -E ':(80|443)\s'
  echo "Route both hosts in that proxy instead (deploy/README.md, 'Existing proxy'), then re-run with SKIP_CADDY=1."
  [ "$SKIP_CADDY" = 1 ] || exit 1
fi

echo "== Node 22 (CloudCLI needs 22+), Caddy, rsync"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if [ "$SKIP_CADDY" != 1 ] && ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi
command -v rsync >/dev/null || apt-get install -y rsync

echo "== oeagent user and directories"
id oeagent >/dev/null 2>&1 || useradd --create-home --shell /bin/bash oeagent
install -d -o oeagent -g oeagent /opt/oe-agent /var/lib/oe-agent /var/lib/oe-agent/work /var/lib/oe-agent/cloudcli
install -d -o root -g oeagent -m 750 /etc/oe-agent

echo "== agent code"
rsync -a --delete --exclude node_modules --exclude .env "$SRC/" /opt/oe-agent/
chown -R oeagent:oeagent /opt/oe-agent
"${AS_AGENT[@]}" bash -c 'cd /opt/oe-agent && npm ci --omit=dev --include=optional'
chmod +x /opt/oe-agent/bin/bq-headers.mjs

echo "== shared workspace (CLAUDE.md + project permissions; session data lives in ~oeagent/.claude)"
rsync -a "$SRC/workspace/" /var/lib/oe-agent/work/
chown -R oeagent:oeagent /var/lib/oe-agent/work

echo "== machine-wide policy: bypass mode off, so every write in CloudCLI/terminal asks for approval"
install -d -m 755 /etc/claude-code
install -m 644 /opt/oe-agent/policy/managed-settings.json /etc/claude-code/managed-settings.json

echo "== claude CLI on PATH (the one bundled with the SDK)"
ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
BIN="/opt/oe-agent/node_modules/@anthropic-ai/claude-agent-sdk-linux-${ARCH}/claude"
[ -x "$BIN" ] || { echo "Missing $BIN (optional dependency not installed?)"; exit 1; }
ln -sf "$BIN" /usr/local/bin/claude
install -m 755 /opt/oe-agent/deploy/oe-agent-cli /usr/local/bin/oe-agent-cli

echo "== env files"
if [ ! -f /etc/oe-agent/agent.env ]; then
  cp /opt/oe-agent/deploy/agent.env.example /etc/oe-agent/agent.env
  sed -i "s/^AGENT_SHARED_SECRET=.*/AGENT_SHARED_SECRET=$(openssl rand -hex 32)/" /etc/oe-agent/agent.env
fi
chown root:oeagent /etc/oe-agent/agent.env && chmod 640 /etc/oe-agent/agent.env
[ -f /etc/oe-agent/bq-sa.json ] && chown root:oeagent /etc/oe-agent/bq-sa.json && chmod 640 /etc/oe-agent/bq-sa.json
if [ ! -f /etc/oe-agent/cloudcli.env ]; then
  {
    printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf '# BigQuery key for CloudCLI and the terminal. Reader by default; point it at a\n'
    printf '# writer key (README, "BigQuery writes") to allow DML there. The dashboard ignores this.\n'
    printf 'BQ_SERVICE_ACCOUNT_KEY_FILE=/etc/oe-agent/bq-sa.json\n'
  } > /etc/oe-agent/cloudcli.env
fi
chown root:oeagent /etc/oe-agent/cloudcli.env && chmod 640 /etc/oe-agent/cloudcli.env

echo "== MCP servers in oeagent's user config (shared by all three interfaces)"
# Read the config file instead of `claude mcp get`, which health-checks the
# server and fails before the BigQuery key or the Meta login exist.
has_mcp() {
  "${AS_AGENT[@]}" node -e 'const c=JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude.json","utf8"));process.exit(c.mcpServers&&c.mcpServers[process.argv[1]]?0:1)' "$1" 2>/dev/null
}
if ! has_mcp bigquery; then
  "${AS_AGENT[@]}" claude mcp add-json --scope user bigquery \
    '{"type":"http","url":"https://bigquery.googleapis.com/mcp","headersHelper":"/opt/oe-agent/bin/bq-headers.mjs"}'
fi
if ! has_mcp meta-ads; then
  "${AS_AGENT[@]}" claude mcp add --scope user --transport http meta-ads https://mcp.facebook.com/ads
fi

echo "== CloudCLI"
CLOUDCLI_VERSION="1.37.3"
if [ "$(npm ls -g --depth=0 @cloudcli-ai/cloudcli 2>/dev/null | grep -o "@${CLOUDCLI_VERSION}" || true)" = "" ]; then
  npm install -g "@cloudcli-ai/cloudcli@${CLOUDCLI_VERSION}"
fi

echo "== systemd"
cp /opt/oe-agent/deploy/oe-agent.service /etc/systemd/system/oe-agent.service
cp /opt/oe-agent/deploy/cloudcli.service /etc/systemd/system/cloudcli.service
systemctl daemon-reload
systemctl enable oe-agent cloudcli

if [ "$SKIP_CADDY" != 1 ]; then
  echo "== Caddy (added beside whatever this VPS already serves, never in place of it)"
  cp /opt/oe-agent/deploy/oe-agent.caddy /etc/caddy/oe-agent.caddy
  grep -qF 'import /etc/caddy/oe-agent.caddy' /etc/caddy/Caddyfile 2>/dev/null \
    || printf '\nimport /etc/caddy/oe-agent.caddy\n' >> /etc/caddy/Caddyfile
  if [ ! -f /etc/caddy/cloudcli-auth.caddy ]; then
    echo "   (no CloudCLI gate password yet; README step 6 sets it. Until then cli.oneeighty.cz refuses everyone.)"
    printf 'basic_auth {\n\tnobody %s\n}\n' "$(caddy hash-password --plaintext "$(openssl rand -hex 24)")" \
      > /etc/caddy/cloudcli-auth.caddy
  fi
  caddy validate --config /etc/caddy/Caddyfile
  systemctl enable caddy
  systemctl reload caddy || systemctl restart caddy
fi

cat <<'NEXT'

Setup done. Remaining steps (deploy/README.md):
  3. Fill /etc/oe-agent/agent.env, upload /etc/oe-agent/bq-sa.json
  4. sudo -u oeagent -H claude mcp login meta-ads --no-browser
  5. sudo -u oeagent -H bash -c 'set -a; . /etc/oe-agent/agent.env; cd /opt/oe-agent && npm run check'
  6. CloudCLI gate password + first-account registration (do both before sharing the URL)
  7. systemctl restart oe-agent cloudcli
NEXT
