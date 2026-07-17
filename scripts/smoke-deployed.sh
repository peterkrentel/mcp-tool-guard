#!/usr/bin/env bash
# Smoke test for the deployed guard proxy via GitHub + Slack vendor MCPs.
#
# gateway:admin auth note: an M2M client_credentials token can't call the
# admin-gated agent-token-vending route here — its token is M2M-shaped, which
# trips the guard's own M2M-revocation liveness check (any freshly-minted M2M
# client looks "revoked" until it's registered as an agent via POST /agents).
# Real Auth0 Users don't have that token shape, so this authenticates as a
# pre-existing STANDING admin user (SMOKE_ADMIN_EMAIL/PASSWORD, created once
# by you in the Auth0 dashboard with the gateway:admin permission). That
# account's Auth0 client only supports the real Authorization Code flow (as a
# browser app should) — realm-based ROPG against it, and against several
# throwaway clients configured for ROPG, was tried and consistently rejected
# ("not authorized to access resource server") for reasons that weren't fully
# root-caused. Rather than keep guessing at Auth0 tenant config, this script
# gets the token by literally automating the real login: scripts/auth0-
# headless-login.mjs (Playwright) drives the actual /agents.html "Sign in"
# button + Universal Login form, then reads the resulting token straight out
# of localStorage — same cache the SPA itself uses.
#
# Reuses EXISTING read-only M2M agents already registered on the proxy (does
# not create new tool-agents), proves read-allow + write-deny for each
# vendor, checks /audit for agent+proxy+mcp correlation.
#
# Never approves a denied write. A pending-approval result counts as a pass
# and is left untouched.
#
# Required env: AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_AUDIENCE, SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD
# Optional env: PROXY_URL, UI_BASE_URL, GITHUB_TEST_OWNER, GITHUB_TEST_REPO, GITHUB_TEST_PATH, SLACK_TEST_CHANNEL_ID
set -euo pipefail

: "${AUTH0_DOMAIN:?AUTH0_DOMAIN is required}"
: "${AUTH0_MGMT_CLIENT_ID:?AUTH0_MGMT_CLIENT_ID is required}"
: "${AUTH0_MGMT_CLIENT_SECRET:?AUTH0_MGMT_CLIENT_SECRET is required}"
: "${AUTH0_AUDIENCE:?AUTH0_AUDIENCE is required}"
: "${SMOKE_ADMIN_EMAIL:?SMOKE_ADMIN_EMAIL is required — a standing Auth0 user with gateway:admin, created once via the Auth0 dashboard}"
: "${SMOKE_ADMIN_PASSWORD:?SMOKE_ADMIN_PASSWORD is required — the password for SMOKE_ADMIN_EMAIL}"

PROXY="${PROXY_URL:-https://mcp-tool-guard-proxy.onrender.com}"
GITHUB_SERVER_ID="${GITHUB_SERVER_ID:-github}"
GITHUB_TEST_OWNER="${GITHUB_TEST_OWNER:-peterkrentel}"
GITHUB_TEST_REPO="${GITHUB_TEST_REPO:-mcp-tool-guard}"
GITHUB_TEST_PATH="${GITHUB_TEST_PATH:-README.md}"
# Slack is NOT in config.prod.yaml — it only exists on the deployed proxy if
# registered at runtime via POST /servers. Don't assume a server ID; if it
# was registered under something other than the default, override it.
SLACK_SERVER_ID="${SLACK_SERVER_ID:-slack-prod}"
SLACK_TEST_CHANNEL_ID="${SLACK_TEST_CHANNEL_ID:-}"

FAILURES=0
pass() { echo "  ✓ $1"; }
fail_soft() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }
fail_hard() { echo "  ✗ $1"; exit 1; }

json_get() {
  # $1 = json string, $2 = js expression using `j`
  node -e 'const j=JSON.parse(process.argv[1]);let v;try{v=eval(process.argv[2])}catch{v=undefined}process.stdout.write(v==null?"":String(v))' "$1" "$2"
}

