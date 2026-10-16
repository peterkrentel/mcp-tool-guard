#!/usr/bin/env bash
set -euo pipefail

: "${GUARD_BASE_URL:?GUARD_BASE_URL is required}"
# Entra token for a human operator holding gateway:admin (the workflow creates a temporary user for this).
: "${ENTRA_OPERATOR_BEARER_TOKEN:?ENTRA_OPERATOR_BEARER_TOKEN is required}"
OPERATOR_TOKEN="$ENTRA_OPERATOR_BEARER_TOKEN"

UI_BASE_URL="${UI_BASE_URL:-}"
AGENT_SCOPE="${AGENT_SCOPE:-flights:read}"
AGENT_SERVER_ID="${AGENT_SERVER_ID:-demo}"

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

echo ""
echo "=== Entra k3d smoke ==="
echo "Guard: ${GUARD_BASE_URL}"
if [[ -n "$UI_BASE_URL" ]]; then
  echo "UI: ${UI_BASE_URL}"
fi
echo ""

echo "1. Operator token: temporary Entra user with gateway:admin (provided by workflow)..."
pass "Using provided operator token"

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
json_field() { node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const v=JSON.parse(d)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
PENDING_ID="$(echo "$CREATE_JSON" | json_field pendingId)"
if [[ -z "$PENDING_ID" ]]; then
  fail "POST /agents did not return a pendingId: $(echo "$CREATE_JSON" | json_field error)"
fi
AGENT_CLIENT_ID=""
for _ in $(seq 1 60); do
  POLL_JSON="$(curl -sS "$GUARD_BASE_URL/agents/pending/$PENDING_ID")"
  POLL_STATUS="$(echo "$POLL_JSON" | json_field status)"
  if [[ "$POLL_STATUS" == "active" ]]; then
    AGENT_CLIENT_ID="$(echo "$POLL_JSON" | json_field clientId)"
    break
  elif [[ "$POLL_STATUS" == "failed" ]]; then
    fail "Agent creation failed: $(echo "$POLL_JSON" | json_field error)"
  fi
  sleep 1
done
[[ -n "$AGENT_CLIENT_ID" ]] || fail "Timed out waiting for agent creation (pendingId $PENDING_ID)"
pass "Created ephemeral agent: $AGENT_CLIENT_ID"

echo "5. GET /agents should list the newly created agent..."
LIST_JSON="$(curl -sS "$GUARD_BASE_URL/agents" -H "Authorization: Bearer $OPERATOR_TOKEN")"
LIST_HAS_AGENT="$(echo "$LIST_JSON" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>{try{const j=JSON.parse(d);const found=(j.agents||[]).some(a=>a.auth0ClientId===\"$AGENT_CLIENT_ID\");process.stdout.write(found?\"ok\":\"missing\");}catch{process.stdout.write(\"bad\")}})")"
[[ "$LIST_HAS_AGENT" == "ok" ]] || fail "Expected GET /agents to include the newly created agent (batched KV fetch)"
pass "Agent list includes the new agent"

echo "6. Vend agent token via POST /agents/:clientId/token..."
VEND_JSON="$(curl -sS -X POST "$GUARD_BASE_URL/agents/$AGENT_CLIENT_ID/token" \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')"
VEND_STATUS="$(echo "$VEND_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);if(j.token && j.expiresIn){process.stdout.write("ok");}else{process.stdout.write("bad");}}catch{process.stdout.write("bad")}})')"
[[ "$VEND_STATUS" == "ok" ]] || fail "Expected token/expiresIn from POST /agents/:clientId/token"
pass "Agent token vending works"

echo "7. Delete ephemeral agent via DELETE /agents/:clientId..."
DEL_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$GUARD_BASE_URL/agents/$AGENT_CLIENT_ID" \
  -H "Authorization: Bearer $OPERATOR_TOKEN")"
[[ "$DEL_HTTP" == "200" ]] || fail "Expected 200 from DELETE /agents/:clientId, got $DEL_HTTP"
pass "Deleted ephemeral agent"
AGENT_CLIENT_ID=""

echo "8. GET /audit should work with valid bearer..."
AUDIT_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" "$GUARD_BASE_URL/audit" -H "Authorization: Bearer $OPERATOR_TOKEN")"
[[ "$AUDIT_HTTP" == "200" ]] || fail "Expected 200 for audit read, got $AUDIT_HTTP"
pass "Audit read works"

echo ""
echo "=== All checks passed ==="
