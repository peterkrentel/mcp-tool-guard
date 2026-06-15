#!/usr/bin/env bash
# Smoke test for Track 3 approval queue end-to-end.
# Requires proxy running locally with MCP_APPROVAL_QUEUE=true and MCP_GATEWAY_ADMIN_AUTH=false.
# Usage: ./scripts/smoke-approval.sh
set -euo pipefail

PROXY="${PROXY_URL:-http://localhost:8787}"

# read_only token has flights:read only — create_booking needs flights:write → triggers 202
READ_TOKEN=$(node -e "console.log(require('./ui/public/demo-tokens.json').read_only)")

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo ""
echo "=== Approval queue smoke test ==="
echo "Proxy: $PROXY"
echo ""

# ── Step 1: blocked tool call → 202 pending ──────────────────────────────────
echo "1. Call create_booking (needs flights:write, token has flights:read only)…"

RESPONSE=$(curl -sf -X POST "$PROXY/flight/mcp" \
  -H "Authorization: Bearer $READ_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_booking_tool","arguments":{"flight_id":"FL001","passenger_name":"Smoke Test"}}}')

STATUS=$(echo "$RESPONSE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.result?.status??'none')})")
PENDING_ID=$(echo "$RESPONSE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.result?.pending_id??'')})")

[[ "$STATUS" == "pending" ]] || fail "Expected status=pending, got: $STATUS"
[[ -n "$PENDING_ID" ]] || fail "No pending_id in response"
pass "Got 202 pending — id: $PENDING_ID"

# ── Step 2: admin approves ────────────────────────────────────────────────────
echo "2. Admin approves $PENDING_ID…"

APPROVE=$(curl -sf -X POST "$PROXY/pending/$PENDING_ID/approve" \
  -H "Content-Type: application/json" \
  -d '{"resolvedBy":"smoke-test"}')

APPROVE_STATUS=$(echo "$APPROVE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.pending?.status??'none')})")
APPROVAL_TOKEN=$(echo "$APPROVE" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.approval_token??'')})")

[[ "$APPROVE_STATUS" == "approved" ]] || fail "Expected approved, got: $APPROVE_STATUS"
[[ -n "$APPROVAL_TOKEN" ]] || fail "No approval_token in approve response"
pass "Approved — token: $APPROVAL_TOKEN"

# ── Step 3: retry with approval token ────────────────────────────────────────
echo "3. Retry create_booking with X-Approval-Token…"

RETRY=$(curl -sf -X POST "$PROXY/flight/mcp" \
  -H "Authorization: Bearer $READ_TOKEN" \
  -H "X-Approval-Token: $APPROVAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_booking_tool","arguments":{"flight_id":"FL001","passenger_name":"Smoke Test"}}}')

# Should NOT be pending — should be a real result or upstream error (flight may be unreachable)
RETRY_STATUS=$(echo "$RETRY" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.result?.status??'forwarded')})")
[[ "$RETRY_STATUS" != "pending" ]] || fail "Retry returned pending again — approval token not consumed"
pass "Tool call forwarded (status: $RETRY_STATUS)"

# ── Step 4: token is burned — replay should fail ──────────────────────────────
echo "4. Replay same token (should be rejected)…"

REPLAY_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROXY/flight/mcp" \
  -H "Authorization: Bearer $READ_TOKEN" \
  -H "X-Approval-Token: $APPROVAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_booking_tool","arguments":{"flight_id":"FL001","passenger_name":"Smoke Test"}}}')

# Should create a new pending (token burned → missing scope → queue again) or error
# Either way, approval_token must NOT grant access again
REPLAY=$(curl -sf -X POST "$PROXY/flight/mcp" \
  -H "Authorization: Bearer $READ_TOKEN" \
  -H "X-Approval-Token: $APPROVAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_booking_tool","arguments":{"flight_id":"FL001","passenger_name":"Smoke Test"}}}' || true)

REPLAY_STATUS=$(echo "$REPLAY" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log(r.result?.status??r.error?.message??'forwarded')}catch{console.log('error')}})" 2>/dev/null || echo "rejected")

[[ "$REPLAY_STATUS" == "pending" || "$REPLAY_STATUS" == "Approval token invalid" || "$REPLAY_STATUS" == "rejected" || "$REPLAY_STATUS" == "error" ]] \
  || fail "Token replay not blocked — got: $REPLAY_STATUS"
pass "Token replay blocked (status: $REPLAY_STATUS)"

echo ""
echo "=== All checks passed ==="
echo ""
