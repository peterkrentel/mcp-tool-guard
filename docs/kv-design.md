# Vercel KV data model (Phase B)

**Navigation:** [NEXT-STEPS](NEXT-STEPS.md) · [ROADMAP #6](ROADMAP.md#release-030--hardening--multi-server) · [Cursor guide](cursor-guide.md) · [Vercel deploy](vercel-deploy.md)

Serverless flight MCP runs in **stateless** Vercel functions. In-memory audit and bookings split across cold starts. Phase B persists both via **Vercel KV** (Upstash Redis REST).

## Key namespaces

All keys use optional prefix `MCP_KV_PREFIX` (default `mcp-tool-guard:`).

| Prefix | Key pattern | Value | Access | TTL |
| ------ | ----------- | ----- | ------ | --- |
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

## Guard proxy KV (agent gateway) {#guard-proxy-kv-agent-gateway}

**Status:** implemented — servers, agents, recent audit rows, and distributed rate-limit counters use Upstash REST when KV is configured.

| Key pattern | Value | Purpose |
| ----------- | ----- | ------- |
| `{prefix}gateway:servers:{id}` | JSON `{ url, scopes }` | MCP registry (extends yaml seed) |
| `{prefix}gateway:agents:{id}` | JSON agent record | Source of truth for [Auth0 sync](NEXT-STEPS.md#agent-registry-auth0-sync-sketch) |
| `{prefix}gateway:audit:recent` | JSON array / ring buffer | Persisted recent proxy audit rows (best-effort, capped to 500) |
| `{prefix}gateway:ratelimit:{ip}:{minute}` | integer counter | Distributed fixed-window rate limiting |

**Agent record shape (sketch):**

```json
{
  "id": "ag_…",
  "name": "test-flight",
  "serverId": "flight",
  "scopes": ["flights:read"],
  "auth0ClientId": "…",
  "auth0AppName": "mcp-agent-test-flight-flight-a1b2c3d4",
  "status": "active",
  "createdAt": "2026-06-09T…"
}
```

`clientSecretEnc` — AES-GCM at rest when `GATEWAY_AGENT_SECRET_KEY` or `AUTH0_MGMT_CLIENT_SECRET` is set; `POST /agents/:clientId/token` vends JWT for **Use** after refresh (never returned from `GET /agents`).

**Startup:** load `gateway:servers:*` into `ServerRegistry` → `syncGuardConfig(guard)`. Load agents for `GET /agents`.

**Local dev:** in-memory fallback when KV env unset (same as flight).

## Approval queue (Track 3, planned) {#approval-queue-track-3-planned}

**Status:** implemented — pending requests, approval tokens, and poll/retry flow are live on the proxy and exercised by [track3-approval-queue-proof.md](track3-approval-queue-proof.md).

| Key pattern | Value | Purpose |
| ----------- | ----- | ------- |
| `{prefix}gateway:pending:{id}` | JSON `PendingRequest` | One scope-elevation request (`status`: pending / approved / denied) |
| `{prefix}gateway:pending:index` | Redis list of ids | Append-only index; filter by `status` in app code |

**Audit:** `decision` includes `"pending"` for approval-queue handoff; approved retries and upstream completion generate follow-on allow rows under the same `trace_id`.

**UI path:** `/agents.html` lists pending requests and can approve or deny them; agents poll `GET /pending/:id` and retry with `X-Approval-Token` when approved.

## Related

- [vercel-deploy.md → KV](vercel-deploy.md#vercel-kv-phase-b)
- [NEXT-STEPS → Agent registry + Auth0 sync](NEXT-STEPS.md#agent-registry-auth0-sync-sketch)
- [cursor-guide.md → three tracks](cursor-guide.md)
- [CONCEPT → Remote deployment](CONCEPT.md#remote-deployment)