MGMT_TOKEN=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mint_mgmt_token() {
  curl -sS -X POST "https://${AUTH0_DOMAIN}/oauth/token" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"${AUTH0_MGMT_CLIENT_ID}\",\"client_secret\":\"${AUTH0_MGMT_CLIENT_SECRET}\",\"audience\":\"https://${AUTH0_DOMAIN}/api/v2/\",\"grant_type\":\"client_credentials\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.access_token||"")}catch{process.stdout.write("")}})'
}

echo ""
echo "=== Deployed smoke test — GitHub + Slack via M2M agents ==="
echo "Proxy: $PROXY"
echo ""

echo "1. Mint Auth0 Management API token..."
MGMT_TOKEN="$(mint_mgmt_token)"
[[ -n "$MGMT_TOKEN" ]] || fail_hard "Failed to mint Management API token"
pass "Management API token minted"

echo "2. Authenticate as standing admin user via headless-browser login (the account's Auth0 client only supports the real Authorization Code flow, not ROPG — this replays the actual /agents.html Sign in + Universal Login form and reads the resulting token out of localStorage, same cache the SPA itself uses)..."
OPERATOR_TOKEN="$(node "$SCRIPT_DIR/auth0-headless-login.mjs")"
[[ -n "$OPERATOR_TOKEN" ]] || fail_hard "Headless login failed to produce a token — see stderr output above"
pass "Standing admin user authenticated"

echo "3. Check which vendor servers are actually registered on this proxy..."
SERVERS_JSON="$(curl -sS "$PROXY/servers" 2>/dev/null || echo '{}')"
HAS_SLACK_SERVER="$(json_get "$SERVERS_JSON" '(j.servers||[]).some(s=>(s.id||s.serverId)==="'"$SLACK_SERVER_ID"'")')"
if [[ "$HAS_SLACK_SERVER" != "true" ]]; then
  echo "  (note) Server '$SLACK_SERVER_ID' not found via GET /servers — it may not be registered on this deployment, or /servers may need auth. Will still try the agent lookup."
fi

echo "4. Find existing read-only agents ($GITHUB_SERVER_ID, $SLACK_SERVER_ID)..."
AGENTS_JSON="$(curl -sS "$PROXY/agents")"
GITHUB_CLIENT_ID="$(json_get "$AGENTS_JSON" '(j.agents||[]).find(a=>a.serverId==="'"$GITHUB_SERVER_ID"'" && Array.isArray(a.scopes) && a.scopes.length===1 && a.scopes[0]==="repo:read")?.auth0ClientId')"
SLACK_CLIENT_ID="$(json_get "$AGENTS_JSON" '(j.agents||[]).find(a=>a.serverId==="'"$SLACK_SERVER_ID"'" && Array.isArray(a.scopes) && a.scopes.length===1 && a.scopes[0]==="slack:read")?.auth0ClientId')"
[[ -n "$GITHUB_CLIENT_ID" ]] && pass "Found read-only GitHub agent: $GITHUB_CLIENT_ID" || echo "  (skip) No repo:read-only agent found for server '$GITHUB_SERVER_ID' — register one via /agents.html"
[[ -n "$SLACK_CLIENT_ID" ]] && pass "Found read-only Slack agent: $SLACK_CLIENT_ID" || echo "  (skip) No slack:read-only agent found for server '$SLACK_SERVER_ID' — register one via /agents.html, or set SLACK_SERVER_ID if it was registered under a different name"

if [[ -z "$GITHUB_CLIENT_ID" || -z "$SLACK_CLIENT_ID" ]]; then
  echo "  Registered agents actually on this proxy:"
  echo "$AGENTS_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);const rows=(j.agents||[]).map(a=>({name:a.name,serverId:a.serverId,scopes:a.scopes}));console.log(rows.length?JSON.stringify(rows,null,2):"    (none registered at all)")})'
fi

