#!/usr/bin/env bash
set -euo pipefail

: "${GUARD_BASE_URL:?GUARD_BASE_URL is required}"
: "${AUTH0_ISSUER:?AUTH0_ISSUER is required}"
: "${AUTH0_AUDIENCE:?AUTH0_AUDIENCE is required}"
: "${AUTH0_READ_CLIENT_ID:?AUTH0_READ_CLIENT_ID is required}"
: "${AUTH0_READ_CLIENT_SECRET:?AUTH0_READ_CLIENT_SECRET is required}"
: "${AUTH0_ADMIN_CLIENT_ID:?AUTH0_ADMIN_CLIENT_ID is required}"
: "${AUTH0_ADMIN_CLIENT_SECRET:?AUTH0_ADMIN_CLIENT_SECRET is required}"

AUTH0_DOMAIN="${AUTH0_ISSUER#https://}"
AUTH0_DOMAIN="${AUTH0_DOMAIN%/}"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

mint_token() {
  local client_id="$1"
  local client_secret="$2"

  curl -sS -X POST "https://${AUTH0_DOMAIN}/oauth/token" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"${client_id}\",\"client_secret\":\"${client_secret}\",\"audience\":\"${AUTH0_AUDIENCE}\",\"grant_type\":\"client_credentials\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);if(!j.access_token){process.stderr.write(d);process.exit(1)};process.stdout.write(j.access_token)})'
}

echo ""
echo "=== Auth0 k3d smoke ==="
echo "Guard: ${GUARD_BASE_URL}"
echo ""

echo "1. Mint Auth0 tokens..."
READ_TOKEN="$(mint_token "$AUTH0_READ_CLIENT_ID" "$AUTH0_READ_CLIENT_SECRET")"
ADMIN_TOKEN="$(mint_token "$AUTH0_ADMIN_CLIENT_ID" "$AUTH0_ADMIN_CLIENT_SECRET")"
[[ -n "$READ_TOKEN" ]] || fail "Failed to mint read token"
[[ -n "$ADMIN_TOKEN" ]] || fail "Failed to mint admin token"
pass "Minted read/admin tokens"

echo "2. Guard health should report KV enabled..."
HEALTH="$(curl -sS "$GUARD_BASE_URL/health")"
KV_ENABLED="$(echo "$HEALTH" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(Boolean(j.kv_enabled)))})')"
[[ "$KV_ENABLED" == "true" ]] || fail "Expected kv_enabled=true"
pass "KV is enabled"

echo "3. UI endpoint should be reachable..."
UI_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" "http://ui.ephemeral.local/")"
[[ "$UI_HTTP" == "200" ]] || fail "Expected UI HTTP 200, got $UI_HTTP"
pass "UI responds with 200"

echo "4. Control-plane POST /servers should fail for read token..."
READ_ADD_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$GUARD_BASE_URL/servers" \
  -H "Authorization: Bearer $READ_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"tmp-read","url":"https://example.com/mcp","scopes":{"noop_tool":["demo:noop"]}}')"
[[ "$READ_ADD_HTTP" == "401" || "$READ_ADD_HTTP" == "403" ]] || fail "Expected 401/403 for read token, got $READ_ADD_HTTP"
pass "Read token blocked from control-plane mutation"

echo "5. Control-plane POST /servers should succeed for admin token..."
ADMIN_ADD_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$GUARD_BASE_URL/servers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"tmp-admin","url":"https://example.com/mcp","scopes":{"noop_tool":["demo:noop"]}}')"
[[ "$ADMIN_ADD_HTTP" == "200" ]] || fail "Expected 200 for admin add, got $ADMIN_ADD_HTTP"
pass "Admin token can mutate control plane"

echo "6. DELETE /servers/tmp-admin should succeed for admin token..."
ADMIN_DEL_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$GUARD_BASE_URL/servers/tmp-admin" \
  -H "Authorization: Bearer $ADMIN_TOKEN")"
[[ "$ADMIN_DEL_HTTP" == "200" ]] || fail "Expected 200 for admin delete, got $ADMIN_DEL_HTTP"
pass "Admin delete works"

echo "7. GET /audit should work with a valid bearer..."
AUDIT_HTTP="$(curl -sS -o /dev/null -w "%{http_code}" "$GUARD_BASE_URL/audit" -H "Authorization: Bearer $READ_TOKEN")"
[[ "$AUDIT_HTTP" == "200" ]] || fail "Expected 200 for audit read, got $AUDIT_HTTP"
pass "Audit read works"

echo ""
echo "=== All checks passed ==="
