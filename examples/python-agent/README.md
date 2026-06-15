# Python Backend Agent Example

Demonstrates a non-browser Python agent calling the mcp-tool-guard proxy.

## What it shows

- MCP `tools/call` over plain HTTPS from a backend process (no SSE, no MCP SDK required)
- Bearer JWT authentication (demo token or Auth0 M2M)
- `create_booking` returns HTTP 202 + `pending_id` when write scope is absent
- Agent polls `GET /pending/:id` until an operator approves/denies
- Retries with `X-Approval-Token` header after approval

## Setup

```bash
# Point at your gateway (defaults to localhost:8787)
export GATEWAY_URL=https://your-gateway.onrender.com

# Option A: pass a token directly
export AGENT_JWT=$(node -e "console.log(require('../../ui/public/demo-tokens.json').read_only)")

# Option B: use a full write-scope token to skip the approval flow
export AGENT_JWT=$(node -e "console.log(require('../../ui/public/demo-tokens.json').full_access)")

# No dependencies needed — uses Python stdlib only
python agent.py
```

## Expected output (read_only token)

```
[agent] Gateway: http://localhost:8787  Server: flight
[agent] Calling search_flights …
[agent] Flights: ...
[agent] Calling create_booking …
[agent] Booking requires approval — pending_id: req_...
[agent] Waiting for approval of pending request req_... …
# (approve via curl or the /agents UI panel)
[agent] Approved — got approval token
[agent] Retrying create_booking with approval token …
[agent] Booking result: Booking confirmed for Ada Lovelace on FL001 seat 12A
[agent] Done.
```

## Dependencies

None — uses Python 3.11+ standard library only (`urllib`, `json`, `pathlib`).
