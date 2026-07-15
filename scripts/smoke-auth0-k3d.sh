#!/usr/bin/env bash
set -euo pipefail

: "${GUARD_BASE_URL:?GUARD_BASE_URL is required}"
OPERATOR_TOKEN="${AUTH0_OPERATOR_BEARER_TOKEN:-}"

if [[ -z "$OPERATOR_TOKEN" ]]; then
  : "${MCP_JWT_ISSUER:?MCP_JWT_ISSUER is required when AUTH0_OPERATOR_BEARER_TOKEN is not set}"
  : "${MCP_JWT_AUDIENCE:?MCP_JWT_AUDIENCE is required when AUTH0_OPERATOR_BEARER_TOKEN is not set}"
  : "${AUTH0_OPERATOR_CLIENT_ID:?AUTH0_OPERATOR_CLIENT_ID is required when AUTH0_OPERATOR_BEARER_TOKEN is not set}"
  : "${AUTH0_OPERATOR_CLIENT_SECRET:?AUTH0_OPERATOR_CLIENT_SECRET is required when AUTH0_OPERATOR_BEARER_TOKEN is not set}"
fi

UI_BASE_URL="${UI_BASE_URL:-}"
AGENT_SCOPE="${AGENT_SCOPE:-flights:read}"
AGENT_SERVER_ID="${AGENT_SERVER_ID:-demo}"

AUTH0_DOMAIN="${MCP_JWT_ISSUER#https://}"
AUTH0_DOMAIN="${AUTH0_DOMAIN%/}"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

AGENT_CLIENT_ID=""

cleanup() {
  if [[ -n "$AGENT_CLIENT_ID" ]]; then
    curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$GUARD_BASE_URL/agents/$AGENT_CLIENT_ID" \
      -H "Authorization: Bearer $OPERATOR_TOKEN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mint_token() {
  local client_id="$1"
  local client_secret="$2"

  curl -sS -X POST "https://${AUTH0_DOMAIN}/oauth/token" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"${client_id}\",\"client_secret\":\"${client_secret}\",\"audience\":\"${MCP_JWT_AUDIENCE}\",\"grant_type\":\"client_credentials\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);if(!j.access_token){process.stderr.write(d);process.exit(1)};process.stdout.write(j.access_token)})'
}

echo ""
echo "=== Auth0 k3d smoke ==="
echo "Guard: ${GUARD_BASE_URL}"
if [[ -n "$UI_BASE_URL" ]]; then
  echo "UI: ${UI_BASE_URL}"
fi
echo ""

if [[ -n "$OPERATOR_TOKEN" ]]; then
  echo "1. Using provided operator bearer token (GUI-like flow)..."
  pass "Using provided operator token"
else
  echo "1. Mint operator Auth0 token (gateway:admin)..."
  OPERATOR_TOKEN="$(mint_token "$AUTH0_OPERATOR_CLIENT_ID" "$AUTH0_OPERATOR_CLIENT_SECRET")"
  [[ -n "$OPERATOR_TOKEN" ]] || fail "Failed to mint operator token"
  pass "Minted operator token"
fi

echo "2. Guard health should report KV enabled..."
HEALTH="$(curl -sS "$GUARD_BASE_URL/health")"
KV_ENABLED="$(echo "$HEALTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(Boolean(j.kv_enabled)))})')"
[[ "$KV_ENABLED" == "true" ]] || fail "Expected kv_enabled=true"
pass "KV is enabled"

if [[ -n "$UI_BASE_URL" ]]; then
  echo "3. UI endpoint should be reachable..."
  UI_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" "$UI_BASE_URL/")"
  [[ "$UI_HTTP" == "200" ]] || fail "Expected UI HTTP 200, got $UI_HTTP"
  pass "UI responds with 200"
else
  echo "3. UI check skipped (UI_BASE_URL not set)"
fi

echo "4. Create ephemeral agent via POST /agents..."
CREATE_JSON="$(curl -sS -X POST "$GUARD_BASE_URL/agents" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"ci-ephemeral-agent-$(date +%s)\",\"scopes\":[\"${AGENT_SCOPE}\"],\"serverId\":\"${AGENT_SERVER_ID}\"}")"
CREATE_STATUS="$(echo "$CREATE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);if(j.clientId && j.clientSecret){process.stdout.write("ok");}else{process.stdout.write("bad");}}catch{process.stdout.write("bad")}})')"
if [[ "$CREATE_STATUS" != "ok" ]]; then
  CREATE_ERR="$(echo "$CREATE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(String(j.error||j.message||"unknown error"));}catch{process.stdout.write("non-json response")}})')"
  fail "POST /agents failed: ${CREATE_ERR}"
fi
AGENT_CLIENT_ID="$(echo "$CREATE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);process.stdout.write(j.clientId||"")})')"
[[ -n "$AGENT_CLIENT_ID" ]] || fail "No clientId in create response"
pass "Created ephemeral agent: $AGENT_CLIENT_ID"

echo "5. Vend agent token via POST /agents/:clientId/token..."
VEND_JSON="$(curl -sS -X POST "$GUARD_BASE_URL/agents/$AGENT_CLIENT_ID/token" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')"
VEND_STATUS="$(echo "$VEND_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);if(j.token && j.expiresIn){process.stdout.write("ok");}else{process.stdout.write("bad");}}catch{process.stdout.write("bad")}})')"
[[ "$VEND_STATUS" == "ok" ]] || fail "Expected token/expiresIn from POST /agents/:clientId/token"
pass "Agent token vending works"

echo "6. Delete ephemeral agent via DELETE /agents/:clientId..."
DEL_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$GUARD_BASE_URL/agents/$AGENT_CLIENT_ID" \
  -H "Authorization: Bearer $OPERATOR_TOKEN")"
[[ "$DEL_HTTP" == "200" ]] || fail "Expected 200 from DELETE /agents/:clientId, got $DEL_HTTP"
pass "Deleted ephemeral agent"
AGENT_CLIENT_ID=""

echo "7. GET /audit should work with valid bearer..."
AUDIT_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" "$GUARD_BASE_URL/audit" -H "Authorization: Bearer $OPERATOR_TOKEN")"
[[ "$AUDIT_HTTP" == "200" ]] || fail "Expected 200 for audit read, got $AUDIT_HTTP"
pass "Audit read works"

echo ""
echo "=== All checks passed ==="
