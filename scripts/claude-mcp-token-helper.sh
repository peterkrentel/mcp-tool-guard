#!/usr/bin/env bash
# headersHelper for Claude Code (.mcp.json) — vends a fresh client_credentials
# token from a local M2M agent and tags the session with a cc-prefixed trace id
# so Claude-Code-originated traffic is filterable in the audit log and Grafana.
set -euo pipefail

# Claude Code invokes this as a subprocess of its own already-running process,
# which only has the env it was launched with — editing scripts/dev.env after
# launch has no effect there without a full restart. Fall back to reading it
# directly here so credential updates/rotation take effect on the next call.
if [ -z "${MCP_AGENT_CLIENT_ID:-}" ] || [ -z "${MCP_AGENT_CLIENT_SECRET:-}" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$script_dir/dev.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$script_dir/dev.env"
    set +a
  fi
fi

: "${MCP_AGENT_CLIENT_ID:?MCP_AGENT_CLIENT_ID is required}"
: "${MCP_AGENT_CLIENT_SECRET:?MCP_AGENT_CLIENT_SECRET is required}"
PROXY_URL="${PROXY_URL:-http://localhost:8787}"

node -e '
  const [proxyUrl, clientId, clientSecret] = process.argv.slice(1);
  (async () => {
    const res = await fetch(`${proxyUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const body = await res.json();
    if (!body.token) {
      process.stderr.write(JSON.stringify(body) + "\n");
      process.exit(1);
    }
    const traceId = `cc-${require("crypto").randomUUID()}`;
    process.stdout.write(JSON.stringify({ Authorization: `Bearer ${body.token}`, "X-Trace-Id": traceId, "X-Wait-For-Approval": "true" }));
  })().catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  });
' "$PROXY_URL" "$MCP_AGENT_CLIENT_ID" "$MCP_AGENT_CLIENT_SECRET"
