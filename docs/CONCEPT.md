# MCPToolGuard — Concept

**Navigation:** [Quick start](../README.md) · [Roadmap](ROADMAP.md) · [Changelog](../CHANGELOG.md)

Design reference for the repo. Task checklists and release status live in [ROADMAP.md](ROADMAP.md) only.

## Problem

AI agents call MCP tools with broad access. Without enforcement, any agent session can invoke destructive operations — cancel bookings, push code, send messages — with no audit trail.

## Solution

MCPToolGuard validates **JWT scopes** against per-tool policy on MCP `tools/call` and logs every allow/deny decision.

1. **Validate JWT** — signature, expiry (public key or JWKS)
2. **Read scopes** from the token (`flights:read`, `flights:write`, …)
3. **Match** against tool policy (YAML / `guard-config.ts`)
4. **Allow or deny** — server is authoritative; client SDK can pre-check first
5. **Audit** — structured JSON per decision (`session_id`, `trace_id`)

## Architecture

```
Browser tab (Vite + WebLLM)
├── WebLLM              ← local LLM (not the MCP caller)
├── Agent loop          ← ui/src/agent.ts
├── ToolGuard (SDK)     ← gateway/guard.ts — pre-check + agent-attempt log
└── MCP HTTP client     ← ui/src/mcp-client.ts (Bearer JWT)
         │
         │  HTTP / HTTPS
         ▼
Flight MCP server       ← servers/flight/ — guard middleware on tools/call
```

The **MCP caller** is `mcp-client.ts`, not WebLLM. WebLLM proposes tool JSON; the agent runs `ToolGuard.authorize`, then `tools/call` when allowed.

### Two audit planes (demo UI)

| Plane | Question | Trust |
|-------|----------|-------|
| **Agent attempts** (client `ToolGuard` log) | What did the agent try? Blocked before network? | Observability / debugging only |
| **Server enforcement** (`GET /audit`) | What reached MCP? JWT valid? Allow/deny? | **Authoritative** security record |

Correlate with `trace_id` when both exist. **No server row after a client deny is expected** — the attempt still appears under Agent attempts.

For compliance and production dashboards, use **server** guard JSON (Tier 2 → Grafana/Loki), not the browser log.

## Policy configuration

Keep these aligned (same tool names and `required_scope` values):

| File | Used by |
|------|---------|
| `servers/flight/guard_config.yaml` | Python server guard |
| `gateway/config.yaml` | SDK / tests |
| `ui/src/guard-config.ts` | Browser demo agent |

Example (flight tools):

```yaml
tools:
  search_flights_tool:
    required_scope: flights:read
  cancel_booking_tool:
    required_scope: flights:delete
    alert: true
```

Wildcards: `flights:*` or `*`.

## Demo vs production

Reference demo, not a hosted security product. [ROADMAP](ROADMAP.md) tracks IdP, durable audit, and observability sinks.

| Concern | Demo (now) | Production (later) |
|---------|------------|---------------------|
| Enforcement | Server on flight MCP + client SDK pre-check | Same pattern on every MCP hop |
| Audit storage | In-memory + UI panel | Log shipper → Loki/Datadog/etc. |
| Dashboards | In-browser sections | Grafana / SIEM |
| Identity | `demo-tokens.json` + public PEM | IdP, JWKS, short-lived tokens |

## Current limitations (demo)

| Limitation | Detail |
|------------|--------|
| Guard | Server enforces every `tools/call`; client pre-check is UX + intent audit only when MCP is public |
| Server audit | In-memory (`GET /audit`); resets on cold start |
| MCP surface | `initialize` / `tools/list` unguarded; no prompts, elicitation, or resources |
| Data | Mock in-memory flights/bookings |
| Multi-server | UI wires **flight** only; yaml stubs for slack/github are future |

## Remote deployment

- **UI** and **flight MCP** on separate HTTPS origins.
- Browser sends `Authorization: Bearer` on every MCP request.
- **Server** must enforce scopes — client-only checks are not sufficient.
- **HTTPS + JWT scopes** for browser → MCP; mTLS optional for service-to-service.

Deploy tasks: [ROADMAP 0.2.0](ROADMAP.md#release-020--remote--server-auth). Env vars: [README](../README.md#deploy).

## JWT & demo tokens

### Files

| Path | Purpose | Committed? |
|------|---------|------------|
| `keys/demo-private.pem` | Signs demo JWTs | No |
| `ui/public/demo-public.pem` | Verify in browser + server (local/CI) | Yes (public key only) |
| `ui/public/demo-tokens.json` | `read_only`, `booking`, `admin` JWTs | Yes (demo credentials) |

Regenerate: `make keys` or `npm run generate-keys`.

### Token format

- **Algorithm:** RS256
- **Claims:** `sub`, `iat`, `exp`, **`scope`** (space-separated)
- Also accepts `scopes` or `scp` for IdP compatibility

### Demo profiles

| UI key | Scopes | Search | Book | Cancel |
|--------|--------|--------|------|--------|
| `read_only` | `flights:read` | Yes | No | No |
| `admin` | + `flights:write`, `flights:delete` | Yes | Yes | Yes |

(`booking` = read + write, no delete.)

### Enforcement flow (demo)

```
Agent → ToolGuard.authorize (client audit) → mcp.callTool → server middleware (server audit) → tool handler
```

Production: use IdP-issued tokens and JWKS; do not ship private keys or long-lived prod tokens in the repo.

## Security layers

1. **Transport** — HTTPS (mTLS optional service-to-service)
2. **Identity** — JWT bearer
3. **Authorization** — per-tool scope from config
4. **Audit** — structured log (server = record of record)
5. **Alerts** — per tool (e.g. `cancel_booking_tool`)

## What this is not

- Not a SaaS IdP — consumes tokens; demo keys only for local use
- Not a substitute for server enforcement on a public MCP endpoint
- Not cloud-dependent for the LLM — WebLLM runs in the browser
