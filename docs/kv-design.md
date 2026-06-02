# Vercel KV data model (Phase B)

**Navigation:** [NEXT-STEPS](NEXT-STEPS.md) · [ROADMAP #6](ROADMAP.md#release-030--hardening--multi-server) · [Vercel deploy](vercel-deploy.md)

Serverless flight MCP runs in **stateless** Vercel functions. In-memory audit and bookings split across cold starts. Phase B persists both via **Vercel KV** (Upstash Redis REST).

## Key namespaces

All keys use optional prefix `MCP_KV_PREFIX` (default `mcp-tool-guard:`).

| Prefix | Key pattern | Value | Access | TTL |
|--------|-------------|-------|--------|-----|
| **audit** | `{prefix}audit:recent` | Redis list of JSON entries | `LPUSH` + `LTRIM` (append) / `LRANGE` (read) | none (trimmed to 100) |
| **audit** | `{prefix}audit:session:{session_id}` | Redis list of JSON entries | same | none (trimmed to 100) |
| **booking** | `{prefix}booking:{booking_id}` | JSON booking blob | `SET` / `GET` | 7 days (`EX`) |

**Do not** store booking ids as bare `BK-*` keys — always under `booking:`.

## Audit entry shape

Same JSON as `GET /audit` rows today:

```json
{
  "timestamp": "2026-06-02T…",
  "decision": "allow",
  "server": "flight",
  "tool": "cancel_booking_tool",
  "required_scope": "flights:delete",
  "token_scopes": ["flights:read", "flights:write", "flights:delete"],
  "reason": null,
  "duration_ms": 12,
  "session_id": "sess_…",
  "trace_id": "tr_…"
}
```

Append writes to `audit:recent` always; when `session_id` is set, also append to `audit:session:{session_id}`.

`GET /audit?session_id=…` reads the session list; without `session_id`, reads `audit:recent`.

## Booking blob

Same dict as `create_booking_tool` returns (`booking_id`, `flight_id`, passenger fields, `status`, etc.).

Flight seat counts remain **in-memory** seed data (demo only). KV fixes **booking lookup** across invocations (book on instance A, cancel on instance B).

## Local dev

Without `KV_REST_API_URL` / `KV_REST_API_TOKEN`, flight uses **in-memory** stores (same as pre–Phase B). No KV account required locally.

## Vercel setup

1. Vercel dashboard → **Storage** → create **KV** store (or Upstash Redis).
2. **Connect** the store to project **`mcp-tool-guard-flight-server`**.
3. Redeploy flight — Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. `GET /health` → `"kv_enabled": true`.

Optional: set `MCP_KV_PREFIX` if sharing one KV across environments.

## Related

- [vercel-deploy.md → KV](vercel-deploy.md#vercel-kv-phase-b)
- [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment)