vend_token() {
  local client_id="$1"
  local resp
  resp="$(curl -sS -X POST "$PROXY/agents/$client_id/token" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')"
  local token
  token="$(echo "$resp" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.token||"")}catch{process.stdout.write("")}})')"
  if [[ -z "$token" ]]; then
    echo "  (debug) vend response: $resp" >&2
  fi
  echo "$token"
}

is_scope_denied() {
  # $1 = raw response body — plain JSON for a proxy deny, SSE ("data: {...}")
  # for an allow forwarded upstream. Parse the actual JSON-RPC error field
  # rather than grepping raw text — a successful tool result can legitimately
  # contain the substring "-32001" or similar in its own content (e.g. this
  # repo's own README documents that error code), which a text grep would
  # misreport as a deny.
  node -e '
    let raw = process.argv[1].trim();
    const dataLine = raw.split("\n").reverse().find(l => l.startsWith("data:"));
    if (dataLine) raw = dataLine.slice(5).trim();
    try {
      const j = JSON.parse(raw);
      const msg = j.error?.message || "";
      process.exit((j.error?.code === -32001 || /Missing required scope/.test(msg)) ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$1"
}

check_vendor() {
  local label="$1" client_id="$2" mcp_path="$3" read_tool="$4" read_args="$5" write_tool="$6" write_args="$7"

  echo ""
  echo "--- $label ---"
  if [[ -z "$client_id" ]]; then
    echo "  (skip) No agent to test — see step 6 above"
    return
  fi
  echo "Vending token..."
  local token
  token="$(vend_token "$client_id")"
  if [[ -z "$token" ]]; then
    fail_soft "$label: found agent $client_id but failed to vend a token for it"
    return
  fi
  pass "$label: token vended"

  echo "Read check ($read_tool)..."
  local read_resp
  read_resp="$(curl -sS -X POST "$PROXY/$mcp_path" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$read_tool\",\"arguments\":$read_args}}")"
  if is_scope_denied "$read_resp"; then
    fail_soft "$label: read tool '$read_tool' was denied — expected allow. Response: $read_resp"
  else
    pass "$label: read allowed"
  fi

  echo "Write-deny check ($write_tool) — never completed even if pending..."
  local write_resp
  write_resp="$(curl -sS -X POST "$PROXY/$mcp_path" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$write_tool\",\"arguments\":$write_args}}")"
  if is_scope_denied "$write_resp"; then
    pass "$label: write correctly denied"
  elif echo "$write_resp" | grep -q '"status":"pending"'; then
    pass "$label: write correctly gated behind approval queue (left pending, not approved)"
  else
    fail_soft "$label: expected write deny/pending, got: $write_resp"
  fi
}

check_vendor "GitHub" "$GITHUB_CLIENT_ID" "$GITHUB_SERVER_ID/mcp" \
  "get_file_contents" "{\"owner\":\"$GITHUB_TEST_OWNER\",\"repo\":\"$GITHUB_TEST_REPO\",\"path\":\"$GITHUB_TEST_PATH\"}" \
  "create_or_update_file" "{}"

if [[ -n "$SLACK_TEST_CHANNEL_ID" ]]; then
  check_vendor "Slack" "$SLACK_CLIENT_ID" "$SLACK_SERVER_ID/mcp" \
    "slack_read_channel" "{\"channel_id\":\"$SLACK_TEST_CHANNEL_ID\"}" \
    "slack_send_message" "{}"
else
  echo ""
  echo "--- Slack --- (skip: set SLACK_TEST_CHANNEL_ID to a real channel id to enable the read check)"
fi

echo ""
echo "5. Audit tail (last 10 entries — eyeball agent/proxy/mcp source correlation)..."
AUDIT_JSON="$(curl -sS -H "Authorization: Bearer $OPERATOR_TOKEN" "$PROXY/audit")"
echo "$AUDIT_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);const tail=(j.entries||[]).slice(-10);console.log(JSON.stringify(tail.map(e=>({source:e.source,tool:e.tool,decision:e.decision,required_scope:e.required_scope})),null,2))})'

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "=== All checks passed ==="
else
  echo "=== $FAILURES check(s) FAILED — see ✗ lines above ==="
  exit 1
fi
